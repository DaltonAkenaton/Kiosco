/**
 * ============================================================================
 *  ENTRADA ESCONDIDA AL MODO ADMINISTRADOR  (20-10-2026)
 * ============================================================================
 *
 *  Junta con el jefe: el empleado no tiene por que ver un boton
 *  "Administrador" ni la barra de estado. Ahora se entra MANTENIENDO
 *  PRESIONADO el letrero de arriba ("UAT  FCACS Nuevo Laredo") unos segundos
 *  (configuracion.ts, `segundosParaEntrarAlAdministrador`), y se abre el
 *  usuario y contrasena de siempre. Lo que protege es la contrasena; esconder
 *  la puerta solo evita que se pique por curiosidad.
 *
 *  El letrero vive en el componente raiz (app.html) y el modo administrador
 *  en la pantalla principal: este servicio los conecta. El raiz llama
 *  `pedir()`; la pantalla principal escucha `solicitudes` y lo abre.
 */

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class EntradaAdmin {
  private readonly _solicitudes = signal(0);
  /** Sube en uno cada vez que alguien completa el "mantener presionado". */
  readonly solicitudes = this._solicitudes.asReadonly();

  pedir(): void {
    this._solicitudes.update((n) => n + 1);
  }
}
