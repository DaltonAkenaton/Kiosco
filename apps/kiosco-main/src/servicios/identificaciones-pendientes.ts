/**
 * ============================================================================
 *  IDENTIFICACIONES PENDIENTES  (el "pase" entre teclear el PIN y confirmar)
 * ============================================================================
 *
 *  EL PROBLEMA QUE RESUELVE
 *  ------------------------
 *  Hasta el bloque 2, el kiosco hacia esto:
 *
 *      1. el empleado teclea su PIN
 *      2. la pantalla llama a `identificar` y recibe el `empleadoId`
 *      3. la pantalla llama a `registrarMarca({empleadoId, tipo, foto})`
 *
 *  Funciona, y tiene dos agujeros de distinto tamano.
 *
 *  AGUJERO 1 (seguridad).
 *  En el paso 3 la pantalla dice A NOMBRE DE QUIEN se registra la marca. Pero
 *  la pantalla es la parte NO confiable del sistema (ver contrato-ipc.ts). El
 *  paso 2 podia simplemente saltarse:
 *
 *      window.kiosco.registrarMarca({ empleadoId: '<el id de otro>', ... })
 *
 *  y quedaba registrada la entrada de otra persona sin saber su PIN. El
 *  proceso principal comprobaba que el empleado EXISTIERA, que no es lo mismo
 *  que comprobar que ACABE DE IDENTIFICARSE.
 *
 *  AGUJERO 2 (la hora).
 *  CLAUDE.md 4.3 pide que el timestamp sea el del instante de la validacion.
 *  Con la pantalla de confirmacion del bloque 3, entre validar y guardar
 *  pasan hasta 3 segundos (mas si el empleado se queda pensando). Si el
 *  reloj se leyera al guardar, la hora registrada seria la de cuando la
 *  persona termino de leer, no la de cuando llego.
 *
 *  LA SOLUCION: UN PASE DE UN SOLO USO
 *  -----------------------------------
 *  Al validar el PIN, el proceso principal se queda con todo lo importante
 *  —quien es, la hora exacta, las lecturas de reloj— y le entrega a la
 *  pantalla nada mas un texto aleatorio:
 *
 *      identificar()  ->  "a3f9c1..."   (32 bytes al azar)
 *
 *  La pantalla ensena la confirmacion y, si el empleado acepta, devuelve ese
 *  texto. El proceso principal lo canjea por los datos guardados y borra el
 *  pase. Para tener un pase valido hay que haber pasado por el PIN, y cada
 *  pase sirve exactamente una vez.
 *
 *  Es el mismo patron de los boletos de guardarropa: el numerito no dice
 *  nada de quien eres ni de que dejaste; solo sirve para que quien SI lo
 *  sabe te lo devuelva.
 *
 *  ¿POR QUE EN MEMORIA Y NO EN LA BASE DE DATOS?
 *  --------------------------------------------
 *  Porque un pase vive 60 segundos y no debe sobrevivir a nada. Si se va la
 *  luz a media confirmacion, lo correcto es que el pase desaparezca: el
 *  empleado vuelve a teclear su PIN. Guardarlo en disco solo lograria que
 *  quedaran pases viejos esperando a que alguien los use.
 */

import { randomBytes } from 'node:crypto';
import { CONFIG, type LecturasDeReloj, type TipoMarca } from '@kiosko/compartido';

/** Todo lo que el proceso principal recuerda mientras el empleado confirma. */
export interface IdentificacionPendiente {
  empleadoId: string;
  usuario: string;
  nombreParaMostrar: string;
  /** La accion que el sistema sugirio. Se guarda para poder compararla. */
  accionSugerida: TipoMarca;
  /**
   * Las lecturas de reloj DEL INSTANTE DE LA VALIDACION.
   *
   * Este es el campo por el que existe todo este archivo. No se vuelve a
   * leer el reloj al guardar la marca: se usa este.
   */
  reloj: LecturasDeReloj;
  /** Momento (en ms del reloj monotonico) despues del cual el pase ya no vale. */
  caducaEnMonotonicoMs: number;
}

