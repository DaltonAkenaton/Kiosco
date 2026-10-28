/**
 * ============================================================================
 *  REPORTES: a tiempo, retardo, falta, horas  (ARQUITECTURA.md 8, bloque 9)
 * ============================================================================
 *
 *  Todo lo calcula la base al momento de preguntar (`reporte_asistencia`,
 *  migracion 0016), con la configuracion VIGENTE. Si el jefe cambia la
 *  tolerancia, este reporte cambia tambien hacia atras, sin tocar ni una
 *  marca.
 *
 *  Dos vistas: dia por dia, y el resumen por persona. Las dos se descargan
 *  para abrirlas en Excel.
 *
 *  21-10-2026: "un lugar donde se vea quien falto mas o llega mas tarde". Es
 *  el mismo resumen, ordenado por faltas, retardos o minutos tarde, con
 *  periodos de un clic (este mes, mes pasado, este año...). De ahi, "Ver sus
 *  dias" lleva al dia por dia de esa persona.
 *
 *  El sistema INFORMA, no descuenta (supuestos 2.4): aqui no hay dinero.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Ayuda } from '../componentes/ayuda';
import { ElegirEmpleado, conNumero } from '../componentes/elegir-empleado';
import { descargarExcel } from '../servicios/escribir-excel';
import { RENGLONES_POR_PEDIDO } from '../servicios/respaldo';
import { type IncidenciaSugerida, RegistrarIncidencia, TIPOS_DE_INCIDENCIA } from '../componentes/registrar-incidencia';
import { senalRecordada } from '../servicios/recordar';
import { Sesion } from '../servicios/sesion';
import { NOMBRES_DE_BANDERAS, fecha, hora } from '../textos';

interface Fila {
  fecha: string;
  empleado_id: string;
  turno: string | null;
  programado_inicio: string | null;
  programado_fin: string | null;
  entrada: string | null;
  salida: string | null;
  minutos_tarde: number | null;
  minutos_salida_anticipada: number | null;
  horas: number | null;
  estado: string;
  estado_salida: string | null;
  incidencia: string | null;
  banderas: string[];
  en_cuarentena: boolean;
  corregida: boolean;
  /** Minutos que repuso quedandose despues de su hora de salida (migracion 0019). */
  minutos_repuestos: number | null;
  /** Tiempo extra: lo que se quedo despues de su hora y no fue para reponer (0022). */
  minutos_extra: number | null;
  /** Las horas que cuentan: trabajadas, o las del turno si el dia se dio por bueno (0020). */
  horas_acreditadas: number | null;
  /** Ese dia tuvo un cambio de horario por un dia (0029): 'cambio' | 'intercambio'. */
  ajuste: 'cambio' | 'intercambio' | null;
}

