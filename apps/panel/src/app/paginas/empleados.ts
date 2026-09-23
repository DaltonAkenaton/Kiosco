/**
 * ============================================================================
 *  EMPLEADOS  (CLAUDE.md 10, 13.3)
 * ============================================================================
 *
 *  Alta, correccion de datos, PIN nuevo, baja y reactivacion; e importacion
 *  de una lista desde Excel (guardada como CSV).
 *
 *  Todo pasa por las funciones de la migracion 0015: cada una exige el rol
 *  admin y un motivo, y queda en la bitacora. Un supervisor ve la lista pero
 *  no los botones.
 *
 *  EL PIN LO DA EL SISTEMA. Al dar de alta (o pedir uno nuevo) la base genera
 *  un PIN al azar y lo devuelve UNA vez. Se muestra grande, con boton para
 *  imprimir, para que el jefe se lo de al empleado. No se vuelve a ver: en la
 *  base solo queda su hash.
 */

import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { desempatarUsuario, generarUsuario } from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { Sesion } from '../servicios/sesion';

interface Empleado {
  id: string;
  usuario: string;
  numero_empleado: string | null;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
  pin_temporal: boolean;
  activo: boolean;
}

interface Datos {
  nombre: string;
  paterno: string;
  materno: string;
  numero: string;
  usuario: string;
}

/** Un PIN recien generado, para mostrarlo una sola vez. */
interface PinParaEntregar {
  nombre: string;
  usuario: string;
  pin: string;
}

type Accion =
  | { tipo: 'alta' }
  | { tipo: 'editar'; empleado: Empleado }
  | { tipo: 'pin'; empleado: Empleado }
  | { tipo: 'estado'; empleado: Empleado }
  | { tipo: 'importar' };

@Component({
  selector: 'panel-empleados',
  imports: [Ayuda, Dialogo, NgTemplateOutlet],
  templateUrl: './empleados.html',
})
export class Empleados implements OnInit {
  protected readonly sesion = inject(Sesion);

  protected readonly empleados = signal<Empleado[]>([]);
  protected readonly buscar = signal('');
  protected readonly verBajas = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly accion = signal<Accion | null>(null);
  protected readonly datos = signal<Datos>({ nombre: '', paterno: '', materno: '', numero: '', usuario: '' });
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly pines = signal<PinParaEntregar[]>([]);

  /** Importacion: lo leido del archivo, antes de confirmar. */
  protected readonly porImportar = signal<(Datos & { problema: string | null })[]>([]);

  protected readonly AYUDA = {
    usuario:
      'Es lo que el empleado usaría para identificarse si el kiosco se configura en modo "usuario": la ' +
      'primera letra de su nombre y su apellido, sin acentos. El sistema lo propone solo.',
    pinTemporal:
      'Este PIN lo dio el jefe (por ejemplo, porque la persona olvidó el suyo). Funciona igual que ' +
      'cualquier otro.',
    importar:
      'Para dar de alta a muchos a la vez. En Excel, haz una hoja con las columnas nombre, ' +
      'apellido_paterno, apellido_materno y numero (el número de empleado, si lo tienen). Guárdala con ' +
      '"Guardar como" > "CSV UTF-8". Aquí se revisa antes de guardar, y al final se muestran los PIN de ' +
      'todos para imprimirlos.',
  };

