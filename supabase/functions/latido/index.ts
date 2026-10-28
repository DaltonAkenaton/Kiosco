/**
 * ============================================================================
 *  LATIDO  (ARQUITECTURA.md 7, "heartbeat")
 * ============================================================================
 *
 *  Cada pocos minutos el kiosco dice "sigo vivo" y como esta:
 *
 *      { versionApp, camaraOk, pendientes, desfaseRelojMs }
 *
 *  Con eso el panel muestra la "ultima conexion" de cada kiosco y puede
 *  alertar de uno caido, de una camara desconectada o de un kiosco que
 *  acumula registros sin poder enviarlos.
 *
 *  La respuesta lleva `servidorAhoraMs` (como todas): de ahi saca el kiosco
 *  su desfase para la proxima vez.
 */

import { z } from 'npm:zod@4';
import {
  atender,
  clienteServidor,
  DATOS_INVALIDOS,
  identificarKiosco,
  leerJson,
  NO_AUTORIZADO,
  responder,
  REVOCADO,
} from '../_compartido/kiosco.ts';

const Esquema = z.strictObject({
  versionApp: z.string().max(40),
  camaraOk: z.boolean(),
  pendientes: z.number().int().nonnegative().max(1_000_000),
  // Un dia entero de desfase ya es "la pila del BIOS se murio"; mas no tiene sentido.
  desfaseRelojMs: z.number().int().min(-86_400_000 * 365).max(86_400_000 * 365).nullable(),
});

Deno.serve(
  atender(async (peticion) => {
    const bd = clienteServidor();
    const kiosco = await identificarKiosco(peticion, bd);
    if (!kiosco) return NO_AUTORIZADO();
    if (!kiosco.activo) return REVOCADO();

    const validacion = Esquema.safeParse(await leerJson(peticion));
    if (!validacion.success) return DATOS_INVALIDOS();
    const d = validacion.data;

    const { error } = await bd
      .from('dispositivos')
      .update({
        ultima_conexion: new Date().toISOString(),
        version_app: d.versionApp,
        camara_ok: d.camaraOk,
        pendientes: d.pendientes,
        desfase_reloj_ms: d.desfaseRelojMs,
      })
      .eq('id', kiosco.id);
    if (error) throw error;

    return responder(200, { ok: true, nombre: kiosco.nombre });
  }),
);
