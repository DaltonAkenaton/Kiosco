/**
 * ============================================================================
 *  ACTUALIZACIONES AUTOMATICAS
 * ============================================================================
 *
 *  CLAUDE.md 13: "Actualizaciones automaticas con electron-updater."
 *
 *  ¿POR QUE ESTO IMPORTA TANTO EN ESTE PROYECTO?
 *  --------------------------------------------
 *  Por la frase de la seccion 1 del CLAUDE.md: "la facultad no tiene
 *  departamento de TI". Si actualizar el kiosco exigiera que alguien vaya con
 *  una memoria USB a cada PC, en la practica NUNCA se va a actualizar. Y hay
 *  varios kioscos.
 *
 *  Con electron-updater, publicar una version nueva es suficiente: cada
 *  kiosco la descarga solo y la instala al reiniciarse.
 *
 *  ---------------------------------------------------------------------------
 *  ESTADO ACTUAL: PREPARADO, NO ENCENDIDO
 *  ---------------------------------------------------------------------------
 *  Todavia NO hay servidor de actualizaciones. Hace falta decidir donde se
 *  publican (lo natural es GitHub Releases, con la cuenta del sistema de la
 *  que habla el CLAUDE.md 1.1), y esa decision es del bloque 10.
 *
 *  Asi que este archivo esta escrito completo, y se queda quieto mientras no
 *  haya a donde preguntar. Esa es justamente la parte que vale la pena mirar:
 *
 *      NO se llama a `checkForUpdates()` "por si acaso".
 *
 *  Si se llamara sin configuracion de publicacion, electron-updater lanzaria
 *  un error en cada arranque del kiosco. Nadie lo veria —no hay quien mire
 *  los logs— pero estaria ahi, ensuciando el diagnostico del dia que si haya
 *  un problema de verdad. Un error que se repite y que todos aprenden a
 *  ignorar es peor que no tener el aviso.
 *
 *  ---------------------------------------------------------------------------
 *  COMO SE ENCIENDE, EL DIA QUE TOQUE
 *  ---------------------------------------------------------------------------
 *    1. En `electron-builder.yml`, descomentar la seccion `publish`.
 *    2. Generar la version con `npm run empaquetar` y subir el resultado
 *       (incluido `latest.yml`) a esa ubicacion.
 *    3. Listo: este archivo se activa solo, porque detecta la configuracion.
 */

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { CONFIG } from '@kiosko/compartido';
import { ES_PRODUCCION } from './entorno';
import { permitirSalir } from './arranque-automatico';

/**
 * Cada cuanto se pregunta si hay version nueva.
 *
 * Esta aqui y no en `configuracion.ts` porque no es una regla de negocio que
 * el jefe vaya a querer ajustar: es un detalle de mantenimiento. Seis horas
 * es un equilibrio razonable entre enterarse pronto de una correccion
 * importante y no estar molestando al servidor sin motivo.
 */
const INTERVALO_REVISION_MS = 6 * 60 * 60 * 1000;

/** La version nueva ya descargada, esperando que alguien la instale. */
let versionDescargada: string | null = null;

/** Para el modo administrador: ¿hay algo listo para instalar? */
export function actualizacionLista(): string | null {
  return versionDescargada;
}

/**
 * Arranca la revision de actualizaciones, si tiene sentido hacerlo.
 *
 * Devuelve `true` si quedo activa, `false` si se quedo quieta (y por que).
 * Devolver algo, en vez de no decir nada, permite que el arranque deje
 * constancia de en que estado quedo esto — que es lo primero que uno quiere
 * saber cuando un kiosco "no se actualiza".
 */
