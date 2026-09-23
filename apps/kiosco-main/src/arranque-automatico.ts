/**
 * ============================================================================
 *  QUE LA APP ESTE SIEMPRE PRENDIDA
 * ============================================================================
 *
 *  CLAUDE.md 4: "La app arranca sola con Windows y se recupera si se cierra."
 *
 *  Detras de esa frase corta hay tres problemas distintos, y cada uno se
 *  resuelve en un lugar diferente. Vale la pena separarlos, porque es facil
 *  creer que uno solo los cubre todos:
 *
 *  ---------------------------------------------------------------------------
 *  1. LA PC SE REINICIO  (se fue la luz, Windows Update, alguien la apago)
 *  ---------------------------------------------------------------------------
 *     Lo resuelve `configurarArranqueConWindows()`, aqui abajo: registra la
 *     app para que Windows la abra sola al iniciar sesion.
 *
 *  ---------------------------------------------------------------------------
 *  2. ALGUIEN INTENTA CERRAR LA VENTANA  (Alt+F4, la X, "salir")
 *  ---------------------------------------------------------------------------
 *     Lo resuelve `blindarContraCierre()`: en produccion la ventana se niega
 *     a cerrarse. Hay una combinacion de escape para quien de mantenimiento,
 *     porque una app que NO se puede cerrar de ninguna forma es un problema
 *     el dia que haya que actualizarla a mano.
 *
 *  ---------------------------------------------------------------------------
 *  3. LA PANTALLA SE CAYO SOLA  (Chromium se quedo sin memoria, un fallo)
 *  ---------------------------------------------------------------------------
 *     Lo resuelve `vigilarCaidas()`: si el proceso de la pantalla muere, se
 *     vuelve a cargar sola. El proceso principal —donde vive la base de
 *     datos— sigue intacto, asi que no se pierde ningun registro.
 *
 *  ---------------------------------------------------------------------------
 *  LO QUE ESTE ARCHIVO NO PUEDE RESOLVER
 *  ---------------------------------------------------------------------------
 *  Si alguien mata el proceso PRINCIPAL desde el Administrador de tareas, no
 *  queda nadie vivo para reaccionar: un programa no puede resucitarse a si
 *  mismo. Eso se cubre fuera de la app, en el sistema operativo:
 *
 *    - cuenta de Windows estandar, sin privilegios (CLAUDE.md 13), para que
 *      el personal no tenga Administrador de tareas util;
 *    - modo kiosco de Windows (Assigned Access o Shell Launcher), que vuelve
 *      a lanzar la aplicacion configurada si se cierra.
 *
 *  Queda documentado en el manual tecnico. No se resuelve inventando un
 *  segundo proceso "vigilante": eso duplica lo que Windows ya hace bien, y
 *  agrega un programa mas que puede fallar o que alguien puede matar tambien.
 */

import { app, BrowserWindow } from 'electron';
import { ES_PRODUCCION, MODO_PRUEBA } from './entorno';

/**
 * ¿Ya se autorizo salir?
 *
 * Empieza en `false` y solo `permitirSalir()` lo cambia. Mientras valga
 * `false`, la ventana se niega a cerrarse en produccion.
 *
 * Es una variable de modulo (no un parametro) a proposito: la autorizacion
 * la puede dar el atajo de teclado, el apagado de Windows o una actualizacion
 * automatica, y los tres tienen que poder decirlo desde donde esten.
 */
let salidaAutorizada = false;

/**
 * Autoriza el cierre y sale.
 *
 * Es la unica puerta de salida limpia en produccion. La usan el atajo de
 * mantenimiento, el apagado de Windows y (mas adelante) el instalador de una
 * actualizacion.
 */
export function permitirSalir(): void {
  salidaAutorizada = true;
  app.quit();
}

