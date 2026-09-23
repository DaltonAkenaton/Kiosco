/**
 * ============================================================================
 *  BITACORA: quien cambio que, cuando y por que  (CLAUDE.md 10)
 * ============================================================================
 *
 *  La llenan los triggers de la base (0009, 0015), no el panel: por eso
 *  registra tambien lo que no pasa por aqui. Solo el rol admin la puede leer
 *  (RLS). Nunca muestra PIN ni contrasenas: la base los guarda como
 *  "[oculto]".
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { Sesion } from '../servicios/sesion';
import { PALABRAS_CONFIGURACION, fecha, hora } from '../textos';

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
};

/** Columnas que no dicen nada a una persona. */
const IGNORAR = new Set(['actualizado_en', 'actualizado_por', 'creado_en', 'id', 'user_id', 'recibido_en']);

@Component({
  selector: 'panel-bitacora',
  template: `
    <h1 class="text-2xl font-bold">Bitácora</h1>
    <p class="text-texto-suave mt-1">Los últimos {{ LIMITE }} cambios: quién, cuándo, qué y por qué. Nadie la puede editar.</p>

    @if (error(); as mensaje) {
      <p class="mt-4 font-bold" style="color: var(--kiosko-peligro)">{{ mensaje }}</p>
    }

    <table class="mt-4 w-full border-collapse text-left">
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
        @for (r of renglones(); track r.id) {
          <tr class="border-borde border-b align-top">
            <td class="py-2 pr-4 whitespace-nowrap tabular-nums">{{ fecha(r.creado_en, sesion.zona()) }} {{ hora(r.creado_en, sesion.zona()) }}</td>
            <td class="py-2 pr-4">{{ quien(r.actor) }}</td>
            <td class="py-2 pr-4 whitespace-nowrap">{{ que(r) }}</td>
            <td class="py-2 pr-4 text-sm">{{ cambio(r) }}</td>
            <td class="py-2">{{ r.motivo ?? '—' }}</td>
          </tr>
        } @empty {
          <tr><td colspan="5" class="text-texto-suave py-10 text-center">Todavía no hay cambios.</td></tr>
        }
      </tbody>
    </table>
  `,
})
export class Bitacora implements OnInit {
  protected readonly sesion = inject(Sesion);
  protected readonly renglones = signal<Renglon[]>([]);
  protected readonly error = signal<string | null>(null);
  private readonly nombres = new Map<string, string>();
  private readonly empleados = new Map<string, string>();

  protected readonly LIMITE = 200;
  protected readonly fecha = fecha;
  protected readonly hora = hora;

  async ngOnInit(): Promise<void> {
    const [bitacora, admins, empleados] = await Promise.all([
      this.sesion.bd
        .from('bitacora_auditoria')
        .select('id, tabla, accion, datos_antes, datos_despues, actor, motivo, creado_en')
        .order('id', { ascending: false })
        .limit(this.LIMITE),
      this.sesion.bd.from('administradores').select('user_id, nombre'),
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno'),
    ]);
    for (const a of admins.data ?? []) this.nombres.set(a.user_id, a.nombre);
    for (const e of empleados.data ?? []) this.empleados.set(e.id, `${e.nombre} ${e.apellido_paterno}`);
    if (bitacora.error) {
      this.error.set('No se pudo traer la bitácora. Sólo el administrador puede verla.');
      return;
    }
    this.renglones.set(bitacora.data as Renglon[]);
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
      .map((k) => `${k.replace(/_/g, ' ')}: ${this.valor(antes[k])} → ${this.valor(despues[k])}`)
      .join(' · ');
  }

  private valor(v: unknown): string {
    if (v === true) return 'sí';
    if (v === false) return 'no';
    if (v === null || v === undefined || v === '') return '—';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
}
