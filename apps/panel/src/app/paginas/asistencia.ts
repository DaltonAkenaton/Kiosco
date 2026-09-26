/**
 * ============================================================================
 *  ASISTENCIA: la tabla de registros  (CLAUDE.md 10)
 * ============================================================================
 *
 *  Todas las marcas que llegaron de los kioscos y las capturadas a mano, con
 *  filtros de fecha, empleado, kiosco y revision.
 *
 *  REGISTRO MANUAL (CLAUDE.md 11): sin luz, sin kiosco, olvido de PIN. Lo
 *  puede hacer tambien un supervisor; pide motivo y queda en la bitacora.
 *
 *  Lo que NO hay aqui: la foto. Nunca sale del kiosco (CLAUDE.md 5.1). El
 *  panel solo sabe su ESTADO (en el kiosco, borrada, falta, alterada...), y
 *  el filtro "Revisar la foto en el kiosco" junta los casos para que el jefe
 *  haga un solo viaje en vez de uno por caso.
 *
 *  "A tiempo / retardo / falta" estan en Reportes: aqui se ven los registros
 *  tal cual, separados por dia y con el TURNO de cada persona, para que "entra
 *  el matutino a las 6:00" no se confunda con "sale el velador a las 6:00".
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { diaSiguiente, hoyEn, inicioDelDiaLocal, instanteLocal } from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { senalRecordada } from '../servicios/recordar';
import { Sesion } from '../servicios/sesion';
import {
  AYUDA_BANDERAS,
  AYUDA_CUARENTENA,
  ESTADOS_DE_FOTO,
  NOMBRES_DE_BANDERAS,
  fecha,
  hora,
} from '../textos';

interface Marca {
  id: string;
  empleado_id: string;
  tipo: 'entrada' | 'salida';
  origen: 'kiosco' | 'manual';
  hora_estimada: string;
  recibido_en: string;
  banderas: string[];
  foto_estado: string;
  en_cuarentena: boolean;
  empleado: { nombre: string; apellido_paterno: string; apellido_materno: string; numero_empleado: string | null } | null;
  dispositivo: { nombre: string } | null;
  correcciones: { accion: 'anular' | 'cambiar_tipo' | 'agregar'; datos: { tipo?: string }; motivo: string; creado_en: string }[];
}

type Revision = '' | 'cualquiera' | 'foto_en_kiosco' | 'cuarentena' | string;

/** El horario asignado a una persona, para saber de que turno es cada registro. */
interface Asignacion {
  empleado_id: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  turno: { nombre: string; hora_inicio: string; hora_fin: string } | null;
}

const SIN_TURNO = '(sin turno)';

/** Tope de renglones por consulta: con 20 personas, 500 son ~12 dias completos. */
const MAXIMO = 500;

@Component({
  selector: 'panel-asistencia',
  imports: [Ayuda, Dialogo],
  templateUrl: './asistencia.html',
})
export class Asistencia implements OnInit {
  protected readonly sesion = inject(Sesion);
  protected readonly zona = this.sesion.zona;

  // Los filtros se recuerdan al cambiar de pantalla (servicios/recordar.ts).
  protected readonly desde = senalRecordada('asistencia.desde', hoyEn(this.sesion.zona()));
  protected readonly hasta = senalRecordada('asistencia.hasta', hoyEn(this.sesion.zona()));
  protected readonly empleadoId = senalRecordada('asistencia.empleado', '');
  protected readonly dispositivoId = senalRecordada('asistencia.kiosco', '');
  protected readonly revision = senalRecordada<Revision>('asistencia.revision', '');
  /** Filtro por turno. Se aplica aqui mismo, sin volver a preguntar a la base. */
  protected readonly turnoFiltro = senalRecordada('asistencia.turno', '');
  protected readonly asignaciones = signal<Asignacion[]>([]);

  /** Los nombres de turno para el filtro. */
  protected readonly turnos = computed(() =>
    [...new Set(this.asignaciones().map((a) => a.turno?.nombre).filter((n): n is string => !!n))].sort(),
  );

  /** Los registros que se ven, ya con el filtro de turno. */
  protected readonly visibles = computed(() => {
    const filtro = this.turnoFiltro();
    return filtro ? this.marcas().filter((m) => this.turnoDe(m) === filtro) : this.marcas();
  });

  protected readonly empleados = signal<{ id: string; nombre: string }[]>([]);
  protected readonly dispositivos = signal<{ id: string; nombre: string }[]>([]);
  protected readonly marcas = signal<Marca[]>([]);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly ESTADOS_DE_FOTO = ESTADOS_DE_FOTO;
  protected readonly NOMBRES_DE_BANDERAS = NOMBRES_DE_BANDERAS as Record<string, string | undefined>;
  protected readonly AYUDA_BANDERAS = AYUDA_BANDERAS;
  protected readonly AYUDA_CUARENTENA = AYUDA_CUARENTENA;
  protected readonly BANDERAS = Object.keys(NOMBRES_DE_BANDERAS);
  protected readonly BANDERAS_QUE_YA_SE_VEN = ['sin_camara', 'foto_obstruida'];
  protected readonly fecha = fecha;
  protected readonly hora = hora;