/**
 * ----------------------------------------------------------------------------
 *  1. ARRANCAR CON WINDOWS
 * ----------------------------------------------------------------------------
 *
 *  `setLoginItemSettings` escribe en el registro de Windows, en la rama del
 *  USUARIO (HKCU\...\Run). Eso importa: no hace falta ser administrador, que
 *  es justo la situacion del kiosco, donde la cuenta es estandar.
 *
 *  Se llama en cada arranque a proposito. Si alguien desactivo el inicio
 *  automatico desde el Administrador de tareas, la siguiente vez que la app
 *  se abra a mano vuelve a quedar configurada. Es barato y se auto-repara.
 */
export function configurarArranqueConWindows(): void {
  // En desarrollo NO: seria insoportable que la app se abriera sola cada vez
  // que enciendes tu computadora de trabajo. Ademas apuntaria al ejecutable
  // de Electron, no al kiosco instalado.
  if (!ES_PRODUCCION) return;

  // En modo prueba tampoco: si no, cada compilacion de prueba dejaria a
  // Windows apuntando a una carpeta `win-unpacked` que la siguiente
  // compilacion borra. Ver MODO_PRUEBA en entorno.ts.
  if (MODO_PRUEBA) {
    console.info('[arranque] modo prueba: no se registra el inicio automatico');
    return;
  }

  try {
    /**
     * Se escribe SIEMPRE, aunque ya estuviera registrado.
     *
     * La primera version de esto hacia `if (yaEstaba) return`, para no tocar
     * el registro sin necesidad. Era un error, y justo del tipo que el
     * comentario de abajo describe: si alguna vez quedaba registrada una ruta
     * equivocada —una copia temporal, una carpeta de pruebas, una instalacion
     * vieja— ya NUNCA se corregia. El kiosco se reinstalaba, todo parecia
     * bien, y Windows seguia intentando abrir un ejecutable que ya no existe.
     *
     * Escribir el registro cuesta microsegundos y se corrige solo en cada
     * arranque. Esa es la propiedad que importa en una PC que nadie
     * administra.
     */
    app.setLoginItemSettings({
      openAtLogin: true,

      /**
       * `path` explicito y no el valor por defecto.
       *
       * Sin el, Electron registra la ruta del ejecutable tal como se lanzo
       * esta vez. Si alguien abriera el kiosco desde un acceso directo raro o
       * desde una copia temporal, quedaria registrada ESA ruta, y el dia que
       * esa copia desaparezca Windows intentaria abrir algo que ya no existe
       * — silenciosamente, sin avisar a nadie.
       */
      path: process.execPath,
    });

    console.info('[arranque] la aplicacion queda configurada para abrirse con Windows');
  } catch (fallo) {
    // Si el registro esta bloqueado por politicas de la facultad, el kiosco
    // sigue sirviendo: simplemente habra que abrirlo a mano. No es motivo
    // para impedir que arranque.
    console.warn('[arranque] no se pudo configurar el inicio automatico', fallo);
  }
}

/**
 * ----------------------------------------------------------------------------
 *  2. QUE NO SE PUEDA CERRAR (sin querer, ni queriendo)
 * ----------------------------------------------------------------------------
 *
 *  En produccion la ventana ya va en modo kiosco: sin barra de titulo, sin
 *  boton de cerrar, sin minimizar. Pero Alt+F4 sigue existiendo, y es de las
 *  primeras cosas que alguien prueba.
 *
 *  LA COMBINACION DE ESCAPE
 *  ------------------------
 *  Ctrl + Alt + Shift + Q cierra la aplicacion.
 *
 *  ¿No es eso un agujero? En la practica no, y por dos razones:
 *
 *    - Cerrar el kiosco no da acceso a nada. La base de datos esta en el
 *      perfil del usuario, las marcas ya estan guardadas, y lo unico que
 *      consigue quien lo cierre es que el siguiente no pueda checar... hasta
 *      que Windows lo vuelva a abrir.
 *
 *    - Lo que si protegemos de verdad (las marcas, las fotos, los PINes) no
 *      depende de que la ventana este abierta.
 *
 *  Y la alternativa —no tener NINGUNA forma de salir— es peor: el dia que
 *  haya que hacer mantenimiento en una PC sin administrador, no habria como.
 *  Queda documentada en el manual tecnico, no escondida.
 */
