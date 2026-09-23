/**
 * ============================================================================
 *  CONFIGURACION DE ARRANQUE DE ANGULAR
 * ============================================================================
 *
 *  Aqui se listan los "proveedores": las piezas globales que Angular debe
 *  tener listas antes de pintar nada.
 *
 *  Por ahora hay una sola, y es a proposito: el kiosco es UNA pantalla con
 *  varios estados (teclado -> confirmacion -> exito), no varias paginas. Por
 *  eso NO usamos el enrutador de Angular: seria complejidad sin beneficio.
 *  El panel administrativo, que si tendra varias secciones, si lo usara.
 */

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    /**
     * Atrapa los errores de JavaScript que nadie atendio y los manda a la
     * consola en lugar de dejar la pantalla congelada en silencio.
     * En un kiosco desatendido esto vale oro: es la diferencia entre
     * "se ve raro" y "no sabemos que paso".
     */
    provideBrowserGlobalErrorListeners(),
  ],
};
