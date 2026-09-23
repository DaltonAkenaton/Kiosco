/**
 * ============================================================================
 *  REPOSITORIO DE EMPLEADOS
 * ============================================================================
 *
 *  ¿Que es un "repositorio"?
 *  -------------------------
 *  El unico archivo que sabe escribir SQL para una tabla. El resto del
 *  programa le pide cosas en lenguaje de negocio:
 *
 *      buscarPorUsuario('dgomez')       en vez de   SELECT * FROM ...
 *
 *  ¿Por que molestarse?
 *
 *    1. El SQL vive en un solo lugar. Si manana cambia la estructura de la
 *       tabla, se arregla aqui y nada mas.
 *    2. El resto del programa no sabe que hay SQLite detras. El dia que
 *       cambie el motor de base de datos (y ya cambiamos uno, ver D-013),
 *       solo se reescribe este archivo.
 *    3. Se puede probar sin base de datos, sustituyendolo por uno falso.
 */

import type { EmpleadoEnCache } from '@kiosko/compartido';
import { baseDeDatos } from './base-de-datos';

/**
 * Como viene una fila de SQLite.
 *
 * SQLite NO tiene tipo booleano: guarda 0 y 1. Por eso `activo` y
 * `pin_temporal` llegan como numeros y hay que convertirlos.
 *
 * Tampoco tiene camelCase por costumbre: las columnas van en snake_case
 * (`apellido_paterno`), que es la convencion en SQL. La conversion a
 * camelCase se hace aqui, en la frontera, para que el resto del programa
 * trabaje con nombres de TypeScript.
 */
interface FilaEmpleado {
  id: string;
  usuario: string;
  numero_empleado: string | null;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
  pin_hash: string;
  pin_temporal: number;
  activo: number;
  actualizado_en: string;
}

/** Traduce una fila de la base al tipo que usa el resto del programa. */
function aEmpleado(fila: FilaEmpleado): EmpleadoEnCache {
  return {
    id: fila.id,
    usuario: fila.usuario,
    numeroEmpleado: fila.numero_empleado,
    nombre: fila.nombre,
    apellidoPaterno: fila.apellido_paterno,
    apellidoMaterno: fila.apellido_materno,
    pinHash: fila.pin_hash,
    // `=== 1` convierte el numero de SQLite en un booleano de verdad.
    pinTemporal: fila.pin_temporal === 1,
    activo: fila.activo === 1,
    actualizadoEn: fila.actualizado_en,
  };
}

/**
 * Busca un empleado por su nombre de usuario ("dgomez").
 *
 * Devuelve `null` si no existe. NO lanza excepcion: "no existe" es un
 * resultado normal del negocio (alguien se equivoco al teclear), no un error
 * del programa.
 *
 * Fijate en el `?`: es un PARAMETRO. Nunca se pega el texto del usuario
 * dentro del SQL con `+`. Eso es lo que evita la inyeccion de SQL: si
 * alguien tecleara `'; DROP TABLE marcas; --`, SQLite lo tratara como un
 * nombre de usuario rarisimo que no existe, no como instrucciones.
 */
export function buscarPorUsuario(usuario: string): EmpleadoEnCache | null {
  const fila = baseDeDatos()
    .prepare('SELECT * FROM empleados_cache WHERE usuario = ?')
    .get(usuario) as FilaEmpleado | undefined;

  return fila ? aEmpleado(fila) : null;
}

/** Busca por el id interno (UUID). Se usa en el modo 'lista'. */
export function buscarPorId(id: string): EmpleadoEnCache | null {
  const fila = baseDeDatos()
    .prepare('SELECT * FROM empleados_cache WHERE id = ?')
    .get(id) as FilaEmpleado | undefined;

  return fila ? aEmpleado(fila) : null;
}

/** Busca por numero de gafete. Se usa en el modo 'numero'. */
export function buscarPorNumeroEmpleado(numero: string): EmpleadoEnCache | null {
  const fila = baseDeDatos()
    .prepare('SELECT * FROM empleados_cache WHERE numero_empleado = ?')
    .get(numero) as FilaEmpleado | undefined;

  return fila ? aEmpleado(fila) : null;
}

/**
 * Los empleados activos, ordenados por nombre, para el modo 'lista'.
 *
 * El doble `as unknown as` no es descuido: `node:sqlite` declara que `.all()`
 * devuelve objetos genericos (no sabe que columnas trae tu consulta), asi que
 * TypeScript se niega a convertirlo directo a nuestro tipo. Pasar por
 * `unknown` es la forma explicita de decir "yo se que forma tiene esto".
 *
 * Es una afirmacion nuestra, no una comprobacion: si cambiara la tabla y se
 * nos olvidara ajustar `FilaEmpleado`, TypeScript no nos avisaria. Por eso
 * TODAS estas conversiones estan encerradas en este archivo y en ningun otro:
 * un solo lugar que revisar cuando cambie la estructura.
 */
export function listarActivos(): EmpleadoEnCache[] {
  const filas = baseDeDatos()
    .prepare('SELECT * FROM empleados_cache WHERE activo = 1 ORDER BY nombre, apellido_paterno')
    .all() as unknown as FilaEmpleado[];

  return filas.map(aEmpleado);
}

