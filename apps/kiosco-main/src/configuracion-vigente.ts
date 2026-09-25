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
import { baseDeDatos } from './datos/base-de-datos';

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
 * ============================================================================
 *  REGLAS QUE DECIDE EL JEFE  (tabla `configuracion` de Supabase)
 * ============================================================================
 *
 *  Bajan con la sincronizacion a `configuracion_cache` (como JSON: '4',
 *  '"America/Matamoros"'). Aqui se leen EN CADA USO, para que un cambio en el
 *  panel se note en el siguiente registro sin reiniciar nada (CLAUDE.md 1.3).
 *
 *  Un valor que no llego, o que llego absurdo (texto, negativo, fuera de
 *  rango), NUNCA se obedece: se usa el respaldo de configuracion.ts. Con un
 *  "0 intentos" mal escrito en el panel, nadie podria checar.
 */
export function numeroConfigurado(
  clave: string,
  respaldo: number,
  rango: { minimo: number; maximo: number },
): number {
  try {
    const fila = baseDeDatos().prepare('SELECT valor FROM configuracion_cache WHERE clave = ?').get(clave) as
      | { valor: string }
      | undefined;
    if (!fila) return respaldo;
    const valor = Number(JSON.parse(fila.valor));
    if (Number.isFinite(valor) && valor >= rango.minimo && valor <= rango.maximo) return valor;
    console.warn(`[config] ${clave} fuera de rango en la configuracion; se usa ${respaldo}`);
  } catch {
    // Base cerrada o valor ilegible: el respaldo.
  }
  return respaldo;
}

/** Las reglas del PIN vigentes (CLAUDE.md 3.4). */
export function reglasDelPin(): { intentosMaximos: number; segundosDeBloqueo: number; minutosParaOlvidar: number } {
  return {
    intentosMaximos: numeroConfigurado('intentos_pin_maximos', CONFIG.seguridadPin.intentosFallidosMaximos, {
      minimo: 2,
      maximo: 20,
    }),
    segundosDeBloqueo: numeroConfigurado('segundos_bloqueo_pin', CONFIG.seguridadPin.segundosDeBloqueo, {
      minimo: 10,
      maximo: 3600,
    }),
    minutosParaOlvidar: numeroConfigurado('minutos_olvidar_intentos', CONFIG.seguridadPin.minutosParaOlvidarIntentos, {
      minimo: 1,
      maximo: 24 * 60,
    }),
  };
}

/** Umbrales de la camara tapada (CLAUDE.md 5). */
export function umbralesDeCamara(): { brilloMinimo: number; varianzaMinima: number } {
  return {
    brilloMinimo: numeroConfigurado('umbral_brillo_minimo', CONFIG.camara.umbralBrilloMinimo, { minimo: 0, maximo: 255 }),
    varianzaMinima: numeroConfigurado('umbral_varianza_minima', CONFIG.camara.umbralVarianzaMinima, {
      minimo: 0,
      maximo: 100_000,
    }),
  };
}

/** Cuanto pueden separarse reloj y cronometro antes de sospechar (CLAUDE.md 6). */
export function umbralDeRelojMs(): number {
  return numeroConfigurado('umbral_desfase_reloj_ms', CONFIG.reloj.umbralDesfaseSospechosoMs, {
    minimo: 5_000,
    maximo: 24 * 60 * 60 * 1000,
  });
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

/**
 * La zona horaria que manda (CLAUDE.md 6): la de la tabla `configuracion`
 * si llego y Windows/Node la conoce; si no, la de configuracion.ts.
 *
 * Se valida pidiendole a `Intl` que la use: una zona mal escrita en el panel
 * ("America/Matamros") lanzaria error al mostrar CADA hora. Aqui se descarta
 * una vez y se sigue con la de respaldo.
 */
export function zonaHorariaVigente(): string {
  const respaldo = CONFIG.reloj.zonaHorariaPorDefecto;
  try {
    const fila = baseDeDatos().prepare('SELECT valor FROM configuracion_cache WHERE clave = ?').get('zona_horaria') as
      | { valor: string }
      | undefined;
    if (!fila) return respaldo;
    const zona = JSON.parse(fila.valor);
    if (typeof zona !== 'string' || zona === '') return respaldo;
    new Intl.DateTimeFormat('es-MX', { timeZone: zona });
    return zona;
  } catch {
    return respaldo;
  }
}