  protected readonly AYUDA_REVISAR_EN_KIOSCO =
    'Registros con algo raro (cámara tapada, hora dudosa, cuarentena) cuya foto sigue guardada en el ' +
    'kiosco. Como la foto sólo se puede ver ahí, este filtro los junta para que revises varios en un ' +
    'solo viaje. Abajo dice cuántos hay en cada kiosco.';

  /** Para el filtro "Revisar la foto en el kiosco": cuantos casos hay en cada uno. */
  protected readonly casosPorKiosco = computed(() => {
    if (this.revision() !== 'foto_en_kiosco') return [];
    const cuenta = new Map<string, number>();
    for (const m of this.marcas()) {
      const nombre = m.dispositivo?.nombre ?? 'Sin kiosco';
      cuenta.set(nombre, (cuenta.get(nombre) ?? 0) + 1);
    }
    return [...cuenta.entries()].map(([nombre, casos]) => ({ nombre, casos }));
  });

  async ngOnInit(): Promise<void> {
    const [emp, disp, asig] = await Promise.all([
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, numero_empleado').order('nombre'),
      this.sesion.bd.from('dispositivos').select('id, nombre').order('nombre'),
      this.sesion.bd
        .from('asignaciones_turno')
        .select('empleado_id, vigente_desde, vigente_hasta, turno:turnos(nombre, hora_inicio, hora_fin)'),
    ]);
    this.asignaciones.set((asig.data ?? []) as unknown as Asignacion[]);
    this.empleados.set(
      (emp.data ?? []).map((e) => ({
        id: e.id,
        nombre: `${e.numero_empleado ? '#' + e.numero_empleado + ' · ' : ''}${e.nombre} ${e.apellido_paterno}`,
      })),
    );
    this.dispositivos.set(disp.data ?? []);
    await this.buscar();
  }

  protected cambiar(filtro: 'desde' | 'hasta' | 'empleadoId' | 'dispositivoId' | 'revision', valor: string): void {
    this[filtro].set(valor);
    void this.buscar();
  }

  protected async buscar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    const zona = this.sesion.zona();

    let consulta = this.sesion.bd
      .from('marcas')
      .select(
        'id, empleado_id, tipo, origen, hora_estimada, recibido_en, banderas, foto_estado, en_cuarentena, ' +
          'empleado:empleados(nombre, apellido_paterno, apellido_materno, numero_empleado), ' +
          'dispositivo:dispositivos(nombre), correcciones(accion, datos, motivo, creado_en)',
      )
      .order('hora_estimada', { ascending: false })
      .limit(MAXIMO);

    // El dia se corta a medianoche de Matamoros, no de UTC (CLAUDE.md 6).
    if (this.desde()) consulta = consulta.gte('hora_estimada', new Date(inicioDelDiaLocal(this.desde(), zona)).toISOString());
    if (this.hasta()) {
      consulta = consulta.lt('hora_estimada', new Date(inicioDelDiaLocal(diaSiguiente(this.hasta()), zona)).toISOString());
    }
    if (this.empleadoId()) consulta = consulta.eq('empleado_id', this.empleadoId());
    if (this.dispositivoId()) consulta = consulta.eq('dispositivo_id', this.dispositivoId());

    const revision = this.revision();
    if (revision === 'cualquiera') {
      consulta = consulta.or('en_cuarentena.eq.true,banderas.neq.{},foto_estado.in.(faltante,alterada,obstruida)');
    } else if (revision === 'foto_en_kiosco') {
      consulta = consulta
        .in('foto_estado', ['con_foto', 'obstruida', 'conservada'])
        .or('en_cuarentena.eq.true,banderas.neq.{}');
    } else if (revision === 'cuarentena') {
      consulta = consulta.eq('en_cuarentena', true);
    } else if (revision === 'foto_problema') {
      consulta = consulta.in('foto_estado', ['faltante', 'alterada']);
    } else if (revision) {
      consulta = consulta.contains('banderas', [revision]);
    }

