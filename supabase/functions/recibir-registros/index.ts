/**
 * ============================================================================
 *  RECIBIR REGISTROS  (CLAUDE.md 7, "push")
 * ============================================================================
 *
 *  El kiosco manda lo que tiene en su bandeja de salida, tal cual lo guardo:
 *
 *      { marcas: [...], eventos: [...], accesosFoto: [...], estadosDeFoto: [...] }
 *
 *  y recibe que se acepto y que no:
 *
 *      { aceptados: [uuid...], rechazados: [{ id, motivo }...] }
 *
 *  "Aceptado" incluye "ya lo tenia": el kiosco reintenta tras un corte y eso
 *  no debe duplicar nada (idempotencia por UUID, CLAUDE.md 7). Con esa
 *  respuesta el kiosco marca cada renglon de su bandeja como enviado, o
 *  anota por que se rechazo.
 *
 *  Aqui se valida la FORMA de cada cosa (zod) y QUIEN la manda (el token).
 *  Guardar lo hace la funcion `recibir_registros` de la base, en una sola
 *  llamada: ahi viven las reglas de idempotencia y de kiosco revocado
 *  (ver migracion 0014).
 *
 *  KIOSCO REVOCADO: a diferencia de las demas funciones, esta SI lo atiende.
 *  Lo que registro antes de la baja entra en cuarentena; nunca se descarta
 *  en silencio (CLAUDE.md 3.3).
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
} from '../_compartido/kiosco.ts';

/** Tope por tipo en un solo lote. El kiosco manda en tandas si tiene mas. */
const MAXIMO_POR_TIPO = 500;

// Las lecturas de reloj de cada marca y evento (compartido/tipos.ts,
// LecturasDeReloj). Se piden todas: sin ellas no se puede detectar un reloj
// movido (CLAUDE.md 6).
const Reloj = z.object({
  horaDispositivoMs: z.number().int().nonnegative(),
  horaEstimadaMs: z.number().int().nonnegative(),
  monotonicoMs: z.number().nonnegative(),
  arranqueId: z.uuid(),
  desfaseServidorMs: z.number().int(),
});

const Marca = z.object({
  id: z.uuid(),
  empleadoId: z.uuid(),
  tipo: z.enum(['entrada', 'salida']),
  reloj: Reloj,
  banderas: z.array(z.enum(['sin_camara', 'foto_obstruida', 'reloj_sospechoso'])).max(10),
  fotoHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  // El kiosco manda tambien `usuario` y `origen`. No se usan: el origen de
  // lo que llega por aqui es SIEMPRE 'kiosco', y el usuario se sabe por el id.
});

const Evento = z.object({
  id: z.uuid(),
  tipo: z.string().max(60),
  detalle: z.record(z.string(), z.unknown()),
  reloj: Reloj,
});

const AccesoFoto = z.object({
  id: z.uuid(),
  marcaId: z.uuid(),
  adminId: z.uuid(),
  accion: z.enum(['ver', 'exportar', 'conservar', 'quitar_conservar']),
  consultadoEn: z.iso.datetime(),
});

const EstadoDeFoto = z.object({
  id: z.uuid(),
  marcaId: z.uuid(),
  estado: z.enum(['con_foto', 'eliminada_por_antiguedad', 'conservada', 'faltante', 'alterada']),
});

const Lote = z.object({
  marcas: z.array(Marca).max(MAXIMO_POR_TIPO).default([]),
  eventos: z.array(Evento).max(MAXIMO_POR_TIPO).default([]),
  accesosFoto: z.array(AccesoFoto).max(MAXIMO_POR_TIPO).default([]),
  estadosDeFoto: z.array(EstadoDeFoto).max(MAXIMO_POR_TIPO).default([]),
});

Deno.serve(
  atender(async (peticion) => {
    const bd = clienteServidor();
    const kiosco = await identificarKiosco(peticion, bd);
    if (!kiosco) return NO_AUTORIZADO();

    const validacion = Lote.safeParse(await leerJson(peticion));
    if (!validacion.success) {
      // Que campo fallo, sin el valor: el valor podria ser un dato personal.
      const problema = validacion.error.issues[0];
      return DATOS_INVALIDOS(problema ? `Campo invalido: ${problema.path.join('.')}` : undefined);
    }

    const { data, error } = await bd.rpc('recibir_registros', {
      p_dispositivo_id: kiosco.id,
      p_revocado_en: kiosco.revocadoEn,
      p_lote: validacion.data,
    });
    if (error) throw error;

    const resultado = data as { aceptados: string[]; rechazados: { id: string; motivo: string }[] };
    console.info(
      `[recibir] ${kiosco.id}: ${resultado.aceptados.length} aceptados, ${resultado.rechazados.length} rechazados`,
    );
    return responder(200, { ...resultado, dispositivoRevocado: !kiosco.activo });
  }),
);
