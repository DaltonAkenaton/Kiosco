/**
 * ============================================================================
 *  REPOSITORIO DE MARCAS
 * ============================================================================
 *
 *  Guardar un registro de entrada o salida. Es el corazon del kiosco: si esto
 *  falla, el sistema no sirve para nada.
 *
 *  ---------------------------------------------------------------------------
 *  Las tres escrituras que van JUNTAS
 *  ---------------------------------------------------------------------------
 *  Guardar una marca no es escribir en una tabla, son tres:
 *
 *    1. `marcas`                -> el registro en si
 *    2. `outbox`                -> la lista de pendientes por enviar a la nube
 *    3. `ultimas_marcas_cache`  -> para sugerir la proxima accion
 *
 *  Y las tres tienen que ocurrir O NINGUNA. Si fallara la segunda, quedaria
 *  una marca guardada que nunca se va a subir: el empleado creeria que checo
 *  y el jefe nunca lo veria.
 *
 *  Por eso van dentro de una TRANSACCION: un "todo o nada" de la base de
 *  datos. Si algo falla a la mitad, se deshace lo anterior y la base queda
 *  como estaba.
 */

import { randomUUID } from 'node:crypto';
import type { BanderaMarca, LecturasDeReloj, TipoMarca } from '@kiosko/compartido';
import type { FotoGuardada } from '../servicios/fotos';
import { baseDeDatos, enTransaccion } from './base-de-datos';

export interface DatosDeMarca {
  /**
   * El identificador de la marca, generado con `nuevoIdDeMarca()`.
   *
   * Se recibe en vez de generarse aqui porque quien llama lo necesita ANTES:
   * la foto se guarda en disco con este mismo id como nombre de archivo, y si
   * cada uno generara el suyo, la foto y su marca no coincidirian.
   */
  id: string;
  empleadoId: string;
  usuario: string;
  tipo: TipoMarca;
  reloj: LecturasDeReloj;
  banderas: BanderaMarca[];
  /** La foto ya cifrada en disco (ruta, hash, llave), o `null` si no hubo. */
  foto: FotoGuardada | null;
}

/**
 * Genera un identificador nuevo para una marca.
 *
 * Esta aparte de `guardarMarca` porque el id hace falta ANTES de guardar:
 * la foto se escribe en disco con ese nombre.
 */
export function nuevoIdDeMarca(): string {
  return randomUUID();
}

/**
 * Guarda la marca. Devuelve su identificador.
 *
 * ¿Por que el identificador se genera AQUI y no en el servidor?
 *
 * Porque el kiosco tiene que poder registrar sin internet. Si el id lo diera
 * el servidor, no habria forma de guardar nada estando desconectado.
 *
 * Y tiene un segundo beneficio, mas importante: hace que subir la marca sea
 * **idempotente** (palabra fea que significa "repetirlo no cambia el
 * resultado"). Si la red se corta justo despues de subirla pero antes de
 * recibir la confirmacion, el kiosco reintentara. El servidor vera que ya
 * tiene ese id y no la duplicara. Sin un id generado aqui, cada reintento
 * crearia una marca nueva y el empleado aparecería checando cinco veces.
 */
