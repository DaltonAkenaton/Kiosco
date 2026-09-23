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
  diaSiguiente,
  inicioDelDiaLocal,
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
  registrarAccesosFoto([marcaId], adminId, accion);
}

/**
 * Lo mismo, para muchas fotos a la vez (una exportacion). Todo o nada: si una
 * no se puede anotar, no se anota ninguna, y quien llama no debe exportar.
 */
export function registrarAccesosFoto(
  marcaIds: readonly string[],
  adminId: string,
  accion: AccionSobreFoto,
): void {
  const ahoraIso = new Date().toISOString();

  enTransaccion(() => {
    const bd = baseDeDatos();
    const enBitacora = bd.prepare(
      `INSERT INTO accesos_foto (id, marca_id, admin_id, accion, consultado_en)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const enBandeja = bd.prepare(
      `INSERT INTO outbox (id, tipo_registro, payload, intentos, creado_en)
       VALUES (?, 'acceso_foto', ?, 0, ?)`,
    );

    for (const marcaId of marcaIds) {
      const id = randomUUID();
      enBitacora.run(id, marcaId, adminId, accion, ahoraIso);
      enBandeja.run(id, JSON.stringify({ id, marcaId, adminId, accion, consultadoEn: ahoraIso }), ahoraIso);
    }
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

// `inicioDelDiaLocal` y `diaSiguiente` viven en compartido/fechas.ts: los usa
// tambien el panel. Se reexporta para las pruebas.
export { inicioDelDiaLocal };

/** Un renglon de auditoria con lo que ademas hace falta para exportar su foto. */
export interface MarcaParaExportar extends MarcaParaAuditoria {
  fotoHash: string | null;
  fotoRutaRelativa: string | null;
}

/** La consulta de la pantalla de auditoria: lo mas reciente primero, con tope. */
export function buscarMarcasParaAuditoria(filtros: FiltrosAuditoria): MarcaParaAuditoria[] {
  return consultarMarcas(filtros, CONFIG.modoAdmin.maximoRegistrosPorConsulta).map(
    ({ fotoHash: _hash, fotoRutaRelativa: _ruta, ...marca }) => marca,
  );
}

/**
 * Los mismos filtros, para exportar: en orden de hora (como se lee un
 * reporte) y con el tope de la exportacion, no el de la pantalla.
 */
export function buscarMarcasParaExportar(filtros: FiltrosAuditoria): MarcaParaExportar[] {
  return consultarMarcas(filtros, CONFIG.exportacion.maximoRegistros).reverse();
}

function consultarMarcas(filtros: FiltrosAuditoria, limite: number): MarcaParaExportar[] {
  const zona = CONFIG.reloj.zonaHorariaPorDefecto;
  const condiciones: string[] = [];
  const valores: (string | number)[] = [];

  if (filtros.desde) {
    condiciones.push('m.hora_estimada_ms >= ?');
    valores.push(inicioDelDiaLocal(filtros.desde, zona));
  }
  if (filtros.hasta) {
    // "Hasta el 22" incluye todo el 22: se corta al inicio del 23.
    condiciones.push('m.hora_estimada_ms < ?');
    valores.push(inicioDelDiaLocal(diaSiguiente(filtros.hasta), zona));
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
      `SELECT m.id, m.empleado_id, m.usuario, m.tipo, m.hora_estimada_ms, m.banderas, m.foto_hash,
              e.nombre, e.apellido_paterno, e.apellido_materno, e.numero_empleado,
              f.marca_id AS foto_marca, f.eliminada_en, f.conservar, f.ruta_relativa
         FROM marcas m
         LEFT JOIN empleados_cache e ON e.id = m.empleado_id
         LEFT JOIN fotos f ON f.marca_id = m.id
         ${donde}
        ORDER BY m.hora_estimada_ms DESC
        LIMIT ?`,
    )
    .all(...valores, limite) as {
    id: string;
    empleado_id: string;
    usuario: string;
    tipo: TipoMarca;
    hora_estimada_ms: number;
    banderas: string;
    foto_hash: string | null;
    nombre: string | null;
    apellido_paterno: string | null;
    apellido_materno: string | null;
    numero_empleado: string | null;
    foto_marca: string | null;
    eliminada_en: string | null;
    conservar: number | null;
    ruta_relativa: string | null;
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
      fotoHash: f.foto_hash,
      fotoRutaRelativa: f.ruta_relativa,
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
