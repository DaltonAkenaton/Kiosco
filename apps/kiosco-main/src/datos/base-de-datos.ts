/**
 * ============================================================================
 *  LA BASE DE DATOS LOCAL (SQLite)
 * ============================================================================
 *
 *  Abre el archivo, lo configura y aplica las migraciones pendientes.
 *
 *  ---------------------------------------------------------------------------
 *  ¿Por que `node:sqlite` y no `better-sqlite3`?
 *  ---------------------------------------------------------------------------
 *  El ARQUITECTURA.md pedia `better-sqlite3`. Se intento y NO se pudo, por una razon
 *  concreta que vale la pena conocer:
 *
 *  `better-sqlite3` es un modulo NATIVO: parte de su codigo esta escrito en
 *  C++ y hay que compilarlo para cada version de Node. Electron trae su propia
 *  version de Node, distinta de la que tienes instalada, asi que el binario
 *  que npm descarga NO sirve:
 *
 *      Error: The module was compiled against a different Node.js version
 *      using NODE_MODULE_VERSION 137. This version requires 149.
 *
 *  La solucion normal es `@electron/rebuild`, que descarga un binario hecho
 *  para Electron. Pero para Electron 44 ese binario NO EXISTE todavia
 *  (error 404 al buscarlo), asi que habria que compilarlo desde el codigo
 *  fuente en C++... lo que exige instalar Visual Studio Build Tools en cada
 *  maquina donde se toque el proyecto.
 *
 *  Y ahi choca con la restriccion central del ARQUITECTURA.md seccion 1:
 *  "el sistema debe poder mantenerse con documentacion, sin su autor
 *  presente", en una facultad que "no tiene departamento de TI".
 *
 *  `node:sqlite` es SQLite incluido dentro de Node (y por lo tanto dentro de
 *  Electron). Cero instalacion, cero compilacion, cero binarios que no
 *  coinciden. Para 5 empleados y unas cuantas marcas al dia, la diferencia de
 *  rendimiento es irrelevante; la diferencia de mantenibilidad es enorme.
 *
 *  El costo honesto: `node:sqlite` esta marcado como experimental y su API
 *  puede cambiar entre versiones mayores de Node. Por eso TODO el acceso a la
 *  base pasa por este archivo y los repositorios: si algun dia hay que
 *  cambiar de motor, se cambia aqui y el resto del programa ni se entera.
 *
 *  Ver la decision D-013 y el error E-007 en el curso.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '@kiosko/compartido';
import { carpetaDeDatos } from '../entorno';
import { MIGRACIONES } from './migraciones';

/**
 * La conexion abierta. Es una sola para toda la aplicacion.
 *
 * `null` hasta que se llama a `abrirBaseDeDatos()`. No se abre al importar el
 * archivo porque `carpetaDeDatos()` necesita que Electron ya este listo.
 */
let db: DatabaseSync | null = null;

/**
 * Devuelve la conexion. Truena si alguien la pide antes de abrirla.
 *
 * Ese error es a proposito y es de los buenos: significa que hay un problema
 * de ORDEN en el arranque, y es mil veces mejor enterarse con un mensaje
 * claro que con un "cannot read property of null" tres archivos mas adelante.
 */
export function baseDeDatos(): DatabaseSync {
  if (!db) {
    throw new Error(
      'La base de datos no esta abierta. Llama a abrirBaseDeDatos() durante el arranque.',
    );
  }
  return db;
}

/**
 * Abre (o crea) la base de datos y la deja lista para usarse.
 *
 * Devuelve la ruta del archivo, util para el log y para el manual tecnico:
 * quien de soporte necesita saber donde esta el archivo para respaldarlo.
 */
export function abrirBaseDeDatos(): string {
  const carpeta = carpetaDeDatos();

  // `recursive: true` crea las carpetas intermedias que falten y NO se queja
  // si ya existen. Evita el clasico "si no existe, crea" escrito a mano.
  fs.mkdirSync(carpeta, { recursive: true });

  const ruta = path.join(carpeta, CONFIG.almacenamiento.archivoBaseDeDatos);
  db = new DatabaseSync(ruta);

  configurarPragmas(db);
  aplicarMigraciones(db);

  console.info(`[bd] abierta en ${ruta}`);
  return ruta;
}

/** Cierra la base. Se llama al salir de la aplicacion. */
export function cerrarBaseDeDatos(): void {
  if (!db) return;
  db.close();
  db = null;
  console.info('[bd] cerrada');
}

