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
 *
 *  MAS FILTROS (06-10-2026, pedido tras la instalacion): fechas, quien lo
 *  hizo, sobre que persona, que tipo de cambio y buscar en el motivo. Todos
 *  se aplican EN LA BASE (no en la pagina): la bitacora crece para siempre y
 *  traerla entera para filtrar aqui seria cada vez mas lento.
 */

import { Component, OnInit, WritableSignal, inject, signal } from '@angular/core';
import { diaSiguiente, inicioDelDiaLocal } from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { CargandoTabla, RENGLONES_CARGANDO } from '../componentes/cargando-tabla';
import { ElegirEmpleado, conNumero } from '../componentes/elegir-empleado';
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
  ajustes_horario: 'Cambio por un día',
  pendientes: 'Pendiente',
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
  dado_de_baja_en: 'dado de baja el',
  ubicacion: 'ubicación', empleado_id: 'persona', turno_id: 'turno', vigente_desde: 'vigente desde',
  descansa: 'descansa', intercambio_con: 'intercambio con', intercambio_id: 'intercambio', que_se_hizo: 'qué se hizo',
};

/** Por paginas: la bitacora crece para siempre. */
const POR_PAGINA = 200;

/**
 * "Qué tipo de cambio": cada opcion es un filtro de la base. Los que no son
 * una tabla entera miran DENTRO del cambio (datos_antes / datos_despues).
 */
const TIPOS: { valor: string; nombre: string }[] = [
  { valor: 'altas', nombre: 'Altas de personal' },
  { valor: 'bajas', nombre: 'Bajas de personal' },
  { valor: 'pin', nombre: 'Cambios de PIN' },
  { valor: 'anulaciones', nombre: 'Registros anulados o corregidos' },
  { valor: 'a_mano', nombre: 'Registros capturados a mano' },
  { valor: 'configuracion', nombre: 'Cambios de Configuración' },
  { valor: 'horarios', nombre: 'Horarios y turnos' },
  { valor: 'kioscos', nombre: 'Kioscos (altas y bajas)' },
  { valor: 'accesos', nombre: 'Accesos al panel' },
];

/** Columnas de hash: la base las guarda como "[oculto]", o "[nuevo]" si cambiaron (0028). */
const HASHES = new Set(['pin_hash', 'contrasena_kiosco_hash', 'token_hash', 'codigo_hash']);

