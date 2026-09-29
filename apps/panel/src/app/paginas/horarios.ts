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
 *  Todo con motivo y en la bitacora (funciones de la 0016).
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { hoyEn } from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { CargandoTabla, RENGLONES_CARGANDO } from '../componentes/cargando-tabla';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
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

interface DiaElegido {
  activo: boolean;
  propio: boolean;
  inicio: string;
  fin: string;
}

@Component({
  selector: 'panel-horarios',
  imports: [Ayuda, CargandoTabla, Dialogo],
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
  /** Las de Configuracion: las que usa un turno que deja sus minutos vacios. */
  private reglasGenerales = { tolerancia: 10, falta: 30 };

  protected readonly turnos = signal<Turno[]>([]);
  protected readonly horarios = signal<Horario[]>([]);
  protected readonly empleados = signal<{ id: string; nombre: string; numero: string | null }[]>([]);
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
  protected readonly desde = signal(hoyEn(this.sesion.zona()));
  protected readonly diasElegidos = signal<Record<number, DiaElegido>>({});

  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  protected readonly AYUDA = {
    turnos:
      'Un turno es una plantilla para asignar rápido: nombre y horas. La tolerancia y los minutos para "retardo mayor" ' +
      'normalmente se dejan vacíos, y entonces se usan los de Configuración. Llénalos sólo si ESE turno necesita ' +
      'otra regla. Si cambias las horas de un turno, eliges a partir de qué día: los días anteriores se siguen ' +
      'calculando con el horario que tenían. Si sólo una persona cambió de horario, cambia su horario abajo.',
    propio: 'Si ese día la persona entra o sale a otra hora que la del turno, escríbela aquí. Vacío = la del turno.',
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
    const hoy = hoyEn(this.sesion.zona());
    const [turnos, horarios, empleados, config] = await Promise.all([
      this.sesion.bd.from('turnos').select('id, nombre, hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta, activo').order('hora_inicio'),
      this.sesion.bd
        .from('asignaciones_turno')
        .select('id, empleado_id, vigente_desde, turno:turnos(nombre, hora_inicio, hora_fin), dias_laborales(dia_semana, hora_inicio, hora_fin)')
        .or(`vigente_hasta.is.null,vigente_hasta.gt.${hoy}`),
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, apellido_materno, numero_empleado').eq('activo', true).order('nombre'),
      this.sesion.bd.from('configuracion').select('clave, valor').in('clave', ['tolerancia_retardo_minutos', 'minutos_para_falta']),
    ]);
    this.cargando.set(false);
    for (const c of config.data ?? []) {
      if (c.clave === 'tolerancia_retardo_minutos') this.reglasGenerales.tolerancia = Number(c.valor);
      if (c.clave === 'minutos_para_falta') this.reglasGenerales.falta = Number(c.valor);
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
            aPartirDe: hoyEn(this.sesion.zona()), inicioAntes: this.hhmm(t.hora_inicio), finAntes: this.hhmm(t.hora_fin) }
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
    const tolQueCuenta = tol ?? this.reglasGenerales.tolerancia;
    const faltaQueCuenta = falta ?? this.reglasGenerales.falta;
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
    this.desde.set(hoyEn(this.sesion.zona()));
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