/** Cuantos empleados hay cargados. Sirve para saber si la base esta vacia. */
export function contarEmpleados(): number {
  const fila = baseDeDatos().prepare('SELECT COUNT(*) AS total FROM empleados_cache').get() as {
    total: number;
  };
  return fila.total;
}

/**
 * Inserta o actualiza un empleado.
 *
 * `ON CONFLICT (id) DO UPDATE` es un "upsert": si el id ya existe, actualiza
 * en vez de fallar. Es justo lo que necesita la sincronizacion, que baja el
 * catalogo completo y no sabe cuales ya tenia.
 *
 * `excluded` es una palabra especial de SQLite: se refiere a la fila que se
 * intento insertar. Asi se dice "usa el valor nuevo, no el que ya estaba".
 */
export function guardarEmpleado(empleado: EmpleadoEnCache): void {
  baseDeDatos()
    .prepare(
      `INSERT INTO empleados_cache
         (id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno,
          pin_hash, pin_temporal, activo, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         usuario          = excluded.usuario,
         numero_empleado  = excluded.numero_empleado,
         nombre           = excluded.nombre,
         apellido_paterno = excluded.apellido_paterno,
         apellido_materno = excluded.apellido_materno,
         pin_hash         = excluded.pin_hash,
         pin_temporal     = excluded.pin_temporal,
         activo           = excluded.activo,
         actualizado_en   = excluded.actualizado_en`,
    )
    .run(
      empleado.id,
      empleado.usuario,
      empleado.numeroEmpleado,
      empleado.nombre,
      empleado.apellidoPaterno,
      empleado.apellidoMaterno,
      empleado.pinHash,
      // De vuelta a numeros: SQLite no acepta booleanos de JavaScript.
      empleado.pinTemporal ? 1 : 0,
      empleado.activo ? 1 : 0,
      empleado.actualizadoEn,
    );
}

// ----------------------------------------------------------------------------
//  Ultima marca conocida (para sugerir entrada o salida)
// ----------------------------------------------------------------------------

/**
 * Devuelve el tipo de la ultima marca del empleado, o `null` si no tiene.
 *
 * Con esto el kiosco SUGIERE la accion: si la ultima fue entrada, lo
 * siguiente probablemente es salida. Es solo una sugerencia — el empleado
 * siempre puede cambiarla con un boton (CLAUDE.md 4.4).
 */
export function ultimaMarcaDe(
  empleadoId: string,
): { tipo: 'entrada' | 'salida'; horaEstimadaMs: number } | null {
  const fila = baseDeDatos()
    .prepare('SELECT tipo, hora_estimada_ms FROM ultimas_marcas_cache WHERE empleado_id = ?')
    .get(empleadoId) as { tipo: 'entrada' | 'salida'; hora_estimada_ms: number } | undefined;

  return fila ? { tipo: fila.tipo, horaEstimadaMs: fila.hora_estimada_ms } : null;
}

/**
 * Los empleados activos CON su ultima marca, en una sola consulta.
 *
 * ¿Por que en una sola consulta y no pidiendo la ultima marca de cada uno?
 *
 * Con 5 empleados daria exactamente igual. Pero pedir dentro de un bucle
 * ("una consulta por cada fila") es un error clasico que se llama "problema
 * N+1": con 5 filas son 6 consultas y no se nota; con 500 son 501 y el
 * sistema se arrastra. Se hace bien desde el principio porque no cuesta mas.
 *
 * `LEFT JOIN` significa "trae los empleados AUNQUE no tengan marca". Con un
 * JOIN normal, quien nunca ha checado desapareceria de la lista — que es
 * justo la persona que mas necesita verla.
 */
export function listarActivosConUltimaMarca(): (EmpleadoEnCache & {
  ultimoTipo: 'entrada' | 'salida' | null;
  ultimaHoraMs: number | null;
})[] {
  const filas = baseDeDatos()
    .prepare(
      `SELECT e.*, u.tipo AS ultimo_tipo, u.hora_estimada_ms AS ultima_hora_ms
         FROM empleados_cache e
         LEFT JOIN ultimas_marcas_cache u ON u.empleado_id = e.id
        WHERE e.activo = 1
        ORDER BY e.nombre, e.apellido_paterno`,
    )
    .all() as unknown as (FilaEmpleado & {
    ultimo_tipo: 'entrada' | 'salida' | null;
    ultima_hora_ms: number | null;
  })[];

  return filas.map((fila) => ({
    ...aEmpleado(fila),
    ultimoTipo: fila.ultimo_tipo,
    ultimaHoraMs: fila.ultima_hora_ms,
  }));
}

/**
 * ¿Que accion sugerir?
 *
 * Sin marcas previas -> entrada (lo logico al empezar el dia).
 * Ultima fue entrada -> salida.
 * Ultima fue salida  -> entrada.
 */
export function accionSugeridaPara(empleadoId: string): 'entrada' | 'salida' {
  const ultima = ultimaMarcaDe(empleadoId);
  if (!ultima) return 'entrada';
  return ultima.tipo === 'entrada' ? 'salida' : 'entrada';
}
