/**
 * ============================================================================
 *  ENROLAR KIOSCO  (ARQUITECTURA.md 3.3)
 * ============================================================================
 *
 *  Un kiosco recien instalado presenta el codigo de 8 caracteres que el jefe
 *  genero en el panel, y recibe a cambio su token: el "gafete" con el que se
 *  identificara de aqui en adelante.
 *
 *      kiosco:  { codigo: "K7M4-QX2P", versionApp: "0.1.0" }
 *      aqui:    hash del codigo -> canjear en la base -> token nuevo
 *      kiosco:  { dispositivoId, nombre, ubicacion, token }
 *
 *  El token sale UNA vez, en esta respuesta. En la base solo queda su hash.
 *  El kiosco lo guarda cifrado con DPAPI de Windows.
 *
 *  Codigo inexistente, usado o vencido: la misma respuesta para los tres.
 *  Decir cual fue le sirve a quien esta probando codigos, no a quien instala.
 */

import { z } from 'npm:zod@4';
import {
  atender,
  clienteServidor,
  DATOS_INVALIDOS,
  leerJson,
  responder,
  sha256Hex,
  tokenNuevo,
} from '../_compartido/kiosco.ts';

const Esquema = z.strictObject({
  // Se aceptan guiones y espacios ("K7M4-QX2P", "k7m4 qx2p"): asi lo dicta o
  // lo anota la gente. Se quitan antes de comparar.
  codigo: z.string().max(20),
  versionApp: z.string().max(40),
});

/** "k7m4-qx2p " -> "K7M4QX2P" */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

Deno.serve(
  atender(async (peticion) => {
    const validacion = Esquema.safeParse(await leerJson(peticion));
    if (!validacion.success) return DATOS_INVALIDOS();

    const codigo = normalizarCodigo(validacion.data.codigo);
    if (codigo.length !== 8) return DATOS_INVALIDOS('El codigo debe tener 8 caracteres.');

    const bd = clienteServidor();

    // Freno a quien prueba codigos al azar (migracion 0017). Se cuenta por
    // origen: la IP que ve el servidor, o "desconocido" si no llega.
    const origen = (peticion.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'desconocido';
    const permitido = await bd.rpc('enrolamiento_permitido', { p_origen: origen });
    if (permitido.error) throw permitido.error;
    if (permitido.data !== true) {
      return responder(429, {
        error: 'demasiados_intentos',
        mensaje: 'Demasiados codigos equivocados. Espera una hora o pide ayuda a quien administra el sistema.',
      });
    }

    const token = tokenNuevo();
    const { data, error } = await bd.rpc('canjear_codigo_enrolamiento', {
      p_codigo_hash: await sha256Hex(codigo),
      p_token_hash: await sha256Hex(token),
      p_version_app: validacion.data.versionApp,
    });
    if (error) throw error;

    const dispositivo = Array.isArray(data) ? data[0] : null;
    const anotado = await bd.rpc('anotar_intento_enrolamiento', { p_origen: origen, p_exitoso: !!dispositivo });
    if (anotado.error) throw anotado.error;
    if (!dispositivo) {
      return responder(400, {
        error: 'codigo_invalido',
        mensaje: 'Ese codigo no sirve: puede estar mal escrito, ya se uso o ya vencio. Pide uno nuevo en el panel.',
      });
    }

    // Ni el token ni el codigo van al log (ARQUITECTURA.md 14).
    console.info(`[enrolar] kiosco dado de alta: ${dispositivo.dispositivo_id}`);
    return responder(200, {
      dispositivoId: dispositivo.dispositivo_id,
      nombre: dispositivo.nombre,
      ubicacion: dispositivo.ubicacion,
      token,
    });
  }),
);
