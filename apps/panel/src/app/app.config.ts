/**
 * ============================================================================
 *  ARRANQUE DEL PANEL
 * ============================================================================
 *  A diferencia del kiosco (una sola pantalla con estados, D-005), el panel SI
 *  usa el enrutador: son secciones distintas (Asistencia, Kioscos...) y es
 *  natural que cada una tenga su direccion y que el boton "atras" funcione.
 */

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RUTAS } from './rutas';

export const configuracionDeLaApp: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(RUTAS, withComponentInputBinding())],
};
