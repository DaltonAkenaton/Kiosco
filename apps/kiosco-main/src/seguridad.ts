/**
 * ============================================================================
 *  BLINDAJE DE ELECTRON
 * ============================================================================
 *
 *  Este archivo implementa, una por una, las reglas OBLIGATORIAS de la
 *  seccion 3.1 del ARQUITECTURA.md. Cada bloque dice que ataque evita.
 *
 *  El modelo mental correcto para un kiosco:
 *  "Doy por hecho que alguien va a tener el teclado, el mouse y todo el tiempo
 *   del mundo frente a esta maquina. ¿Que puede lograr?"
 *
 *  La respuesta que buscamos es: nada mas que checar su asistencia.
 */

import { BrowserWindow, session, type Session } from 'electron';
import { ES_DESARROLLO } from './entorno';

/**
 * ----------------------------------------------------------------------------
 *  CONTENT SECURITY POLICY (CSP)
 * ----------------------------------------------------------------------------
 *  La CSP es una lista blanca que le dice al navegador interno:
 *  "solo puedes cargar codigo, estilos e imagenes de estos lugares".
 *
 *  Si alguien lograra inyectar un <script src="http://sitio-malo/robar.js">
 *  dentro de la pantalla, el navegador simplemente se niega a cargarlo.
 *
 *  Desglose de cada directiva:
 *    default-src 'self'   -> por defecto, solo lo que venga de la propia app
 *    script-src  'self'   -> NADA de scripts externos, ni codigo en texto
 *    style-src            -> estilos propios; 'unsafe-inline' es necesario
 *                            porque Angular y Tailwind insertan estilos asi
 *    img-src  'self' data: blob:
 *                         -> 'data:' y 'blob:' son para las fotos que la
 *                            camara genera en memoria; nunca salen a internet
 *    media-src 'self' blob:
 *                         -> el video en vivo de la camara
 *    connect-src 'self'   -> la interfaz NO habla con internet. Quien habla
 *                            con Supabase es el proceso principal. Asi, aunque
 *                            comprometieran la pantalla, no pueden filtrar datos
 *    object-src 'none'    -> prohibido Flash, applets y demas reliquias
 *    frame-src  'none'    -> prohibido meter iframes (evita phishing dentro del kiosco)
 *    base-uri   'self'    -> impide reescribir la base de las rutas relativas
 *    form-action 'none'   -> ningun formulario puede enviar datos a ningun lado
 */
const CSP_PRODUCCION = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * En desarrollo hay que aflojar un poco: el servidor de Angular recarga la
 * pagina sola usando WebSockets y evalua codigo al vuelo.
 * Esta version relajada NUNCA se usa en el .exe instalado.
 */
