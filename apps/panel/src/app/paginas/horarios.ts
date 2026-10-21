/**
 * ============================================================================
 *  HORARIOS: turnos y el horario de cada persona  (CLAUDE.md 8)
 * ============================================================================
 *
 *  TURNOS: plantillas para asignar rapido ("Matutino 06:00-14:00"). Su
 *  tolerancia y minutos para falta van VACIOS normalmente: entonces mandan los
 *  de Configuracion. Solo se llenan si ese turno necesita otra regla.
 *
 *  HORARIO DE CADA PERSONA: un turno, los dias que trabaja y, si hace falta,
 *  su propia hora en algun dia ("los sabados entra a las 7"). Cambiarlo es "a
 *  partir de tal fecha": los dias anteriores se siguen calculando con el
 *  horario que tenia entonces.
 *
 *  CAMBIOS POR UN DIA (0029, junta del 20-10-2026): "hoy Juan cubre el turno
 *  de Pedro". Un cambio manda sobre el horario normal SOLO ese dia; un
 *  intercambio son dos cambios que se guardan y se quitan juntos. Sin esto,
 *  el reporte (y Pendientes) veria a Juan faltar a su turno y a Pedro llegar
 *  a una hora rara: dos casos falsos de dos personas que si trabajaron.
 *
 *  Todo con motivo y en la bitacora (funciones de la 0016 y la 0029).
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Ayuda } from '../componentes/ayuda';
import { CargandoTabla, RENGLONES_CARGANDO } from '../componentes/cargando-tabla';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { ElegirEmpleado, conNumero } from '../componentes/elegir-empleado';
import { Avisos } from '../servicios/avisos';
import { Sesion } from '../servicios/sesion';

interface Turno {
  id: string;
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  tolerancia_minutos: number | null;
  minutos_para_falta: number | null;
  activo: boolean;
}

interface DiaLaboral {
  dia_semana: number;
  hora_inicio: string | null;
  hora_fin: string | null;
}

interface Horario {
  id: string;
  empleado_id: string;
  vigente_desde: string;
  turno: { nombre: string; hora_inicio: string; hora_fin: string } | null;
  dias_laborales: DiaLaboral[];
}

/** 0 = domingo, como `extract(dow ...)` de Postgres. Se muestran de lunes a domingo. */
const DIAS = [
  { n: 1, corto: 'Lun', largo: 'Lunes' },
  { n: 2, corto: 'Mar', largo: 'Martes' },
  { n: 3, corto: 'Mié', largo: 'Miércoles' },
  { n: 4, corto: 'Jue', largo: 'Jueves' },
  { n: 5, corto: 'Vie', largo: 'Viernes' },
  { n: 6, corto: 'Sáb', largo: 'Sábado' },
  { n: 0, corto: 'Dom', largo: 'Domingo' },
];

/** Un cambio de horario de un dia (tabla `ajustes_horario`, 0029). */
interface Ajuste {
  id: string;
  empleado_id: string;
  fecha: string;
  descansa: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  intercambio_id: string | null;
  intercambio_con: string | null;
  motivo: string;
}

/** Lo que devuelve `horario_del_dia()`: si trabaja ese dia y a que hora. */
interface HorarioDelDia {
  trabaja: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
}

/** Cuantos dias hacia atras se muestran los cambios ya pasados. */
const DIAS_DE_CAMBIOS_PASADOS = 14;

interface DiaElegido {
  activo: boolean;
  propio: boolean;
  inicio: string;
  fin: string;
}

@Component({
  selector: 'panel-horarios',
  imports: [Ayuda, CargandoTabla, Dialogo, ElegirEmpleado],
  templateUrl: './horarios.html',
})
export class Horarios implements OnInit {
  protected readonly sesion = inject(Sesion);
  private readonly avisos = inject(Avisos);
  private readonly ruta = inject(ActivatedRoute);
  protected readonly cargando = signal(true);
  protected readonly RENGLONES_CARGANDO = RENGLONES_CARGANDO;
  /** A una persona solo se le asigna un turno activo (la base tampoco acepta otro). */
  protected readonly turnosActivos = computed(() => this.turnos().filter((t) => t.activo !== false));
  /**
   * Las de Configuracion: las que usa un turno que deja sus minutos vacios.
   * Se muestran en el campo vacio ("10 (la general)") para que el jefe sepa
   * cuanto vale sin ir a Configuracion.
   */
  protected readonly reglasGenerales = signal({ tolerancia: 10, falta: 30 });

