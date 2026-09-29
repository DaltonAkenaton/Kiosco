/**
 * ============================================================================
 *  ARRANQUE DEL PANEL
 * ============================================================================
 *  A diferencia del kiosco (una sola pantalla con estados, D-005), el panel SI
 *  usa el enrutador: son secciones distintas (Asistencia, Kioscos...) y es
 *  natural que cada una tenga su direccion y que el boton "atras" funcione.
 */

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { type NavigationError, provideRouter, withComponentInputBinding, withNavigationErrorHandler } from '@angular/router';
import { RUTAS } from './rutas';

/**
 * ¿La seccion no se pudo descargar porque el panel se publico de nuevo?
 *
 * Cada seccion es un archivo aparte que se baja la primera vez que se pica
 * (`chunk-XXXX.js`, con un nombre que cambia en cada publicacion). Una pestaña
 * abierta ANTES de publicar sigue pidiendo los nombres viejos, que ya no
 * existen: el servidor contesta con la pagina principal, la descarga falla y el
 * clic "no hace nada" (se vio el 28-09-2026: "doy clic en el menu y no se
 * mueve").
 *
 * La salida es recargar: la pagina nueva trae los nombres nuevos. Se hace
 * sola, directo a la seccion que se pidio, y como mucho una vez cada 10
 * segundos para no quedar en un ciclo si el problema fuera otro.
 */
const CLAVE_ULTIMA_RECARGA = 'panel-recarga-por-version-nueva';
const SEGUNDOS_ENTRE_RECARGAS = 10;

function alFallarLaNavegacion(error: NavigationError): void {
  const mensaje = String((error.error as Error | undefined)?.message ?? error.error ?? '');
  const esArchivoViejo = /dynamically imported module|importing a module script failed|module script/i.test(mensaje);
  if (!esArchivoViejo) return;

  let ultima = 0;
  try {
    ultima = Number(sessionStorage.getItem(CLAVE_ULTIMA_RECARGA) ?? 0);
    if (Date.now() - ultima < SEGUNDOS_ENTRE_RECARGAS * 1000) return;
    sessionStorage.setItem(CLAVE_ULTIMA_RECARGA, String(Date.now()));
  } catch {
    // sin almacenamiento: se recarga igual (una recarga de mas no hace daño)
  }
  location.assign(error.url);
}

export const configuracionDeLaApp: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(RUTAS, withComponentInputBinding(), withNavigationErrorHandler(alFallarLaNavegacion)),
  ],
};
