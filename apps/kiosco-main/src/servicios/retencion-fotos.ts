/**
 * ============================================================================
 *  RETENCION DE FOTOS  (CLAUDE.md 5.1 y 12)
 * ============================================================================
 *
 *  Una foto de asistencia es un dato personal con UNA finalidad. Pasado el
 *  plazo (30 dias por defecto, configurable) ya no tiene razon para existir,
 *  y guardarla "por si acaso" es justo lo que la ley pide no hacer.
 *
 *  Excepcion: las marcadas "Conservar" por un administrador (casos en
 *  disputa) no se borran hasta que se les quite la marca.
 *
 *  Lo que se borra es el ARCHIVO. La marca, con su hash, se queda para
 *  siempre: el registro de asistencia no se borra nunca, y el hash sigue
 *  diciendo que en su momento hubo foto.
 *
 *  ---------------------------------------------------------------------------
 *  EL RIESGO: adelantar el reloj para borrar evidencia
 *  ---------------------------------------------------------------------------
 *  Si "vencida" se midiera solo con la hora de Windows, bastaria con
 *  adelantarla 31 dias y reiniciar la app para que se borraran las fotos de
 *  este mes. Por eso el "ahora" que se usa es el MENOR entre la hora de
 *  Windows y la de la ultima marca registrada: adelantar el reloj no basta,
 *  hay que registrar ademas una marca con la hora falsa, y esa marca queda
 *  en la nube con su hora de recepcion delatandola.
 *
 *  El costo, dicho claro: si el kiosco pasa dos semanas sin marcas
 *  (vacaciones), las fotos vencidas se borran hasta que vuelva a haber
 *  marcas. Se prefiere un retraso de dias en borrar a una puerta para
 *  destruir evidencia.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '@kiosko/compartido';
import { baseDeDatos } from '../datos/base-de-datos';
import { registrarEvento } from '../datos/repositorio-eventos';
import {
  fotosVencidas,
  marcarComoEliminada,
  marcasConFotoHeredada,
  registrarFotoHeredada,
} from '../datos/repositorio-fotos';
import { horaDeLaUltimaMarca } from '../datos/repositorio-marcas';
import { carpetaDeDatos } from '../entorno';
import { borrarArchivoDeFoto, guardarBytesDeFoto } from './fotos';
import { detectarAnomaliasDeReloj, leerReloj } from './reloj';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * El plazo vigente, en dias.
 *
 * Primero el de la tabla `configuracion` (baja con la sincronizacion a
 * `configuracion_cache`); si nunca ha llegado o no es un numero sensato, el
 * de respaldo de configuracion.ts. Un valor absurdo (0, negativo, texto)
 * NUNCA se obedece: con 0 se borraria todo al instante.
 */
export function diasDeRetencion(): number {
  try {
    const fila = baseDeDatos()
      .prepare("SELECT valor FROM configuracion_cache WHERE clave = 'dias_retencion_fotos'")
      .get() as { valor: string } | undefined;
    if (fila) {
      const dias = Number(JSON.parse(fila.valor));
      if (Number.isInteger(dias) && dias >= 1) return dias;
      console.warn('[retencion] dias_retencion_fotos invalido en la configuracion; se usa el de respaldo');
    }
  } catch {
    // Configuracion ilegible: se usa el respaldo.
  }
  return CONFIG.fotos.diasRetencionPorDefecto;
}

/**
 * Borra las fotos vencidas. Devuelve cuantas borro.
 *
 * @param ahoraMs solo para pruebas; en la app es la hora actual
 */
