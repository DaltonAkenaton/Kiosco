/**
 * ============================================================================
 *  REPOSITORIO DEL MODO ADMINISTRADOR
 * ============================================================================
 *
 *  Tres cosas: las credenciales de administrador (para validar sin internet),
 *  la bitacora de quien toco que foto, y la consulta de la pantalla de
 *  auditoria.
 */

import { randomUUID } from 'node:crypto';
import {
  CONFIG,
  type EmpleadoParaFiltro,
  type EstadoFotoLocal,
  type FiltrosAuditoria,
  type MarcaParaAuditoria,
  type TipoMarca,
} from '@kiosko/compartido';
import { baseDeDatos, enTransaccion } from './base-de-datos';

// ----------------------------------------------------------------------------
//  Credenciales
// ----------------------------------------------------------------------------

export interface AdministradorEnCache {
  id: string;
  usuario: string;
  nombre: string;
  contrasenaHash: string;
  rol: 'admin' | 'supervisor';
  activo: boolean;
}

export function buscarAdministrador(usuario: string): AdministradorEnCache | null {
  const fila = baseDeDatos()
    .prepare('SELECT * FROM administradores_cache WHERE usuario = ?')
    .get(usuario) as
    | {
        id: string;
        usuario: string;
        nombre: string;
        contrasena_hash: string;
        rol: 'admin' | 'supervisor';
        activo: number;
      }
    | undefined;

  if (!fila) return null;
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    contrasenaHash: fila.contrasena_hash,
    rol: fila.rol,
    activo: fila.activo === 1,
  };
}

/** Alta o actualizacion. La usaran la sincronizacion y, en desarrollo, la semilla. */
export function guardarAdministrador(admin: AdministradorEnCache): void {
  baseDeDatos()
    .prepare(
      `INSERT INTO administradores_cache
         (id, usuario, nombre, contrasena_hash, rol, activo, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         usuario = excluded.usuario, nombre = excluded.nombre,
         contrasena_hash = excluded.contrasena_hash, rol = excluded.rol,
         activo = excluded.activo, actualizado_en = excluded.actualizado_en`,
    )
    .run(
      admin.id,
      admin.usuario,
      admin.nombre,
      admin.contrasenaHash,
      admin.rol,
      admin.activo ? 1 : 0,
      new Date().toISOString(),
    );
}

// ----------------------------------------------------------------------------
//  Bitacora de accesos a fotos
// ----------------------------------------------------------------------------

export type AccionSobreFoto = 'ver' | 'exportar' | 'conservar' | 'quitar_conservar';

/**
 * Deja constancia de que un administrador toco una foto.
 *
 * Va a la tabla Y a la bandeja de salida, en la misma transaccion: una
 * consulta que quedara solo aqui podria borrarse junto con la PC.
 *
 * A diferencia de los eventos, esto SI lanza excepcion si falla. Quien llama
 * no debe mostrar la foto si no pudo anotar que la mostro.
 */