/** Cada estado en palabras, con su color y su explicacion (ⓘ). */
export const ESTADOS: Record<string, { texto: string; color: string; ayuda: string } | undefined> = {
  a_tiempo: { texto: 'A tiempo', color: 'var(--kiosko-entrada)', ayuda: 'Entró antes de que se acabara la tolerancia.' },
  retardo: {
    texto: 'Retardo',
    color: 'var(--kiosko-atencion)',
    ayuda: 'Llegó después de la tolerancia. Si se quedó más tiempo al salir, aquí mismo dice cuánto repuso.',
  },
  retardo_mayor: {
    texto: 'Retardo mayor',
    color: 'var(--kiosko-salida)',
    ayuda: 'Llegó muy tarde (más que los minutos para "retardo mayor" de Configuración), pero SÍ vino: no es falta. Si se quedó más tiempo al salir, aquí dice cuánto repuso.',
  },
  falta: {
    texto: 'Falta',
    color: 'var(--kiosko-peligro)',
    ayuda: 'Tenía turno y no vino (terminó su turno sin registrar entrada). Si fue por enfermedad, un accidente u otra razón válida, regístralo en Incidencias (o con el botón "Justificar") como falta justificada o incapacidad: deja de contar como falta.',
  },
  sin_entrada: {
    texto: 'Sin entrada',
    color: 'var(--kiosko-atencion)',
    ayuda: 'Registró su SALIDA pero no su entrada: sí vino, olvidó checar al llegar (o el kiosco no lo tomó). No cuenta como falta. Con "Justificar" → "No se registró" el día cuenta completo.',
  },
  programado: { texto: 'Programado', color: 'var(--kiosko-texto-suave)', ayuda: 'Su turno de ese día todavía no empieza.' },
  pendiente: { texto: 'Todavía no llega', color: 'var(--kiosko-texto-suave)', ayuda: 'Su turno ya empezó o está por empezar y aún no registra entrada. Puede llegar tarde: si termina su turno sin llegar, será falta.' },
  incidencia: { texto: 'Ausencia justificada', color: 'var(--kiosko-texto)', ayuda: 'No vino, con razón (vacaciones, incapacidad, permiso...): no cuenta como falta, pero tampoco suma horas trabajadas.' },
  justificado: {
    texto: 'Justificado',
    color: 'var(--kiosko-entrada)',
    ayuda: 'Se dio por bueno: hubo un problema que no fue suyo (no se registró, se cayó el sistema, retardo con razón). Cuenta como día normal y completo, con las horas de su turno.',
  },
  festivo: { texto: 'Día festivo', color: 'var(--kiosko-texto)', ayuda: 'No se esperaba a nadie ese día.' },
  sin_turno: {
    texto: 'Fuera de horario',
    color: 'var(--kiosko-texto-suave)',
    ayuda: 'Registró en un día u hora en que no tenía turno. Se muestra para que no se pierda, sin calificarlo.',
  },
};

export const ESTADOS_DE_SALIDA: Record<string, { texto: string; ayuda: string } | undefined> = {
  completa: { texto: '', ayuda: '' },
  en_curso: {
    texto: 'Sin salida todavía',
    ayuda: 'Registró su entrada y todavía no su salida. Si pasan muchas horas (se ajusta en Configuración), se marcará como "No registró salida".',
  },
  salida_no_registrada: {
    texto: 'No registró salida',
    ayuda: 'Pasaron muchas horas sin salida. El sistema NO inventa la hora: si sabes a qué hora salió, regístrala a mano en Asistencia.',
  },
  salida_sin_entrada: { texto: 'Salida sin entrada', ayuda: 'Registró la salida, pero no la entrada de ese turno.' },
};

const INCIDENCIAS: Record<string, string | undefined> = Object.fromEntries(
  TIPOS_DE_INCIDENCIA.map((t) => [t.valor, t.texto]),
);

/** Como se ordena el resumen: por nombre, o quien tiene mas de algo primero. */
type OrdenDelResumen = 'nombre' | 'faltas' | 'retardos' | 'minutos';

const ORDENES_DEL_RESUMEN: { valor: OrdenDelResumen; texto: string }[] = [
  { valor: 'nombre', texto: 'Nombre' },
  { valor: 'faltas', texto: 'Más faltas primero' },
  { valor: 'retardos', texto: 'Más retardos primero' },
  { valor: 'minutos', texto: 'Más minutos tarde primero' },
];

/** Los periodos de un clic. */
type Periodo = 'semana' | 'mes' | 'mes_pasado' | 'tres_meses' | 'anio';

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'mes', texto: 'Este mes' },
  { valor: 'mes_pasado', texto: 'Mes pasado' },
  { valor: 'tres_meses', texto: 'Últimos 3 meses' },
  { valor: 'anio', texto: 'Este año' },
];

const UN_DIA_MS = 86_400_000;

interface Resumen {
  empleadoId: string;
  nombre: string;
  programados: number;
  aTiempo: number;
  retardos: number;
  retardosMayores: number;
  /** Minutos tarde sumados, desde su hora de entrada (los mismos que cuenta Pendientes). */
  minutosTarde: number;
  faltas: number;
  justificadas: number;
  porBueno: number;
  horasQueCuentan: number;
  sinSalida: number;
  fueraDeHorario: number;
  horas: number;
}

