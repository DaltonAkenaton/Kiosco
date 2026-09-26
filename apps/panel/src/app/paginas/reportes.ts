/**
 * ============================================================================
 *  REPORTES: a tiempo, retardo, falta, horas  (CLAUDE.md 8, bloque 9)
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
 *  El sistema INFORMA, no descuenta (supuestos 2.4): aqui no hay dinero.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { hoyEn } from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
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
  /** Las horas que cuentan: trabajadas, o las del turno si el dia se dio por bueno (0020). */
  horas_acreditadas: number | null;
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
    ayuda: 'Tenía turno y no vino (terminó su turno sin registrar entrada). Si fue por enfermedad, un accidente u otra razón válida, regístralo en Ausencias como falta justificada o incapacidad: deja de contar como falta.',
  },
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

interface Resumen {
  empleadoId: string;
  nombre: string;
  programados: number;
  aTiempo: number;
  retardos: number;
  retardosMayores: number;
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
  imports: [Ayuda, RegistrarIncidencia],
  templateUrl: './reportes.html',
})
export class Reportes implements OnInit {
  protected readonly sesion = inject(Sesion);
  protected readonly zona = this.sesion.zona;

  // Los filtros se recuerdan al cambiar de pantalla (servicios/recordar.ts).
  protected readonly desde = senalRecordada('reportes.desde', this.lunesDeEstaSemana());
  protected readonly hasta = senalRecordada('reportes.hasta', hoyEn(this.sesion.zona()));
  protected readonly empleadoId = senalRecordada('reportes.empleado', '');
  protected readonly vista = senalRecordada<'dias' | 'resumen'>('reportes.vista', 'resumen');

  protected readonly empleados = signal<Map<string, { nombre: string; numero: string | null }>>(new Map());
  protected readonly filas = signal<Fila[]>([]);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly ESTADOS = ESTADOS;
  protected readonly ESTADOS_DE_SALIDA = ESTADOS_DE_SALIDA;
  protected readonly INCIDENCIAS = INCIDENCIAS;
  protected readonly fecha = fecha;
  protected readonly hora = hora;

