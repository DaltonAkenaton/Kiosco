/**
 * ============================================================================
 *  INCIDENCIAS Y DIAS FESTIVOS  (ARQUITECTURA.md 8 y 10, migracion 0020)
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
 *  Filtros (21-10-2026): persona, tipo, fechas y buscar en las notas. Se
 *  piden a la base, no se filtra lo ya traido: antes solo llegaban las 200
 *  mas recientes y las viejas se perdian de vista sin avisar.
 *
 *  El reporte las toma en cuenta al momento: registrar unas vacaciones de la
 *  semana pasada corrige el reporte de la semana pasada.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { CargandoTabla, RENGLONES_CARGANDO } from '../componentes/cargando-tabla';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { ElegirEmpleado } from '../componentes/elegir-empleado';
import { RegistrarIncidencia, TIPOS_DE_INCIDENCIA, familiaDeIncidencia, textoDeIncidencia } from '../componentes/registrar-incidencia';
import { Avisos } from '../servicios/avisos';
import { senalRecordada } from '../servicios/recordar';
import { Sesion } from '../servicios/sesion';

interface Incidencia {
  id: string;
  empleado_id: string;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  notas: string;
}

/** Cuantas se traen como mucho; si se llega, se pide afinar los filtros. */
const MAXIMO_INCIDENCIAS = 300;

interface Festivo {
  fecha: string;
  descripcion: string;
}

@Component({
  selector: 'panel-ausencias',
  imports: [Ayuda, CargandoTabla, Dialogo, ElegirEmpleado, RegistrarIncidencia],
  templateUrl: './ausencias.html',
})
export class Ausencias implements OnInit {
  protected readonly sesion = inject(Sesion);
  private readonly avisos = inject(Avisos);
  protected readonly cargando = signal(true);
  protected readonly RENGLONES_CARGANDO = RENGLONES_CARGANDO;

  protected readonly incidencias = signal<Incidencia[]>([]);
  protected readonly festivos = signal<Festivo[]>([]);
  protected readonly empleados = signal<{ id: string; nombre: string }[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly familia = familiaDeIncidencia;
  protected readonly TIPOS = TIPOS_DE_INCIDENCIA;
  protected readonly MAXIMO = MAXIMO_INCIDENCIAS;

  // Filtros: se recuerdan al cambiar de pantalla, como en Reportes.
  protected readonly filtroEmpleado = senalRecordada('incidencias.empleado', '');
  protected readonly filtroTipo = senalRecordada('incidencias.tipo', '');
  protected readonly filtroDesde = senalRecordada('incidencias.desde', '');
  protected readonly filtroHasta = senalRecordada('incidencias.hasta', '');
  protected readonly filtroTexto = senalRecordada('incidencias.texto', '');
  protected readonly hayFiltros = computed(
    () => !!(this.filtroEmpleado() || this.filtroTipo() || this.filtroDesde() || this.filtroHasta() || this.filtroTexto().trim()),
  );
  /**
   * Total de dias que suman las incidencias que se ven, contando solo los que
   * caen entre Desde y Hasta: una incapacidad del 28 al 3, buscando octubre,
   * suma 3 dias y no 6.
   */
  protected readonly diasEnTotal = computed(() => {
    const desde = this.filtroDesde();
    const hasta = this.filtroHasta();
    return this.incidencias().reduce((suma, i) => {
      const inicio = desde && desde > i.fecha_inicio ? desde : i.fecha_inicio;
      const fin = hasta && hasta < i.fecha_fin ? hasta : i.fecha_fin;
      return suma + Math.max(0, Math.round((Date.parse(fin) - Date.parse(inicio)) / 86_400_000) + 1);
    }, 0);
  });
  private consulta = 0;

  protected readonly registrando = signal(false);
  protected readonly porBorrar = signal<Incidencia | null>(null);
  protected readonly festivoNuevo = signal<{ fecha: string; descripcion: string } | null>(null);
  protected readonly festivoPorBorrar = signal<Festivo | null>(null);
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const esta = ++this.consulta;
    let inc = this.sesion.bd.from('incidencias').select('id, empleado_id, tipo, fecha_inicio, fecha_fin, notas');
    if (this.filtroEmpleado()) inc = inc.eq('empleado_id', this.filtroEmpleado());
    if (this.filtroTipo()) inc = inc.eq('tipo', this.filtroTipo());
    // Que se crucen con el periodo: una incapacidad del 28 al 3 sale buscando "desde el 1".
    if (this.filtroDesde()) inc = inc.gte('fecha_fin', this.filtroDesde());
    if (this.filtroHasta()) inc = inc.lte('fecha_inicio', this.filtroHasta());
    // Sin % _ * ni \: son comodines (o el escape) de ilike y aqui se busca el texto tal cual.
    const texto = this.filtroTexto().trim().replace(/[%_*\\]/g, ' ');
    if (texto) inc = inc.ilike('notas', `%${texto}%`);
    const [incidencias, fes, emp] = await Promise.all([
      inc.order('fecha_inicio', { ascending: false }).limit(MAXIMO_INCIDENCIAS),
      this.sesion.bd.from('dias_festivos').select('fecha, descripcion').order('fecha'),
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, apellido_materno').order('nombre'),
    ]);
    if (esta !== this.consulta) return; // ya se pidio otra con otros filtros
    this.cargando.set(false);
    if (incidencias.error || fes.error || emp.error) {
      this.error.set('No se pudo traer la información. Revisa el internet.');
      return;
    }
    this.error.set(null);
    this.incidencias.set(incidencias.data as Incidencia[]);
    this.festivos.set(fes.data as Festivo[]);
    this.empleados.set((emp.data ?? []).map((e) => ({ id: e.id, nombre: [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' ') })));
  }

