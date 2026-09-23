/**
 * Punto de entrada del paquete compartido.
 *
 * Un archivo "index" existe para que el resto del proyecto escriba:
 *     import { CONFIG, type TipoMarca } from '@kiosko/compartido';
 * en vez de tener que acordarse de en cual archivo estaba cada cosa.
 *
 * `export *` = "re-exporta todo lo que ese archivo exporta".
 */
export * from './configuracion';
export * from './tema';
export * from './tipos';
export * from './usuarios';
export * from './contrato-ipc';