  protected readonly AYUDA_HORAS =
    'Las horas trabajadas de verdad, MÁS las de los días que se dieron por buenos (se cuenta el turno completo). ' +
    'Las ausencias justificadas (vacaciones, incapacidad) no suman horas.';

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
           retardosMayores: 0, faltas: 0, justificadas: 0, porBueno: 0, horasQueCuentan: 0, sinSalida: 0,
           fueraDeHorario: 0, horas: 0 } satisfies Resumen);
      if (f.estado !== 'sin_turno' && f.estado !== 'festivo' && f.estado !== 'pendiente') r.programados++;
      if (f.estado === 'a_tiempo') r.aTiempo++;
      if (f.estado === 'retardo' || f.estado === 'retardo_mayor') r.retardos++;
      if (f.estado === 'retardo_mayor') r.retardosMayores++;
      if (f.estado === 'falta') r.faltas++;
      if (f.estado === 'incidencia') r.justificadas++;
      if (f.estado === 'justificado') r.porBueno++;
      r.horasQueCuentan += Number(f.horas_acreditadas ?? 0);
      if (f.estado === 'sin_turno') r.fueraDeHorario++;
      if (f.estado_salida === 'salida_no_registrada') r.sinSalida++;
      r.horas += Number(f.horas ?? 0);
      porPersona.set(f.empleado_id, r);
    }
    return [...porPersona.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  async ngOnInit(): Promise<void> {
    const { data } = await this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, apellido_materno, numero_empleado').order('nombre');
    this.empleados.set(
      new Map((data ?? []).map((e) => [e.id, { nombre: [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' '), numero: e.numero_empleado }])),
    );
    await this.buscar();
  }

  // --------------------------------------------------------------------------
  //  Justificar desde el reporte (migracion 0020)
  // --------------------------------------------------------------------------

  protected readonly justificando = signal<IncidenciaSugerida | null>(null);
  protected readonly aviso = signal<string | null>(null);

  /** ¿Tiene algo que justificar ese dia? Falta, retardo o salida sin registrar. */
  protected sePuedeJustificar(f: Fila): boolean {
    return (
      ['falta', 'retardo', 'retardo_mayor'].includes(f.estado) ||
      (f.estado !== 'justificado' && f.estado !== 'incidencia' &&
        ['salida_no_registrada', 'salida_sin_entrada'].includes(f.estado_salida ?? ''))
    );
  }

  /** Abre la ventana con la persona, el dia y el tipo que mas probablemente sea. */
  protected justificar(f: Fila): void {
    const tipo =
      f.estado === 'falta' ? 'falta_justificada'
        : f.estado === 'retardo' || f.estado === 'retardo_mayor' ? 'retardo_justificado'
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
    this.cargando.set(true);
    this.error.set(null);
    const { data, error } = await this.sesion.bd.rpc('reporte_asistencia', {
      p_desde: this.desde(),
      p_hasta: this.hasta(),
      p_empleado_id: this.empleadoId() || null,
    });
    this.cargando.set(false);
    if (error) {
      this.error.set('No se pudo calcular el reporte. Revisa el internet y vuelve a intentar.');
      return;
    }
    // Por dia; dentro del dia, por la hora en que empieza el turno (el
    // matutino antes que el nocturno) y luego por nombre.
    const filas = (data as Fila[]).sort(
      (a, b) =>
        a.fecha.localeCompare(b.fecha) ||
        (a.programado_inicio ?? a.entrada ?? '').localeCompare(b.programado_inicio ?? b.entrada ?? '') ||
        this.nombre(a.empleado_id).localeCompare(this.nombre(b.empleado_id)),
    );
    this.filas.set(filas);
  }

  protected cambiar(filtro: 'desde' | 'hasta' | 'empleadoId', valor: string): void {
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

  // --------------------------------------------------------------------------
  //  Descargar para Excel (CSV con BOM: Excel respeta los acentos)
  // --------------------------------------------------------------------------

  protected descargarDias(): void {
    const z = this.zona();
    const encabezado = ['fecha', 'numero', 'nombre', 'turno', 'entrada_programada', 'entrada', 'salida', 'minutos_tarde',
      'minutos_repuestos', 'horas', 'estado', 'salida_estado', 'ausencia', 'revision'];
    const renglones = this.filas().map((f) => [
      f.fecha, this.numero(f.empleado_id), this.nombre(f.empleado_id), f.turno ?? '',
      f.programado_inicio ? hora(f.programado_inicio, z) : '', f.entrada ? hora(f.entrada, z) : '',
      f.salida ? hora(f.salida, z) : '', f.minutos_tarde ?? '', f.minutos_repuestos ?? '', f.horas ?? '',
      ESTADOS[f.estado]?.texto ?? f.estado, f.estado_salida ? (ESTADOS_DE_SALIDA[f.estado_salida]?.texto || 'Completa') : '',
      f.incidencia ? (INCIDENCIAS[f.incidencia] ?? f.incidencia) : '',
      [...f.banderas.map((b) => (NOMBRES_DE_BANDERAS as Record<string, string>)[b] ?? b), f.corregida ? 'Corregida' : '', f.en_cuarentena ? 'En cuarentena' : '']
        .filter(Boolean).join('; '),
    ]);
    this.descargar(`asistencia-por-dia_${this.desde()}_a_${this.hasta()}.csv`, [encabezado, ...renglones]);
  }

  protected descargarResumen(): void {
    const encabezado = ['numero', 'nombre', 'dias_con_turno', 'a_tiempo', 'retardos', 'de_ellos_mayores', 'faltas', 'ausencias_justificadas',
      'dias_dados_por_buenos', 'sin_registrar_salida', 'fuera_de_horario', 'horas_trabajadas', 'horas_que_cuentan'];
    const renglones = this.resumen().map((r) => [
      this.numero(r.empleadoId), r.nombre, r.programados, r.aTiempo, r.retardos, r.retardosMayores, r.faltas, r.justificadas,
      r.porBueno, r.sinSalida, r.fueraDeHorario, r.horas.toFixed(2), r.horasQueCuentan.toFixed(2),
    ]);
    this.descargar(`asistencia-resumen_${this.desde()}_a_${this.hasta()}.csv`, [encabezado, ...renglones]);
  }

  private descargar(nombre: string, tabla: (string | number)[][]): void {
    const celda = (v: string | number): string => {
      let t = String(v);
      if (/^[=+\-@]/.test(t)) t = `'${t}`; // que Excel no lo tome como formula
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = '﻿' + tabla.map((r) => r.map(celda).join(',')).join('\r\n') + '\r\n';
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  private lunesDeEstaSemana(): string {
    const hoy = hoyEn(this.sesion.zona());
    const d = new Date(`${hoy}T12:00:00Z`);
    const diasDesdeLunes = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diasDesdeLunes);
    return d.toISOString().slice(0, 10);
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected listaEmpleados(): { id: string; nombre: string }[] {
    return [...this.empleados().entries()].map(([id, e]) => ({ id, nombre: e.nombre }));
  }
}