@Component({
  selector: 'panel-reportes',
  imports: [Ayuda, ElegirEmpleado, RegistrarIncidencia],
  templateUrl: './reportes.html',
})
export class Reportes implements OnInit {
  protected readonly sesion = inject(Sesion);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  protected readonly zona = this.sesion.zona;

  // Los filtros se recuerdan al cambiar de pantalla (servicios/recordar.ts).
  protected readonly desde = senalRecordada('reportes.desde', this.lunesDeEstaSemana(), { delDia: this.sesion.hoy() });
  protected readonly hasta = senalRecordada('reportes.hasta', this.sesion.hoy(), { delDia: this.sesion.hoy() });
  protected readonly empleadoId = senalRecordada('reportes.empleado', '');
  protected readonly vista = senalRecordada<'dias' | 'resumen'>('reportes.vista', 'resumen');
  /**
   * "Dia por dia": los dias MAS RECIENTES arriba por defecto (30-09-2026: lo
   * que el jefe busca casi siempre es lo de hoy o ayer, no el lunes). Dentro
   * de cada dia se respeta el orden por turno y nombre.
   */
  protected readonly orden = senalRecordada<'recientes' | 'antiguos'>('reportes.orden', 'recientes');
  /** "Resumen por persona": quien falto mas, quien llega mas tarde... (21-10-2026). */
  protected readonly ordenResumen = senalRecordada<OrdenDelResumen>('reportes.ordenResumen', 'nombre');
  protected readonly ORDENES_DEL_RESUMEN = ORDENES_DEL_RESUMEN;
  protected readonly PERIODOS = PERIODOS;
  protected readonly filasEnOrden = computed<Fila[]>(() => {
    const filas = this.filas();
    if (this.orden() === 'antiguos') return filas;
    // `sort` es estable: al ordenar solo por fecha, cada dia conserva su orden interno.
    return [...filas].sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  protected readonly empleados = signal<Map<string, { nombre: string; numero: string | null }>>(new Map());
  protected readonly filas = signal<Fila[]>([]);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  private busqueda = 0;

  protected readonly ESTADOS = ESTADOS;
  protected readonly ESTADOS_DE_SALIDA = ESTADOS_DE_SALIDA;
  protected readonly INCIDENCIAS = INCIDENCIAS;
  protected readonly fecha = fecha;
  protected readonly hora = hora;

  protected readonly AYUDA_HORAS =
    'Las horas trabajadas de verdad, MÁS las de los días que se dieron por buenos (se cuenta el turno completo). ' +
    'Las ausencias justificadas (vacaciones, incapacidad) no suman horas.';

  protected readonly AYUDA_MINUTOS =
    'Todos los minutos que llegó después de su hora de entrada, sumados (también los que quedaron dentro de la ' +
    'tolerancia: es la misma cuenta de «Tarde en la semana» en Pendientes). Los días justificados no cuentan.';

  protected readonly AYUDA_RECALCULO =
    'Este reporte se calcula en el momento. Si cambias la tolerancia en Configuración, los días pasados se ' +
    'vuelven a calcular solos; los registros no se tocan. En cambio, si cambias el HORARIO de un turno, ' +
    'eso vale a partir del día que elijas: los días anteriores se siguen calculando con el horario que tenían. ' +
    'Falta es sólo no venir; llegar tarde es retardo (o "retardo mayor" si fue mucho), y se muestra si repuso el tiempo.';

  protected readonly resumen = computed<Resumen[]>(() => {
    const porPersona = new Map<string, Resumen>();
    for (const f of this.filas()) {
      const r =
        porPersona.get(f.empleado_id) ??
        ({ empleadoId: f.empleado_id, nombre: this.nombre(f.empleado_id), programados: 0, aTiempo: 0, retardos: 0,
           retardosMayores: 0, minutosTarde: 0, faltas: 0, justificadas: 0, porBueno: 0, horasQueCuentan: 0, sinSalida: 0,
           fueraDeHorario: 0, horas: 0 } satisfies Resumen);
      if (!['sin_turno', 'festivo', 'pendiente', 'programado'].includes(f.estado)) r.programados++;
      if (f.estado === 'a_tiempo') r.aTiempo++;
      if (f.estado === 'retardo' || f.estado === 'retardo_mayor') r.retardos++;
      if (f.estado === 'retardo_mayor') r.retardosMayores++;
      // Los dias que vino (un dia justificado ya no cuenta), aunque haya quedado dentro de la tolerancia.
      if (['a_tiempo', 'retardo', 'retardo_mayor'].includes(f.estado)) r.minutosTarde += f.minutos_tarde ?? 0;
      if (f.estado === 'falta') r.faltas++;
      if (f.estado === 'incidencia') r.justificadas++;
      if (f.estado === 'justificado') r.porBueno++;
      r.horasQueCuentan += Number(f.horas_acreditadas ?? 0);
      if (f.estado === 'sin_turno') r.fueraDeHorario++;
      // "Incompletos": entro y no registro salida, o salio sin registrar entrada.
      if (f.estado_salida === 'salida_no_registrada' || f.estado === 'sin_entrada') r.sinSalida++;
      r.horas += Number(f.horas ?? 0);
      porPersona.set(f.empleado_id, r);
    }
    // Quien tiene mas primero; los empates, por lo que sigue en importancia y al final por nombre.
    const cuanto: Record<OrdenDelResumen, (r: Resumen) => number[]> = {
      nombre: () => [],
      faltas: (r) => [r.faltas, r.retardos, r.minutosTarde],
      retardos: (r) => [r.retardos, r.minutosTarde, r.faltas],
      minutos: (r) => [r.minutosTarde, r.retardos, r.faltas],
    };
    const valores = cuanto[this.ordenResumen()] ?? cuanto.nombre;
    return [...porPersona.values()].sort((a, b) => {
      const va = valores(a);
      const vb = valores(b);
      for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
      return a.nombre.localeCompare(b.nombre);
    });
  });

  /** El periodo de un clic que corresponde a las fechas elegidas (para marcar su boton). */
  protected readonly periodoActual = computed<Periodo | null>(() => {
    const hoy = this.sesion.hoy();
    const p = PERIODOS.find(({ valor }) => {
      const [desde, hasta] = this.fechasDe(valor, hoy);
      return desde === this.desde() && hasta === this.hasta();
    });
    return p?.valor ?? null;
  });

  protected elegirPeriodo(periodo: Periodo): void {
    const [desde, hasta] = this.fechasDe(periodo, this.sesion.hoy());
    this.resaltado.set(null);
    this.desde.set(desde);
    this.hasta.set(hasta);
    void this.buscar();
  }

  /** Desde y hasta de cada periodo, contados desde hoy (fechas AAAA-MM-DD). */
  private fechasDe(periodo: Periodo, hoy: string): [string, string] {
    const [a, m] = hoy.split('-').map(Number);
    // Date.UTC acomoda solo los meses fuera de rango: el mes 0 es diciembre del año anterior.
    const dia = (anio: number, mes: number, d: number): string => new Date(Date.UTC(anio, mes - 1, d)).toISOString().slice(0, 10);
    switch (periodo) {
      case 'semana':
        return [this.lunesDeEstaSemana(), hoy];
      case 'mes':
        return [dia(a, m, 1), hoy];
      case 'mes_pasado':
        return [dia(a, m - 1, 1), dia(a, m, 0)];
      case 'tres_meses':
        return [dia(a, m - 2, 1), hoy];
      case 'anio':
        return [dia(a, 1, 1), hoy];
    }
  }

  /** Del resumen al dia por dia de esa persona, con las mismas fechas. */
  protected verDiasDe(empleadoId: string): void {
    this.resaltado.set(null);
    this.empleadoId.set(empleadoId);
    this.vista.set('dias');
    void this.buscar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async ngOnInit(): Promise<void> {
    const { data } = await this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, apellido_materno, numero_empleado').order('nombre');
    this.empleados.set(
      new Map((data ?? []).map((e) => [e.id, { nombre: [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' '), numero: e.numero_empleado }])),
    );
    this.filtrosDeLaDireccion();
    await this.buscar();
  }

  /**
   * "Ver su reporte" desde Pendientes (faltas y retardos, 20-10-2026) llega
   * con ?desde=...&hasta=...&empleado=...: aqui se ve el horario, los minutos
   * tarde de cada dia y el boton Justificar, que en Asistencia no estan.
   */
  private filtrosDeLaDireccion(): void {
    const q = this.ruta.snapshot.queryParamMap;
    const fechaValida = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const desde = q.get('desde');
    const hasta = q.get('hasta');
    if (!fechaValida(desde) || !fechaValida(hasta)) return;
    this.desde.set(desde);
    this.hasta.set(hasta);
    this.empleadoId.set(q.get('empleado') ?? '');
    this.vista.set('dias');
    const resaltar = q.get('resaltar');
    this.resaltado.set({
      empleadoId: q.get('empleado') ?? '',
      fecha: fechaValida(resaltar) ? resaltar : null,
      tarde: q.get('tarde') === '1',
    });
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  /**
   * Lo que se resalta al llegar desde Pendientes (20-10-2026): el dia del
   * caso (una falta, un retardo) o, en "Tarde en la semana", los dias que
   * llego tarde, que son los que suman esos minutos. Se quita al cambiar un
   * filtro: ya no es la misma busqueda.
   */
  protected readonly resaltado = signal<{ empleadoId: string; fecha: string | null; tarde: boolean } | null>(null);

  protected resaltada(f: Fila): boolean {
    const r = this.resaltado();
    if (!r || f.empleado_id !== r.empleadoId) return false;
    if (r.fecha) return f.fecha.slice(0, 10) === r.fecha;
    return r.tarde && (f.minutos_tarde ?? 0) > 0 && ['a_tiempo', 'retardo', 'retardo_mayor'].includes(f.estado);
  }

  /** Lleva la vista a la fila resaltada, por si la tabla es larga. */
  private irAlResaltado(): void {
    if (!this.resaltado()) return;
    setTimeout(() => document.querySelector('.fila-resaltada')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  // --------------------------------------------------------------------------
  //  Justificar desde el reporte (migracion 0020)
  // --------------------------------------------------------------------------

  protected readonly justificando = signal<IncidenciaSugerida | null>(null);
  protected readonly aviso = signal<string | null>(null);

  /**
   * ¿Tiene algo que justificar ese dia? Falta, retardo, salida sin registrar,
   * o se fue antes de su hora (28-09-2026: "¿y si se va a medio turno por una
   * emergencia?" -> se le da un Permiso desde aqui mismo).
   */
  protected sePuedeJustificar(f: Fila): boolean {
    const yaResuelto = f.estado === 'justificado' || f.estado === 'incidencia';
    return (
      ['falta', 'retardo', 'retardo_mayor', 'sin_entrada'].includes(f.estado) ||
      (!yaResuelto && ['salida_no_registrada', 'salida_sin_entrada'].includes(f.estado_salida ?? '')) ||
      (!yaResuelto && (f.minutos_salida_anticipada ?? 0) > 0)
    );
  }

  /**
   * Que dice el boton (21-10-2026: "¿por que el de A tiempo esta a
   * justificar?"). Llego a tiempo pero se fue antes: el boton decia solo
   * "Justificar", junto a "A tiempo", y no se entendia que.
   */
  protected textoJustificar(f: Fila): string {
    if (['falta', 'retardo', 'retardo_mayor', 'sin_entrada'].includes(f.estado)) return 'Justificar';
    if (['salida_no_registrada', 'salida_sin_entrada'].includes(f.estado_salida ?? '')) return 'Justificar la salida';
    return `Justificar: se fue ${f.minutos_salida_anticipada} min antes`;
  }

  /** Abre la ventana con la persona, el dia y el tipo que mas probablemente sea. */
  protected justificar(f: Fila): void {
    const tipo =
      f.estado === 'falta' ? 'falta_justificada'
        : f.estado === 'retardo' || f.estado === 'retardo_mayor' ? 'retardo_justificado'
          : (f.minutos_salida_anticipada ?? 0) > 0 ? 'permiso'
            : 'olvido_registro';
    this.aviso.set(null);
    this.justificando.set({ empleadoId: f.empleado_id, fecha: f.fecha.slice(0, 10), tipo });
  }

  protected async alJustificar(mensaje: string): Promise<void> {
    this.justificando.set(null);
    this.aviso.set(mensaje);
    await this.buscar();
  }

  protected async buscar(): Promise<void> {
    if (!this.desde() || !this.hasta()) return;
    if (this.desde() > this.hasta()) {
      this.filas.set([]);
      this.error.set('La fecha "Desde" es después de "Hasta". Revisa las fechas.');
      this.busqueda++; // la que venia en camino ya no cuenta
      this.cargando.set(false);
      return;
    }
    this.cargando.set(true);
    this.error.set(null);
    // Una busqueda vieja que llega tarde no pisa a la nueva (filtros cambiados de prisa).
    const esta = ++this.busqueda;
    const { data, error } = await this.traerFilas(this.desde(), this.hasta(), this.empleadoId() || null);
    if (esta !== this.busqueda) return;
    this.cargando.set(false);
    if (error) {
      this.error.set('No se pudo calcular el reporte. Revisa el internet y vuelve a intentar.');
      return;
    }
    // Por dia; dentro del dia, por la hora en que empieza el turno (el
    // matutino antes que el nocturno) y luego por nombre.
    const filas = (data ?? []).sort(
      (a, b) =>
        a.fecha.localeCompare(b.fecha) ||
        (a.programado_inicio ?? a.entrada ?? '').localeCompare(b.programado_inicio ?? b.entrada ?? '') ||
        this.nombre(a.empleado_id).localeCompare(this.nombre(b.empleado_id)),
    );
    this.filas.set(filas);
    this.irAlResaltado();
  }

  /**
   * El servidor entrega como mucho 1000 renglones por pedido (como en el
   * respaldo). Un renglon es una persona en un dia: con 20 personas, mas de
   * siete semanas ya no cabian y el reporte salia cortado SIN avisar
   * (21-10-2026). Si un pedido llega lleno, el periodo se parte en dos.
   */
  private async traerFilas(desde: string, hasta: string, empleado: string | null): Promise<{ data: Fila[] | null; error: unknown }> {
    const { data, error } = await this.sesion.bd.rpc('reporte_asistencia', {
      p_desde: desde,
      p_hasta: hasta,
      p_empleado_id: empleado,
    });
    if (error) return { data: null, error };
    const filas = (data ?? []) as Fila[];
    if (filas.length < RENGLONES_POR_PEDIDO || desde === hasta) return { data: filas, error: null };
    const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / UN_DIA_MS);
    const mitad = new Date(Date.parse(desde) + Math.floor(dias / 2) * UN_DIA_MS).toISOString().slice(0, 10);
    const despues = new Date(Date.parse(mitad) + UN_DIA_MS).toISOString().slice(0, 10);
    const [antes, luego] = await Promise.all([this.traerFilas(desde, mitad, empleado), this.traerFilas(despues, hasta, empleado)]);
    if (antes.error || luego.error) return { data: null, error: antes.error ?? luego.error };
    return { data: [...(antes.data ?? []), ...(luego.data ?? [])], error: null };
  }

  protected cambiar(filtro: 'desde' | 'hasta' | 'empleadoId', valor: string): void {
    this.resaltado.set(null);
    this[filtro].set(valor);
    void this.buscar();
  }

  protected nombre(id: string): string {
    return this.empleados().get(id)?.nombre ?? '(desconocido)';
  }

  protected numero(id: string): string {
    return this.empleados().get(id)?.numero ?? '';
  }

  /** El dia completo, para el encabezado de cada dia: "lunes 21 de septiembre". */
  protected fechaLarga(iso: string): string {
    const texto = new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  protected fechaCorta(iso: string): string {
    const [a, m, d] = iso.split('-');
    const dia = new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-MX', { weekday: 'short', timeZone: 'UTC' });
    return `${dia} ${d}/${m}/${a}`;
  }

  protected horas(h: number): string {
    const total = Math.round(h * 60);
    return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
  }

  /** "45 min", "2 h 10 min". */
  protected minutos(m: number): string {
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  }

  // --------------------------------------------------------------------------
  //  Descargar en Excel (un .xlsx de verdad, con las dos vistas) e imprimir
  // --------------------------------------------------------------------------

  protected descargarExcel(): void {
    const z = this.zona();
    const minutosEnHoras = (m: number | null): string => (m ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : '');
    const resumen = [
      ['Número', 'Nombre', 'Días con turno', 'A tiempo', 'Retardos', 'De ellos, mayores', 'Minutos tarde', 'Faltas',
        'Ausencias justificadas', 'Justificados', 'Registros incompletos', 'Fuera de horario', 'Horas trabajadas', 'Horas que cuentan'],
      ...this.resumen().map((r) => [
        this.numero(r.empleadoId), r.nombre, r.programados, r.aTiempo, r.retardos, r.retardosMayores, r.minutosTarde, r.faltas,
        r.justificadas, r.porBueno, r.sinSalida, r.fueraDeHorario, Number(r.horas.toFixed(2)), Number(r.horasQueCuentan.toFixed(2)),
      ]),
    ];
    const dias = [
      ['Fecha', 'Número', 'Nombre', 'Turno', 'Entrada programada', 'Salida programada', 'Entró', 'Salió',
        'Minutos tarde', 'Repuso', 'Tiempo extra', 'Horas', 'Horas que cuentan', 'Resultado', 'Salida', 'Incidencia', 'Revisión'],
      ...this.filasEnOrden().map((f) => [
        f.fecha.slice(0, 10), this.numero(f.empleado_id), this.nombre(f.empleado_id), f.turno ?? '',
        f.programado_inicio ? hora(f.programado_inicio, z) : '', f.programado_fin ? hora(f.programado_fin, z) : '',
        f.entrada ? hora(f.entrada, z) : '', f.salida ? hora(f.salida, z) : '',
        f.minutos_tarde ?? '', minutosEnHoras(f.minutos_repuestos), minutosEnHoras(f.minutos_extra),
        f.horas !== null ? Number(f.horas) : '', f.horas_acreditadas !== null ? Number(f.horas_acreditadas) : '',
        ESTADOS[f.estado]?.texto ?? f.estado,
        f.estado_salida ? (ESTADOS_DE_SALIDA[f.estado_salida]?.texto || 'Completa') : '',
        f.incidencia ? (INCIDENCIAS[f.incidencia] ?? f.incidencia) : '',
        [...f.banderas.map((b) => (NOMBRES_DE_BANDERAS as Record<string, string>)[b] ?? b),
          f.corregida ? 'Corregido' : '', f.en_cuarentena ? 'En cuarentena' : ''].filter(Boolean).join('; '),
      ]),
    ];
    const titulo = this.vista() === 'resumen' ? 'Resumen' : 'Día por día';
    const hojas = [
      { nombre: 'Resumen por persona', filas: resumen },
      { nombre: 'Día por día', filas: dias },
    ];
    // La hoja que se estaba viendo va primero (es la que abre Excel).
    if (titulo !== 'Resumen') hojas.reverse();
    descargarExcel(`asistencia_${this.desde()}_a_${this.hasta()}.xlsx`, hojas);
  }

  /** Imprime lo que se ve (o "Guardar como PDF" en la ventana de impresion). */
  protected imprimir(): void {
    window.print();
  }

  protected fechaImpresion(): string {
    return new Date(this.sesion.ahora()).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: this.zona() });
  }

  private lunesDeEstaSemana(): string {
    const hoy = this.sesion.hoy();
    const d = new Date(`${hoy}T12:00:00Z`);
    const diasDesdeLunes = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diasDesdeLunes);
    return d.toISOString().slice(0, 10);
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected listaEmpleados(): { id: string; nombre: string }[] {
    return [...this.empleados().entries()].map(([id, e]) => ({ id, nombre: conNumero(e.nombre, e.numero) }));
  }
}
