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
 *  pestaña.
 *
 *  LAS FECHAS, SOLO EL MISMO DIA (28-09-2026). Cerrar la pestaña no basta: el
 *  autor la dejo abierta del 26 al 28, hizo registros, y el panel no los
 *  mostraba porque "Hasta" seguia en el 26. Con `delDia: hoy`, lo guardado
 *  otro dia se ignora y el filtro vuelve a su valor normal ("hasta hoy").
 *  Dentro del mismo dia, una fecha elegida a mano si se respeta.
 *
 *  Se usa en la inicializacion de un componente (necesita el contexto de
 *  Angular para `effect`).
 */

import { type WritableSignal, effect, signal } from '@angular/core';

const PREFIJO = 'panel-filtro:';

export function senalRecordada<T>(
  clave: string,
  porDefecto: T,
  opciones: { delDia?: string } = {},
): WritableSignal<T> {
  const { delDia } = opciones;
  let inicial = porDefecto;
  try {
    const guardado = sessionStorage.getItem(PREFIJO + clave);
    if (guardado !== null) {
      const leido = JSON.parse(guardado) as unknown;
      if (delDia === undefined) {
        inicial = leido as T;
      } else if (
        typeof leido === 'object' && leido !== null &&
        (leido as { dia?: unknown }).dia === delDia
      ) {
        inicial = (leido as { valor: T }).valor;
      }
    }
  } catch {
    // sin almacenamiento (modo privado estricto): se usa el valor por defecto
  }
  const senal = signal<T>(inicial);
  effect(() => {
    const valor = senal();
    try {
      const aGuardar = delDia === undefined ? valor : { dia: delDia, valor };
      sessionStorage.setItem(PREFIJO + clave, JSON.stringify(aGuardar));
    } catch {
      // no se pudo guardar: el filtro funciona, solo no se recuerda
    }
  });
  return senal;
}
