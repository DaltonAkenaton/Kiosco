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
 *  Lo que TODAVIA no hay: "a tiempo / retardo / falta". Eso necesita los
 *  turnos y llega en el bloque 9.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { diaSiguiente, hoyEn, inicioDelDiaLocal, instanteLocal } from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
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

  protected readonly desde = signal(hoyEn(this.sesion.zona()));
  protected readonly hasta = signal(hoyEn(this.sesion.zona()));
  protected readonly empleadoId = signal('');
  protected readonly dispositivoId = signal('');
  protected readonly revision = signal<Revision>('');

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
    const [emp, disp] = await Promise.all([
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, numero_empleado').order('nombre'),
      this.sesion.bd.from('dispositivos').select('id, nombre').order('nombre'),
    ]);
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
        'id, tipo, origen, hora_estimada, recibido_en, banderas, foto_estado, en_cuarentena, ' +
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
