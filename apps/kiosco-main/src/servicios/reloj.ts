/**
 * ============================================================================
 *  RELOJ Y DETECCION DE MANIPULACION
 * ============================================================================
 *
 *  CLAUDE.md seccion 6, y una de las partes mas interesantes del sistema.
 *
 *  EL PROBLEMA
 *  -----------
 *  El empleado tiene acceso fisico a la PC. Puede cambiar la hora de Windows,
 *  marcar entrada, y volver a ponerla bien. En el registro parecera que llego
 *  a las 6:00 cuando en realidad llego a las 8:30.
 *
 *  No lo podemos IMPEDIR (es su computadora durante esos segundos), pero SI
 *  lo podemos DETECTAR y dejar constancia.
 *
 *  LA IDEA
 *  -------
 *  Tenemos dos relojes distintos:
 *
 *    RELOJ DE PARED  (`Date.now()`)
 *      La hora de Windows. Dice "son las 6:02 del 19 de septiembre".
 *      Cualquiera con acceso al panel de control la puede cambiar.
 *
 *    RELOJ MONOTONICO  (`performance.now()`)
 *      Un cronometro que empieza en cero cuando arranca la app y SOLO AVANZA.
 *      No dice que hora es. No se puede cambiar desde Windows, porque cuenta
 *      tiempo transcurrido, no fechas.
 *
 *  Al arrancar guardamos los dos juntos. A partir de ahi, los dos deberian
 *  avanzar al mismo ritmo:
 *
 *      pasaron 10 minutos de cronometro  ->  deben haber pasado 10 de reloj
 *
 *  Si el cronometro dice que pasaron 10 minutos pero el reloj de pared dice
 *  que pasaron 3 horas, alguien movio la hora. Bandera `reloj_sospechoso`.
 *
 *  LO QUE NUNCA HACE
 *  -----------------
 *  Bloquear el registro. Las banderas son para que el jefe revise, no para
 *  impedir que alguien cheque (CLAUDE.md 6: "las banderas nunca bloquean").
 */

import { randomUUID } from 'node:crypto';
import { CONFIG, type BanderaMarca, type LecturasDeReloj } from '@kiosko/compartido';
import { umbralDeRelojMs } from '../configuracion-vigente';

/**
 * Identificador de ESTA sesion de la aplicacion.
 *
 * ¿Para que sirve? El cronometro monotonico se reinicia en cada arranque. Si
 * comparamos el monotonico de una marca de hoy con el de una marca de ayer,
 * el resultado no significa nada. El `arranqueId` permite saber cuales
 * lecturas son comparables entre si.
 */
const ARRANQUE_ID = randomUUID();

/**
 * El par de referencia, tomado al arrancar: "en este instante, el reloj de
 * pared decia X y el cronometro iba en Y".
 *
 * Todo lo demas se mide contra esto.
 */
const REFERENCIA = {
  paredMs: Date.now(),
  monotonicoMs: performance.now(),
};

/**
 * Desfase conocido contra el servidor, en milisegundos.
 *
 * Positivo = el reloj de esta PC va adelantado respecto al servidor.
 * Se recalcula en cada sincronizacion (bloque 6 del plan). Mientras no haya
 * nube, vale 0: no tenemos con quien compararnos.
 */
let desfaseServidorMs = 0;

export function establecerDesfaseServidor(ms: number): void {
  desfaseServidorMs = ms;
}

/**
 * Toma todas las lecturas de tiempo del momento exacto del evento.
 *
 * Se llama UNA vez, justo cuando se valida el PIN, y el resultado viaja con
 * la marca. No se vuelve a calcular despues: la hora del registro es la de
 * ese instante, no la de cuando se guardo en disco.
 */
export function leerReloj(): LecturasDeReloj {
  const horaDispositivoMs = Date.now();
  const monotonicoMs = performance.now();

  return {
    horaDispositivoMs,
    monotonicoMs,
    arranqueId: ARRANQUE_ID,
    desfaseServidorMs,
    // La mejor estimacion que tenemos: la hora del dispositivo corregida con
    // lo que sabemos que se desvia respecto al servidor.
    horaEstimadaMs: horaDispositivoMs - desfaseServidorMs,
  };
}

/**
 * Revisa si las lecturas huelen a manipulacion.
 *
 * Devuelve las banderas que correspondan. Arreglo vacio = todo normal.
 */
export function detectarAnomaliasDeReloj(
  lecturas: LecturasDeReloj,
  horaUltimaMarcaMs: number | null,
): BanderaMarca[] {
  const banderas: BanderaMarca[] = [];

  // --- 1. ¿Coinciden el reloj de pared y el cronometro? -------------------
  //
  // Desde el arranque deberian haber avanzado lo mismo.
  const avanceDePared = lecturas.horaDispositivoMs - REFERENCIA.paredMs;
  const avanceDeCronometro = lecturas.monotonicoMs - REFERENCIA.monotonicoMs;
  const discrepancia = Math.abs(avanceDePared - avanceDeCronometro);

  if (discrepancia > umbralDeRelojMs()) {
    banderas.push('reloj_sospechoso');
    console.warn(
      `[reloj] discrepancia de ${Math.round(discrepancia / 1000)} s entre el reloj ` +
        `de Windows y el cronometro interno`,
    );
  }

  // --- 2. ¿La marca es anterior a la ultima que ya teniamos? --------------
  //
  // El tiempo no va para atras. Si esta marca dice ser anterior a una que ya
  // esta guardada, o alguien movio el reloj hacia atras, o hay algo raro.
  //
  // (Ojo con el falso positivo: la noche que termina el horario de verano,
  // la hora local se repite. Por eso comparamos en UTC, que nunca retrocede,
  // y no en hora local.)
  if (horaUltimaMarcaMs !== null && lecturas.horaEstimadaMs < horaUltimaMarcaMs) {
    if (!banderas.includes('reloj_sospechoso')) banderas.push('reloj_sospechoso');
    console.warn('[reloj] la marca es anterior a la ultima registrada');
  }

  // --- 3. ¿La fecha es absurda? (CLAUDE.md 13.2) --------------------------
  //
  // El caso tipico NO es alguien haciendo trampa: es la pila del BIOS
  // agotada. Cuando muere, la PC arranca creyendo que es el ano 2009 o 1980.
  //
  // Se marca igual, porque una marca con fecha de 2009 hay que revisarla,
  // pero el diagnostico es distinto: no es trampa, es hardware.
  const ano = new Date(lecturas.horaEstimadaMs).getUTCFullYear();
  if (ano < ANO_MINIMO_RAZONABLE || ano > ANO_MAXIMO_RAZONABLE) {
    if (!banderas.includes('reloj_sospechoso')) banderas.push('reloj_sospechoso');
    console.error(
      `[reloj] FECHA ABSURDA: ano ${ano}. Revisa la pila del BIOS de esta computadora.`,
    );
  }

  return banderas;
}

/**
 * Limites de lo que consideramos una fecha creible.
 *
 * El minimo es el ano en que arranca el sistema: nada anterior tiene sentido.
 * El maximo da margen para que el kiosco viva anos sin que nadie lo toque
 * (recuerda: la facultad no tiene departamento de TI).
 *
 * Estan aqui y no en `configuracion.ts` porque no son algo que el cliente
 * vaya a querer ajustar: son un limite de cordura, no una regla de negocio.
 */
const ANO_MINIMO_RAZONABLE = 2025;
const ANO_MAXIMO_RAZONABLE = 2100;

/** El identificador de esta sesion, para guardarlo con cada marca. */
export function arranqueId(): string {
  return ARRANQUE_ID;
}
