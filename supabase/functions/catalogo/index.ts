/**
 * ============================================================================
 *  CATALOGO  (ARQUITECTURA.md 7, "pull")
 * ============================================================================
 *
 *  Lo que el kiosco necesita para trabajar SIN internet:
 *
 *    - empleados, con el hash de su PIN (para validar ahi mismo);
 *    - administradores con credenciales de kiosco (para el modo admin);
 *    - la configuracion vigente (tolerancias, retencion de fotos...);
 *    - la ultima marca de cada empleado (para sugerir ENTRADA o SALIDA,
 *      aunque la anterior se haya hecho en otro kiosco).
 *
 *      kiosco:  { desde: "2026-09-23T12:00:00Z" | null }
 *      aqui:    { empleados, administradores, configuracion, ultimasMarcas, cursor }
 *
 *  Incremental: el kiosco manda el `cursor` que recibio la vez anterior y
 *  solo baja lo que cambio. Con `null`, baja todo (primera vez).
 *
 *  Un kiosco revocado ya no recibe nada: si lo robaron, que no se lleve los
 *  PINes nuevos.
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

const Esquema = z.object({
  desde: z.iso.datetime({ offset: true }).nullable().default(null),
});

Deno.serve(
  atender(async (peticion) => {
    const bd = clienteServidor();
    const kiosco = await identificarKiosco(peticion, bd);
    if (!kiosco) return NO_AUTORIZADO();
    if (!kiosco.activo) return REVOCADO();

    const validacion = Esquema.safeParse(await leerJson(peticion));
    if (!validacion.success) return DATOS_INVALIDOS();

    const { data, error } = await bd.rpc('catalogo_para_kiosco', { p_desde: validacion.data.desde });
    if (error) throw error;

    return responder(200, data as Record<string, unknown>);
  }),
);
