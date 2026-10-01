/**
 * ============================================================================
 *  BITACORA: quien cambio que, cuando y por que  (CLAUDE.md 10)
 * ============================================================================
 *
 *  La llenan los triggers de la base (0009, 0015), no el panel: por eso
 *  registra tambien lo que no pasa por aqui. Solo el rol admin la puede leer
 *  (RLS). Nunca muestra PIN ni contrasenas: la base los guarda como
 *  "[oculto]".
 *
 *  FILTRO POR DEFECTO: "lo que hicieron personas". Cada registro de entrada
 *  o salida de los kioscos tambien entra a la bitacora (~240 por semana con
 *  20 personas); sin el filtro, en unos dias tapaban las bajas, los PIN y los
 *  cambios de Configuracion, que es lo que de verdad se audita.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { CargandoTabla, RENGLONES_CARGANDO } from '../componentes/cargando-tabla';
import { Sesion } from '../servicios/sesion';
import { ESTADOS_DE_FOTO, PALABRAS_CONFIGURACION, fecha, hora } from '../textos';

interface Renglon {
  id: number;
  tabla: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  datos_antes: Record<string, unknown> | null;
  datos_despues: Record<string, unknown> | null;
  actor: string | null;
  motivo: string | null;
  creado_en: string;
}

const TABLAS: Record<string, string> = {
  empleados: 'Empleado',
  administradores: 'Administrador',
  configuracion: 'Configuración',
  dispositivos: 'Kiosco',
  marcas: 'Registro',
  correcciones: 'Corrección',
  incidencias: 'Incidencia',
  turnos: 'Turno',
  asignaciones_turno: 'Horario',
  dias_festivos: 'Día festivo',
  respaldo: 'Respaldo',
};

/** Columnas que no dicen nada a una persona. */
const IGNORAR = new Set(['actualizado_en', 'actualizado_por', 'creado_en', 'id', 'user_id', 'recibido_en']);

/** El nombre de cada columna en palabras ("pin_temporal" -> "PIN temporal"). */
const COLUMNAS: Record<string, string> = {
  pin_temporal: 'PIN temporal', pin_hash: 'PIN', numero_empleado: 'número de empleado',
  apellido_paterno: 'apellido paterno', apellido_materno: 'apellido materno', foto_estado: 'foto',
  rol: 'permiso', usuario_kiosco: 'usuario del kiosco', contrasena_kiosco_hash: 'contraseña del kiosco',
  debe_cambiar_contrasena: 'contraseña temporal', hora_inicio: 'entrada', hora_fin: 'salida',
  tolerancia_minutos: 'tolerancia', minutos_para_falta: 'minutos para retardo mayor', vigente_hasta: 'vigente hasta',
  revocado_en: 'dado de baja el', revocado_por: 'dado de baja por', anonimizado_en: 'datos suprimidos el',
  ubicacion: 'ubicación', empleado_id: 'persona', turno_id: 'turno', vigente_desde: 'vigente desde',
};

/** Por paginas: la bitacora crece para siempre. */
const POR_PAGINA = 200;