/**
 * Los pases vivos, guardados por su texto aleatorio.
 *
 * En un kiosco con ~5 empleados casi siempre habra 0 o 1. El Map existe para
 * el caso raro de dos personas identificandose con segundos de diferencia
 * (por ejemplo, si alguien deja su confirmacion abierta y el siguiente
 * empieza), no porque se esperen multitudes.
 */
const pases = new Map<string, IdentificacionPendiente>();

/**
 * La caducidad se mide con el reloj MONOTONICO, no con `Date.now()`.
 *
 * Es el mismo razonamiento de `servicios/reloj.ts`: si alguien mueve la hora
 * de Windows hacia adelante, con `Date.now()` todos los pases vivos caducarian
 * de golpe; si la mueve hacia atras, durarian horas. El cronometro interno no
 * se puede tocar, y para medir "cuanto ha pasado" es lo correcto.
 */
function ahoraMonotonicoMs(): number {
  return performance.now();
}

/** Borra los pases que ya caducaron. Barato: la lista casi siempre esta vacia. */
function limpiarCaducados(): void {
  const ahora = ahoraMonotonicoMs();
  for (const [token, pase] of pases) {
    if (pase.caducaEnMonotonicoMs <= ahora) pases.delete(token);
  }
}

/**
 * Crea un pase y devuelve su texto aleatorio.
 *
 * 32 bytes al azar (64 caracteres en hexadecimal). Es muchisimo mas de lo
 * necesario, pero un token corto es de las cosas que nadie revisa despues:
 * mas vale que nazca sobrado.
 *
 * `randomBytes` es el generador CRIPTOGRAFICO de Node, no `Math.random()`.
 * `Math.random()` es predecible: viendo unos cuantos resultados se puede
 * calcular el siguiente, y aqui eso equivaldria a adivinar pases ajenos.
 */
export function crearPase(
  datos: Omit<IdentificacionPendiente, 'caducaEnMonotonicoMs'>,
): string {
  limpiarCaducados();

  const token = randomBytes(32).toString('hex');
  const vidaMs = CONFIG.seguridadPin.segundosDeVidaDeLaIdentificacion * 1000;

  pases.set(token, { ...datos, caducaEnMonotonicoMs: ahoraMonotonicoMs() + vidaMs });

  return token;
}

/**
 * Canjea un pase: devuelve sus datos y lo BORRA.
 *
 * Devuelve `null` si el pase no existe, ya se uso o caduco. Los tres casos se
 * tratan igual a proposito: la pantalla no tiene por que enterarse de la
 * diferencia, y un mensaje distinto por caso solo le diria a quien lo este
 * probando cual de sus intentos estuvo mas cerca.
 *
 * El borrado ocurre ANTES de guardar la marca, y eso es deliberado: si dos
 * mensajes llegaran casi a la vez (un doble clic, un reintento de la
 * pantalla), el segundo se encuentra el pase ya gastado y no duplica el
 * registro. Es la misma idea de idempotencia que usara la sincronizacion.
 */
export function canjearPase(token: string): IdentificacionPendiente | null {
  const pase = pases.get(token);
  if (!pase) return null;

  pases.delete(token);

  if (pase.caducaEnMonotonicoMs <= ahoraMonotonicoMs()) return null;

  return pase;
}

/**
 * Tira un pase sin usarlo: el empleado cancelo la confirmacion.
 *
 * No es obligatorio llamarlo (el pase caducaria solo en 60 segundos), pero
 * cancelar y que el pase siga vivo es justo el tipo de cabo suelto que
 * despues cuesta explicar.
 */
export function descartarPase(token: string): void {
  pases.delete(token);
}

/** Cuantos pases hay vivos. Existe para las pruebas y para diagnostico. */
export function pasesVivos(): number {
  limpiarCaducados();
  return pases.size;
}