  protected readonly turnos = signal<Turno[]>([]);
  protected readonly horarios = signal<Horario[]>([]);
  protected readonly empleados = signal<{ id: string; nombre: string; numero: string | null }[]>([]);
  /** Para el buscador de "Cambios por un dia": con el numero, para buscar por el. */
  protected readonly opcionesDeEmpleado = computed(() =>
    this.empleados().map((e) => ({ id: e.id, nombre: conNumero(e.nombre, e.numero) })),
  );
  protected readonly error = signal<string | null>(null);

  protected readonly DIAS = DIAS;

  // --- Editar un turno ---
  protected readonly turnoEditado = signal<{
    id: string | null; nombre: string; inicio: string; fin: string; tolerancia: string; falta: string;
    /** A partir de que dia vale el horario nuevo (migracion 0019). */
    aPartirDe: string;
    /** Las horas que tenia, para saber si cambiaron. */
    inicioAntes: string; finAntes: string;
  } | null>(null);

  // --- Cambiar el horario de alguien ---
  protected readonly horarioDe = signal<{ id: string; nombre: string } | null>(null);
  protected readonly turnoElegido = signal('');
  protected readonly desde = signal(this.sesion.hoy());
  protected readonly diasElegidos = signal<Record<number, DiaElegido>>({});

  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  // --- Cambios por un dia (0029) ---
  protected readonly ajustes = signal<Ajuste[]>([]);
  protected readonly cambioNuevo = signal<{
    tipo: 'una' | 'intercambio'; fecha: string; a: string; b: string;
    descansa: boolean; inicio: string; fin: string;
  } | null>(null);
  /** El horario normal de cada persona elegida ese dia (para que se vea que va a pasar). */
  protected readonly horarioNormal = signal<Record<string, HorarioDelDia | null>>({});
  protected readonly ajustePorQuitar = signal<Ajuste | null>(null);

  protected readonly AYUDA = {
    turnos:
      'Un turno es una plantilla para asignar rápido: nombre y horas. La tolerancia y los minutos para "retardo mayor" ' +
      'normalmente se dejan vacíos, y entonces se usan los de Configuración. Llénalos sólo si ESE turno necesita ' +
      'otra regla. Si cambias las horas de un turno, eliges a partir de qué día: los días anteriores se siguen ' +
      'calculando con el horario que tenían. Si sólo una persona cambió de horario, cambia su horario abajo.',
    propio: 'Si ese día la persona entra o sale a otra hora que la del turno, escríbela aquí. Vacío = la del turno.',
    cambios:
      'Para un solo día: alguien entra a otra hora, descansa, o dos personas se intercambian el turno. Ese día ' +
      'los retardos y las faltas se miden contra el horario del cambio; el resto de los días sigue igual. ' +
      'Sin esto, quien cubre a otro aparecería con falta en su turno y llegando a una hora rara en el del otro.',
    desde:
      'El horario nuevo cuenta desde ese día. Los días anteriores se siguen calculando con el horario que tenía ' +
      'entonces, para que el pasado no cambie.',
  };

