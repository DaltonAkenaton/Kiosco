/**
 * ============================================================================
 *  PENDIENTES: lo que el jefe tiene que atender  (migracion 0029)
 * ============================================================================
 *
 *  Junta del 20-10-2026. El jefe quiere que el sistema le RECUERDE: quien
 *  llego tarde toda la semana, quien falto, quien no registro su salida.
 *  Lo que ve el viernes, el lunes sigue aqui.
 *
 *  Cada caso se queda abierto hasta que alguien pica "Atender" y escribe que
 *  se hizo ("Se hablo con la persona", "Se levanto acta"). Eso queda como la
 *  historia de cada persona, en "Atendidos".
 *
 *  Los casos los crea la base con las reglas de Configuracion → Pendientes
 *  (servicios/pendientes.ts, `revisar_pendientes()`). Si un caso deja de
 *  aplicar (se registro un permiso, se corrigio la salida), se cierra solo y
 *  dice por que.
 *
 *  Agrupados POR PERSONA: con 20 empleados, "Juan: 3 casos" se lee mejor que
 *  una lista de 30 renglones sueltos.
 *
 *  Prueba del autor (20-10-2026): con muchos casos la pantalla era una lista
 *  enorme. Cada persona es ahora UNA tarjeta corta ("9 faltas, 2 camara
 *  tapada · del 12 al 20 de octubre") y sus casos se ven al picar "Ver los
 *  casos". Cada caso se atiende por separado (cada dia tiene su propia
 *  razon), salvo "Tarde en la semana", que pregunta que dias cierra con ella. Si alguien falta varios dias seguidos, la tarjeta pregunta
 *  si esta enfermo, de vacaciones o ya no trabaja ahi.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { diaSiguiente, inicioDelDiaLocal } from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { CargandoTabla, RENGLONES_CARGANDO } from '../componentes/cargando-tabla';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { ElegirEmpleado, conNumero } from '../componentes/elegir-empleado';
import { IncidenciaSugerida, RegistrarIncidencia, TIPOS_DE_INCIDENCIA, familiaDeIncidencia, textoDeIncidencia } from '../componentes/registrar-incidencia';
import { Avisos } from '../servicios/avisos';
import { Pendientes } from '../servicios/pendientes';
import { senalRecordada } from '../servicios/recordar';
import { Sesion } from '../servicios/sesion';
import { hora } from '../textos';

type Tipo = 'retardo_dia' | 'retardos_semana' | 'falta' | 'salida_no_registrada' | 'registro_de_baja' | 'foto_tapada';

interface Caso {
  id: string;
  tipo: Tipo;
  empleado_id: string;
  desde: string;
  hasta: string;
  detalle: {
    minutos?: number;
    dias?: number;
    entrada?: string | null;
    programado?: string | null;
    turno?: string | null;
    hora?: string;
    tipo?: 'entrada' | 'salida';
    veces?: number;
  };
  estado: 'pendiente' | 'atendido' | 'resuelto_solo';
  detectado_en: string;
  cerrado_en: string | null;
  cerrado_por: string | null;
  que_se_hizo: string | null;
  empleado: { nombre: string; apellido_paterno: string; apellido_materno: string; numero_empleado: string | null } | null;
}

/** Cada tipo de caso, en palabras: un titulo corto y su color. */
export const TIPOS_DE_PENDIENTE: Record<Tipo, { titulo: string; color: string; ayuda: string }> = {
  retardo_dia: {
    titulo: 'Llegó tarde',
    color: 'var(--kiosko-atencion)',
    ayuda: 'Llegó tarde ese día los minutos que dice Configuración → Pendientes ("Minutos tarde en un día"), o más.',
  },
  retardos_semana: {
    titulo: 'Tarde en la semana',
    color: 'var(--kiosko-atencion)',
    ayuda:
      'Sus minutos tarde de esa semana (lunes a domingo) suman lo que dice Configuración → Pendientes, o más. ' +
      'Se cuentan desde su hora de entrada, aunque estén dentro de la tolerancia: 12 minutos todos los días ' +
      'también suman.',
  },
  falta: {
    titulo: 'Faltó',
    color: 'var(--kiosko-peligro)',
    ayuda: 'Le tocaba trabajar, no registró entrada y no tiene permiso, vacaciones ni otra incidencia ese día.',
  },
  salida_no_registrada: {
    titulo: 'No registró su salida',
    color: 'var(--kiosko-atencion)',
    ayuda: 'Registró su entrada y nunca su salida. El sistema no inventa la hora: si sabes a qué hora salió, regístrala a mano en Asistencia.',
  },
  registro_de_baja: {
    titulo: 'Registró después de su baja',
    color: 'var(--kiosko-peligro)',
    ayuda:
      'Esta persona ya estaba dada de baja cuando registró (el kiosco no se había enterado por falta de ' +
      'internet). Decide si cuenta; si no, anúlalo en Asistencia (Corregir → Anular).',
  },
  foto_tapada: {
    titulo: 'Cámara tapada',
    color: 'var(--kiosko-peligro)',
    ayuda: 'Registró con la cámara tapada (la foto salió oscura o sin forma). La foto está en el kiosco, en el modo administrador.',
  },
};

