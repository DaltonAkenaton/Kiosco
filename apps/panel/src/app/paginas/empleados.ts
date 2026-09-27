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
 *  DERECHOS ARCO (CLAUDE.md 12, migracion 0017): "Sus datos" descarga todo
 *  lo que el sistema guarda de la persona, y "Suprimir sus datos" la vuelve
 *  anonima sin borrar sus marcas (son registro laboral e inmutables).
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
import { descargarExcel } from '../servicios/escribir-excel';
import { leerHojaDeExcel } from '../servicios/leer-excel';
import { Sesion } from '../servicios/sesion';
import { fecha, hora } from '../textos';

/** Lo que devuelve `datos_de_empleado` (migracion 0017). */
interface DatosArco {
  generado_en: string;
  aviso: string;
  empleado: Record<string, unknown> & { nombre: string; apellido_paterno: string; apellido_materno: string };
  marcas: { tipo: string; origen: string; hora: string; kiosco: string | null; foto_estado: string; banderas: string[] }[];
  correcciones: { accion: string; motivo: string; creado_en: string }[];
  ausencias: { tipo: string; desde: string; hasta: string; notas: string }[];
  horarios: { turno: string; desde: string; hasta: string | null }[];
  consultas_de_sus_fotos: { accion: string; cuando: string }[];
}

interface Empleado {
  id: string;
  usuario: string;
  numero_empleado: string | null;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
  pin_temporal: boolean;
  activo: boolean;
  anonimizado_en: string | null;
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
  | { tipo: 'datos'; empleado: Empleado }
  | { tipo: 'suprimir'; empleado: Empleado }
  | { tipo: 'demo' }
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

  /** ARCO: la constancia en pantalla, lista para imprimir o guardar como PDF. */
  protected readonly constancia = signal<{ empleado: Empleado; datos: DatosArco } | null>(null);
  protected readonly fecha = fecha;
  protected readonly hora = hora;

  /** Importar: el nombre del archivo elegido, para mostrarlo en español. */
  protected readonly nombreArchivo = signal('');

  /** Demostracion: cuantos dias de registros generar. */
  protected readonly diasDemo = signal(14);

  /** Suprimir: lo que el jefe teclea para confirmar (el usuario de la persona). */
  protected readonly confirmacion = signal('');

  /** Importacion: lo leido del archivo, antes de confirmar. */
  protected readonly porImportar = signal<(Datos & { problema: string | null })[]>([]);

