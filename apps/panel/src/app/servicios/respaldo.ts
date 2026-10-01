/**
 * ============================================================================
 *  RESPALDO DESDE EL PANEL  (Configuracion -> Respaldo, migracion 0027)
 * ============================================================================
 *
 *  Baja TODAS las tablas y las pone en un Excel, una hoja por tabla: lo mismo
 *  que el respaldo automatico de GitHub (.github/workflows/respaldo-semanal.yml
 *  y .github/scripts/respaldo-a-excel.mjs), pero en el momento y sin entrar a
 *  GitHub. Las mismas tablas y las mismas columnas: SIN hashes de PIN, de
 *  tokens ni de contrasenas.
 *
 *  Lo que NO trae: el SQL para reconstruir la base (eso solo lo puede sacar
 *  GitHub, conectado directo a la base) ni las fotos (nunca salen del kiosco).
 *
 *  POR PARTES: el servidor entrega como mucho 1000 renglones por pedido. La
 *  bitacora y las marcas crecen para siempre, asi que cada tabla se pide en
 *  pedazos de 1000, ordenada por una llave fija para no saltarse ni repetir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Celda, Hoja } from './escribir-excel';

export interface TablaDelRespaldo {
  /** Nombre de la tabla y de la hoja. */
  tabla: string;
  /** Columnas: '*' o una lista (en las tablas con hashes, SIEMPRE lista). */
  columnas: string;
  /** Orden fijo y unico, para pedir por partes sin saltarse renglones. */
  orden: string[];
}

/**
 * En el orden en que salen las hojas: lo que mas se consulta, primero.
 * Si se agrega una tabla aqui, agregarla tambien al respaldo de GitHub.
 */
export const TABLAS_DEL_RESPALDO: TablaDelRespaldo[] = [
  { tabla: 'marcas', orden: ['hora_estimada', 'id'],
    columnas: 'id, empleado_id, tipo, origen, hora_estimada, dispositivo_id, foto_estado, banderas, en_cuarentena, recibido_en' },
  { tabla: 'empleados', orden: ['nombre', 'id'],
    columnas: 'id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno, pin_temporal, activo, anonimizado_en, creado_en, actualizado_en' },
  { tabla: 'incidencias', columnas: '*', orden: ['fecha_inicio', 'id'] },
  { tabla: 'correcciones', columnas: '*', orden: ['creado_en', 'id'] },
  { tabla: 'turnos', columnas: '*', orden: ['nombre', 'id'] },
  { tabla: 'asignaciones_turno', columnas: '*', orden: ['vigente_desde', 'id'] },
  { tabla: 'dias_laborales', columnas: '*', orden: ['asignacion_id', 'dia_semana'] },
  { tabla: 'dias_festivos', columnas: '*', orden: ['fecha'] },
  { tabla: 'accesos_foto', columnas: '*', orden: ['consultado_en', 'id'] },
  { tabla: 'administradores', orden: ['nombre', 'user_id'],
    columnas: 'user_id, nombre, correo, rol, activo, usuario_kiosco, creado_en' },
  { tabla: 'bitacora_auditoria', columnas: '*', orden: ['id'] },
  { tabla: 'configuracion', columnas: 'clave, valor, descripcion', orden: ['clave'] },
  { tabla: 'dispositivos', orden: ['nombre', 'id'],
    columnas: 'id, nombre, ubicacion, activo, enrolado_en, revocado_en, ultima_conexion, version_app' },
  { tabla: 'eventos_dispositivo', columnas: '*', orden: ['ocurrido_en', 'id'] },
];

/** Lo maximo que entrega el servidor por pedido. */
export const RENGLONES_POR_PEDIDO = 1000;

type Renglon = Record<string, unknown>;

/** Una tabla completa, pidiendola por partes. */
export async function bajarTabla(bd: SupabaseClient, t: TablaDelRespaldo): Promise<Renglon[]> {
  const todos: Renglon[] = [];
  for (let desde = 0; ; desde += RENGLONES_POR_PEDIDO) {
    let consulta = bd.from(t.tabla).select(t.columnas);
    for (const columna of t.orden) consulta = consulta.order(columna, { ascending: true });
    const { data, error } = await consulta.range(desde, desde + RENGLONES_POR_PEDIDO - 1);
    if (error) throw new Error(`No se pudo leer "${t.tabla}": ${error.message}`);
    const renglones = (data ?? []) as unknown as Renglon[];
    todos.push(...renglones);
    if (renglones.length < RENGLONES_POR_PEDIDO) return todos;
  }
}

/** Un valor de la base, como celda de Excel. */
export function aCelda(valor: unknown): Celda {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no';
  if (typeof valor === 'number' || typeof valor === 'string') return valor;
  if (Array.isArray(valor) && valor.every((v) => typeof v !== 'object' || v === null)) return valor.join(' ');
  return JSON.stringify(valor);
}

/** Fecha y hora de un timestamp, en la hora local (por ejemplo, Nuevo Laredo). */
function horaLocal(iso: unknown, zona: string): string {
  if (typeof iso !== 'string' || !iso) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

/**
 * Convierte las tablas bajadas en hojas de Excel. La hoja de marcas lleva,
 * como en el respaldo de GitHub, el usuario de la persona y la hora local
 * junto a cada registro, para leerla sin cruzar tablas.
 */
export function armarHojas(datos: Map<string, Renglon[]>, zona: string): Hoja[] {
  const usuarios = new Map((datos.get('empleados') ?? []).map((e) => [e['id'], e['usuario']]));
  return TABLAS_DEL_RESPALDO.map((t) => {
    let renglones = datos.get(t.tabla) ?? [];
    let columnas = t.columnas === '*' ? Object.keys(renglones[0] ?? {}) : t.columnas.split(',').map((c) => c.trim());
    if (t.tabla === 'marcas') {
      columnas = ['id', 'empleado_id', 'usuario', 'tipo', 'origen', 'hora_local', ...columnas.filter((c) => !['id', 'empleado_id', 'tipo', 'origen'].includes(c))];
      renglones = renglones.map((m) => ({ ...m, usuario: usuarios.get(m['empleado_id']) ?? '', hora_local: horaLocal(m['hora_estimada'], zona) }));
    }
    if (!columnas.length) return { nombre: t.tabla, filas: [['(vacía)']] };
    return { nombre: t.tabla.slice(0, 31), filas: [columnas, ...renglones.map((r) => columnas.map((c) => aCelda(r[c])))] };
  });
}

/** Todo junto: baja cada tabla (avisando cual va) y arma las hojas. */
export async function armarRespaldo(
  bd: SupabaseClient,
  zona: string,
  avance: (tabla: string, numero: number, total: number) => void = () => {},
): Promise<Hoja[]> {
  const datos = new Map<string, Renglon[]>();
  for (const [i, t] of TABLAS_DEL_RESPALDO.entries()) {
    avance(t.tabla, i + 1, TABLAS_DEL_RESPALDO.length);
    datos.set(t.tabla, await bajarTabla(bd, t));
  }
  return armarHojas(datos, zona);
}