@Component({
  selector: 'panel-bitacora',
  imports: [Ayuda, CargandoTabla, ElegirEmpleado],
  template: `
    <h1 class="text-2xl font-bold">Bitácora</h1>
    <p class="text-texto-suave mt-1">Quién cambió qué, cuándo y por qué, del más reciente al más antiguo. Nadie la puede editar ni borrar.</p>

    <div class="mt-4 flex flex-wrap items-end gap-4">
      <label class="flex max-w-full flex-col gap-1">
        <span>Mostrar <panel-ayuda titulo="¿Por qué no salen los registros de los kioscos?" [texto]="AYUDA_FILTRO" alinear="izquierda" /></span>
        <select class="campo max-w-full" (change)="cambiarFiltro(valor($event))">
          <option value="personas" [selected]="filtro() === 'personas'">Lo que hicieron personas (lo normal)</option>
          <option value="todo" [selected]="filtro() === 'todo'">Todo, también cada registro de los kioscos</option>
          @for (t of SECCIONES; track t.tabla) {
            <option [value]="t.tabla" [selected]="filtro() === t.tabla">Sólo: {{ t.nombre }}</option>
          }
        </select>
      </label>
      <label class="flex flex-col gap-1">
        Qué tipo de cambio
        <select class="campo" (change)="cambiar(tipo, valor($event))">
          <option value="">Cualquiera</option>
          @for (t of TIPOS; track t.valor) {
            <option [value]="t.valor" [selected]="tipo() === t.valor">{{ t.nombre }}</option>
          }
        </select>
      </label>
      <label class="flex flex-col gap-1">
        Quién lo hizo
        <select class="campo" (change)="cambiar(actor, valor($event))">
          <option value="">Cualquiera</option>
          @for (a of administradores(); track a.id) {
            <option [value]="a.id" [selected]="actor() === a.id">{{ a.nombre }}</option>
          }
          <option value="sistema" [selected]="actor() === 'sistema'">El sistema (un kiosco)</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        Sobre qué persona
        <panel-elegir-empleado [opciones]="listaEmpleados()" [valor]="empleado()" textoVacio="Cualquiera"
                               (elegir)="cambiar(empleado, $event)" />
      </label>
      <label class="flex flex-col gap-1">
        Desde
        <input type="date" class="campo" [value]="desde()" (change)="cambiar(desde, valor($event))" />
      </label>
      <label class="flex flex-col gap-1">
        Hasta
        <input type="date" class="campo" [value]="hasta()" (change)="cambiar(hasta, valor($event))" />
      </label>
      <label class="flex flex-col gap-1">
        Buscar en el motivo
        <input type="search" class="campo" placeholder="Ej.: prueba" [value]="texto()"
               (change)="cambiar(texto, valor($event))" />
      </label>
      @if (hayFiltros()) {
        <button type="button" class="boton-secundario" (click)="quitarFiltros()">Quitar filtros</button>
      }
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
  protected readonly tipo = signal('');
  protected readonly actor = signal('');
  protected readonly empleado = signal('');
  protected readonly desde = signal('');
  protected readonly hasta = signal('');
  protected readonly texto = signal('');
  protected readonly TIPOS = TIPOS;
  protected readonly administradores = signal<{ id: string; nombre: string }[]>([]);
  protected readonly listaEmpleados = signal<{ id: string; nombre: string }[]>([]);
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
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, numero_empleado'),
    ]);
    for (const a of admins.data ?? []) this.nombres.set(a.user_id, a.nombre);
    for (const e of empleados.data ?? []) this.empleados.set(e.id, `${e.nombre} ${e.apellido_paterno}`);
    const porNombre = (a: { nombre: string }, b: { nombre: string }): number => a.nombre.localeCompare(b.nombre);
    this.administradores.set([...this.nombres].map(([id, nombre]) => ({ id, nombre })).sort(porNombre));
    const numeros = new Map((empleados.data ?? []).map((e) => [e.id as string, e.numero_empleado as string | null]));
    this.listaEmpleados.set(
      [...this.empleados].map(([id, nombre]) => ({ id, nombre: conNumero(nombre, numeros.get(id)) })).sort(porNombre),
    );
    await this.cargar(true);
  }

  protected cambiarFiltro(valor: string): void {
    this.filtro.set(valor);
    void this.cargar(true);
  }

  protected cambiar(campo: WritableSignal<string>, valor: string): void {
    if (campo() === valor.trim()) return;
    campo.set(valor.trim());
    void this.cargar(true);
  }

  protected hayFiltros(): boolean {
    return !!(this.tipo() || this.actor() || this.empleado() || this.desde() || this.hasta() || this.texto());
  }

  protected quitarFiltros(): void {
    for (const f of [this.tipo, this.actor, this.empleado, this.desde, this.hasta, this.texto]) f.set('');
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
    // "Quién lo hizo" manda sobre "Mostrar": si se eligió a alguien, ya no
    // hace falta esconder lo de los kioscos (y "el sistema" ES lo de los kioscos).
    const actor = this.actor();
    if (actor === 'sistema') q = q.is('actor', null);
    else if (actor) q = q.eq('actor', actor);
    else if (filtro === 'personas') q = q.not('actor', 'is', null);
    if (filtro !== 'personas' && filtro !== 'todo') q = q.eq('tabla', filtro);

    switch (this.tipo()) {
      case 'altas': q = q.eq('tabla', 'empleados').eq('accion', 'INSERT'); break;
      case 'bajas':
        q = q.eq('tabla', 'empleados').eq('datos_antes->>activo', 'true').eq('datos_despues->>activo', 'false');
        break;
      case 'pin': q = q.eq('tabla', 'empleados').eq('datos_despues->>pin_hash', '[nuevo]'); break;
      case 'anulaciones': q = q.eq('tabla', 'correcciones'); break;
      case 'a_mano': q = q.eq('tabla', 'marcas').eq('datos_despues->>origen', 'manual'); break;
      case 'configuracion': q = q.eq('tabla', 'configuracion'); break;
      case 'horarios': q = q.in('tabla', ['turnos', 'turno_versiones', 'asignaciones_turno', 'ajustes_horario']); break;
      case 'kioscos': q = q.eq('tabla', 'dispositivos'); break;
      case 'accesos': q = q.eq('tabla', 'administradores'); break;
    }

    // Una persona: los cambios A ELLA (su renglon de empleados) y los que la
    // MENCIONAN (sus registros, correcciones, horarios, incidencias).
    const persona = this.empleado();
    if (persona) {
      q = q.or(`registro_id.eq.${persona},datos_despues->>empleado_id.eq.${persona},datos_antes->>empleado_id.eq.${persona}`);
    }

    // El dia se corta a medianoche de Nuevo Laredo, no de UTC (CLAUDE.md 6).
    const zona = this.sesion.zona();
    if (this.desde()) q = q.gte('creado_en', new Date(inicioDelDiaLocal(this.desde(), zona)).toISOString());
    if (this.hasta()) q = q.lt('creado_en', new Date(inicioDelDiaLocal(diaSiguiente(this.hasta()), zona)).toISOString());

    // Sin los comodines de PostgREST: que lo escrito se busque tal cual.
    const texto = this.texto().replace(/[%*,()]/g, ' ').trim();
    if (texto) q = q.ilike('motivo', `%${texto}%`);

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
      .map((k) =>
        // Un PIN o contraseña que cambio: se dice que cambio, nunca cual era (0028).
        HASHES.has(k)
          ? `${COLUMNAS[k] ?? k.replace(/_/g, ' ')}: cambió (por seguridad no se muestra)`
          : `${COLUMNAS[k] ?? k.replace(/_/g, ' ')}: ${this.enPalabras(k, antes[k])} → ${this.enPalabras(k, despues[k])}`,
      )
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