  protected readonly AYUDA = {
    usuario:
      'Es lo que el empleado usaría para identificarse si el kiosco se configura en modo "usuario": la ' +
      'primera letra de su nombre y su apellido, sin acentos. El sistema lo propone solo.',
    pinTemporal:
      'Todavía usa el PIN que le dio el sistema (al darla de alta o con "PIN nuevo"). Funciona para ' +
      'checar, pero como tú lo viste, no es sólo suyo. La próxima vez que registre, el kiosco le ' +
      'pedirá elegir uno propio; puede decir "ahora no" y se le vuelve a preguntar. Cuando lo elija, ' +
      'esta nota desaparece.',
    arco:
      'La ley de protección de datos personales le da a cada persona derecho a saber qué datos suyos ' +
      'tiene el sistema (Acceso), a corregirlos (Rectificación), a pedir que se borren (Cancelación) ' +
      'y a oponerse a su uso (Oposición). Se les llama derechos ARCO. Antes de suprimir, consulta con ' +
      'la Unidad de Transparencia de la UAT: la asistencia es un registro laboral y puede que deba conservarse.',
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
      .select('id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno, pin_temporal, activo, anonimizado_en')
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
      this.nombreArchivo.set('');
    } else if (accion.tipo === 'suprimir') {
      this.confirmacion.set('');
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
  //  Datos de demostracion (migracion 0018)
  // --------------------------------------------------------------------------

  /** Genera 5 empleados inventados con sus registros, y muestra sus PIN. */
  protected async generarDemostracion(motivo: string): Promise<void> {
    let generados: { usuario: string; nombre: string; pin: string }[] = [];
    await this.ejecutar(async () => {
      const r = await this.sesion.bd.rpc('generar_datos_demostracion', { p_dias: this.diasDemo(), p_motivo: motivo });
      generados = (r.data as typeof generados | null) ?? [];
      return r;
    });
    if (generados.length > 0) this.pines.set(generados.map((g) => ({ nombre: g.nombre + ' (DEMO)', usuario: g.usuario, pin: g.pin })));
  }

  // --------------------------------------------------------------------------
  //  Derechos ARCO
  // --------------------------------------------------------------------------

  /** Acceso: descarga un archivo con todo lo que el sistema tiene de la persona. */
  protected async descargarDatos(empleado: Empleado, motivo: string): Promise<void> {
    let datos: unknown = null;
    const ok = await this.ejecutar(async () => {
      const r = await this.sesion.bd.rpc('datos_de_empleado', { p_id: empleado.id, p_motivo: motivo });
      datos = r.data;
      return r;
    });
    if (!ok || !datos) return;
    this.constancia.set({ empleado, datos: datos as DatosArco });
  }

  /**
   * Ademas de la hoja impresa, el archivo con TODO en formato de datos
   * (JSON). La ley pide entregar los datos "en un formato estructurado y
   * comunmente utilizado" si la persona lo solicita asi (portabilidad).
   */
  protected descargarArchivoArco(): void {
    const c = this.constancia();
    if (!c) return;
    const archivo = new Blob([JSON.stringify(c.datos, null, 2)], { type: 'application/json' });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = `datos-${c.empleado.usuario}-${new Date().toISOString().slice(0, 10)}.json`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  protected imprimirConstancia(): void {
    window.print();
  }

  /** "2026-09-26" -> "26/09/2026" */
  protected dma(iso: string | null): string {
    if (!iso) return '';
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }

  protected palabraDeAusencia(tipo: string): string {
    const palabras: Record<string, string> = {
      vacaciones: 'Vacaciones', incapacidad: 'Incapacidad', permiso: 'Permiso', comision: 'Comisión',
      falta_justificada: 'Falta justificada',
    };
    return palabras[tipo] ?? tipo;
  }

  protected palabraDeFoto(estado: string): string {
    const palabras: Record<string, string> = {
      con_foto: 'Tomada (sólo en el kiosco)', conservada: 'Conservada (en el kiosco)', sin_camara: 'Sin foto',
      obstruida: 'Cámara tapada', eliminada_por_antiguedad: 'Borrada por antigüedad', faltante: 'Falta', alterada: 'Alterada',
    };
    return palabras[estado] ?? estado;
  }

  /** Supresion: la persona deja de ser identificable. No se puede deshacer. */
  protected async suprimir(empleado: Empleado, motivo: string): Promise<void> {
    if (this.confirmacion().trim().toLowerCase() !== empleado.usuario) {
      this.errorAccion.set(`Para confirmar, escribe exactamente su usuario: ${empleado.usuario}`);
      return;
    }
    await this.ejecutar(() =>
      Promise.resolve(
        this.sesion.bd.rpc('anonimizar_empleado', {
          p_id: empleado.id, p_confirmar_usuario: this.confirmacion(), p_motivo: motivo,
        }),
      ),
    );
  }

  // --------------------------------------------------------------------------
  //  Importar desde Excel (CSV)
  // --------------------------------------------------------------------------

  protected async leerArchivo(evento: Event): Promise<void> {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    this.nombreArchivo.set(archivo.name);

    // Excel normal (.xlsx) o "CSV": los dos terminan como renglones de texto.
    let renglones: string[][];
    try {
      renglones = /\.xlsx$/i.test(archivo.name) ? await leerHojaDeExcel(archivo) : this.renglonesDeCsv(await archivo.text());
    } catch (fallo) {
      this.porImportar.set([]);
      this.errorAccion.set((fallo as Error).message);
      return;
    }
    if (renglones.length < 2) {
      this.porImportar.set([]);
      this.errorAccion.set('El archivo está vacío o sólo tiene los títulos. Llena un renglón por persona debajo de los títulos.');
      return;
    }

    // Titulos sin acentos ni mayusculas: "Número" = "numero".
    const titulos = renglones[0]!.map((t) =>
      t.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_'),
    );
    const columna = (nombres: string[]): number => titulos.findIndex((t) => nombres.includes(t));
    const iNombre = columna(['nombre', 'nombres']);
    const iPaterno = columna(['apellido_paterno', 'paterno']);
    const iMaterno = columna(['apellido_materno', 'materno']);
    const iNumero = columna(['numero', 'numero_empleado', 'no_empleado', 'numero_de_empleado']);
    if (iNombre < 0 || iPaterno < 0) {
      this.porImportar.set([]);
      this.errorAccion.set(
        'No encontré las columnas "nombre" y "apellido_paterno" en la primera fila. Lo más fácil: descarga la plantilla y copia ahí tus datos.',
      );
      return;
    }

    const usados = this.empleados().map((e) => e.usuario);
    const filas = renglones.slice(1).map((c) => {
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

  /** Un CSV a renglones. Excel en español a veces separa con ";" en vez de ",". */
  private renglonesDeCsv(texto: string): string[][] {
    const lineas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lineas.length === 0) return [];
    const separador = (lineas[0]!.match(/;/g)?.length ?? 0) > (lineas[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
    return lineas.map((l) => l.split(separador).map((v) => v.trim().replace(/^"|"$/g, '')));
  }

  /**
   * La plantilla para llenar en Excel (un .xlsx de verdad): la primera hoja
   * con los titulos exactos y dos renglones de ejemplo, y una segunda hoja
   * con las instrucciones. El panel lee siempre la PRIMERA hoja.
   */
  protected descargarPlantilla(): void {
    descargarExcel('plantilla-empleados.xlsx', [
      {
        nombre: 'Empleados',
        filas: [
          ['nombre', 'apellido_paterno', 'apellido_materno', 'numero'],
          ['María Elena', 'Garza', 'Salinas', '1234'],
          ['José Luis', 'Treviño', '', ''],
        ],
        anchos: [24, 22, 22, 14],
      },
      {
        nombre: 'Instrucciones',
        sinTitulos: true,
        anchos: [100],
        filas: [
          ['CÓMO LLENAR ESTA PLANTILLA'],
          ['1. Ve a la hoja "Empleados" (abajo, en las pestañas).'],
          ['2. Escribe una persona por renglón, debajo de los títulos. NO cambies la primera fila.'],
          ['3. Borra los dos renglones de ejemplo (María Elena y José Luis).'],
          ['4. "nombre" y "apellido_paterno" son obligatorios. "apellido_materno" y "numero" (de empleado) pueden ir vacíos.'],
          ['5. No hace falta escribir usuario ni PIN: los pone el sistema.'],
          ['6. Guarda el archivo (Archivo > Guardar) y en el panel: Empleados > Importar lista de Excel > Elegir archivo.'],
          ['7. El panel te muestra la lista para revisar ANTES de dar de alta a nadie. Al final, imprime la hoja de los PIN.'],
        ],
      },
    ]);
  }

  /** La lista del personal, en Excel. */
  protected exportarLista(): void {
    descargarExcel(`empleados-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        nombre: 'Empleados',
        filas: [
          ['Número', 'Nombre', 'Apellido paterno', 'Apellido materno', 'Usuario', 'Estado', 'PIN'],
          ...this.empleados()
            .filter((e) => !e.anonimizado_en)
            .map((e) => [
              e.numero_empleado ?? '', e.nombre, e.apellido_paterno, e.apellido_materno, e.usuario,
              e.activo ? 'Activo' : 'Dado de baja', e.pin_temporal ? 'Temporal (todavía no elige el suyo)' : 'Propio (lo eligió en el kiosco)',
            ]),
        ],
      },
    ]);
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
