/**
 * ============================================================================
 *  CONFIGURACION VIGENTE  (la que manda AHORA MISMO)
 * ============================================================================
 *
 *  ¿Por que existe este archivo si ya hay `configuracion.ts`?
 *  ----------------------------------------------------------
 *  Porque son dos cosas distintas:
 *
 *    `packages/compartido/src/configuracion.ts`
 *        Los valores POR DEFECTO, compilados dentro del programa.
 *        No cambian mientras la app corre.
 *
 *    este archivo
 *        Los valores EFECTIVOS en este momento, que pueden venir de:
 *          - los valores por defecto (al arrancar),
 *          - la tabla `configuracion` de Supabase (bloque 6 del plan),
 *          - un cambio en caliente durante el desarrollo.
 *
 *  ---------------------------------------------------------------------------
 *  La leccion que hay detras de esto
 *  ---------------------------------------------------------------------------
 *  La primera version del validador armaba el esquema de zod UNA sola vez, al
 *  cargar el archivo:
 *
 *      export const EsquemaIdentificacion = z.strictObject({ ... });
 *
 *  Eso funciona... hasta que la configuracion cambia mientras el programa
 *  corre. Entonces el validador sigue usando la regla vieja y rechaza datos
 *  perfectamente validos, sin que nadie entienda por que.
 *
 *  Y eso NO es hipotetico: la tabla `configuracion` de Supabase va a cambiar
 *  valores en caliente cuando exista la sincronizacion. Un validador congelado
 *  al arrancar seria un bug esperando su turno.
 *
 *  Por eso el esquema se arma EN CADA PETICION, leyendo de aqui.
 *  Cuesta microsegundos y elimina toda una familia de errores.
 */

import { app } from 'electron';
import { CONFIG } from '@kiosko/compartido';

/** Los tres modos posibles de identificacion. */
export type ModoIdentificacion = 'usuario' | 'lista' | 'numero';

/**
 * El estado mutable. Arranca con los valores por defecto.
 *
 * Es el UNICO lugar del proceso principal donde hay configuracion que cambia.
 * Todo lo demas lee de aqui, nunca guarda su propia copia — si cada modulo
 * guardara la suya, unas quedarian actualizadas y otras no.
 */
const vigente = {
  modoIdentificacion: CONFIG.identificacion.modo as ModoIdentificacion,
};

/** Lee el modo de identificacion que manda ahora mismo. */
export function modoIdentificacionVigente(): ModoIdentificacion {
  return vigente.modoIdentificacion;
}

/**
 * Cambia el modo de identificacion.
 *
 * SOLO FUNCIONA EN DESARROLLO.
 *
 * ¿Por que ese candado? Porque este canal llega desde la pantalla, y la
 * pantalla es la parte menos confiable del sistema (ver capitulo 03 del
 * curso). Si en produccion alguien lograra invocarlo, podria poner el kiosco
 * en modo 'lista' y dejar los nombres de todo el personal a la vista.
 *
 * En el kiosco real, el modo se cambia desde el panel del jefe y baja por
 * sincronizacion — nunca desde la pantalla que tiene enfrente el empleado.
 *
 * Devuelve `true` si el cambio se aplico.
 */
export function cambiarModoIdentificacion(modo: ModoIdentificacion): boolean {
  if (app.isPackaged) {
    console.warn('[config] Intento de cambiar el modo en produccion: RECHAZADO');
    return false;
  }

  vigente.modoIdentificacion = modo;
  console.info(`[config] modo de identificacion -> ${modo}`);
  return true;
}