export function registrarAccesoFoto(marcaId: string, adminId: string, accion: AccionSobreFoto): void {
  const id = randomUUID();
  const ahoraIso = new Date().toISOString();

  enTransaccion(() => {
    const bd = baseDeDatos();
    bd.prepare(
      `INSERT INTO accesos_foto (id, marca_id, admin_id, accion, consultado_en)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, marcaId, adminId, accion, ahoraIso);

    bd.prepare(
      `INSERT INTO outbox (id, tipo_registro, payload, intentos, creado_en)
       VALUES (?, 'acceso_foto', ?, 0, ?)`,
    ).run(id, JSON.stringify({ id, marcaId, adminId, accion, consultadoEn: ahoraIso }), ahoraIso);
  });
}

export function accesosDeFoto(marcaId: string): { adminId: string; accion: AccionSobreFoto }[] {
  const filas = baseDeDatos()
    .prepare('SELECT admin_id, accion FROM accesos_foto WHERE marca_id = ? ORDER BY consultado_en')
    .all(marcaId) as { admin_id: string; accion: AccionSobreFoto }[];
  return filas.map((f) => ({ adminId: f.admin_id, accion: f.accion }));
}

// ----------------------------------------------------------------------------
//  La consulta de auditoria
// ----------------------------------------------------------------------------

/**
 * Convierte "AAAA-MM-DD" (dia local) en el milisegundo UTC en que empieza.
 *
 * No se puede hacer con `new Date('2026-09-22')`: eso es medianoche UTC, que
 * en Nuevo Laredo son las 18:00 o 19:00 del dia ANTERIOR, segun el horario de
 * verano. Aqui se busca el desfase real de esa fecha en la zona configurada.
 */
export function inicioDelDiaLocal(fecha: string, zona: string): number {
  const [ano, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  const comoSiFueraUtc = Date.UTC(ano, mes - 1, dia);

  // Que hora marca el reloj de la zona en ese instante UTC; la diferencia es
  // el desfase. Se calcula dos veces porque cerca del cambio de horario el
  // desfase de "medianoche UTC" y el de "medianoche local" pueden no coincidir.
  const desfase = (ms: number): number => {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const v = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - ms;
  };

  const primera = comoSiFueraUtc - desfase(comoSiFueraUtc);
  return comoSiFueraUtc - desfase(primera);
}


export function buscarMarcasParaAuditoria(filtros: FiltrosAuditoria): MarcaParaAuditoria[] {
  const zona = CONFIG.reloj.zonaHorariaPorDefecto;
  const condiciones: string[] = [];
  const valores: (string | number)[] = [];

  if (filtros.desde) {
    condiciones.push('m.hora_estimada_ms >= ?');
    valores.push(inicioDelDiaLocal(filtros.desde, zona));
  }
  if (filtros.hasta) {
    // "Hasta el 22" incluye todo el 22: se corta al inicio del 23. Se suma un
    // dia a la FECHA (no 24 h a los milisegundos), porque el dia del cambio de
    // horario dura 23 o 25 horas.
    const [ano, mes, dia] = filtros.hasta.split('-').map(Number) as [number, number, number];
    const siguiente = new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
    condiciones.push('m.hora_estimada_ms < ?');
    valores.push(inicioDelDiaLocal(siguiente, zona));
  }
  if (filtros.empleadoId) {
    condiciones.push('m.empleado_id = ?');
    valores.push(filtros.empleadoId);
  }
  if (filtros.bandera) {
    // Las banderas viven como "a,b,c": se rodea de comas para no confundir
    // "sin_camara" con una bandera que la contuviera.
    condiciones.push("(',' || m.banderas || ',') LIKE ?");
    valores.push(`%,${filtros.bandera},%`);
  }
  if (filtros.soloConFoto) {
    condiciones.push('f.marca_id IS NOT NULL AND f.eliminada_en IS NULL');
  }

  const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

  const filas = baseDeDatos()
    .prepare(
      `SELECT m.id, m.empleado_id, m.usuario, m.tipo, m.hora_estimada_ms, m.banderas,
              e.nombre, e.apellido_paterno, e.apellido_materno, e.numero_empleado,
              f.marca_id AS foto_marca, f.eliminada_en, f.conservar
         FROM marcas m
         LEFT JOIN empleados_cache e ON e.id = m.empleado_id
         LEFT JOIN fotos f ON f.marca_id = m.id
         ${donde}
        ORDER BY m.hora_estimada_ms DESC
        LIMIT ?`,
    )
    .all(...valores, CONFIG.modoAdmin.maximoRegistrosPorConsulta) as {
    id: string;
    empleado_id: string;
    usuario: string;
    tipo: TipoMarca;
    hora_estimada_ms: number;
    banderas: string;
    nombre: string | null;
    apellido_paterno: string | null;
    apellido_materno: string | null;
    numero_empleado: string | null;
    foto_marca: string | null;
    eliminada_en: string | null;
    conservar: number | null;
  }[];

  return filas.map((f) => {
    let fotoEstado: EstadoFotoLocal = 'sin_foto';
    if (f.foto_marca) {
      if (f.eliminada_en) fotoEstado = 'eliminada_por_antiguedad';
      else fotoEstado = f.conservar === 1 ? 'conservada' : 'disponible';
    }

    return {
      id: f.id,
      empleadoId: f.empleado_id,
      nombreCompleto: f.nombre
        ? [f.nombre, f.apellido_paterno, f.apellido_materno].filter(Boolean).join(' ')
        : f.usuario,
      numeroEmpleado: f.numero_empleado,
      usuario: f.usuario,
      tipo: f.tipo,
      horaEstimadaMs: f.hora_estimada_ms,
      banderas: f.banderas.split(',').filter((b) => b !== ''),
      fotoEstado,
    };
  });
}

/** Todos los empleados, incluidos los de baja: sus marcas viejas tambien se auditan. */
export function empleadosParaFiltro(): EmpleadoParaFiltro[] {
  const filas = baseDeDatos()
    .prepare(
      `SELECT id, nombre, apellido_paterno, apellido_materno, numero_empleado
         FROM empleados_cache
        ORDER BY nombre, apellido_paterno`,
    )
    .all() as {
    id: string;
    nombre: string;
    apellido_paterno: string;
    apellido_materno: string;
    numero_empleado: string | null;
  }[];

  return filas.map((f) => ({
    id: f.id,
    nombreCompleto: [f.nombre, f.apellido_paterno, f.apellido_materno].filter(Boolean).join(' '),
    numeroEmpleado: f.numero_empleado,
  }));
}