    const { data, error } = await consulta;
    this.cargando.set(false);
    if (error) {
      this.error.set('No se pudieron traer los registros. Revisa el internet y vuelve a intentar.');
      return;
    }
    this.marcas.set((data ?? []) as unknown as Marca[]);
  }

  /**
   * El turno al que pertenece un registro: el que la persona tenia asignado
   * ese dia. Una SALIDA de madrugada de un turno que cruza la medianoche
   * (el velador, 22:00-06:00) es del turno que empezo el dia ANTERIOR.
   */
  protected turnoDe(m: Marca): string {
    const zona = this.sesion.zona();
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(m.hora_estimada));
    const p = (t: string): string => partes.find((x) => x.type === t)?.value ?? '';
    const dia = `${p('year')}-${p('month')}-${p('day')}`;
    const horaLocal = `${p('hour')}:${p('minute')}`;

    const vigenteEn = (fecha: string): Asignacion | undefined =>
      this.asignaciones()
        .filter((a) => a.empleado_id === m.empleado_id && a.vigente_desde <= fecha && (!a.vigente_hasta || fecha < a.vigente_hasta))
        .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0];

    let asignada = vigenteEn(dia);
    const cruza = (a?: Asignacion): boolean => !!a?.turno && a.turno.hora_fin < a.turno.hora_inicio;
    if (this.tipoVigente(m) === 'salida' && horaLocal < '12:00') {
      const ayer = new Date(`${dia}T12:00:00Z`);
      ayer.setUTCDate(ayer.getUTCDate() - 1);
      const anterior = vigenteEn(ayer.toISOString().slice(0, 10));
      if (cruza(anterior)) asignada = anterior;
    }
    return asignada?.turno?.nombre ?? SIN_TURNO;
  }

  /** "martes 22 de septiembre de 2026", para el renglon que separa los dias. */
  protected diaLargo(iso: string): string {
    const texto = new Date(iso).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: this.sesion.zona(),
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  protected nombreCompleto(m: Marca): string {
    const e = m.empleado;
    return e ? [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' ') : '(desconocido)';
  }

  protected estadoDeFoto(estado: string): { texto: string; color: string; ayuda: string } {
    return ESTADOS_DE_FOTO[estado] ?? { texto: estado, color: 'var(--kiosko-texto)', ayuda: '' };
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected readonly MAXIMO = MAXIMO;

  // --------------------------------------------------------------------------
  //  Correcciones: la marca original NO se toca (CLAUDE.md 8)
  // --------------------------------------------------------------------------
  protected readonly corrigiendo = signal<Marca | null>(null);
  protected readonly accionCorreccion = signal<'anular' | 'cambiar_tipo'>('cambiar_tipo');

  /** Anulada: ya no cuenta para los reportes. */
  protected anulada(m: Marca): boolean {
    return (m.correcciones ?? []).some((c) => c.accion === 'anular');
  }

  /** El tipo que cuenta: el de la ultima correccion, o el original. */
  protected tipoVigente(m: Marca): 'entrada' | 'salida' {
    const cambios = (m.correcciones ?? []).filter((c) => c.accion === 'cambiar_tipo').sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    return (cambios.at(-1)?.datos.tipo as 'entrada' | 'salida' | undefined) ?? m.tipo;
  }

  protected abrirCorreccion(m: Marca): void {
    this.errorAccion.set(null);
    this.accionCorreccion.set('cambiar_tipo');
    this.corrigiendo.set(m);
  }

  protected async guardarCorreccion(m: Marca, motivo: string): Promise<void> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await this.sesion.bd.rpc('corregir_marca', {
      p_marca_id: m.id,
      p_accion: this.accionCorreccion(),
      p_motivo: motivo,
    });
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    this.corrigiendo.set(null);
    await this.buscar();
  }

  // --------------------------------------------------------------------------
  //  Registro manual
  // --------------------------------------------------------------------------
  protected readonly registrandoAMano = signal(false);
  protected readonly manual = signal({ empleadoId: '', tipo: 'entrada' as 'entrada' | 'salida', fecha: '', hora: '' });
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  protected abrirManual(): void {
    const zona = this.sesion.zona();
    const ahora = new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    this.manual.set({ empleadoId: '', tipo: 'entrada', fecha: hoyEn(zona), hora: ahora });
    this.errorAccion.set(null);
    this.registrandoAMano.set(true);
  }

  protected cambiarManual(campo: 'empleadoId' | 'tipo' | 'fecha' | 'hora', valor: string): void {
    this.manual.update((m) => ({ ...m, [campo]: valor }));
  }

  /**
   * La hora que escribe el jefe es hora de Nuevo Laredo. Se convierte al
   * instante exacto con `instanteLocal` (compartido/fechas.ts), que respeta
   * el horario de verano: la noche del cambio, las 06:00 son las 06:00 reales.
   */
  protected async guardarManual(motivo: string): Promise<void> {
    const m = this.manual();
    const [h, min] = m.hora.split(':').map(Number);
    if (!m.empleadoId || !m.fecha || h === undefined || min === undefined || Number.isNaN(h) || Number.isNaN(min)) {
      this.errorAccion.set('Elige a la persona y escribe la fecha y la hora.');
      return;
    }
    const instante = new Date(instanteLocal(m.fecha, h, min, this.sesion.zona()));

    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await this.sesion.bd.rpc('registrar_marca_manual', {
      p_empleado_id: m.empleadoId,
      p_tipo: m.tipo,
      p_hora: instante.toISOString(),
      p_motivo: motivo,
    });
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    this.registrandoAMano.set(false);
    await this.buscar();
  }
}
