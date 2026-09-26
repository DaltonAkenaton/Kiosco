/**
 * ============================================================================
 *  FILTROS QUE SE RECUERDAN
 * ============================================================================
 *
 *  Pedido del autor (26-09-2026): poner una fecha en Asistencia, ir a
 *  Reportes y regresar... y que la fecha siga ahi.
 *
 *  `senalRecordada('asistencia.desde', hoy)` es una signal normal de Angular
 *  que ademas se guarda en el navegador (sessionStorage) cada vez que cambia,
 *  y al volver a la pantalla arranca con lo guardado.
 *
 *  sessionStorage y no localStorage a proposito: se olvida al cerrar la
 *  pestaña. Al dia siguiente el panel abre en "hoy", que es lo que se espera.
 *
 *  Se usa en la inicializacion de un componente (necesita el contexto de
 *  Angular para `effect`).
 */

import { type WritableSignal, effect, signal } from '@angular/core';

const PREFIJO = 'panel-filtro:';

export function senalRecordada<T>(clave: string, porDefecto: T): WritableSignal<T> {
  let inicial = porDefecto;
  try {
    const guardado = sessionStorage.getItem(PREFIJO + clave);
    if (guardado !== null) inicial = JSON.parse(guardado) as T;
  } catch {
    // sin almacenamiento (modo privado estricto): se usa el valor por defecto
  }
  const senal = signal<T>(inicial);
  effect(() => {
    const valor = senal();
    try {
      sessionStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    } catch {
      // no se pudo guardar: el filtro funciona, solo no se recuerda
    }
  });
  return senal;
}