/**
 * Lo que se escribe casi siempre al atender: un clic y listo (se puede
 * editar). Y el ejemplo del campo. CADA TIPO LOS SUYOS (21-10-2026: en una
 * camara tapada salia "dice que fue el camion" y "Tenia permiso del jefe",
 * que ahi no tienen sentido).
 */
const AL_ATENDER: Record<Tipo, { sugerencias: string[]; ejemplo: string }> = {
  falta: {
    sugerencias: ['Se habló con la persona', 'Tenía permiso del jefe', 'Se levantó acta administrativa', 'Fue un error del registro'],
    ejemplo: 'Ej.: se habló con la persona, dice que se enfermó',
  },
  retardo_dia: {
    sugerencias: ['Se habló con la persona', 'Tenía permiso del jefe', 'Se levantó acta administrativa', 'Fue un error del registro'],
    ejemplo: 'Ej.: se habló con la persona, dice que fue el camión',
  },
  retardos_semana: {
    sugerencias: ['Se habló con la persona', 'Se le dio una advertencia', 'Se levantó acta administrativa'],
    ejemplo: 'Ej.: se habló con la persona sobre sus llegadas tarde',
  },
  salida_no_registrada: {
    sugerencias: ['Se registró su salida a mano', 'Se le recordó registrar su salida', 'Se habló con la persona'],
    ejemplo: 'Ej.: salió a las 14:00, se registró a mano en Asistencia',
  },
  registro_de_baja: {
    sugerencias: ['Sí trabajó ese día, cuenta', 'Se anuló el registro', 'Se habló con la persona'],
    ejemplo: 'Ej.: vino a entregar su gafete; se anuló el registro',
  },
  foto_tapada: {
    sugerencias: ['Se revisó la foto: sí era la persona', 'Se habló con la persona', 'Se levantó acta administrativa', 'La cámara falló, no fue la persona'],
    ejemplo: 'Ej.: se revisó en el kiosco, tapó la cámara con la mano',
  },
};

/**
 * Atender y justificar en un paso (21-10-2026: el jefe elegia "Tenia permiso
 * del jefe" y creia que la falta ya no contaba; atender solo anota). En una
 * falta o un retardo sale la casilla "Ademas, justificar ese dia"; elegir una
 * de estas sugerencias la marca (con su tipo) o la desmarca. Con un motivo
 * escrito a mano no se toca: decide el jefe.
 */
const JUSTIFICA: Record<string, { falta: string; retardo_dia: string } | null> = {
  'Tenía permiso del jefe': { falta: 'permiso', retardo_dia: 'retardo_justificado' },
  'Fue un error del registro': { falta: 'olvido_registro', retardo_dia: 'falla_sistema' },
  'Se habló con la persona': null,
  'Se levantó acta administrativa': null,
};

/**
 * Atendidos, por paginas (21-10-2026): antes se traian los 300 mas recientes
 * de TODOS y se filtraba por persona en la pagina, asi que con los meses la
 * historia vieja de alguien ya no aparecia. Ahora la persona se filtra en la
 * base y "Ver más antiguos" trae la siguiente pagina, como en la Bitacora.
 */
const ATENDIDOS_POR_PAGINA = 100;

/**
 * Desde cuantas faltas SEGUIDAS (sin ningun dia trabajado en medio) la
 * tarjeta pregunta si esta enfermo, de vacaciones o ya no trabaja ahi.
 */
const FALTAS_SEGUIDAS_PARA_PREGUNTAR = 3;

/** "9 faltas", "1 llegada tarde": cada tipo, contado, en palabras. */
const CONTADO: Record<Tipo, (n: number) => string> = {
  retardo_dia: (n) => `${n} ${n === 1 ? 'llegada' : 'llegadas'} tarde`,
  retardos_semana: (n) => `${n} ${n === 1 ? 'semana' : 'semanas'} con muchos minutos tarde`,
  falta: (n) => `${n} ${n === 1 ? 'falta' : 'faltas'}`,
  salida_no_registrada: (n) => `${n} ${n === 1 ? 'salida' : 'salidas'} sin registrar`,
  registro_de_baja: (n) => `${n} ${n === 1 ? 'registro' : 'registros'} después de su baja`,
  foto_tapada: (n) => `cámara tapada ${n} ${n === 1 ? 'día' : 'días'}`,
};