export function guardarMarca(datos: DatosDeMarca): string {
  const { id } = datos;
  const ahoraIso = new Date().toISOString();

  // Las banderas se guardan como texto separado por comas porque SQLite no
  // tiene listas. En PostgreSQL sera un `text[]` de verdad.
  const banderasTexto = datos.banderas.join(',');

  enTransaccion(() => {
    const bd = baseDeDatos();

    // --- 1. La marca -----------------------------------------------------
    bd.prepare(
      `INSERT INTO marcas (
         id, empleado_id, usuario, tipo, origen,
         hora_dispositivo_ms, monotonico_ms, arranque_id,
         desfase_servidor_ms, hora_estimada_ms,
         banderas, foto_hash, foto_subida, creado_en
       ) VALUES (?, ?, ?, ?, 'kiosco', ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      id,
      datos.empleadoId,
      datos.usuario,
      datos.tipo,
      datos.reloj.horaDispositivoMs,
      // El cronometro viene con decimales; la columna es de enteros.
      Math.round(datos.reloj.monotonicoMs),
      datos.reloj.arranqueId,
      datos.reloj.desfaseServidorMs,
      datos.reloj.horaEstimadaMs,
      banderasTexto,
      datos.foto?.hash ?? null,
      ahoraIso,
    );

    // --- 1.b La foto: donde quedo y su ciclo de vida -----------------------
    // Dentro de la misma transaccion: una foto en disco sin su fila aqui
    // nunca se borraria a los 30 dias, porque nadie sabria que existe.
    if (datos.foto) {
      bd.prepare(
        `INSERT INTO fotos (marca_id, ruta_relativa, llave_id, creado_en)
         VALUES (?, ?, ?, ?)`,
      ).run(id, datos.foto.rutaRelativa, datos.foto.llaveId, ahoraIso);
    }

    // --- 2. La bandeja de salida ----------------------------------------
    // Se guarda una copia completa en JSON, no una referencia a la tabla
    // `marcas`. Asi el sincronizador manda exactamente lo que se guardo,
    // aunque la estructura de la tabla cambie en una version futura.
    const paquete = JSON.stringify({
      id,
      empleadoId: datos.empleadoId,
      usuario: datos.usuario,
      tipo: datos.tipo,
      origen: 'kiosco',
      reloj: datos.reloj,
      banderas: datos.banderas,
      // La huella, nunca la foto ni su ruta (CLAUDE.md 5.1).
      fotoHash: datos.foto?.hash ?? null,
    });

    bd.prepare(
      `INSERT INTO outbox (id, tipo_registro, payload, intentos, creado_en)
       VALUES (?, 'marca', ?, 0, ?)`,
    ).run(id, paquete, ahoraIso);

    // --- 3. La ultima marca conocida ------------------------------------
    // Sirve para sugerir la proxima accion. `ON CONFLICT ... DO UPDATE` la
    // reemplaza si ya habia una.
    bd.prepare(
      `INSERT INTO ultimas_marcas_cache (empleado_id, tipo, hora_estimada_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (empleado_id) DO UPDATE SET
         tipo             = excluded.tipo,
         hora_estimada_ms = excluded.hora_estimada_ms`,
    ).run(datos.empleadoId, datos.tipo, datos.reloj.horaEstimadaMs);
  });

  // El log lleva el tipo y las banderas, NUNCA el nombre del empleado ni la
  // foto. Sirve para diagnosticar sin exponer a nadie.
  console.info(
    `[marcas] ${datos.tipo} registrada${banderasTexto ? ` [${banderasTexto}]` : ''}`,
  );

  return id;
}

/**
 * Cuantas marcas faltan por subir a la nube.
 *
 * Es el numero que aparece en la barra de estado del kiosco. Que sea visible
 * importa: si empieza a crecer, quien pase por ahi nota que algo lleva rato
 * sin sincronizar, mucho antes de que sea un problema.
 */
export function contarPendientes(): number {
  const fila = baseDeDatos()
    .prepare('SELECT COUNT(*) AS total FROM outbox WHERE sincronizado_en IS NULL')
    .get() as { total: number };
  return fila.total;
}

/**
 * La hora de la ultima marca guardada, en milisegundos.
 *
 * La usa el detector de reloj: si una marca nueva dice ser ANTERIOR a esta,
 * alguien movio la hora hacia atras.
 */
export function horaDeLaUltimaMarca(): number | null {
  const fila = baseDeDatos()
    .prepare('SELECT MAX(hora_estimada_ms) AS ultima FROM marcas')
    .get() as { ultima: number | null };
  return fila.ultima;
}

/**
 * Las marcas pendientes de subir, listas para el sincronizador.
 *
 * Todavia no hay nube (bloque 4 del plan), pero la funcion ya existe porque
 * las pruebas la usan para comprobar que la bandeja de salida se llena bien.
 */
export function marcasPendientes(limite: number): { id: string; payload: string }[] {
  return baseDeDatos()
    .prepare(
      `SELECT id, payload FROM outbox
       WHERE sincronizado_en IS NULL AND tipo_registro = 'marca'
       ORDER BY creado_en
       LIMIT ?`,
    )
    .all(limite) as unknown as { id: string; payload: string }[];
}

/** Cuenta cuantas marcas hay en total. Solo para pruebas y diagnostico. */
export function contarMarcas(): number {
  const fila = baseDeDatos().prepare('SELECT COUNT(*) AS total FROM marcas').get() as {
    total: number;
  };
  return fila.total;
}

/**
 * ============================================================================
 *  LAS ULTIMAS MARCAS, PARA VERLAS EN PANTALLA
 * ============================================================================
 *
 *  Alimenta la pantalla de registros del kiosco.
 *
 *  Es la PRIMERA VERSION de la pantalla de auditoria del modo administrador
 *  (CLAUDE.md 5.2, bloque 3.b). Hoy sirve para enseñar que los datos de verdad
 *  se guardan; manana sera la pantalla donde el revisor compara cada registro
 *  con su foto.
 *
 *  Fijate en lo que NO devuelve: ni el hash del PIN, ni la ruta de la foto.
 *  La pantalla no necesita ninguna de las dos para pintar una tabla, asi que no
 *  las recibe (minimo privilegio, CLAUDE.md 3.1). Solo se le dice SI hay foto.
 */
export interface MarcaEnPantalla {
  id: string;
  /** Nombre abreviado, como en la lista: "Dalton G." */
  nombre: string;
  tipo: TipoMarca;
  /** Milisegundos UTC. La pantalla lo formatea con la zona configurada. */
  horaEstimadaMs: number;
  banderas: string[];
  tieneFoto: boolean;
  /** `true` si ya viajo a la nube. Hoy siempre falso: no hay nube todavia. */
  sincronizada: boolean;
}

export function listarMarcasRecientes(limite: number): MarcaEnPantalla[] {
  /*
    El JOIN es con `empleados_cache` y no con la marca, porque la marca guarda
    el `usuario` ("dgomez") y no el nombre. Guardar el nombre dentro de la marca
    habria sido mas comodo aqui y un error en todo lo demas: el dia que alguien
    corrija un apellido mal escrito, las marcas viejas seguirian mostrando el
    apellido viejo para siempre.

    Un dato se guarda UNA vez, en su lugar, y se consulta desde donde haga falta.

    `LEFT JOIN` y no `JOIN`: si un empleado se diera de baja y desapareciera de
    la copia local, su marca debe seguir viendose. Perder de vista un registro de
    asistencia porque la persona ya no trabaja aqui seria justo lo contrario de
    lo que hace un archivo.
  */
  const filas = baseDeDatos()
    .prepare(
      `SELECT m.id,
              m.tipo,
              m.hora_estimada_ms,
              m.banderas,
              f.marca_id IS NOT NULL AND f.eliminada_en IS NULL AS foto_en_disco,
              m.foto_subida,
              m.usuario,
              e.nombre,
              e.apellido_paterno
         FROM marcas m
         LEFT JOIN empleados_cache e ON e.id = m.empleado_id
         LEFT JOIN fotos f ON f.marca_id = m.id
        ORDER BY m.hora_estimada_ms DESC
        LIMIT ?`,
    )
    .all(limite) as {
    id: string;
    tipo: TipoMarca;
    hora_estimada_ms: number;
    banderas: string;
    foto_en_disco: number;
    foto_subida: number;
    usuario: string;
    nombre: string | null;
    apellido_paterno: string | null;
  }[];

  return filas.map((fila) => ({
    id: fila.id,
    // Si el empleado ya no esta en la copia local, se muestra su usuario. Es
    // menos bonito y es informacion honesta: mejor "dgomez" que un hueco.
    nombre: fila.nombre
      ? `${fila.nombre.split(' ')[0]} ${(fila.apellido_paterno ?? '')[0] ?? ''}.`
      : fila.usuario,
    tipo: fila.tipo,
    horaEstimadaMs: fila.hora_estimada_ms,
    // En SQLite las banderas viven como texto separado por comas (no hay
    // arreglos). El `filter` quita la cadena vacia que deja un split de "".
    banderas: fila.banderas.split(',').filter((b) => b !== ''),
    tieneFoto: fila.foto_en_disco === 1,
    sincronizada: fila.foto_subida === 1,
  }));
}
