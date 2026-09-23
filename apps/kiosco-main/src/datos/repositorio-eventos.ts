/**
 * ============================================================================
 *  EVENTOS DEL DISPOSITIVO
 * ============================================================================
 *
 *  Cosas que le pasan al kiosco y que NO son marcas de asistencia: la camara
 *  se desconecto, alguien pauso la pantalla, el reloj dio un salto raro.
 *
 *  ¿POR QUE IMPORTAN?
 *  ------------------
 *  Porque son la mitad que explica a la otra. Una marca dice "Rosa entro a las
 *  06:02". Un evento dice "la camara llevaba dos horas desconectada", y de
 *  pronto la marca sin foto de Rosa deja de ser sospechosa y pasa a ser una
 *  consecuencia esperable.
 *
 *  El caso que hizo falta primero fue la pausa: con el kiosco minimizado
 *  NADIE PUEDE CHECAR. Sin constancia, eso es un hueco inexplicable en la
 *  asistencia de la manana. Con constancia, el jefe puede ver que la pantalla
 *  estuvo abajo de 10:15 a 10:32 y entender por que falta un registro.
 *
 *  ---------------------------------------------------------------------------
 *  DONDE SE GUARDAN
 *  ---------------------------------------------------------------------------
 *  En la misma bandeja de salida (`outbox`) que las marcas, con
 *  `tipo_registro = 'evento'`. La tabla ya venia preparada para esto desde el
 *  bloque 2.
 *
 *  Compartir la bandeja no es pereza: es lo que hace que un evento herede
 *  gratis todo lo que ya se resolvio para las marcas — sobrevive sin internet,
 *  se reintenta con espera creciente, y llega al servidor con su id propio,
 *  asi que reenviarlo dos veces no lo duplica.
 *
 *  En el servidor aterrizaran en la tabla `eventos_dispositivo` (CLAUDE.md 8),
 *  que se construye en el bloque 4.
 */

import { randomUUID } from 'node:crypto';
import { baseDeDatos } from './base-de-datos';
import { leerReloj } from '../servicios/reloj';

/**
 * Los tipos de evento que el kiosco sabe reportar.
 *
 * Es una lista cerrada, no texto libre: asi el panel puede traducir cada uno a
 * un mensaje entendible y nadie inventa un tipo nuevo que despues nadie sepa
 * interpretar.
 */
export type TipoDeEvento =
  /** Alguien minimizo el kiosco para usar la computadora. */
  | 'kiosco_pausado'
  /** El kiosco volvio: por el temporizador o porque alguien lo restauro. */
  | 'kiosco_reanudado'
  /** La camara dejo de responder. */
  | 'camara_desconectada'
  /** La camara volvio. */
  | 'camara_reconectada'
  /** Primera llave de cifrado de fotos de este kiosco (servicios/llave-fotos.ts). */
  | 'llave_fotos_creada'
  /** Windows ya no abria la llave (otra PC u otro perfil): se aparto y se creo otra. */
  | 'llave_fotos_reemplazada'
  /** Se definio o cambio la contrasena de recuperacion de la llave. */
  | 'recuperacion_fotos_definida'
  /** Windows no ofrece cifrado: las marcas se guardan, las fotos no. */
  | 'cifrado_no_disponible'
  /** Se borraron fotos por haber pasado el plazo de retencion. */
  | 'fotos_depuradas'
  /** Se cifraron fotos que versiones anteriores dejaron sin cifrar. */
  | 'fotos_heredadas_cifradas'
  /** Un administrador entro al modo administrador del kiosco. */
  | 'modo_admin_abierto'
  /** Alguien intento entrar al modo administrador y fallo. */
  | 'modo_admin_intento_fallido'
  /** Muchos fallos seguidos: hay que esperar antes del siguiente intento. */
  | 'modo_admin_bloqueado';

/**
 * Deja constancia de un evento.
 *
 * NUNCA lanza excepcion. Un evento es informacion de apoyo: si no se pudiera
 * guardar, lo correcto es que el kiosco siga funcionando igual, no que se
 * caiga por no haber podido anotar algo.
 *
 * `detalle` es libre (un objeto que se guarda como JSON) porque cada tipo de
 * evento necesita cosas distintas: la pausa guarda cuantos minutos, la camara
 * guarda el mensaje de error. Lo unico prohibido es meter aqui datos
 * personales: nombres, PINes o fotos (CLAUDE.md 16).
 */
export function registrarEvento(
  tipo: TipoDeEvento,
  detalle: Record<string, unknown> = {},
): void {
  try {
    const id = randomUUID();
    const reloj = leerReloj();
    const ahoraIso = new Date().toISOString();

    const paquete = JSON.stringify({
      id,
      tipo,
      detalle,
      // Las mismas lecturas de reloj que llevan las marcas. Sin ellas, un
      // evento con hora movida seria indistinguible de uno normal.
      reloj,
    });

    baseDeDatos()
      .prepare(
        `INSERT INTO outbox (id, tipo_registro, payload, intentos, creado_en)
         VALUES (?, 'evento', ?, 0, ?)`,
      )
      .run(id, paquete, ahoraIso);

    console.info(`[eventos] ${tipo}`);
  } catch (fallo) {
    console.warn(`[eventos] no se pudo registrar ${tipo}`, fallo);
  }
}

/** Cuantos eventos esperan subir. Existe para las pruebas y el diagnostico. */
export function contarEventosPendientes(): number {
  const fila = baseDeDatos()
    .prepare(
      `SELECT COUNT(*) AS total FROM outbox
       WHERE sincronizado_en IS NULL AND tipo_registro = 'evento'`,
    )
    .get() as { total: number };

  return fila.total;
}

/** Los eventos que faltan por subir, para el sincronizador del bloque 6. */
export function eventosPendientes(limite: number): { id: string; payload: string }[] {
  return baseDeDatos()
    .prepare(
      `SELECT id, payload FROM outbox
       WHERE sincronizado_en IS NULL AND tipo_registro = 'evento'
       ORDER BY creado_en
       LIMIT ?`,
    )
    .all(limite) as { id: string; payload: string }[];
}