/** El orden de los tipos en el resumen: lo mas serio primero. */
const ORDEN: Tipo[] = ['falta', 'registro_de_baja', 'foto_tapada', 'salida_no_registrada', 'retardos_semana', 'retardo_dia'];

interface Persona {
  id: string;
  nombre: string;
  numero: string | null;
  casos: Caso[];
  /** "9 faltas", "2 llegadas tarde"... con su color. */
  resumen: { texto: string; color: string }[];
  /** "Del 12 al 20 de octubre", o "Lunes, 19 de octubre". */
  rango: string;
  /** La racha mas larga de faltas seguidas, si llega al limite. */
  seguidas: { dias: number; desde: string; hasta: string } | null;
}

@Component({
  selector: 'panel-pendientes',
  imports: [Ayuda, CargandoTabla, Dialogo, ElegirEmpleado, RegistrarIncidencia, RouterLink],
  templateUrl: './pendientes.html',
})
export class PaginaPendientes implements OnInit {
  protected readonly sesion = inject(Sesion);
  private readonly pendientes = inject(Pendientes);
  private readonly avisos = inject(Avisos);
  private readonly router = inject(Router);

  protected readonly vista = senalRecordada<'abiertos' | 'atendidos'>('pendientes.vista', 'abiertos');
  protected readonly empleadoId = senalRecordada('pendientes.empleado', '');

  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly abiertos = signal<Caso[]>([]);
  protected readonly cerrados = signal<Caso[]>([]);
  protected readonly empleados = signal<{ id: string; nombre: string }[]>([]);
  private readonly nombresDeAdmin = signal<Map<string, string>>(new Map());
  /** Los dias en que cada persona SI registro entrada (para las faltas seguidas). */
  private readonly diasConEntrada = signal<Map<string, Set<string>>>(new Map());
  /** "Revisar desde" de Configuracion: lo de antes no es pendiente. */
  protected readonly revisarDesde = signal<string | null>(null);
  /** Las tarjetas con sus casos a la vista. */
  private readonly desplegadas = signal<Set<string>>(new Set());

  protected readonly TIPOS = TIPOS_DE_PENDIENTE;
  protected readonly AYUDA =
    'Aquí sale quién llegó tarde, quién faltó, quién no registró su salida y quién registró con la cámara tapada, ' +
    'según las reglas de Configuración → Pendientes. Cada caso se queda hasta que alguien pica «Atender» y escribe ' +
    'qué se hizo: así no se olvida aunque pasen días, y queda en la historia de la persona (pestaña «Atendidos»). ' +
    'Si un caso deja de aplicar (por ejemplo, se registró un permiso), se cierra solo y dice por qué. Lo que pasó ' +
    'antes de la fecha «Revisar desde» de Configuración no se vuelve pendiente.';
  protected readonly AL_ATENDER = AL_ATENDER;
  protected readonly RENGLONES_CARGANDO = RENGLONES_CARGANDO;

  /**
   * El lugar de cada tarjeta, fijo mientras se esta en la pagina (20-10-2026:
   * al atender, la persona bajaba de lugar y parecia que habia desaparecido).
   * Se ordena por cuantos casos tiene solo la PRIMERA vez que aparece.
   */
  private readonly lugares = new Map<string, number>();

  /** Los abiertos, agrupados por persona; quien tiene mas casos, primero. */
  protected readonly porPersona = computed<Persona[]>(() => {
    const filtro = this.empleadoId();
    const grupos = new Map<string, Caso[]>();
    for (const c of this.abiertos()) {
      if (filtro && c.empleado_id !== filtro) continue;
      grupos.set(c.empleado_id, [...(grupos.get(c.empleado_id) ?? []), c]);
    }
    const conEntrada = this.diasConEntrada();
    const personas = [...grupos.entries()]
      .map(([id, casos]) => ({
        id,
        nombre: this.nombreDe(casos[0]),
        numero: casos[0].empleado?.numero_empleado ?? null,
        casos,
        resumen: ORDEN.map((tipo) => ({ tipo, n: casos.filter((c) => c.tipo === tipo).length }))
          .filter((x) => x.n > 0)
          .map((x) => ({ texto: CONTADO[x.tipo](x.n), color: TIPOS_DE_PENDIENTE[x.tipo].color })),
        rango: this.rango(casos),
        seguidas: this.faltasSeguidas(casos, conEntrada.get(id) ?? new Set()),
      }))
      .sort((a, b) => b.casos.length - a.casos.length || a.nombre.localeCompare(b.nombre));
    // Con el filtro puesto no se reparten lugares: la lista completa manda.
    if (filtro) return personas;
    for (const p of personas) if (!this.lugares.has(p.id)) this.lugares.set(p.id, this.lugares.size);
    return personas.sort((a, b) => this.lugares.get(a.id)! - this.lugares.get(b.id)!);
  });

