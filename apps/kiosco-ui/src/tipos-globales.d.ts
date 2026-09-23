/**
 * ============================================================================
 *  DECLARACION DE `window.kiosco`
 * ============================================================================
 *
 *  El preload de Electron crea `window.kiosco` en tiempo de ejecucion.
 *  Pero TypeScript no tiene forma de adivinarlo: para el, `window` es el
 *  objeto estandar del navegador y `window.kiosco` no existe.
 *
 *  Este archivo (con extension `.d.ts`, de "declaration") es una NOTA para
 *  TypeScript: "confia en mi, en tiempo de ejecucion va a existir esto, y
 *  tiene esta forma exacta".
 *
 *  Gracias a esto:
 *    - el editor te autocompleta `window.kiosco.` y te muestra los metodos,
 *    - si escribes mal un nombre, te lo marca en rojo al instante,
 *    - si algun dia cambia el contrato compartido, Angular deja de compilar
 *      hasta que lo ajustes. Eso es bueno: el error aparece al programar y
 *      no de madrugada frente a un empleado.
 *
 *  Un `.d.ts` no genera JavaScript. Es solo informacion para el compilador.
 */

import type { ApiKiosco } from '@kiosko/compartido';

declare global {
  interface Window {
    /**
     * El puente hacia el proceso principal de Electron.
     *
     * Es OPCIONAL (`?`) a proposito: si algun dia abres esta app en un
     * navegador normal (para probar la interfaz sin Electron), `window.kiosco`
     * no existira. Al declararlo opcional, TypeScript te obliga a comprobar
     * que exista antes de usarlo, y la app muestra un aviso en vez de tronar.
     */
    kiosco?: ApiKiosco;
  }
}

// Un archivo con `import` o `export` es un modulo. Este `export {}` vacio
// es el truco estandar para que `declare global` funcione correctamente.
export {};