const CSP_DESARROLLO = [
  "default-src 'self' http://localhost:4200 ws://localhost:4200",
  "script-src 'self' 'unsafe-eval' http://localhost:4200",
  "style-src 'self' 'unsafe-inline' http://localhost:4200",
  "img-src 'self' data: blob: http://localhost:4200",
  "media-src 'self' blob:",
  "font-src 'self' data: http://localhost:4200",
  "connect-src 'self' http://localhost:4200 ws://localhost:4200",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * ----------------------------------------------------------------------------
 *  Politicas a nivel SESION (aplican a todo lo que cargue la app)
 * ----------------------------------------------------------------------------
 *  Una "sesion" en Electron es como el perfil del navegador: cookies, cache,
 *  permisos. Configurarla aqui cubre cualquier ventana que abramos despues.
 */
export function aplicarPoliticasDeSesion(sesion: Session = session.defaultSession): void {
  // --- 1. Inyectar la CSP en cada respuesta -------------------------------
  // Lo hacemos desde aqui y no con una etiqueta <meta> en el HTML porque la
  // cabecera no se puede quitar desde la pagina; la etiqueta si.
  sesion.webRequest.onHeadersReceived((detalles, responder) => {
    responder({
      responseHeaders: {
        ...detalles.responseHeaders,
        'Content-Security-Policy': [ES_DESARROLLO ? CSP_DESARROLLO : CSP_PRODUCCION],
      },
    });
  });

  // --- 2. Permisos del navegador ------------------------------------------
  // ARQUITECTURA.md 3.1: "permitir solo `media` (camara) y denegar todo lo demas".
  // Sin esto, la pagina podria pedir ubicacion, notificaciones, portapapeles,
  // reproduccion automatica... y Electron se los concederia sin preguntar.
  const PERMISOS_AUTORIZADOS = new Set(['media']);

  sesion.setPermissionRequestHandler((_contenido, permiso, responder) => {
    const autorizado = PERMISOS_AUTORIZADOS.has(permiso);
    if (!autorizado) {
      console.warn(`[seguridad] Permiso DENEGADO: ${permiso}`);
    }
    responder(autorizado);
  });

  // Algunas APIs consultan el permiso sin "pedirlo" formalmente.
  // Hay que cerrar esa puerta tambien o el filtro de arriba se puede rodear.
  sesion.setPermissionCheckHandler((_contenido, permiso) => PERMISOS_AUTORIZADOS.has(permiso));

  // --- 3. Nada de dispositivos USB / serie / HID --------------------------
  // La camara entra por `media` (arriba). Estas otras APIs darian acceso
  // directo al hardware desde la pagina web. No las necesitamos.
  sesion.setDevicePermissionHandler(() => false);
}

/**
 * ----------------------------------------------------------------------------
 *  Blindaje de UNA ventana concreta
 * ----------------------------------------------------------------------------
 */
export function blindarVentana(ventana: BrowserWindow): void {
  const contenido = ventana.webContents;

  // --- 4. Prohibido navegar fuera de la app -------------------------------
  // Si un enlace intenta llevar la ventana a otro sitio, lo cancelamos.
  // Sin esto, un enlace a una pagina externa convertiria el kiosco en un
  // navegador a pantalla completa: el empleado podria salir a internet.
  contenido.on('will-navigate', (evento, urlDestino) => {
    if (!esUrlPropia(urlDestino)) {
      console.warn(`[seguridad] Navegacion BLOQUEADA hacia: ${urlDestino}`);
      evento.preventDefault();
    }
  });

  // --- 5. Prohibido abrir ventanas nuevas ---------------------------------
  // `window.open(...)` o un target="_blank" abririan otra ventana de Electron,
  // sin nuestras protecciones. La respuesta siempre es 'deny'.
  contenido.setWindowOpenHandler(({ url }) => {
    console.warn(`[seguridad] Ventana emergente BLOQUEADA: ${url}`);
    // Si algun dia hiciera falta abrir un enlace legitimo (por ejemplo el
    // aviso de privacidad), NO se abre aqui dentro: se abre en el navegador
    // del sistema con `shell.openExternal(url)` de Electron, fuera del kiosco.
    return { action: 'deny' };
  });

  // --- 6. Prohibido incrustar contenido externo en sub-marcos -------------
  contenido.on('will-attach-webview', (evento) => {
    console.warn('[seguridad] <webview> BLOQUEADO');
    evento.preventDefault();
  });

  // --- 7. DevTools solo en desarrollo -------------------------------------
  // ARQUITECTURA.md 3.1: "Menu y DevTools deshabilitados en produccion".
  // Con DevTools abiertas cualquiera puede leer el hash del PIN de un
  // empleado o falsificar mensajes IPC desde la consola.
  if (!ES_DESARROLLO) {
    contenido.on('devtools-opened', () => {
      console.warn('[seguridad] DevTools cerradas por politica');
      contenido.closeDevTools();
    });
  }

  // --- 8. Ver en la terminal lo que la pantalla escribe en su consola -----
  // Los `console.log` de Angular viven dentro de Chromium y NO aparecen en la
  // terminal donde arrancaste la app. Esto los trae para aca.
  //
  // Es de una ayuda enorme para diagnosticar: en el kiosco real no vas a
  // poder abrir las DevTools, pero SI puedes leer el archivo de registro.
  //
  // Va sin filtro solo en desarrollo. En produccion nos quedamos con los
  // avisos y errores, nunca con mensajes informativos, porque estos podrian
  // contener datos de empleados (ARQUITECTURA.md 14: nunca registrar PINs ni fotos).
  contenido.on('console-message', (detalles) => {
    const esImportante = detalles.level === 'warning' || detalles.level === 'error';
    if (!ES_DESARROLLO && !esImportante) return;

    console.log(`[pantalla:${detalles.level}] ${detalles.message}`);
  });

  // --- 9. Vigilancia: si el proceso de la pantalla muere, lo sabemos ------
  // La regla de oro es que el kiosco nunca deje de servir. Si Chrome se cae,
  // recargamos en vez de quedarnos con una ventana en blanco.
  contenido.on('render-process-gone', (_evento, detalles) => {
    console.error('[seguridad] El proceso de la interfaz murio:', detalles.reason);
    if (!ventana.isDestroyed()) {
      ventana.reload();
    }
  });
}

/**
 * ¿La URL pertenece a nuestra propia aplicacion?
 *
 * Aceptamos:
 *   - file://   -> la interfaz compilada dentro del instalador
 *   - http://localhost:4200 -> el servidor de Angular, SOLO en desarrollo
 *
 * Cualquier otra cosa (http, https, ftp, javascript:...) queda fuera.
 */
function esUrlPropia(url: string): boolean {
  try {
    const destino = new URL(url);
    if (destino.protocol === 'file:') return true;
    if (ES_DESARROLLO && destino.origin === 'http://localhost:4200') return true;
    return false;
  } catch {
    // Si ni siquiera se puede leer como URL, con mas razon la bloqueamos.
    return false;
  }
}

/** Se exporta solo para que las pruebas puedan verificar la politica. */
export const _politicasCsp = { CSP_PRODUCCION, CSP_DESARROLLO };