export function depurarFotosVencidas(ahoraMs: number = Date.now()): number {
  // Con el reloj en duda no se borra nada: se reintenta en la siguiente vuelta.
  if (detectarAnomaliasDeReloj(leerReloj(), null).length > 0) {
    console.warn('[retencion] reloj sospechoso: no se borra ninguna foto esta vez');
    return 0;
  }

  const ultimaMarca = horaDeLaUltimaMarca();
  if (ultimaMarca === null) return 0;

  const referencia = Math.min(ahoraMs, ultimaMarca);
  const limite = referencia - diasDeRetencion() * MS_POR_DIA;

  let borradas = 0;
  for (const foto of fotosVencidas(limite)) {
    // Solo se anota como eliminada si de verdad ya no esta en disco. Si el
    // borrado fallo (archivo en uso), se intenta en la siguiente vuelta.
    if (borrarArchivoDeFoto(foto.rutaRelativa)) {
      marcarComoEliminada(foto.marcaId);
      borradas++;
    }
  }

  if (borradas > 0) {
    console.info(`[retencion] ${borradas} foto(s) borradas por antiguedad`);
    registrarEvento('fotos_depuradas', { cantidad: borradas, diasRetencion: diasDeRetencion() });
  }
  return borradas;
}

/**
 * Cifra las fotos que versiones anteriores dejaron en claro, y vacia la
 * carpeta vieja. Se corre al arrancar; cuando ya no hay nada, no hace nada.
 *
 * Una foto suelta en esa carpeta que no pertenece a ninguna marca (la marca
 * fallo despues de escribir la foto) se BORRA: es un dato personal sin
 * registro que lo justifique.
 */
export function migrarFotosHeredadas(): { cifradas: number; huerfanasBorradas: number } {
  let cifradas = 0;
  let huerfanasBorradas = 0;

  for (const heredada of marcasConFotoHeredada()) {
    let jpeg: Buffer;
    try {
      jpeg = fs.readFileSync(heredada.rutaAbsoluta);
    } catch {
      continue; // el archivo ya no esta: no hay nada que cifrar
    }

    const foto = guardarBytesDeFoto(heredada.marcaId, jpeg, heredada.horaMs);
    if (!foto) continue; // sin cifrado disponible: se reintenta en otro arranque

    registrarFotoHeredada(heredada.marcaId, foto);
    // La copia en claro se borra SOLO despues de que la cifrada quedo
    // registrada. Al reves, un corte de luz a la mitad perderia la foto.
    fs.rmSync(heredada.rutaAbsoluta, { force: true });
    cifradas++;
  }

  const carpetaVieja = path.join(carpetaDeDatos(), CONFIG.almacenamiento.carpetaFotosHeredada);
  if (fs.existsSync(carpetaVieja)) {
    // Solo las que ya no esperan cifrarse: si el cifrado fallo arriba, su
    // marca sigue en la lista de heredadas y su archivo NO es huerfano.
    const pendientes = new Set(
      marcasConFotoHeredada().map((h) => path.basename(h.rutaAbsoluta)),
    );
    for (const nombre of fs.readdirSync(carpetaVieja)) {
      if (nombre.endsWith('.jpg') && !pendientes.has(nombre)) {
        fs.rmSync(path.join(carpetaVieja, nombre), { force: true });
        huerfanasBorradas++;
      }
    }
    if (fs.readdirSync(carpetaVieja).length === 0) fs.rmdirSync(carpetaVieja);
  }

  if (cifradas > 0 || huerfanasBorradas > 0) {
    console.info(`[fotos] heredadas: ${cifradas} cifradas, ${huerfanasBorradas} huerfanas borradas`);
    registrarEvento('fotos_heredadas_cifradas', { cifradas, huerfanasBorradas });
  }
  return { cifradas, huerfanasBorradas };
}

/**
 * Deja corriendo la depuracion: una vez poco despues de arrancar y luego
 * cada N horas.
 *
 * La primera vuelta se retrasa a proposito (ver
 * `segundosAntesDeLaPrimeraDepuracion`).
 */
export function programarDepuracionDeFotos(): void {
  const vuelta = (): void => {
    try {
      depurarFotosVencidas();
    } catch (fallo) {
      // Que falle el borrado nunca debe tumbar el kiosco.
      console.error('[retencion] fallo la depuracion de fotos:', fallo);
    }
  };

  setTimeout(vuelta, CONFIG.fotos.segundosAntesDeLaPrimeraDepuracion * 1000).unref();
  setInterval(vuelta, CONFIG.fotos.horasEntreDepuraciones * 60 * 60 * 1000).unref();
}