  protected readonly visibles = computed(() => {
    const texto = this.buscar().trim().toLowerCase();
    return this.empleados()
      .filter((e) => this.verBajas() || e.activo)
      .filter(
        (e) =>
          !texto ||
          [e.nombre, e.apellido_paterno, e.apellido_materno, e.usuario, e.numero_empleado ?? '']
            .join(' ')
            .toLowerCase()
            .includes(texto),
      );
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const { data, error } = await this.sesion.bd
      .from('empleados')
      .select('id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno, pin_temporal, activo')
      .order('nombre')
      .order('apellido_paterno');
    if (error) {
      this.error.set('No se pudo traer la lista. Revisa el internet y vuelve a intentar.');
      return;
    }
    this.empleados.set(data as Empleado[]);
  }

  protected nombreCompleto(e: { nombre: string; apellido_paterno?: string; paterno?: string; apellido_materno?: string; materno?: string }): string {
    return [e.nombre, e.apellido_paterno ?? e.paterno, e.apellido_materno ?? e.materno].filter(Boolean).join(' ');
  }

  // --------------------------------------------------------------------------
  //  Abrir y cerrar acciones
  // --------------------------------------------------------------------------

  protected abrir(accion: Accion): void {
    this.errorAccion.set(null);
    if (accion.tipo === 'alta') {
      this.datos.set({ nombre: '', paterno: '', materno: '', numero: '', usuario: '' });
    } else if (accion.tipo === 'editar') {
      const e = accion.empleado;
      this.datos.set({
        nombre: e.nombre,
        paterno: e.apellido_paterno,
        materno: e.apellido_materno,
        numero: e.numero_empleado ?? '',
        usuario: e.usuario,
      });
    } else if (accion.tipo === 'importar') {
      this.porImportar.set([]);
    }
    this.accion.set(accion);
  }

  protected cerrar(): void {
    if (!this.guardando()) this.accion.set(null);
  }

  /**
   * Al escribir nombre o apellido en el ALTA, el usuario se propone solo
   * ("Dalton Gomez" -> "dgomez"; si ya existe, "dgomez2").
   */
  protected cambiarDato(campo: keyof Datos, valor: string): void {
    const nuevo = { ...this.datos(), [campo]: valor };
    if (this.accion()?.tipo === 'alta' && (campo === 'nombre' || campo === 'paterno')) {
      const base = generarUsuario(nuevo.nombre, nuevo.paterno) ?? '';
      nuevo.usuario = base ? desempatarUsuario(base, this.empleados().map((e) => e.usuario)) : '';
    }
    this.datos.set(nuevo);
  }

  /** `true` si se puede guardar; si no, deja dicho que falta. */
  private datosCompletos(): boolean {
    const d = this.datos();
    if (d.nombre.trim() === '' || d.paterno.trim() === '') {
      this.errorAccion.set('Falta el nombre o el apellido paterno.');
      return false;
    }
    if (!/^[a-z][a-z0-9.]{2,19}$/.test(d.usuario.trim())) {
      this.errorAccion.set('El usuario debe empezar con una letra y tener de 3 a 20 letras o números, sin espacios ni acentos.');
      return false;
    }
    return true;
  }

  // --------------------------------------------------------------------------
  //  Las acciones (cada una, una funcion de la base con motivo)
  // --------------------------------------------------------------------------

  private async ejecutar(trabajo: () => Promise<{ error: { message?: string } | null }>): Promise<boolean> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await trabajo();
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return false;
    }
    this.accion.set(null);
    await this.cargar();
    return true;
  }

  protected async guardarAlta(motivo: string): Promise<void> {
    if (!this.datosCompletos()) return;
    const d = this.datos();
    let pin = '';
    await this.ejecutar(async () => {
      const r = await this.sesion.bd.rpc('alta_empleado', {
        p_nombre: d.nombre, p_paterno: d.paterno, p_materno: d.materno,
        p_numero: d.numero, p_usuario: d.usuario, p_motivo: motivo,
      });
      pin = (r.data as { pin: string }[] | null)?.[0]?.pin ?? '';
      return r;
    });
    if (pin) this.pines.set([{ nombre: this.nombreCompleto(d), usuario: d.usuario, pin }]);
  }

  protected async guardarEdicion(empleado: Empleado, motivo: string): Promise<void> {
    if (!this.datosCompletos()) return;
    const d = this.datos();
    await this.ejecutar(() =>
      Promise.resolve(
        this.sesion.bd.rpc('editar_empleado', {
          p_id: empleado.id, p_nombre: d.nombre, p_paterno: d.paterno, p_materno: d.materno,
          p_numero: d.numero, p_usuario: d.usuario, p_motivo: motivo,
        }),
      ),
    );
  }

  protected async darPinNuevo(empleado: Empleado, motivo: string): Promise<void> {
    let pin = '';
    await this.ejecutar(async () => {
      const r = await this.sesion.bd.rpc('restablecer_pin', { p_id: empleado.id, p_motivo: motivo });
      pin = (r.data as string | null) ?? '';
      return r;
    });
    if (pin) this.pines.set([{ nombre: this.nombreCompleto(empleado), usuario: empleado.usuario, pin }]);
  }

  protected async cambiarEstado(empleado: Empleado, motivo: string): Promise<void> {
    await this.ejecutar(() =>
      Promise.resolve(
        this.sesion.bd.rpc('cambiar_estado_empleado', { p_id: empleado.id, p_activo: !empleado.activo, p_motivo: motivo }),
      ),
    );
  }

  // --------------------------------------------------------------------------
  //  Importar desde Excel (CSV)
  // --------------------------------------------------------------------------

  protected async leerArchivo(evento: Event): Promise<void> {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    const texto = (await archivo.text()).replace(/^﻿/, '');
    const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lineas.length < 2) {
      this.errorAccion.set('El archivo está vacío o sólo tiene los títulos.');
      return;
    }

    // Excel en español a veces separa con ";" en vez de ",".
    const separador = (lineas[0]!.match(/;/g)?.length ?? 0) > (lineas[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
    const titulos = lineas[0]!.split(separador).map((t) => t.trim().toLowerCase().replace(/\s+/g, '_'));
    const columna = (nombres: string[]): number => titulos.findIndex((t) => nombres.includes(t));
    const iNombre = columna(['nombre', 'nombres']);
    const iPaterno = columna(['apellido_paterno', 'paterno']);
    const iMaterno = columna(['apellido_materno', 'materno']);
    const iNumero = columna(['numero', 'numero_empleado', 'número', 'no_empleado']);
    if (iNombre < 0 || iPaterno < 0) {
      this.errorAccion.set('No encontré las columnas "nombre" y "apellido_paterno" en la primera fila.');
      return;
    }

    const usados = this.empleados().map((e) => e.usuario);
    const filas = lineas.slice(1).map((linea) => {
      const c = linea.split(separador).map((v) => v.trim().replace(/^"|"$/g, ''));
      const d = {
        nombre: c[iNombre] ?? '',
        paterno: c[iPaterno] ?? '',
        materno: iMaterno >= 0 ? (c[iMaterno] ?? '') : '',
        numero: iNumero >= 0 ? (c[iNumero] ?? '') : '',
        usuario: '',
      };
      const base = generarUsuario(d.nombre, d.paterno);
      let problema: string | null = null;
      if (!d.nombre || !d.paterno || !base) problema = 'Falta el nombre o el apellido';
      else {
        d.usuario = desempatarUsuario(base, usados);
        usados.push(d.usuario);
        if (d.numero && this.empleados().some((e) => e.numero_empleado === d.numero)) {
          problema = `Ya hay alguien con el número ${d.numero}`;
        }
      }
      return { ...d, problema };
    });
    this.errorAccion.set(null);
    this.porImportar.set(filas);
  }

  protected async guardarImportacion(motivo: string): Promise<void> {
    if (this.importables() === 0) {
      this.errorAccion.set('Primero elige un archivo con al menos una persona sin problemas.');
      return;
    }
    this.guardando.set(true);
    this.errorAccion.set(null);
    const entregados: PinParaEntregar[] = [];
    const fallidos: string[] = [];
    for (const d of this.porImportar().filter((f) => !f.problema)) {
      const r = await this.sesion.bd.rpc('alta_empleado', {
        p_nombre: d.nombre, p_paterno: d.paterno, p_materno: d.materno,
        p_numero: d.numero, p_usuario: d.usuario, p_motivo: motivo,
      });
      const pin = (r.data as { pin: string }[] | null)?.[0]?.pin;
      if (r.error || !pin) fallidos.push(`${this.nombreCompleto(d)}: ${mensajeDeError(r.error)}`);
      else entregados.push({ nombre: this.nombreCompleto(d), usuario: d.usuario, pin });
    }
    this.guardando.set(false);
    await this.cargar();
    if (fallidos.length > 0) {
      this.errorAccion.set(`No se pudieron dar de alta: ${fallidos.join(' · ')}`);
    } else {
      this.accion.set(null);
    }
    if (entregados.length > 0) this.pines.set(entregados);
  }

  protected importables(): number {
    return this.porImportar().filter((f) => !f.problema).length;
  }

  // --------------------------------------------------------------------------

  protected imprimirPines(): void {
    window.print();
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