export function blindarContraCierre(ventana: BrowserWindow): void {
  if (!ES_PRODUCCION) return;

  // En modo prueba se deja cerrar con normalidad: estas probando en tu
  // computadora, no en el pasillo. La CSP y todo lo demas siguen siendo los
  // de produccion; esto solo evita que tengas que acordarte del atajo cada
  // vez que quieras cerrar la ventana.
  if (MODO_PRUEBA) return;

  ventana.on('close', (evento) => {
    if (salidaAutorizada) return;

    evento.preventDefault();
    console.warn('[kiosco] intento de cerrar la ventana: bloqueado');
  });

  /**
   * `before-input-event` ve las teclas ANTES que la pagina.
   *
   * Es la unica forma de atrapar una combinacion sin que el renderer —que es
   * la parte no confiable— tenga nada que ver. Si esto viviera en Angular, la
   * combinacion de mantenimiento se podria descubrir leyendo el codigo de la
   * interfaz, que viaja dentro del .exe y es texto.
   */
  ventana.webContents.on('before-input-event', (evento, entrada) => {
    const esLaCombinacion =
      entrada.type === 'keyDown' &&
      entrada.control &&
      entrada.alt &&
      entrada.shift &&
      entrada.key.toLowerCase() === 'q';

    if (!esLaCombinacion) return;

    evento.preventDefault();
    console.info('[kiosco] salida autorizada con la combinacion de mantenimiento');
    permitirSalir();
  });

  /**
   * Windows se esta apagando o cerrando sesion.
   *
   * Aqui SI hay que dejar salir. Negarse a cerrar durante un apagado no lo
   * impide: Windows termina el proceso a la fuerza de todos modos, y eso deja
   * la base de datos sin cerrar limpiamente (con su archivo WAL suelto). Mas
   * vale salir por la puerta.
   */
  ventana.on('session-end', () => {
    console.info('[kiosco] Windows se esta cerrando: se autoriza la salida');
    salidaAutorizada = true;
  });
}

/**
 * ----------------------------------------------------------------------------
 *  3. RECUPERARSE SI LA PANTALLA SE CAE
 * ----------------------------------------------------------------------------
 *
 *  El proceso de la pantalla (Chromium) puede morir por su cuenta: un fallo
 *  de memoria, un problema del controlador de video, la camara portandose
 *  mal. Cuando pasa, la ventana queda en blanco o con el mensaje de "Aw,
 *  Snap" — y nadie puede checar.
 *
 *  La buena noticia es que el proceso PRINCIPAL sigue vivo, y con el la base
 *  de datos y todo lo ya registrado. Recargar la pantalla lo arregla.
 */
export function vigilarCaidas(ventana: BrowserWindow): void {
  ventana.webContents.on('render-process-gone', (_evento, detalle) => {
    console.error(`[kiosco] la pantalla se cayo (${detalle.reason}). Recargando...`);

    // `clean-exit` significa que la pantalla se cerro a proposito (por
    // ejemplo, porque la aplicacion esta saliendo). Recargar ahi seria
    // pelearse con el cierre.
    if (detalle.reason === 'clean-exit') return;

    if (!ventana.isDestroyed()) ventana.reload();
  });

  /**
   * La pantalla dejo de responder.
   *
   * NO se recarga automaticamente: "no responde" suele ser temporal (un
   * momento de trabajo pesado) y recargar borraria lo que el empleado llevaba
   * tecleado. Se deja constancia, que es lo que sirve para el diagnostico a
   * distancia; si se queda colgada de verdad, el caso anterior acabara
   * disparandose.
   */
  ventana.webContents.on('unresponsive', () => {
    console.warn('[kiosco] la pantalla no responde');
  });

  ventana.webContents.on('responsive', () => {
    console.info('[kiosco] la pantalla volvio a responder');
  });
}