  /** El horario vigente de cada empleado (el mas reciente que ya empezo o empieza). */
  protected readonly horarioActual = computed(() => {
    const porEmpleado = new Map<string, Horario>();
    for (const h of this.horarios()) {
      const actual = porEmpleado.get(h.empleado_id);
      if (!actual || h.vigente_desde > actual.vigente_desde) porEmpleado.set(h.empleado_id, h);
    }
    return porEmpleado;
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
    // Viene de Empleados ("Horario" o "Siguiente: asignar su horario"):
    // abre el editor directo con esa persona.
    const id = this.ruta.snapshot.queryParamMap.get('empleado');
    const empleado = id ? this.empleados().find((e) => e.id === id) : undefined;
    if (empleado) this.abrirHorario(empleado);
  }

  private async cargar(): Promise<void> {
    const hoy = this.sesion.hoy();
    const desdeCambios = new Date(`${hoy}T12:00:00Z`);
    desdeCambios.setUTCDate(desdeCambios.getUTCDate() - DIAS_DE_CAMBIOS_PASADOS);
    const [turnos, horarios, empleados, config, ajustes] = await Promise.all([
      this.sesion.bd.from('turnos').select('id, nombre, hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta, activo').order('hora_inicio'),
      this.sesion.bd
        .from('asignaciones_turno')
        .select('id, empleado_id, vigente_desde, turno:turnos(nombre, hora_inicio, hora_fin), dias_laborales(dia_semana, hora_inicio, hora_fin)')
        .or(`vigente_hasta.is.null,vigente_hasta.gt.${hoy}`),
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, apellido_materno, numero_empleado').eq('activo', true).order('nombre'),
      this.sesion.bd.from('configuracion').select('clave, valor').in('clave', ['tolerancia_retardo_minutos', 'minutos_para_falta']),
      this.sesion.bd
        .from('ajustes_horario')
        .select('id, empleado_id, fecha, descansa, hora_inicio, hora_fin, intercambio_id, intercambio_con, motivo')
        .gte('fecha', desdeCambios.toISOString().slice(0, 10))
        .order('fecha'),
    ]);
    this.ajustes.set((ajustes.data ?? []) as Ajuste[]);
    this.cargando.set(false);
    for (const c of config.data ?? []) {
      if (c.clave === 'tolerancia_retardo_minutos') this.reglasGenerales.update((r) => ({ ...r, tolerancia: Number(c.valor) }));
      if (c.clave === 'minutos_para_falta') this.reglasGenerales.update((r) => ({ ...r, falta: Number(c.valor) }));
    }
    if (turnos.error || horarios.error || empleados.error) {
      this.error.set('No se pudieron traer los horarios. Revisa el internet.');
      return;
    }
    this.turnos.set(turnos.data as Turno[]);
    this.horarios.set(horarios.data as unknown as Horario[]);
    this.empleados.set(
      (empleados.data ?? []).map((e) => ({
        id: e.id,
        nombre: [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' '),
        numero: e.numero_empleado,
      })),
    );
  }

  /** "2026-09-27" -> "27/09/2026" */
  protected dma(iso: string): string {
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }

  protected hhmm(t: string | null): string {
    return t ? t.slice(0, 5) : '';
  }

  /** "Lun a Vie 06:00–14:00 · Sáb 07:00–13:00" */
  protected resumenDeDias(h: Horario): string {
    const inicio = this.hhmm(h.turno?.hora_inicio ?? null);
    const fin = this.hhmm(h.turno?.hora_fin ?? null);
    const dias = DIAS.filter((d) => h.dias_laborales.some((dl) => dl.dia_semana === d.n));
    const normales = dias.filter((d) => !h.dias_laborales.find((dl) => dl.dia_semana === d.n)?.hora_inicio);
    const propios = dias.filter((d) => h.dias_laborales.find((dl) => dl.dia_semana === d.n)?.hora_inicio);
    const partes: string[] = [];
    if (normales.length) partes.push(`${normales.map((d) => d.corto).join(', ')} ${inicio}–${fin}`);
    for (const d of propios) {
      const dl = h.dias_laborales.find((x) => x.dia_semana === d.n)!;
      partes.push(`${d.corto} ${this.hhmm(dl.hora_inicio)}–${this.hhmm(dl.hora_fin)}`);
    }
    return partes.join(' · ');
  }

  // --------------------------------------------------------------------------
  //  Turnos
  // --------------------------------------------------------------------------

  protected abrirTurno(t: Turno | null): void {
    this.errorAccion.set(null);
    this.turnoEditado.set(
      t
        ? { id: t.id, nombre: t.nombre, inicio: this.hhmm(t.hora_inicio), fin: this.hhmm(t.hora_fin),
            tolerancia: t.tolerancia_minutos?.toString() ?? '', falta: t.minutos_para_falta?.toString() ?? '',
            aPartirDe: this.sesion.hoy(), inicioAntes: this.hhmm(t.hora_inicio), finAntes: this.hhmm(t.hora_fin) }
        : { id: null, nombre: '', inicio: '06:00', fin: '14:00', tolerancia: '', falta: '',
            aPartirDe: '', inicioAntes: '', finAntes: '' },
    );
  }

  /** ¿Se estan cambiando las HORAS de un turno que ya existia? Entonces se pregunta desde cuando. */
  protected cambianLasHoras(t: { id: string | null; inicio: string; fin: string; inicioAntes: string; finAntes: string }): boolean {
    return !!t.id && (t.inicio !== t.inicioAntes || t.fin !== t.finAntes);
  }

  protected cambiarTurno(campo: 'nombre' | 'inicio' | 'fin' | 'tolerancia' | 'falta' | 'aPartirDe', valor: string): void {
    this.turnoEditado.update((t) => (t ? { ...t, [campo]: valor } : t));
  }

  /**
   * Los minutos del turno: solo se pueden teclear numeros (prueba del autor,
   * 20-10-2026: aceptaban letras y el error salia hasta guardar).
   */
  protected minutosDelTurno(campo: 'tolerancia' | 'falta', evento: Event): void {
    const caja = evento.target as HTMLInputElement;
    const limpio = caja.value.replace(/[^0-9]/g, '');
    if (limpio !== caja.value) caja.value = limpio;
    this.cambiarTurno(campo, limpio);
  }

  protected async guardarTurno(motivo: string): Promise<void> {
    const t = this.turnoEditado();
    if (!t) return;
    const numero = (v: string): number | null => (v.trim() === '' ? null : Number(v));
    const tol = numero(t.tolerancia);
    const falta = numero(t.falta);
    if ((tol !== null && (!Number.isInteger(tol) || tol < 0)) || (falta !== null && (!Number.isInteger(falta) || falta < 0))) {
      this.errorAccion.set('Los minutos deben ser números enteros, o quedar vacíos para usar los de Configuración.');
      return;
    }
    // La base revisa tolerancia < "retardo mayor" solo si el turno trae los
    // DOS. Con uno propio y el otro de Configuracion, se revisa aqui: si no,
    // habria llegadas que brincan de "a tiempo" a "retardo mayor".
    const tolQueCuenta = tol ?? this.reglasGenerales().tolerancia;
    const faltaQueCuenta = falta ?? this.reglasGenerales().falta;
    if (tolQueCuenta >= faltaQueCuenta) {
      this.errorAccion.set(
        `La tolerancia (${tolQueCuenta}${tol === null ? ', la de Configuración' : ''}) debe ser menor que los minutos para "retardo mayor" (${faltaQueCuenta}${falta === null ? ', los de Configuración' : ''}).`,
      );
      return;
    }
    await this.ejecutar(() =>
      this.sesion.bd.rpc('guardar_turno', {
        p_id: t.id, p_nombre: t.nombre, p_inicio: t.inicio, p_fin: t.fin,
        p_tolerancia: tol, p_falta: falta, p_motivo: motivo,
        // Sin cambio de horas, no hay "a partir de": se corrige tal cual.
        p_desde: this.cambianLasHoras(t) ? t.aPartirDe || null : null,
      }),
      () => {
        this.turnoEditado.set(null);
        this.avisos.exito('Turno guardado. Los reportes ya lo toman en cuenta.');
      },
    );
  }

  // --------------------------------------------------------------------------
  //  Horario de una persona
  // --------------------------------------------------------------------------

  protected abrirHorario(empleado: { id: string; nombre: string }): void {
    const actual = this.horarioActual().get(empleado.id);
    const turno = this.turnosActivos().find((t) => t.nombre === actual?.turno?.nombre) ?? this.turnosActivos()[0];
    const elegidos: Record<number, DiaElegido> = {};
    for (const d of DIAS) {
      const dl = actual?.dias_laborales.find((x) => x.dia_semana === d.n);
      elegidos[d.n] = {
        activo: actual ? !!dl : d.n >= 1 && d.n <= 5,
        propio: !!dl?.hora_inicio,
        inicio: this.hhmm(dl?.hora_inicio ?? turno?.hora_inicio ?? null),
        fin: this.hhmm(dl?.hora_fin ?? turno?.hora_fin ?? null),
      };
    }
    this.turnoElegido.set(turno?.id ?? '');
    this.desde.set(this.sesion.hoy());
    this.diasElegidos.set(elegidos);
    this.errorAccion.set(null);
    this.horarioDe.set(empleado);
  }

  protected cambiarDia(n: number, cambio: Partial<DiaElegido>): void {
    this.diasElegidos.update((d) => ({ ...d, [n]: { ...d[n]!, ...cambio } }));
  }

  protected async guardarHorario(motivo: string): Promise<void> {
    const empleado = this.horarioDe();
    if (!empleado) return;
    const dias = DIAS.filter((d) => this.diasElegidos()[d.n]?.activo).map((d) => {
      const e = this.diasElegidos()[d.n]!;
      return e.propio ? { dia: d.n, inicio: e.inicio, fin: e.fin } : { dia: d.n };
    });
    if (!this.turnoElegido()) {
      this.errorAccion.set('Todavía no hay turnos. Cierra esta ventana y crea uno con "+ Nuevo turno".');
      return;
    }
    if (dias.length === 0) {
      this.errorAccion.set('Elige al menos un día de la semana.');
      return;
    }
    // "Otra hora" con una casilla vacia, o entrada igual a salida (un turno de cero horas).
    const malo = DIAS.find((d) => {
      const e = this.diasElegidos()[d.n];
      return e?.activo && e.propio && (!e.inicio || !e.fin || e.inicio === e.fin);
    });
    if (malo) {
      this.errorAccion.set(`El ${malo.largo.toLowerCase()} tiene "otra hora", pero falta la hora o la entrada es igual a la salida.`);
      return;
    }
    if (!this.desde()) {
      this.errorAccion.set('Escribe a partir de qué día vale el horario.');
      return;
    }
    await this.ejecutar(() =>
      this.sesion.bd.rpc('asignar_horario', {
        p_empleado_id: empleado.id, p_turno_id: this.turnoElegido(), p_desde: this.desde(),
        p_dias: dias, p_motivo: motivo,
      }),
      () => {
        this.horarioDe.set(null);
        this.avisos.exito(`Horario de ${empleado.nombre} guardado.`);
      },
    );
  }

  // --------------------------------------------------------------------------
  //  Cambios por un dia (0029)
  // --------------------------------------------------------------------------

  protected nombreDe(id: string | null): string {
    return this.empleados().find((e) => e.id === id)?.nombre ?? '(persona dada de baja)';
  }

  /** "Martes 21 de octubre" */
  protected diaLargo(fecha: string): string {
    const texto = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  /** "Descansa" o "14:00–22:00". */
  protected horasDe(h: { descansa?: boolean; trabaja?: boolean; hora_inicio: string | null; hora_fin: string | null } | null | undefined): string {
    if (!h || h.descansa || h.trabaja === false || !h.hora_inicio) return 'Descansa';
    return `${this.hhmm(h.hora_inicio)}–${this.hhmm(h.hora_fin)}`;
  }

  /** Los de un intercambio van juntos: se muestra uno por intercambio. */
  protected readonly cambiosParaMostrar = computed(() => {
    const vistos = new Set<string>();
    return this.ajustes().filter((a) => {
      if (!a.intercambio_id) return true;
      if (vistos.has(a.intercambio_id)) return false;
      vistos.add(a.intercambio_id);
      return true;
    });
  });

  /** El otro lado de un intercambio. */
  protected pareja(a: Ajuste): Ajuste | undefined {
    return this.ajustes().find((x) => x.intercambio_id === a.intercambio_id && x.id !== a.id);
  }

  protected esPasado(fecha: string): boolean {
    return fecha < this.sesion.hoy();
  }

  protected abrirCambio(): void {
    this.errorAccion.set(null);
    this.horarioNormal.set({});
    this.cambioNuevo.set({ tipo: 'una', fecha: this.sesion.hoy(), a: '', b: '', descansa: false, inicio: '', fin: '' });
  }

  protected cambiarCambio(campo: 'tipo' | 'fecha' | 'a' | 'b' | 'inicio' | 'fin', valor: string): void {
    // Otra persona u otro dia: las horas propuestas eran de antes.
    const limpiar = campo === 'fecha' || campo === 'a' ? { inicio: '', fin: '' } : {};
    this.cambioNuevo.update((c) => (c ? { ...c, ...limpiar, [campo]: valor } : c));
    if (campo === 'fecha' || campo === 'a' || campo === 'b' || campo === 'tipo') void this.verHorarioNormal();
  }

  protected cambiarDescanso(descansa: boolean): void {
    this.cambioNuevo.update((c) => (c ? { ...c, descansa } : c));
  }

  /** Pregunta a la base el horario normal de las personas elegidas ese dia. */
  private async verHorarioNormal(): Promise<void> {
    const c = this.cambioNuevo();
    if (!c?.fecha) return;
    const ids = [c.a, c.b].filter(Boolean);
    const respuestas = await Promise.all(
      ids.map((id) => this.sesion.bd.rpc('horario_del_dia', { p_empleado_id: id, p_fecha: c.fecha })),
    );
    const mapa: Record<string, HorarioDelDia | null> = {};
    ids.forEach((id, i) => (mapa[id] = ((respuestas[i]?.data ?? []) as HorarioDelDia[])[0] ?? null));
    this.horarioNormal.set(mapa);
    // Con una sola persona, se proponen sus horas de siempre para editarlas.
    const propio = c.a ? mapa[c.a] : null;
    if (c.tipo === 'una' && propio?.trabaja && !this.cambioNuevo()?.inicio) {
      this.cambioNuevo.update((x) => (x ? { ...x, inicio: this.hhmm(propio.hora_inicio), fin: this.hhmm(propio.hora_fin) } : x));
    }
  }

  protected async guardarCambio(motivo: string): Promise<void> {
    const c = this.cambioNuevo();
    if (!c) return;
    if (!c.fecha || !c.a || (c.tipo === 'intercambio' && !c.b)) {
      this.errorAccion.set(c.tipo === 'intercambio' ? 'Elige el día y a las dos personas.' : 'Elige el día y a la persona.');
      return;
    }
    if (c.tipo === 'intercambio' && c.a === c.b) {
      this.errorAccion.set('Elegiste a la misma persona dos veces: un intercambio es entre dos personas distintas.');
      return;
    }
    if (c.tipo === 'una' && !c.descansa && (!c.inicio || !c.fin)) {
      this.errorAccion.set('Escribe la hora de entrada y la de salida, o marca que ese día descansa.');
      return;
    }
    await this.ejecutar(
      () =>
        c.tipo === 'intercambio'
          ? this.sesion.bd.rpc('intercambiar_horario', { p_empleado_a: c.a, p_empleado_b: c.b, p_fecha: c.fecha, p_motivo: motivo })
          : this.sesion.bd.rpc('ajustar_horario_dia', {
              p_empleado_id: c.a, p_fecha: c.fecha,
              p_inicio: c.descansa ? null : c.inicio, p_fin: c.descansa ? null : c.fin, p_motivo: motivo,
            }),
      () => {
        this.cambioNuevo.set(null);
        this.avisos.exito('Cambio guardado. Los reportes y Pendientes ya lo toman en cuenta.');
      },
    );
  }

  protected async quitarCambio(a: Ajuste, motivo: string): Promise<void> {
    await this.ejecutar(
      () => this.sesion.bd.rpc('quitar_ajuste_horario', { p_id: a.id, p_motivo: motivo }),
      () => {
        this.ajustePorQuitar.set(null);
        this.avisos.exito('Cambio quitado: ese día vuelve a su horario normal.');
      },
    );
  }

  // --------------------------------------------------------------------------

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

  protected marcado(evento: Event): boolean {
    return (evento.target as HTMLInputElement).checked;
  }
}
