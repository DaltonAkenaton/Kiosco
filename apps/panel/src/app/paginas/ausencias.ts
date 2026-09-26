/**
 * ============================================================================
 *  INCIDENCIAS Y DIAS FESTIVOS  (CLAUDE.md 8 y 10, migracion 0020)
 * ============================================================================
 *
 *  Lo que evita que un dia "raro" cuente como falta o retardo:
 *
 *    - INCIDENCIAS (tabla `incidencias`), en dos familias:
 *        ausencia justificada  vacaciones, incapacidad, permiso, comision,
 *                              falta justificada (no vino, con razon);
 *        se da por bueno       no se registro, falla del sistema, retardo
 *                              justificado (el problema no fue suyo).
 *      Por persona o para varios a la vez (componentes/registrar-incidencia).
 *      Las puede registrar tambien un supervisor; las notas son el motivo.
 *    - DIAS FESTIVOS: nadie tiene que venir. Solo el administrador.
 *
 *  (La ruta sigue siendo /ausencias para no romper enlaces guardados.)
 *
 *  El reporte las toma en cuenta al momento: registrar unas vacaciones de la
 *  semana pasada corrige el reporte de la semana pasada.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { hoyEn } from '@kiosko/compartido';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { RegistrarIncidencia, familiaDeIncidencia, textoDeIncidencia } from '../componentes/registrar-incidencia';
import { Sesion } from '../servicios/sesion';

interface Incidencia {
  id: string;
  empleado_id: string;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  notas: string;
}

interface Festivo {
  fecha: string;
  descripcion: string;
}

@Component({
  selector: 'panel-ausencias',
  imports: [Dialogo, RegistrarIncidencia],
  templateUrl: './ausencias.html',
})
export class Ausencias implements OnInit {
  protected readonly sesion = inject(Sesion);

  protected readonly incidencias = signal<Incidencia[]>([]);
  protected readonly festivos = signal<Festivo[]>([]);
  protected readonly empleados = signal<{ id: string; nombre: string }[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly familia = familiaDeIncidencia;

  protected readonly registrando = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly porBorrar = signal<Incidencia | null>(null);
  protected readonly festivoNuevo = signal<{ fecha: string; descripcion: string } | null>(null);
  protected readonly festivoPorBorrar = signal<Festivo | null>(null);
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const [inc, fes, emp] = await Promise.all([
      this.sesion.bd.from('incidencias').select('id, empleado_id, tipo, fecha_inicio, fecha_fin, notas').order('fecha_inicio', { ascending: false }).limit(200),
      this.sesion.bd.from('dias_festivos').select('fecha, descripcion').order('fecha'),
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, apellido_materno').order('nombre'),
    ]);
    if (inc.error || fes.error || emp.error) {
      this.error.set('No se pudo traer la información. Revisa el internet.');
      return;
    }
    this.incidencias.set(inc.data as Incidencia[]);
    this.festivos.set(fes.data as Festivo[]);
    this.empleados.set((emp.data ?? []).map((e) => ({ id: e.id, nombre: [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' ') })));
  }

  protected nombre(id: string): string {
    return this.empleados().find((e) => e.id === id)?.nombre ?? '(desconocido)';
  }

  protected tipo(valor: string): string {
    return textoDeIncidencia(valor);
  }

  /** "2026-09-26" -> "26/09/2026" */
  protected dma(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  protected async alGuardar(mensaje: string): Promise<void> {
    this.registrando.set(false);
    this.aviso.set(mensaje);
    await this.cargar();
  }

  protected fechaLarga(iso: string): string {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  }

  protected async borrar(i: Incidencia, motivo: string): Promise<void> {
    await this.ejecutar(() => this.sesion.bd.rpc('borrar_incidencia', { p_id: i.id, p_motivo: motivo }), () => this.porBorrar.set(null));
  }

  protected abrirFestivo(): void {
    this.errorAccion.set(null);
    this.festivoNuevo.set({ fecha: hoyEn(this.sesion.zona()), descripcion: '' });
  }

  protected async guardarFestivo(): Promise<void> {
    const f = this.festivoNuevo();
    if (!f) return;
    await this.ejecutar(
      () => this.sesion.bd.rpc('guardar_dia_festivo', { p_fecha: f.fecha, p_descripcion: f.descripcion }),
      () => this.festivoNuevo.set(null),
    );
  }

  protected async borrarFestivo(f: Festivo, motivo: string): Promise<void> {
    await this.ejecutar(
      () => this.sesion.bd.rpc('borrar_dia_festivo', { p_fecha: f.fecha, p_motivo: motivo }),
      () => this.festivoPorBorrar.set(null),
    );
  }

  private async ejecutar(trabajo: () => PromiseLike<{ error: { message?: string } | null }>, alTerminar: () => void): Promise<void> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await trabajo();
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    alTerminar();
    await this.cargar();
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
