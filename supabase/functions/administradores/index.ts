/**
 * ============================================================================
 *  ADMINISTRADORES  (la unica Edge Function que llama el PANEL)
 * ============================================================================
 *
 *  Dar acceso al panel a alguien nuevo exige crear su cuenta en Supabase
 *  Auth, y eso solo se puede con la llave service_role. Esa llave NUNCA va en
 *  el panel (CLAUDE.md 3.2), asi que el panel le pide el favor a esta funcion.
 *
 *      panel:  { accion: "crear", correo, nombre, rol, motivo }
 *      aqui:   ¿quien llama es administrador activo?  ->  crea la cuenta con
 *              una contrasena temporal  ->  la anota en `administradores`
 *      panel:  { userId, contrasenaTemporal }   (se muestra UNA vez)
 *
 *      panel:  { accion: "restablecer", userId, motivo }
 *      panel:  { contrasenaTemporal }
 *
 *  Igual que con el PIN de los empleados: la contrasena la inventa el
 *  sistema, el jefe se la entrega a la persona, y al entrar la primera vez el
 *  panel la obliga a ponerse una propia.
 *
 *  Cambiar el rol o dar de baja NO pasa por aqui: no necesita service_role,
 *  lo hace el panel con `cambiar_administrador()` (migracion 0017).
 *
 *  A diferencia de las del kiosco, esta SI exige el JWT de Supabase
 *  (verify_jwt = true): solo alguien con sesion en el panel llega aqui.
 */

import { z } from 'npm:zod@4';
import { clienteServidor, leerJson } from '../_compartido/kiosco.ts';

// El panel corre en un navegador (Netlify), asi que esta funcion SI necesita
// CORS. La sesion viaja en el encabezado Authorization, no en cookies: un
// origen '*' no le regala nada a otro sitio.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function responder(estado: number, cuerpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

const Motivo = z.string().trim().min(10, 'Escribe el motivo (al menos 10 letras): queda anotado en la bitácora').max(500);

const Esquema = z.discriminatedUnion('accion', [
  z.strictObject({
    accion: z.literal('crear'),
    correo: z.email('Ese correo no parece válido').max(200),
    nombre: z.string().trim().min(3, 'Escribe el nombre completo').max(120),
    rol: z.enum(['admin', 'supervisor']),
    motivo: Motivo,
  }),
  z.strictObject({
    accion: z.literal('restablecer'),
    userId: z.uuid(),
    motivo: Motivo,
  }),
]);

/**
 * 12 caracteres sin los que se confunden al leerlos en papel (0/O, 1/l/I).
 * ~70 bits: sobra para una contrasena que se cambia al primer uso.
 */
export function contrasenaTemporal(): string {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

Deno.serve(async (peticion) => {
  if (peticion.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (peticion.method !== 'POST') return responder(405, { error: 'metodo_no_permitido' });

  try {
    const bd = clienteServidor();

    // ¿Quien llama? Su sesion del panel.
    const jwt = (peticion.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: quien } = await bd.auth.getUser(jwt);
    const actor = quien?.user?.id;
    if (!actor) return responder(401, { error: 'sin_sesion', mensaje: 'Tu sesión terminó. Vuelve a entrar al panel.' });

    const { data: esAdmin, error: errorRol } = await bd.rpc('es_admin_activo', { p_user_id: actor });
    if (errorRol) throw errorRol;
    if (esAdmin !== true) {
      return responder(403, { error: 'sin_permiso', mensaje: 'Sólo un administrador puede dar acceso al panel.' });
    }

    const validacion = Esquema.safeParse(await leerJson(peticion));
    if (!validacion.success) {
      return responder(400, { error: 'datos_invalidos', mensaje: validacion.error.issues[0]?.message ?? 'Datos incompletos' });
    }
    const d = validacion.data;
    const contrasena = contrasenaTemporal();

    if (d.accion === 'crear') {
      const correo = d.correo.trim().toLowerCase();
      let userId: string | undefined;

      // Si el correo ya existe, Auth responde con error (y a veces LANZA en
      // vez de devolverlo): las dos formas se tratan igual, buscando la cuenta.
      const creado = await bd.auth.admin
        .createUser({ email: correo, password: contrasena, email_confirm: true })
        .catch((fallo: unknown) => ({ data: { user: null }, error: fallo as Error }));
      if (creado.data.user) {
        userId = creado.data.user.id;
      } else {
        // ¿Ya existia la cuenta? (por ejemplo, alguien creado a mano en el
        // tablero de Supabase). Se reutiliza con una contrasena nueva.
        const { data: existente, error: errorBusqueda } = await bd.rpc('buscar_cuenta_por_correo', { p_correo: correo });
        if (errorBusqueda) throw errorBusqueda;
        if (!existente) throw creado.error ?? new Error('No se pudo crear la cuenta');

        const { data: yaAdmin } = await bd.from('administradores').select('activo').eq('user_id', existente).maybeSingle();
        if (yaAdmin?.activo) {
          return responder(409, { error: 'ya_existe', mensaje: 'Esa persona ya tiene acceso al panel.' });
        }
        const actualizado = await bd.auth.admin.updateUserById(existente, { password: contrasena });
        if (actualizado.error) throw actualizado.error;
        userId = existente;
      }

      const { error } = await bd.rpc('registrar_administrador', {
        p_actor: actor,
        p_user_id: userId,
        p_nombre: d.nombre,
        p_correo: correo,
        p_rol: d.rol,
        p_motivo: d.motivo,
      });
      if (error) return responder(400, { error: 'rechazado', mensaje: error.message });

      console.info(`[administradores] acceso dado a ${userId}`);
      return responder(200, { userId, contrasenaTemporal: contrasena });
    }

    // restablecer
    if (d.userId === actor) {
      return responder(400, { error: 'propio', mensaje: 'Tu propia contraseña se cambia en "Mi cuenta".' });
    }
    const { error: errorMarca } = await bd.rpc('marcar_contrasena_temporal', {
      p_actor: actor,
      p_user_id: d.userId,
      p_motivo: d.motivo,
    });
    if (errorMarca) return responder(400, { error: 'rechazado', mensaje: errorMarca.message });

    const actualizado = await bd.auth.admin.updateUserById(d.userId, { password: contrasena });
    if (actualizado.error) throw actualizado.error;

    // La contrasena nunca va al log (CLAUDE.md 16).
    console.info(`[administradores] contrasena restablecida para ${d.userId}`);
    return responder(200, { contrasenaTemporal: contrasena });
  } catch (fallo) {
    console.error('[administradores] error inesperado:', fallo instanceof Error ? fallo.message : fallo);
    return responder(500, { error: 'error_interno', mensaje: 'Hubo un problema en el servidor. Intenta de nuevo.' });
  }
});
