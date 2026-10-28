/**
 * ============================================================================
 *  LO COMUN A TODAS LAS EDGE FUNCTIONS DEL KIOSCO
 * ============================================================================
 *
 *  Una Edge Function es una "ventanilla" en el servidor: el kiosco le manda
 *  una peticion por internet y ella decide que hacer. Las del kiosco son
 *  cuatro:
 *
 *      enrolar-kiosco     codigo de 8 caracteres  ->  token del kiosco
 *      recibir-registros  marcas, eventos, accesos a fotos  ->  a la base
 *      catalogo           empleados, admins, configuracion  ->  al kiosco
 *      latido             "sigo vivo": version, camara, pendientes
 *
 *  El kiosco NO usa Supabase Auth ni habla con las tablas (ARQUITECTURA.md 3.2).
 *  Presenta su token en el encabezado `x-kiosco-token`; aqui se saca su
 *  SHA-256 y se busca en `dispositivos`. Si cuadra, la funcion trabaja con
 *  service_role, la llave maestra que NUNCA sale del servidor.
 *
 *  Nada de esto corre en un navegador: el kiosco llama desde su proceso
 *  principal (Node). Por eso no hay encabezados CORS.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const ENCABEZADO_TOKEN = 'x-kiosco-token';

/** Mas de esto en una sola peticion es un error o un abuso, no un lote real. */
export const BYTES_MAXIMOS_POR_PETICION = 2 * 1024 * 1024;

/** El cliente con service_role. Se crea en cada peticion: no guarda estado. */
export function clienteServidor(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const llave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !llave) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** SHA-256 en hexadecimal. Mismo formato que guarda la base (`token_hash`, `codigo_hash`). */
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 bytes al azar, en hexadecimal (64 caracteres): el token de un kiosco. */
export function tokenNuevo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Una respuesta JSON. Todas llevan `servidorAhoraMs`: con eso el kiosco
 * calcula cuanto se aparta su reloj del del servidor (ARQUITECTURA.md 6), sin
 * pedirlo aparte.
 */
export function responder(estado: number, cuerpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ...cuerpo, servidorAhoraMs: Date.now() }), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Lee el cuerpo como JSON, con tope de tamano. Devuelve `undefined` si no es
 * JSON valido o es demasiado grande.
 */
export async function leerJson(peticion: Request): Promise<unknown> {
  const texto = await peticion.text();
  if (texto.length > BYTES_MAXIMOS_POR_PETICION) return undefined;
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    return undefined;
  }
}

export interface Dispositivo {
  id: string;
  nombre: string;
  activo: boolean;
  revocadoEn: string | null;
}

/**
 * ¿Quien llama? Busca el kiosco por el hash de su token.
 *
 * Devuelve el dispositivo AUNQUE este revocado: cada funcion decide que
 * hacer con uno revocado (recibir-registros acepta lo anterior a la baja en
 * cuarentena; las demas lo rechazan). Devuelve `null` si el token no es de
 * ningun kiosco.
 */
export async function identificarKiosco(
  peticion: Request,
  bd: SupabaseClient,
): Promise<Dispositivo | null> {
  const token = peticion.headers.get(ENCABEZADO_TOKEN) ?? '';
  // Un token siempre son 64 hex. Lo demas ni se busca.
  if (!/^[0-9a-f]{64}$/.test(token)) return null;

  const { data, error } = await bd
    .from('dispositivos')
    .select('id, nombre, activo, revocado_en')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { id: data.id, nombre: data.nombre, activo: data.activo, revocadoEn: data.revocado_en };
}

/** Las respuestas de "no pasas", iguales en todas las funciones. */
export const NO_AUTORIZADO = (): Response =>
  responder(401, { error: 'no_autorizado', mensaje: 'Este kiosco no esta dado de alta.' });

export const REVOCADO = (): Response =>
  responder(403, { error: 'dispositivo_revocado', mensaje: 'Este kiosco fue dado de baja en el panel.' });

export const DATOS_INVALIDOS = (detalle?: string): Response =>
  responder(400, { error: 'datos_invalidos', mensaje: detalle ?? 'La peticion no tiene la forma esperada.' });

/**
 * Envuelve una funcion: solo POST, y cualquier error inesperado sale como un
 * 500 generico. El detalle va al log del servidor, nunca al kiosco.
 */
export function atender(trabajo: (peticion: Request) => Promise<Response>): (peticion: Request) => Promise<Response> {
  return async (peticion) => {
    if (peticion.method !== 'POST') return responder(405, { error: 'metodo_no_permitido' });
    try {
      return await trabajo(peticion);
    } catch (fallo) {
      console.error('[funcion] error inesperado:', fallo instanceof Error ? fallo.message : fallo);
      return responder(500, { error: 'error_interno', mensaje: 'Hubo un problema en el servidor.' });
    }
  };
}