@Component({
  selector: 'panel-bitacora',
  imports: [Ayuda, CargandoTabla],
  template: `
    <h1 class="text-2xl font-bold">Bitácora</h1>
    <p class="text-texto-suave mt-1">Quién cambió qué, cuándo y por qué, del más reciente al más antiguo. Nadie la puede editar ni borrar.</p>

    <div class="mt-4 flex flex-wrap items-end gap-4">
      <label class="flex flex-col gap-1">
        <span>Mostrar <panel-ayuda titulo="¿Por qué no salen los registros de los kioscos?" [texto]="AYUDA_FILTRO" alinear="izquierda" /></span>
        <select class="campo" (change)="cambiarFiltro(valor($event))">
          <option value="personas" [selected]="filtro() === 'personas'">Lo que hicieron personas (lo normal)</option>
          <option value="todo" [selected]="filtro() === 'todo'">Todo, también cada registro de los kioscos</option>
          @for (t of SECCIONES; track t.tabla) {
            <option [value]="t.tabla" [selected]="filtro() === t.tabla">Sólo: {{ t.nombre }}</option>
          }
        </select>
      </label>
      @if (!cargando()) {
        <span class="text-texto-suave pb-2">{{ renglones().length }} cambio(s){{ hayMas() ? ' (hay más abajo)' : '' }}</span>
      }
    </div>

    @if (error(); as mensaje) {
      <p class="mt-4 font-bold" style="color: var(--kiosko-peligro)">{{ mensaje }}</p>
    }

    <div class="tabla-desplazable mt-4">
    <table class="w-full border-collapse text-left">
      <thead>
        <tr class="text-texto-suave border-borde border-b text-sm uppercase tracking-wide">
          <th class="py-2 pr-4">Cuándo</th>
          <th class="py-2 pr-4">Quién</th>
          <th class="py-2 pr-4">Qué</th>
          <th class="py-2 pr-4">Cambio</th>
          <th class="py-2">Motivo</th>
        </tr>
      </thead>
      <tbody>
        @if (cargando()) {
          @for (i of RENGLONES_CARGANDO; track i) {
            <tr panel-cargando-tabla [columnas]="5"></tr>
          }
        } @else {
        @for (r of renglones(); track r.id) {
          <tr class="border-borde border-b align-top">
            <td class="py-2 pr-4 whitespace-nowrap tabular-nums">{{ fecha(r.creado_en, sesion.zona()) }} {{ hora(r.creado_en, sesion.zona()) }}</td>
            <td class="py-2 pr-4">{{ quien(r.actor) }}</td>
            <td class="py-2 pr-4 whitespace-nowrap">{{ que(r) }}</td>
            <td class="py-2 pr-4 text-sm">{{ cambio(r) }}</td>
            <td class="py-2">{{ r.motivo ?? '—' }}</td>
          </tr>
        } @empty {
          <tr><td colspan="5" class="text-texto-suave py-10 text-center">No hay cambios con este filtro.</td></tr>
        }
        }
      </tbody>
    </table>
    </div>
    @if (hayMas() && !cargando()) {
      <div class="mt-4 flex justify-center">
        <button type="button" class="boton-secundario" [disabled]="cargandoMas()" (click)="cargar(false)">
          {{ cargandoMas() ? 'Cargando…' : 'Ver cambios más antiguos' }}
        </button>
      </div>
    }
  `,
})
export class Bitacora implements OnInit {
  protected readonly sesion = inject(Sesion);
  protected readonly renglones = signal<Renglon[]>([]);
  protected readonly cargando = signal(true);
  protected readonly RENGLONES_CARGANDO = RENGLONES_CARGANDO;
  protected readonly error = signal<string | null>(null);
  private readonly nombres = new Map<string, string>();
  private readonly empleados = new Map<string, string>();

  protected readonly filtro = signal('personas');
  protected readonly hayMas = signal(false);
  protected readonly cargandoMas = signal(false);
  protected readonly fecha = fecha;
  protected readonly hora = hora;
  protected readonly SECCIONES = Object.entries(TABLAS).map(([tabla, nombre]) => ({ tabla, nombre }));
  protected readonly AYUDA_FILTRO =
    'Cada entrada y salida que se registra en un kiosco también queda en la bitácora. Son muchas (cientos por ' +
    'semana) y taparían lo importante: altas, bajas, PIN nuevos, cambios de horario y de configuración. Por eso, ' +
    'de inicio se muestra sólo lo que hicieron personas. Para ver también los registros, elige "Todo".';
  /** Para que una respuesta vieja (filtro cambiado de prisa) no pise a la nueva. */
  private consulta = 0;

  async ngOnInit(): Promise<void> {
    const [admins, empleados] = await Promise.all([
      this.sesion.bd.from('administradores').select('user_id, nombre'),
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno'),
    ]);
    for (const a of admins.data ?? []) this.nombres.set(a.user_id, a.nombre);
    for (const e of empleados.data ?? []) this.empleados.set(e.id, `${e.nombre} ${e.apellido_paterno}`);
    await this.cargar(true);
  }

  protected cambiarFiltro(valor: string): void {
    this.filtro.set(valor);
    void this.cargar(true);
  }

