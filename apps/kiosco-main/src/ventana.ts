/**
 * ============================================================================
 *  LA VENTANA DEL KIOSCO
 * ============================================================================
 *
 *  Aqui se crea la unica ventana de la aplicacion y se le ponen las tres
 *  banderas de seguridad que el ARQUITECTURA.md marca como obligatorias.
 *
 *  Estas tres son LAS MAS IMPORTANTES de todo el proyecto en materia de
 *  seguridad de Electron. Si alguna vez dudas, no las toques.
 */

import { BrowserWindow } from 'electron';
import path from 'node:path';
import { CONFIG } from '@kiosko/compartido';
import {
  ES_DESARROLLO,
  MODO_PRUEBA,
  RUTA_INTERFAZ_COMPILADA,
  URL_DESARROLLO,
} from './entorno';
import { blindarVentana } from './seguridad';

/**
 * ¿Esta ventana debe ir en modo kiosco (pantalla completa, sin salir)?
 *
 * Es una funcion exportada y no un calculo suelto porque hay DOS lugares que
 * necesitan la respuesta: al crear la ventana, y al reanudar despues de una
 * pausa (`servicios/pausa.ts`), que tiene que devolverla al estado en que
 * estaba. Si la regla estuviera escrita en los dos sitios, tarde o temprano
 * uno cambiaria y el otro no — y el sintoma seria un kiosco que despues de
 * una pausa se queda en ventana, para siempre.
 */
export function debeIrEnModoKiosco(): boolean {
  return CONFIG.ventana.pantallaCompletaEnProduccion && !ES_DESARROLLO && !MODO_PRUEBA;
}

export function crearVentanaPrincipal(): BrowserWindow {
  const pantallaCompleta = debeIrEnModoKiosco();

  /**
   * El titulo avisa cuando esto NO es el kiosco de verdad.
   *
   * En modo prueba la ventana tiene barra de titulo (no esta en pantalla
   * completa), asi que el aviso se ve. Es barato y evita la confusion mas
   * tonta posible: mirar una ventana de prueba y creer que es la instalada.
   */
  const ventana = new BrowserWindow({
    title: MODO_PRUEBA ? `${CONFIG.ventana.titulo} — MODO PRUEBA` : CONFIG.ventana.titulo,
    width: CONFIG.ventana.anchoDesarrollo,
    height: CONFIG.ventana.altoDesarrollo,
    minWidth: CONFIG.ventana.anchoMinimo,
    minHeight: CONFIG.ventana.altoMinimo,
    backgroundColor: CONFIG.ventana.colorDeFondo,

    // `kiosk: true` es el modo kiosco de Electron: pantalla completa sin
    // forma de salir con el raton, sin barra de titulo, sin minimizar.
    kiosk: pantallaCompleta,
    fullscreen: pantallaCompleta,
    autoHideMenuBar: true,

    // No mostramos la ventana hasta que la interfaz este lista para pintarse.
    // Evita el clasico rectangulo blanco de medio segundo al arrancar.
    show: false,

    webPreferences: {
      // ================================================================
      //  LAS TRES REGLAS DE ORO DE LA SEGURIDAD EN ELECTRON
      // ================================================================

      /**
       * 1) contextIsolation: true
       *
       * Hace que el codigo del preload viva en un "universo" aparte del
       * codigo de la pagina. Aunque compartan la misma ventana, la pagina
       * NO puede alcanzar las variables del preload.
       *
       * Sin esto, cualquier script de la pagina podria reemplazar funciones
       * internas de Electron y colarse a Node.js.
       */
      contextIsolation: true,

      /**
       * 2) nodeIntegration: false
       *
       * La pagina no tiene `require`, ni `process`, ni `fs`.
       * Es decir: el codigo de Angular NO puede tocar el disco duro.
       * Esto es lo que impide que un fallo en la interfaz se convierta en
       * "borrame la base de datos".
       */
      nodeIntegration: false,

      /**
       * 3) sandbox: true
       *
       * Encierra al proceso de la pantalla en la caja de arena de Chromium,
       * la misma que usa Google Chrome para cada pestana. Aunque alguien
       * lograra ejecutar codigo dentro, seguiria atrapado: el sistema
       * operativo le niega el acceso a archivos, red y otros procesos.
       *
       * Es la ultima linea de defensa, la que aguanta cuando las otras dos
       * ya fallaron.
       */
      sandbox: true,

      /**
       * El preload es el UNICO puente entre la pagina y el sistema.
       * Corre antes que la pagina, y es quien define `window.kiosco`
       * con la lista cerrada de operaciones permitidas.
       *
       * La ruta apunta al archivo YA COMPILADO (dist/preload.js), por eso
       * usamos `__dirname` (la carpeta de este archivo compilado).
       */
      preload: path.join(__dirname, 'preload.js'),

      /** Sin spellcheck: es un kiosco, no un procesador de textos. */
      spellcheck: false,

      /**
       * `webSecurity` mantiene activas las reglas de origen del navegador.
       * Apagarlo es un error clasico en tutoriales de Electron. Jamas.
       */
      webSecurity: true,

      /** Prohibido incrustar <webview> con contenido de terceros. */
      webviewTag: false,

      /** No permitir contenido http dentro de una pagina https. */
      allowRunningInsecureContent: false,
    },
  });

  // Se aplican los bloqueos de navegacion, ventanas emergentes y DevTools.
  blindarVentana(ventana);

  // Ahora si: mostrar cuando el contenido esta listo.
  ventana.once('ready-to-show', () => {
    ventana.show();
    if (ES_DESARROLLO) {
      // En desarrollo abrimos las herramientas en un panel lateral.
      ventana.webContents.openDevTools({ mode: 'right' });
    }
  });

  // Cargar la interfaz: el servidor de Angular en desarrollo,
  // o el HTML compilado dentro del instalador en produccion.
  if (ES_DESARROLLO) {
    void ventana.loadURL(URL_DESARROLLO);
  } else {
    void ventana.loadFile(RUTA_INTERFAZ_COMPILADA);
  }

  return ventana;
}
