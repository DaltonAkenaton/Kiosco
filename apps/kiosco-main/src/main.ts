/**
 * ============================================================================
 *  PUNTO DE ENTRADA DEL KIOSCO
 * ============================================================================
 *
 *  Este es el primer archivo que corre cuando alguien abre la aplicacion.
 *  Su trabajo es coordinar el arranque en el orden correcto:
 *
 *      1. Asegurar que solo haya UNA copia corriendo.
 *      2. Endurecer la configuracion de Chromium.
 *      3. Esperar a que Electron este listo.
 *      4. Aplicar las politicas de seguridad de la sesion.
 *      5. Registrar los manejadores IPC (ANTES de abrir la ventana).
 *      6. Abrir la ventana y protegerla contra cierres y caidas.
 *      7. Dejar la app registrada para arrancar con Windows.
 *
 *  El orden importa: si la ventana abriera antes de registrar los manejadores,
 *  la interfaz podria preguntar algo y no encontrar a nadie escuchando.
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { CANALES, CONFIG } from '@kiosko/compartido';
import { iniciarActualizaciones } from './actualizaciones';
import {
  blindarContraCierre,
  configurarArranqueConWindows,
  vigilarCaidas,
} from './arranque-automatico';
import { abrirBaseDeDatos, cerrarBaseDeDatos } from './datos/base-de-datos';
import { sembrarAdministradorDePrueba, sembrarEmpleadosDePrueba } from './datos/semilla';
import { ES_DESARROLLO } from './entorno';
import { actualizarEstado, estadoActual, registrarManejadoresIpc } from './ipc/manejadores';
import { registrarManejadoresAdmin } from './ipc/manejadores-admin';
import { prepararLlaveDeFotos } from './servicios/llave-fotos';
import { configurarPausa, reanudar } from './servicios/pausa';
import { migrarFotosHeredadas, programarDepuracionDeFotos } from './servicios/retencion-fotos';
import { iniciarSincronizacion } from './servicios/sincronizacion';
import { alCerrarseSesionAdmin } from './servicios/sesion-admin';
import { aplicarPoliticasDeSesion } from './seguridad';
import { crearVentanaPrincipal } from './ventana';
import { anotarUso } from './servicios/actividad';
import { cerrarKiosco } from './servicios/cierre';
import { esPcCompartida } from './configuracion-vigente';

/**
 * ----------------------------------------------------------------------------
 *  1. UNA SOLA COPIA A LA VEZ
 * ----------------------------------------------------------------------------
 *  Si el empleado hace doble clic dos veces en el icono, Windows abriria dos
 *  kioscos. Dos programas escribiendo en la misma base SQLite es una receta
 *  para corromper datos de asistencia.
 *
 *  `requestSingleInstanceLock()` devuelve false si ya hay otra copia viva.
 *  En ese caso esta se cierra sola y le cede el foco a la primera.
 */
const esLaPrimeraCopia = app.requestSingleInstanceLock();

