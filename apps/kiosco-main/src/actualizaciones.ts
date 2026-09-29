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
 *  ---------------------------------------------------------------------------
 *  COMO FUNCIONA  (encendido el 28-09-2026)
 *  ---------------------------------------------------------------------------
 *    1. Cada `horasEntreRevisiones`, el kiosco pregunta a SU repositorio de
 *       versiones (uno publico por ambiente: ver ACTUALIZACIONES y AMBIENTE en
 *       configuracion.ts) si hay una version mas nueva.
 *    2. Si la hay, la descarga en silencio. El kiosco sigue funcionando igual.
 *    3. La instala:
 *         - sola, de madrugada (ventana `instalacionAutomatica`), si nadie lo
 *           ha usado en unos minutos, no hay nadie en el modo administrador y
 *           no esta en pausa; o
 *         - cuando el jefe pica "Instalar la version nueva" en el modo
 *           administrador.
 *       Instalar es: cerrar, instalar sin preguntar nada, y volver a abrir.
 *       Menos de un minuto.
 *
 *  El repositorio se fija AQUI (setFeedURL) y no en electron-builder.yml a
 *  proposito: asi sale de AMBIENTE, la misma palabra que decide la base de
 *  datos. Un kiosco de pruebas no puede bajar una version de produccion.
 *
 *  ---------------------------------------------------------------------------
 *  SI ALGO SALE MAL
 *  ---------------------------------------------------------------------------
 *  Cualquier falla (sin internet, repositorio inexistente, descarga cortada)
 *  deja al kiosco en la version que ya tenia, que es la que funcionaba. Se
 *  anota y se reintenta en la siguiente revision. Nunca detiene el registro.
 */

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { CONFIG } from '@kiosko/compartido';
import { ES_PRODUCCION } from './entorno';
import { permitirSalir } from './arranque-automatico';
import { minutosSinUso } from './servicios/actividad';
import { haySesionAdminAbierta } from './servicios/sesion-admin';
import { estaPausado } from './servicios/pausa';
import { zonaHorariaVigente } from './configuracion-vigente';

const A = CONFIG.actualizaciones;

/** Cada cuanto se mira si ya es buen momento para instalar lo descargado. */
const MS_ENTRE_INTENTOS_DE_INSTALAR = 60_000;

/** La version nueva ya descargada, esperando que alguien la instale. */
let versionDescargada: string | null = null;

/** Para el modo administrador: ¿hay algo listo para instalar? */
export function actualizacionLista(): string | null {
  return versionDescargada;
}

/** El repositorio de ESTE ambiente: "propietario/repositorio". */
export function repositorioDeVersiones(): string {
  return `${A.propietario}/${A.repositorios[CONFIG.ambiente]}`;
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
  if (!ES_PRODUCCION || !app.isPackaged) {
    console.info('[actualizaciones] en desarrollo: desactivadas');
    return false;
  }
  if (!A.activas) {
    console.info('[actualizaciones] apagadas en configuracion.ts');
    return false;
  }

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: A.propietario,
    repo: A.repositorios[CONFIG.ambiente],
  });

  /**
   * Descargar si; instalar solo en el momento que decidimos nosotros.
   *
   * `autoInstallOnAppQuit` va en `false`: con `true` se instalaria cuando
   * Windows se apaga, y el siguiente arranque tardaria de mas mientras
   * instala. Si eso cae un lunes a las 6 de la mañana, la gente se encuentra
   * un instalador corriendo en vez de un checador.
   */
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    console.info(`[actualizaciones] hay version nueva: ${info.version}; descargando`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    versionDescargada = info.version;
    console.info(`[actualizaciones] version ${info.version} descargada; se instalara en un momento tranquilo`);
  });

  autoUpdater.on('error', (fallo) => {
    // No es grave: el kiosco sigue en la version que ya tenia.
    console.warn('[actualizaciones] no se pudo revisar', fallo?.message ?? fallo);
  });

  // La primera revision NO es inmediata: al arrancar, la PC esta ocupada
  // levantando Windows, la camara y la base de datos.
  setTimeout(() => void revisarAhora(), CONFIG.sincronizacion.intervaloPullMs).unref();
  setInterval(() => void revisarAhora(), A.horasEntreRevisiones * 60 * 60 * 1000).unref();
  setInterval(() => instalarSiEsBuenMomento(), MS_ENTRE_INTENTOS_DE_INSTALAR).unref();

  console.info(`[actualizaciones] activas; versiones de ${repositorioDeVersiones()}`);
  return true;
}

/** Pregunta una vez si hay version nueva. Nunca lanza. */
async function revisarAhora(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (fallo) {
    console.warn('[actualizaciones] revision fallida', fallo);
  }
}

/**
 * ¿Es buen momento para reiniciar el kiosco e instalar?
 *
 * Se exporta la decision (sin instalar nada) para poder probarla.
 */
export function esBuenMomentoParaInstalar(ahora: Date = new Date(), sinUso: number = minutosSinUso()): boolean {
  const regla = A.instalacionAutomatica;
  if (!regla.activa) return false;

  const hora = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zonaHorariaVigente() }).format(ahora),
  );
  const dentroDeLaVentana = hora >= regla.desdeHora && hora < regla.hastaHora;

  return dentroDeLaVentana && sinUso >= regla.minutosSinUso && !haySesionAdminAbierta() && !estaPausado();
}

function instalarSiEsBuenMomento(): void {
  if (versionDescargada === null || !esBuenMomentoParaInstalar()) return;
  console.info(`[actualizaciones] instalando ${versionDescargada} (instalacion automatica)`);
  instalarActualizacionYReiniciar();
}

/**
 * Instala la actualizacion ya descargada y reinicia la aplicacion.
 *
 * La llama la instalacion automatica y el boton "Instalar la version nueva"
 * del modo administrador. Hay que AUTORIZAR la salida antes de reiniciar, o
 * el blindaje contra el cierre bloquearia la propia actualizacion ("el kiosco
 * se queda pensando y no se actualiza nunca").
 *
 * `quitAndInstall(true, true)`: instalar en silencio (sin ventanas que nadie
 * va a leer) y volver a abrir el kiosco al terminar.
 */
export function instalarActualizacionYReiniciar(): void {
  permitirSalir();
  autoUpdater.quitAndInstall(true, true);
}

/**
 * PC compartida: instala la version descargada al cerrar el kiosco, en
 * silencio y SIN volver a abrirlo (la persona lo esta cerrando a proposito).
 */
export function instalarAlCerrar(): void {
  permitirSalir();
  autoUpdater.quitAndInstall(true, false);
}

/** La version que corre ahora mismo. Para el heartbeat y el diagnostico. */
export function versionActual(): string {
  return app.getVersion();
}