  protected filtrar(filtro: 'filtroEmpleado' | 'filtroTipo' | 'filtroDesde' | 'filtroHasta' | 'filtroTexto', valor: string): void {
    this[filtro].set(valor);
    void this.cargar();
  }

  protected quitarFiltros(): void {
    for (const f of ['filtroEmpleado', 'filtroTipo', 'filtroDesde', 'filtroHasta', 'filtroTexto'] as const) this[f].set('');
    void this.cargar();
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
    this.avisos.exito(mensaje);
    await this.cargar();
  }

  /** "Miércoles, 16 de septiembre de 2026" (con la clase `capitalize` salia "16 De Septiembre De 2026"). */
  protected fechaLarga(iso: string): string {
    const texto = new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  protected async borrar(i: Incidencia, motivo: string): Promise<void> {
    await this.ejecutar(() => this.sesion.bd.rpc('borrar_incidencia', { p_id: i.id, p_motivo: motivo }), () => {
      this.porBorrar.set(null);
      this.avisos.exito('Incidencia quitada. El reporte de esos días se recalcula solo.');
    });
  }

  protected abrirFestivo(): void {
    this.errorAccion.set(null);
    this.festivoNuevo.set({ fecha: this.sesion.hoy(), descripcion: '' });
  }

  protected async guardarFestivo(): Promise<void> {
    const f = this.festivoNuevo();
    if (!f) return;
    await this.ejecutar(
      () => this.sesion.bd.rpc('guardar_dia_festivo', { p_fecha: f.fecha, p_descripcion: f.descripcion }),
      () => {
        this.festivoNuevo.set(null);
        this.avisos.exito('Día festivo agregado. Ese día nadie cuenta como falta.');
      },
    );
  }

  protected async borrarFestivo(f: Festivo, motivo: string): Promise<void> {
    await this.ejecutar(
      () => this.sesion.bd.rpc('borrar_dia_festivo', { p_fecha: f.fecha, p_motivo: motivo }),
      () => {
        this.festivoPorBorrar.set(null);
        this.avisos.exito('Día festivo quitado.');
      },
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