export function iniciarActualizaciones(): boolean {
  // En desarrollo no: la app corre desde el codigo fuente, no hay nada que
  // actualizar, y electron-updater se queja con razon.
  if (!ES_PRODUCCION) {
    console.info('[actualizaciones] en desarrollo: desactivadas');
    return false;
  }

  if (!hayServidorConfigurado()) {
    console.info(
      '[actualizaciones] sin servidor configurado: desactivadas. ' +
        'Ver la seccion `publish` de electron-builder.yml.',
    );
    return false;
  }

  /**
   * Descargar si, instalar NO.
   *
   * `autoInstallOnAppQuit` se deja en `false` a proposito, y es la decision
   * mas importante de este archivo.
   *
   * Con `true`, el kiosco se actualizaria al cerrarse... que en produccion es
   * cuando Windows se apaga, y el siguiente arranque tardaria de mas mientras
   * instala. Si eso cae un lunes a las 6 de la manana, la gente se encuentra
   * un instalador corriendo en vez de un checador.
   *
   * Con `false`, la version nueva se descarga en silencio y se queda
   * esperando. Instalarla es una decision explicita: la toma quien de
   * mantenimiento, cuando no hay nadie checando.
   */
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    console.info(`[actualizaciones] hay version nueva: ${info.version}`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    versionDescargada = info.version;
    console.info(
      `[actualizaciones] version ${info.version} descargada y lista. ` +
        'Se instalara cuando se pida expresamente.',
    );
  });

  autoUpdater.on('error', (fallo) => {
    // Un fallo aqui NO es grave: significa que el kiosco se quedo en la
    // version que ya tenia, que es exactamente la que funcionaba hace un
    // minuto. Se deja constancia y la vida sigue.
    console.warn('[actualizaciones] no se pudo revisar', fallo?.message ?? fallo);
  });

  // La primera revision NO es inmediata: al arrancar, la PC esta ocupada
  // levantando Windows, la camara y la base de datos. Descargar 100 MB en ese
  // momento solo lograria que el kiosco tarde mas en estar listo.
  setTimeout(() => void revisarAhora(), CONFIG.sincronizacion.intervaloPullMs);
  setInterval(() => void revisarAhora(), INTERVALO_REVISION_MS);

  console.info('[actualizaciones] activas');
  return true;
}

/** Pregunta una vez si hay version nueva. Nunca lanza. */
async function revisarAhora(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (fallo) {
    // Ya hay un manejador de 'error' arriba; esto atrapa lo que se escape del
    // propio `await`. La regla de oro manda: el kiosco no se cae por esto.
    console.warn('[actualizaciones] revision fallida', fallo);
  }
}

/**
 * Instala la actualizacion ya descargada y reinicia la aplicacion.
 *
 * La llama el boton "Instalar version nueva" del modo administrador del
 * kiosco (solo rol admin). El cabo suelto que resuelve: hay que AUTORIZAR la salida antes de
 * reiniciar, o el blindaje contra el cierre bloquearia la propia
 * actualizacion, y el sintoma seria "el kiosco se queda pensando y no se
 * actualiza nunca".
 */
export function instalarActualizacionYReiniciar(): void {
  permitirSalir();
  autoUpdater.quitAndInstall();
}

/**
 * ¿Sabe electron-updater a donde preguntar?
 *
 * La configuracion de publicacion queda escrita dentro del paquete, en
 * `app-update.yml`, cuando electron-builder encuentra una seccion `publish`.
 * Si ese archivo no existe, `updateConfigPath` no lleva a ningun lado y
 * cualquier revision terminaria en error.
 *
 * Se comprueba leyendo el propio objeto en vez de buscando el archivo a mano:
 * asi, si electron-updater cambia donde lo guarda, esto sigue siendo cierto.
 */
function hayServidorConfigurado(): boolean {
  try {
    // `isUpdaterActive()` devuelve false cuando la app no esta empaquetada o
    // cuando no encuentra configuracion de publicacion.
    return autoUpdater.isUpdaterActive();
  } catch {
    return false;
  }
}

/** La version que corre ahora mismo. Para el heartbeat y el diagnostico. */
export function versionActual(): string {
  return app.getVersion();
}