  /** Con un filtro nuevo (desdeCero), o la siguiente pagina ("Ver cambios mas antiguos"). */
  protected async cargar(desdeCero: boolean): Promise<void> {
    const esta = ++this.consulta;
    if (desdeCero) this.cargando.set(true);
    else this.cargandoMas.set(true);
    const inicio = desdeCero ? 0 : this.renglones().length;

    let q = this.sesion.bd
      .from('bitacora_auditoria')
      .select('id, tabla, accion, datos_antes, datos_despues, actor, motivo, creado_en')
      .order('id', { ascending: false });
    const filtro = this.filtro();
    if (filtro === 'personas') q = q.not('actor', 'is', null);
    else if (filtro !== 'todo') q = q.eq('tabla', filtro);
    const { data, error } = await q.range(inicio, inicio + POR_PAGINA - 1);

    if (esta !== this.consulta) return;
    this.cargando.set(false);
    this.cargandoMas.set(false);
    if (error) {
      this.error.set('No se pudo traer la bitácora. Revisa el internet y vuelve a intentar.');
      return;
    }
    this.error.set(null);
    const nuevos = data as Renglon[];
    this.renglones.set(desdeCero ? nuevos : [...this.renglones(), ...nuevos]);
    this.hayMas.set(nuevos.length === POR_PAGINA);
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLSelectElement).value;
  }

  protected quien(actor: string | null): string {
    if (!actor) return 'El sistema (un kiosco)';
    return this.nombres.get(actor) ?? 'Alguien que ya no es administrador';
  }

  protected que(r: Renglon): string {
    const d = r.datos_despues ?? r.datos_antes ?? {};

    // Un registro de asistencia: de quien, que, y si fue a mano.
    if (r.tabla === 'marcas') {
      const quien = this.empleados.get(String(d['empleado_id'])) ?? 'alguien';
      const tipo = d['tipo'] === 'salida' ? 'Salida' : 'Entrada';
      if (r.accion === 'UPDATE') return `Foto del registro de ${quien}`;
      return `${tipo} de ${quien}${d['origen'] === 'manual' ? ' (a mano)' : ''}`;
    }

    // Alguien se llevo una copia de todos los datos (Configuracion -> Respaldo, 0027).
    if (r.tabla === 'respaldo') return 'Descargó el respaldo completo (Excel con todos los datos)';

    const cosa = TABLAS[r.tabla] ?? r.tabla;
    const verbo = r.accion === 'INSERT' ? 'nuevo' : r.accion === 'UPDATE' ? 'cambio' : 'borrado';
    const clave = typeof d['clave'] === 'string' ? d['clave'] : '';
    const nombre =
      [d['nombre'], d['apellido_paterno']].filter(Boolean).join(' ') ||
      (clave ? (PALABRAS_CONFIGURACION[clave]?.nombre ?? clave) : '');
    return `${cosa} (${verbo})${nombre ? ': ' + nombre : ''}`;
  }

  /** "activo: sí → no", solo las columnas que cambiaron. */
  protected cambio(r: Renglon): string {
    if (r.accion !== 'UPDATE' || !r.datos_antes || !r.datos_despues) return '';
    const antes = r.datos_antes;
    const despues = r.datos_despues;
    return Object.keys(despues)
      .filter((k) => !IGNORAR.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
      .map((k) => `${COLUMNAS[k] ?? k.replace(/_/g, ' ')}: ${this.enPalabras(k, antes[k])} → ${this.enPalabras(k, despues[k])}`)
      .join(' · ');
  }

  private enPalabras(columna: string, v: unknown): string {
    if (columna === 'foto_estado' && typeof v === 'string') return ESTADOS_DE_FOTO[v]?.texto ?? v;
    if (columna === 'rol') return v === 'admin' ? 'administrador' : String(v);
    if (v === true) return 'sí';
    if (v === false) return 'no';
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v !== 'string') return JSON.stringify(v);
    // "2026-09-27T06:39:39.11+00:00" -> "27/09/2026 01:39", en la hora del sistema.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return `${fecha(v, this.sesion.zona())} ${hora(v, this.sesion.zona())}`;
    // Un identificador interno ("revocado por: 5f3a..."): el nombre, si se sabe.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
      return this.nombres.get(v) ?? this.empleados.get(v) ?? 'otro registro';
    }
    return v;
  }
}