  /** Con una sola persona a la vista (o el filtro puesto), sus casos se ven solos. */
  protected desplegada(p: Persona): boolean {
    return this.porPersona().length === 1 || this.desplegadas().has(p.id);
  }

  protected alternar(p: Persona): void {
    this.desplegadas.update((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(p.id)) nuevo.delete(p.id);
      else nuevo.add(p.id);
      return nuevo;
    });
  }

  /** "Del 12 al 20 de octubre" (o un solo dia). */
  private rango(casos: Caso[]): string {
    const desde = casos.reduce((m, c) => (c.desde < m ? c.desde : m), casos[0].desde);
    // La semana termina en domingo: hasta hoy, no una fecha que todavia no llega.
    const masTarde = casos.reduce((m, c) => (c.hasta > m ? c.hasta : m), casos[0].hasta);
    const hasta = masTarde > this.sesion.hoy() ? this.sesion.hoy() : masTarde;
    if (desde === hasta) return this.cuando({ ...casos[0], tipo: 'falta', desde, hasta });
    const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
    return `Del ${this.diaYMes(desde, !mismoMes)} al ${this.diaYMes(hasta, true)}`;
  }

  /**
   * La racha mas larga de faltas sin ningun dia con entrada en medio (los
   * dias de descanso no la cortan: en ellos no hay falta ni entrada).
   */
  private faltasSeguidas(casos: Caso[], conEntrada: Set<string>): Persona['seguidas'] {
    const faltas = casos.filter((c) => c.tipo === 'falta').map((c) => c.desde).sort();
    let mejor: Persona['seguidas'] = null;
    let inicio = 0;
    for (let i = 1; i <= faltas.length; i++) {
      const corta = i === faltas.length || [...conEntrada].some((d) => d > faltas[i - 1] && d < faltas[i]);
      if (!corta) continue;
      const dias = i - inicio;
      if (dias >= FALTAS_SEGUIDAS_PARA_PREGUNTAR && (!mejor || dias >= mejor.dias)) {
        mejor = { dias, desde: faltas[inicio], hasta: faltas[i - 1] };
      }
      inicio = i;
    }
    return mejor;
  }

  /** "del 12 al 20 de octubre" de una racha de faltas. */
  protected fechasDeRacha(r: NonNullable<Persona['seguidas']>): string {
    const mismoMes = r.desde.slice(0, 7) === r.hasta.slice(0, 7);
    return `del ${this.diaYMes(r.desde, !mismoMes)} al ${this.diaYMes(r.hasta, true)}`;
  }

  /** "20 de octubre de 2026". */
  protected fechaLarga(f: string): string {
    return new Date(`${f}T12:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  /** Ya vienen filtrados por persona desde la base (cargarAtendidos). */
  protected readonly atendidosVisibles = this.cerrados;
  protected readonly hayMasAtendidos = signal(false);
  protected readonly cargandoMas = signal(false);
  private consultaAtendidos = 0;

  private static readonly COLUMNAS =
    'id, tipo, empleado_id, desde, hasta, detalle, estado, detectado_en, cerrado_en, cerrado_por, que_se_hizo, ' +
    'empleado:empleados(nombre, apellido_paterno, apellido_materno, numero_empleado)';

  protected elegirEmpleado(id: string): void {
    this.empleadoId.set(id);
    void this.cargarAtendidos(true);
  }

  /** Una pagina de atendidos: desde el principio (otro filtro) o la que sigue. */
  protected async cargarAtendidos(desdeCero: boolean): Promise<boolean> {
    const esta = ++this.consultaAtendidos;
    const inicio = desdeCero ? 0 : this.cerrados().length;
    this.cargandoMas.set(!desdeCero);
    let q = this.sesion.bd.from('pendientes').select(PaginaPendientes.COLUMNAS).neq('estado', 'pendiente');
    if (this.empleadoId()) q = q.eq('empleado_id', this.empleadoId());
    // El id desempata: dos cerrados en el mismo instante no se repiten ni se saltan entre paginas.
    const { data, error } = await q.order('cerrado_en', { ascending: false }).order('id')
      .range(inicio, inicio + ATENDIDOS_POR_PAGINA - 1);
    if (esta !== this.consultaAtendidos) return true;
    this.cargandoMas.set(false);
    if (error) return false;
    const nuevos = (data ?? []) as unknown as Caso[];
    this.cerrados.set(desdeCero ? nuevos : [...this.cerrados(), ...nuevos]);
    this.hayMasAtendidos.set(nuevos.length === ATENDIDOS_POR_PAGINA);
    void this.cargarJustificaciones();
    return true;
  }

  /**
   * En Atendidos, que se vea si el dia quedo justificado (21-10-2026: el jefe
   * no sabia si su falta ya no contaba). Se busca la incidencia que cubre ese
   * dia HOY, no lo que se marco al atender: si luego la quitaron en
   * Incidencias, aqui deja de decirlo, igual que el reporte.
   */
  protected readonly justificaciones = signal<Map<string, string>>(new Map());

  private async cargarJustificaciones(): Promise<void> {
    const lista = this.cerrados();
    const casos = lista.filter((c) => this.sePuedeRegistrarIncidencia(c));
    if (casos.length === 0) {
      this.justificaciones.set(new Map());
      return;
    }
    const fechas = casos.map((c) => c.desde).sort();
    const { data } = await this.sesion.bd.from('incidencias').select('empleado_id, tipo, fecha_inicio, fecha_fin')
      .in('empleado_id', [...new Set(casos.map((c) => c.empleado_id))])
      .lte('fecha_inicio', fechas[fechas.length - 1])
      .gte('fecha_fin', fechas[0]);
    if (lista !== this.cerrados()) return; // mientras, llego otra pagina u otro filtro
    const incidencias = data ?? [];
    this.justificaciones.set(new Map(casos.flatMap((c) => {
      const i = incidencias.find((x) => x.empleado_id === c.empleado_id && x.fecha_inicio <= c.desde && x.fecha_fin >= c.desde);
      return i ? [[c.id, textoDeIncidencia(i.tipo)] as [string, string]] : [];
    })));
  }

  async ngOnInit(): Promise<void> {
    await this.pendientes.revisar();
    await this.cargar();
  }

  protected async cargar(): Promise<void> {
    this.error.set(null);
    const [abiertos, cerrados, emp, admins, desde] = await Promise.all([
      this.sesion.bd.from('pendientes').select(PaginaPendientes.COLUMNAS).eq('estado', 'pendiente').order('desde', { ascending: false }),
      this.cargarAtendidos(true),
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, numero_empleado, anonimizado_en').order('nombre'),
      this.sesion.bd.from('administradores').select('user_id, nombre'),
      this.sesion.bd.from('configuracion').select('valor').eq('clave', 'pendientes_revisar_desde').maybeSingle(),
    ]);
    this.cargando.set(false);
    if (abiertos.error || !cerrados || emp.error) {
      this.error.set('No se pudieron traer los pendientes. Revisa el internet y vuelve a intentar.');
      return;
    }
    this.abiertos.set((abiertos.data ?? []) as unknown as Caso[]);
    this.empleados.set(
      (emp.data ?? [])
        .filter((e) => e.anonimizado_en === null)
        .map((e) => ({ id: e.id, nombre: conNumero(`${e.nombre} ${e.apellido_paterno}`, e.numero_empleado) })),
    );
    this.nombresDeAdmin.set(new Map((admins.data ?? []).map((a) => [a.user_id as string, a.nombre as string])));
    this.revisarDesde.set(typeof desde.data?.valor === 'string' ? desde.data.valor : null);
    await this.cargarEntradas();
  }

  /**
   * Para las faltas seguidas: los dias con entrada de quien tiene varias
   * faltas abiertas, entre su primera y su ultima falta. Si no llega (sin
   * internet), simplemente no se pregunta.
   */
  private async cargarEntradas(): Promise<void> {
    const faltas = new Map<string, string[]>();
    for (const c of this.abiertos()) {
      if (c.tipo === 'falta') faltas.set(c.empleado_id, [...(faltas.get(c.empleado_id) ?? []), c.desde]);
    }
    const quienes = [...faltas.entries()].filter(([, f]) => f.length >= FALTAS_SEGUIDAS_PARA_PREGUNTAR);
    if (quienes.length === 0) {
      this.diasConEntrada.set(new Map());
      return;
    }
    const todas = quienes.flatMap(([, f]) => f).sort();
    const zona = this.sesion.zona();
    const { data } = await this.sesion.bd
      .from('marcas')
      .select('empleado_id, hora_estimada')
      .eq('tipo', 'entrada')
      .in('empleado_id', quienes.map(([id]) => id))
      .gte('hora_estimada', new Date(inicioDelDiaLocal(todas[0], zona)).toISOString())
      .lt('hora_estimada', new Date(inicioDelDiaLocal(diaSiguiente(todas[todas.length - 1]), zona)).toISOString());
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' });
    const mapa = new Map<string, Set<string>>();
    for (const m of data ?? []) {
      const id = m.empleado_id as string;
      if (!mapa.has(id)) mapa.set(id, new Set());
      mapa.get(id)!.add(dia.format(new Date(m.hora_estimada as string)));
    }
    this.diasConEntrada.set(mapa);
  }

  // --------------------------------------------------------------------------
  //  En palabras
  // --------------------------------------------------------------------------

  protected nombreDe(c: Caso): string {
    const e = c.empleado;
    return e ? [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' ') : '(desconocido)';
  }

  /** Lo que paso, en una oracion. */
  protected texto(c: Caso): string {
    const z = this.sesion.zona();
    const d = c.detalle;
    switch (c.tipo) {
      case 'retardo_dia':
        return `Llegó ${d.minutos} minutos tarde` +
          (d.entrada && d.programado ? ` (entró a las ${hora(d.entrada, z)}; su hora era las ${hora(d.programado, z)}).` : '.');
      case 'retardos_semana':
        return `Sumó ${d.minutos} minutos tarde en la semana, en ${d.dias} día${d.dias === 1 ? '' : 's'}.`;
      case 'falta':
        return `No vino y no tiene permiso registrado` +
          (d.programado ? ` (le tocaba a las ${hora(d.programado, z)}${d.turno ? ', ' + d.turno : ''}).` : '.');
      case 'salida_no_registrada':
        return `Registró su entrada${d.entrada ? ' a las ' + hora(d.entrada, z) : ''} y nunca su salida.`;
      case 'registro_de_baja':
        return `Registró su ${d.tipo ?? 'entrada'}${d.hora ? ' a las ' + hora(d.hora, z) : ''} cuando ya tenía su baja.`;
      case 'foto_tapada':
        return `Registró con la cámara tapada${d.veces && d.veces > 1 ? ` (${d.veces} veces)` : ''}.`;
    }
  }

  /** "Viernes 24 de octubre", o "Semana del 19 al 25 de octubre". */
  protected cuando(c: Caso): string {
    if (c.tipo === 'retardos_semana') {
      // Con mes en los dos lados si la semana cruza de mes: "del 28 de septiembre al 4 de octubre".
      const del = this.diaYMes(c.desde, c.desde.slice(0, 7) !== c.hasta.slice(0, 7));
      const al = this.diaYMes(c.hasta, true);
      return `Semana del ${del} al ${al}`;
    }
    const texto = new Date(`${c.desde}T12:00:00Z`).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  private diaYMes(fecha: string, conMes: boolean): string {
    return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-MX', {
      day: 'numeric', ...(conMes ? { month: 'long' } : {}), timeZone: 'UTC',
    });
  }

  /** "Atendido por Javier el 27/10: Se habló con la persona" / "Se resolvió solo". */
  protected quienCerro(c: Caso): string {
    if (c.estado === 'resuelto_solo') return 'Se resolvió solo';
    return `Atendido por ${c.cerrado_por ? (this.nombresDeAdmin().get(c.cerrado_por) ?? 'un administrador') : 'un administrador'}`;
  }

  protected fechaCierre(c: Caso): string {
    return c.cerrado_en
      ? new Date(c.cerrado_en).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: this.sesion.zona() })
      : '';
  }

  // --------------------------------------------------------------------------
  //  Acciones
  // --------------------------------------------------------------------------

  /**
   * Faltas y retardos se ven en REPORTES (20-10-2026): ahi esta el horario,
   * los minutos tarde de cada dia ("+4, +14, +52 = 70") y el boton Justificar.
   * En Asistencia solo se veian entradas y salidas, y una falta ni eso.
   * Se abre la SEMANA del caso, para ver lo de los otros dias.
   */
  protected seVeEnReportes(c: Caso): boolean {
    return c.tipo === 'falta' || c.tipo === 'retardo_dia' || c.tipo === 'retardos_semana';
  }

  /** "Ver su reporte" o "Ver sus registros", segun el caso. */
  protected verRegistros(c: Caso): void {
    if (this.seVeEnReportes(c)) {
      const domingo = this.sumarDias(this.lunesDe(c.desde), 6);
      void this.router.navigate(['/reportes'], {
        queryParams: {
          desde: this.lunesDe(c.desde),
          hasta: domingo < this.sesion.hoy() ? domingo : this.sesion.hoy(),
          empleado: c.empleado_id,
          // Reportes resalta el dia del caso, o los dias que llego tarde.
          ...(c.tipo === 'retardos_semana' ? { tarde: '1' } : { resaltar: c.desde }),
        },
      });
      return;
    }
    // Lo demas (salida sin registrar, camara tapada, registro de baja) se
    // corrige sobre el registro mismo: en Asistencia.
    void this.router.navigate(['/asistencia'], {
      queryParams: { desde: c.desde, hasta: c.tipo === 'salida_no_registrada' ? this.sumarDias(c.hasta, 1) : c.hasta, empleado: c.empleado_id },
    });
  }

  /**
   * "Registrar incidencia" (20-10-2026): lo normal es que el jefe se entere
   * aqui mismo de que estaba enfermo o tenia permiso. Solo en faltas y
   * retardos de un dia: ahi la incidencia SI cierra el caso sola (una salida
   * no registrada se arregla capturando la salida, no con una incidencia).
   */
  protected readonly registrando = signal<IncidenciaSugerida | null>(null);

  protected sePuedeRegistrarIncidencia(c: Caso): boolean {
    return c.tipo === 'falta' || c.tipo === 'retardo_dia';
  }

  protected registrarIncidencia(c: Caso): void {
    this.registrando.set({
      empleadoId: c.empleado_id,
      fecha: c.desde,
      tipo: c.tipo === 'falta' ? 'falta_justificada' : 'retardo_justificado',
    });
  }

  /** Para todos los dias de una racha de faltas seguidas, de un jalon. */
  protected registrarIncidenciaDeRacha(p: Persona, r: NonNullable<Persona['seguidas']>): void {
    this.registrando.set({ empleadoId: p.id, fecha: r.desde, hasta: r.hasta, tipo: 'falta_justificada' });
  }

  protected async alRegistrarIncidencia(mensaje: string): Promise<void> {
    this.registrando.set(null);
    this.cargando.set(true);
    await this.pendientes.revisar();
    await this.cargar();
    this.avisos.exito(`${mensaje} Los casos que justifica se cerraron solos (están en "Atendidos").`);
  }

  private sumarDias(fecha: string, dias: number): string {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  /** El lunes de la semana de esa fecha (la semana va de lunes a domingo). */
  private lunesDe(fecha: string): string {
    const diaDeLaSemana = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
    return this.sumarDias(fecha, -((diaDeLaSemana + 6) % 7));
  }

  protected readonly atendiendo = signal<Caso | null>(null);
  protected readonly reabriendo = signal<Caso | null>(null);
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  protected abrirAtender(c: Caso): void {
    this.errorAccion.set(null);
    this.diasMarcados.set(new Set(this.diasDeLaSemana(c).map((d) => d.id)));
    this.justificar.set(false);
    this.tipoJustificacion.set(c.tipo === 'falta' ? 'falta_justificada' : 'retardo_justificado');
    this.atendiendo.set(c);
  }

  // Ademas, justificar ese dia (ver JUSTIFICA).
  protected readonly justificar = signal(false);
  protected readonly tipoJustificacion = signal('');

  /** Los tipos que tienen sentido: a una falta no le toca "retardo justificado", ni a un retardo unas vacaciones. */
  protected gruposParaJustificar(c: Caso): { familia: 'ausencia' | 'por_bueno'; tipos: typeof TIPOS_DE_INCIDENCIA }[] {
    const sirven = c.tipo === 'falta'
      ? (v: string) => v !== 'retardo_justificado'
      : (v: string) => ['retardo_justificado', 'falla_sistema', 'olvido_registro', 'permiso'].includes(v);
    const tipos = TIPOS_DE_INCIDENCIA.filter((t) => sirven(t.valor));
    return (['ausencia', 'por_bueno'] as const)
      .map((familia) => ({ familia, tipos: tipos.filter((t) => t.familia === familia) }))
      .filter((g) => g.tipos.length > 0);
  }

  protected familiaDe(valor: string): 'ausencia' | 'por_bueno' | null {
    return familiaDeIncidencia(valor);
  }

  protected alEscribirQueSeHizo(c: Caso, texto: string): void {
    if (!this.sePuedeRegistrarIncidencia(c) || !(texto in JUSTIFICA)) return;
    const tipos = JUSTIFICA[texto];
    this.justificar.set(!!tipos);
    if (tipos) this.tipoJustificacion.set(c.tipo === 'falta' ? tipos.falta : tipos.retardo_dia);
  }

  /**
   * Al atender "Tarde en la semana", las llegadas tarde de ESA semana de esa
   * persona que siguen abiertas (20-10-2026: el jefe hablo de la semana
   * completa; dejar los dias sueltos obligaba a atender lo mismo otra vez).
   * Una casilla POR DIA, todas marcadas de entrada y bien a la vista: el dia
   * que llego muy tarde puede llevar su propia acta y atenderse aparte.
   */
  protected diasDeLaSemana(c: Caso): Caso[] {
    if (c.tipo !== 'retardos_semana') return [];
    return this.abiertos()
      .filter((d) => d.tipo === 'retardo_dia' && d.empleado_id === c.empleado_id && d.desde >= c.desde && d.desde <= c.hasta)
      .sort((a, b) => a.desde.localeCompare(b.desde));
  }

  protected readonly diasMarcados = signal<Set<string>>(new Set());

  protected marcarDia(id: string): void {
    this.diasMarcados.update((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  protected marcarTodos(c: Caso, todos: boolean): void {
    this.diasMarcados.set(new Set(todos ? this.diasDeLaSemana(c).map((d) => d.id) : []));
  }

  /**
   * Antes de justificar, se pregunta con todas sus letras (21-10-2026: el jefe
   * atendio una falta con la casilla marcada como "No se registro" sin darse
   * cuenta; queria incapacidad, vacaciones o permiso).
   */
  protected readonly porConfirmar = signal<{ caso: Caso; queSeHizo: string } | null>(null);

  protected textoDelTipo(valor: string): string {
    return textoDeIncidencia(valor);
  }

  protected async atender(c: Caso, queSeHizo: string, confirmado = false): Promise<void> {
    const justifica = this.justificar() && this.sePuedeRegistrarIncidencia(c);
    if (justifica && !confirmado) {
      this.porConfirmar.set({ caso: c, queSeHizo });
      return;
    }
    this.porConfirmar.set(null);
    this.guardando.set(true);
    this.errorAccion.set(null);
    // Primero la justificacion: si falla, no se cerro nada y se puede volver a intentar.
    if (justifica) {
      const { error } = await this.sesion.bd.rpc('registrar_incidencia', {
        p_empleado_id: c.empleado_id, p_tipo: this.tipoJustificacion(), p_inicio: c.desde, p_fin: c.desde, p_notas: queSeHizo,
      });
      if (error) {
        this.guardando.set(false);
        this.errorAccion.set(`No se pudo justificar el día: ${mensajeDeError(error)}`);
        return;
      }
    }
    const { error } = await this.sesion.bd.rpc('atender_pendiente', { p_id: c.id, p_que_se_hizo: queSeHizo });
    if (error) {
      this.guardando.set(false);
      this.errorAccion.set(
        justifica
          ? `El día quedó justificado, pero no se anotó lo que se hizo: ${mensajeDeError(error)}`
          : mensajeDeError(error),
      );
      if (justifica) await this.cargar();
      return;
    }
    if (justifica) {
      // Un retardo justificado ya no suma a "Tarde en la semana": que se revise.
      this.guardando.set(false);
      this.atendiendo.set(null);
      this.cargando.set(true);
      await this.pendientes.revisar();
      await this.cargar();
      this.avisos.exito(
        `Listo: quedó en la historia de ${this.nombreDe(c)} y el día quedó justificado ` +
          `(ya no cuenta como ${c.tipo === 'falta' ? 'falta' : 'retardo'} en los reportes).`,
      );
      return;
    }
    let cerrados = 1;
    {
      // En la historia de cada dia queda con que se atendio.
      const nota = `Se atendió junto con «${this.cuando(c)}»: ${queSeHizo}`;
      for (const d of this.diasDeLaSemana(c).filter((x) => this.diasMarcados().has(x.id))) {
        const { error: e } = await this.sesion.bd.rpc('atender_pendiente', { p_id: d.id, p_que_se_hizo: nota });
        if (e) {
          this.guardando.set(false);
          this.errorAccion.set(`La semana quedó atendida, pero no un día: ${mensajeDeError(e)}`);
          await this.cargar();
          return;
        }
        cerrados++;
      }
    }
    this.guardando.set(false);
    this.atendiendo.set(null);
    this.pendientes.ajustar(-cerrados);
    this.avisos.exito(
      cerrados > 1
        ? `Listo: la semana y ${cerrados - 1} llegada(s) tarde quedaron en la historia de ${this.nombreDe(c)}.`
        : `Listo: quedó en la historia de ${this.nombreDe(c)}.`,
    );
    await this.cargar();
  }

  protected abrirReabrir(c: Caso): void {
    this.errorAccion.set(null);
    this.reabriendo.set(c);
  }

  protected async reabrir(c: Caso, motivo: string): Promise<void> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await this.sesion.bd.rpc('reabrir_pendiente', { p_id: c.id, p_motivo: motivo });
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    this.reabriendo.set(null);
    this.pendientes.ajustar(1);
    this.avisos.exito('El pendiente se volvió a abrir.');
    await this.cargar();
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLSelectElement).value;
  }
}