if (!esLaPrimeraCopia) {
  app.quit();
} else {
  /** Referencia a la ventana. La guardamos para poder reutilizarla. */
  let ventanaPrincipal: BrowserWindow | null = null;

  // Si alguien intenta abrir una segunda copia, en vez de abrirla,
  // traemos al frente la que ya existe.
  app.on('second-instance', () => {
    if (ventanaPrincipal) {
      if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
      ventanaPrincipal.focus();
    }
  });

  /**
   * --------------------------------------------------------------------------
   *  2. AJUSTES DE CHROMIUM (antes de que Electron arranque)
   * --------------------------------------------------------------------------
   */

  /**
   * Nombre de la aplicacion y carpeta de datos.
   *
   * `app.setName()` por si solo NO basta: Electron ya calculo la ruta de
   * `userData` a partir del nombre del package.json, y el nuestro es
   * "@kiosko/kiosco-main". El resultado era una carpeta llamada:
   *
   *     C:\Users\<usuario>\AppData\Roaming\@kiosko\kiosco-main\
   *
   * Eso funciona, pero es un problema real de OPERACION: el manual tecnico
   * tiene que decirle a quien de soporte donde esta la base de datos para
   * respaldarla, y "@kiosko\kiosco-main" no lo va a encontrar nadie. Peor:
   * si manana se renombra el paquete, la carpeta cambia y el kiosco
   * "pierde" todos sus datos.
   *
   * Por eso se fija la ruta EXPLICITAMENTE. Queda:
   *
   *     C:\Users\<usuario>\AppData\Roaming\Control de Asistencia\
   */
  app.setName(CONFIG.ventana.titulo);
  app.setPath('userData', path.join(app.getPath('appData'), CONFIG.ventana.titulo));

  // El kiosco esta pensado para una pantalla tactil o un teclado fisico.
  // Apagamos funciones de Chromium que no usamos y que solo suman superficie
  // de ataque y consumo.
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,Translate');

  // Windows: evita que el equipo se duerma o apague la pantalla mientras el
  // kiosco esta activo. Un kiosco con la pantalla negra a las 6 AM es un
  // kiosco que la gente cree descompuesto.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');

  /**
   * --------------------------------------------------------------------------
   *  3. ARRANQUE
   * --------------------------------------------------------------------------
   *  `app.whenReady()` es una promesa que se cumple cuando Electron ya
   *  inicializo todo lo suyo. Antes de ese momento casi ninguna API funciona.
   */
  void app.whenReady().then(() => {
    /**
     * 4. LA BASE DE DATOS, antes que nada.
     *
     * Va primero porque todo lo demas depende de ella: los manejadores IPC
     * la consultan, y si no estuviera abierta, la primera peticion tronaria.
     *
     * Si esto falla (disco lleno, permisos, base corrupta), la app NO debe
     * arrancar a medias: mas vale un error claro al abrir que un kiosco que
     * se ve bien y no guarda nada.
     */
    abrirBaseDeDatos();
    actualizarEstado({ pcCompartida: esPcCompartida() });
    sembrarEmpleadosDePrueba(); // no hace nada si la app esta empaquetada
    sembrarAdministradorDePrueba(); // tampoco

    /**
     * 4.b LAS FOTOS: llave, pendientes heredadas y retencion.
     *
     * La llave se abre ya, y no en el primer registro, para que la primera
     * persona del dia no espere a que Windows la descifre.
     *
     * Nada de esto puede impedir que el kiosco arranque: sin llave, se
     * registra sin foto; si la migracion falla, se reintenta al siguiente
     * arranque. Por eso va envuelto.
     */
    try {
      prepararLlaveDeFotos();
      migrarFotosHeredadas();
    } catch (fallo) {
      console.error('[arranque] problema al preparar las fotos:', fallo);
    }
    programarDepuracionDeFotos();

    // 5. Politicas de seguridad de la sesion (CSP, permisos, dispositivos).
    aplicarPoliticasDeSesion();

    // 6. Manejadores IPC: siempre ANTES de crear la ventana.
    registrarManejadoresIpc();
    registrarManejadoresAdmin();

    // 7. La ventana.
    ventanaPrincipal = crearVentanaPrincipal();

    // Cualquier tecla cuenta como "alguien esta usando el kiosco": la
    // instalacion automatica de versiones nuevas espera a que no haya nadie.
    ventanaPrincipal.webContents.on('before-input-event', () => anotarUso());

    /**
     * 8. Que se quede prendida.
     *
     * Las dos protecciones van JUNTAS y justo aqui, con la ventana recien
     * creada: una impide que la cierren, la otra la revive si se cae sola.
     * Cubren cosas distintas y ninguna sustituye a la otra. El porque completo
     * esta en arranque-automatico.ts.
     */
    blindarContraCierre(ventanaPrincipal, () => void cerrarKiosco());
    vigilarCaidas(ventanaPrincipal);

    // Modo administrador: aviso de que la sesion se cerro sola por
    // inactividad, para que la pantalla tape las fotos de inmediato.
    alCerrarseSesionAdmin(() => {
      for (const ventana of BrowserWindow.getAllWindows()) {
        if (!ventana.isDestroyed()) ventana.webContents.send(CANALES.adminSesionCerrada);
      }
    });

    /**
     * La pausa recibe aqui la ventana y la forma de avisar cambios de estado.
     *
     * Se le pasan en vez de que ella los importe, para no crear dos archivos
     * que se necesiten mutuamente: `pausa.ts` tiene que avisar del estado, y
     * quien maneja el estado tiene que poder llamar a `pausar()`.
     */
    configurarPausa(ventanaPrincipal, actualizarEstado);

    ventanaPrincipal.on('closed', () => {
      ventanaPrincipal = null;
    });

    /**
     * 9. Lo que no corre prisa.
     *
     * Estas dos lineas van AL FINAL a proposito: para cuando se ejecutan, el
     * kiosco ya esta en pantalla y alguien ya podria estar checando. Ni
     * escribir en el registro de Windows ni preguntar por actualizaciones
     * deben retrasar ni un milisegundo el momento en que la pantalla aparece.
     */
    configurarArranqueConWindows();
    iniciarActualizaciones();

    // La sincronizacion con la nube (CLAUDE.md 7). En segundo plano: nada de
    // lo que haga, ni una red caida, puede retrasar a quien viene a checar.
    iniciarSincronizacion({ avisar: actualizarEstado, obtenerEstado: estadoActual });

    console.info(
      `[arranque] ${CONFIG.ventana.titulo} v${app.getVersion()} - ` +
        `modo ${ES_DESARROLLO ? 'DESARROLLO' : 'PRODUCCION'}`,
    );
  });

  /**
   * --------------------------------------------------------------------------
   *  4. CIERRE
   * --------------------------------------------------------------------------
   *  En Windows y Linux, cerrar la ultima ventana cierra la aplicacion.
   *  (En macOS la costumbre es al reves, pero el kiosco es solo para Windows;
   *  dejamos la condicion por si algun dia se prueba en otra plataforma.)
   */
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  /**
   * Cerrar la base de datos limpiamente al salir.
   *
   * 'will-quit' es el ultimo momento util: la ventana ya se fue pero el
   * proceso sigue vivo. Cerrar bien hace que SQLite vacie el archivo WAL
   * dentro de la base principal; si no, queda un .db-wal suelto que el
   * siguiente arranque tiene que recuperar.
   */
  app.on('will-quit', () => {
    // Si la app se cierra durante una pausa, se cierra tambien la pausa: asi
    // queda el evento de regreso y el panel no ve una pausa abierta para
    // siempre. Va ANTES de cerrar la base, porque el evento se escribe en ella.
    reanudar('cierre');
    cerrarBaseDeDatos();
  });

  /**
   * --------------------------------------------------------------------------
   *  5. RED DE SEGURIDAD CONTRA CAIDAS
   * --------------------------------------------------------------------------
   *  Regla de oro del proyecto: el kiosco nunca debe impedir que alguien
   *  registre. Un error no atendido en Node cierra el proceso de golpe.
   *  Aqui lo atrapamos, lo dejamos escrito y seguimos vivos.
   *
   *  (Mas adelante, cuando exista el sincronizador, estos errores tambien
   *  viajaran a `eventos_dispositivo` para que el panel los muestre.)
   */
  process.on('uncaughtException', (error) => {
    console.error('[fatal] Excepcion no atendida:', error);
  });

  process.on('unhandledRejection', (motivo) => {
    console.error('[fatal] Promesa rechazada sin atender:', motivo);
  });
}