/**
 * ----------------------------------------------------------------------------
 *  PRAGMAs: los ajustes de SQLite
 * ----------------------------------------------------------------------------
 *  Un PRAGMA es una instruccion de configuracion del motor. Estos tres son
 *  los que importan para un kiosco.
 */
function configurarPragmas(conexion: DatabaseSync): void {
  /**
   * WAL (Write-Ahead Logging).
   *
   * Por defecto, SQLite bloquea el archivo entero mientras escribe: nadie
   * puede leer. Con WAL, las escrituras van a un archivo aparte y las
   * lecturas siguen funcionando al mismo tiempo.
   *
   * Para nosotros importa por algo muy concreto: si se va la luz a media
   * escritura, WAL recupera la base al siguiente arranque en vez de dejarla
   * corrupta. Y en esta facultad la luz se va (ARQUITECTURA.md 11).
   */
  conexion.exec('PRAGMA journal_mode = WAL');

  /**
   * `synchronous = NORMAL` con WAL es el equilibrio recomendado: aguanta un
   * corte de luz sin corromper la base, y no obliga a esperar al disco en
   * cada escritura (que es lo que hace FULL, y se siente en el tiempo de
   * respuesta del kiosco).
   */
  conexion.exec('PRAGMA synchronous = NORMAL');

  /**
   * Llaves foraneas activadas. SQLite las trae APAGADAS por defecto, por
   * compatibilidad con versiones antiguas. Es una de esas trampas que casi
   * nadie conoce: escribes las reglas y no se aplican.
   */
  conexion.exec('PRAGMA foreign_keys = ON');
}

/**
 * ----------------------------------------------------------------------------
 *  Aplicar migraciones
 * ----------------------------------------------------------------------------
 *  `user_version` es un numero que SQLite guarda DENTRO del propio archivo,
 *  gratis, sin necesidad de crear una tabla para llevar la cuenta.
 *  Lo usamos para saber hasta que migracion va esta base.
 */
function aplicarMigraciones(conexion: DatabaseSync): void {
  const fila = conexion.prepare('PRAGMA user_version').get() as { user_version: number };
  const versionActual = fila.user_version;

  const pendientes = MIGRACIONES.filter((m) => m.version > versionActual);

  if (pendientes.length === 0) {
    console.info(`[bd] sin migraciones pendientes (version ${versionActual})`);
    return;
  }

  for (const migracion of pendientes) {
    /**
     * Cada migracion va dentro de una TRANSACCION.
     *
     * Una transaccion es "todo o nada": si el SQL falla a la mitad, se
     * deshace lo que ya se habia hecho y la base queda como estaba.
     *
     * Sin esto, una migracion que crea cinco tablas y falla en la tercera
     * dejaria la base a medio migrar, con `user_version` sin actualizar, y
     * el siguiente arranque intentaria crear otra vez las dos primeras
     * tablas: "table already exists" y el kiosco no abre nunca mas.
     */
    conexion.exec('BEGIN');
    try {
      conexion.exec(migracion.sql);

      // `user_version` no acepta parametros (`?`), asi que el numero se
      // interpola. Es seguro porque viene de nuestro propio arreglo de
      // migraciones, no de ninguna entrada externa.
      conexion.exec(`PRAGMA user_version = ${migracion.version}`);

      conexion.exec('COMMIT');
      console.info(`[bd] migracion ${migracion.version} aplicada: ${migracion.descripcion}`);
    } catch (fallo) {
      conexion.exec('ROLLBACK');
      // Aqui SI relanzamos el error. Una base a medio migrar no es algo con
      // lo que se pueda seguir trabajando: es mejor que la app no abra y se
      // vea el problema, a que opere con una estructura incompleta.
      throw new Error(
        `Fallo la migracion ${migracion.version} (${migracion.descripcion}): ${String(fallo)}`,
      );
    }
  }
}

/**
 * ----------------------------------------------------------------------------
 *  Ayuda para transacciones
 * ----------------------------------------------------------------------------
 *  Envuelve varias operaciones en un "todo o nada".
 *
 *  Se usa, por ejemplo, al guardar una marca: hay que escribir en `marcas`,
 *  en `outbox` y en `ultimas_marcas_cache`. Si fallara la segunda, quedaria
 *  una marca que nunca se va a subir. Con la transaccion, o se escriben las
 *  tres o no se escribe ninguna.
 */
export function enTransaccion<T>(operacion: () => T): T {
  const conexion = baseDeDatos();
  conexion.exec('BEGIN');
  try {
    const resultado = operacion();
    conexion.exec('COMMIT');
    return resultado;
  } catch (fallo) {
    conexion.exec('ROLLBACK');
    throw fallo;
  }
}
