/**
 * ============================================================================
 *  SESION DEL MODO ADMINISTRADOR  (CLAUDE.md 5.2)
 * ============================================================================
 *
 *  Quien entra, cuanto dura, y cuando se cierra sola.
 *
 *  ---------------------------------------------------------------------------
 *  La sesion vive AQUI, no en la pantalla
 *  ---------------------------------------------------------------------------
 *  La pantalla solo recibe un token (64 caracteres al azar) y lo presenta en
 *  cada peticion. Quien decide si sigue valido es este archivo: si la
 *  pantalla "creyera" que la sesion sigue abierta, bastaria con manipularla
 *  para seguir viendo fotos despues de los 2 minutos.
 *
 *  ---------------------------------------------------------------------------
 *  Intentos fallidos: se regresa, no se bloquea  (decision del 22-09-2026)
 *  ---------------------------------------------------------------------------
 *  Un fallo regresa a la pantalla principal con "Intento fallido. Quedo
 *  registrado con fecha y hora." Nada de bloqueos de minutos: el jefe con las
 *  mayusculas puestas no tiene por que esperar, y un bloqueo general dejaria
 *  que cualquier empleado lo dejara fuera a proposito.
 *
 *  La unica red de seguridad es para quien prueba contrasenas en serie: tras
 *  N fallos SEGUIDOS hay que esperar antes del siguiente, y la espera se
 *  duplica (30 s, 1 min, 2 min... hasta 5). Es general y no por usuario: por
 *  usuario, "espera" le diria a quien prueba que ese usuario existe. Y la
 *  cuenta se guarda en la base: si viviera en memoria, reiniciar la app la
 *  borraria.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { CONFIG } from '@kiosko/compartido';
import { baseDeDatos } from '../datos/base-de-datos';
import { buscarAdministrador } from '../datos/repositorio-admin';
import { registrarEvento } from '../datos/repositorio-eventos';

export interface SesionAdmin {
  token: string;
  adminId: string;
  nombre: string;
  rol: 'admin' | 'supervisor';
}

let sesion: (SesionAdmin & { venceEnMs: number }) | null = null;
let temporizador: NodeJS.Timeout | null = null;
let avisarCierre: () => void = () => {};

const CLAVE_BLOQUEO = 'modo_admin_bloqueo';

/**
 * Un hash bcrypt de relleno, para gastar el mismo tiempo cuando el usuario no
 * existe. Sin esto, "usuario inexistente" responderia al instante y
 * "contrasena equivocada" tardaria ~60 ms: la diferencia delataria cuales
 * usuarios existen. Es el mismo truco que `simularVerificacion` del PIN.
 */
const HASH_DE_RELLENO = bcrypt.hashSync(randomBytes(16).toString('hex'), CONFIG.seguridadPin.costoBcrypt);

/** Lo llama main.ts para que la pantalla se entere cuando la sesion se cierra sola. */
export function alCerrarseSesionAdmin(callback: () => void): void {
  avisarCierre = callback;
}

function leerBloqueo(): { fallidos: number; bloqueadoHastaMs: number } {
  const fila = baseDeDatos()
    .prepare('SELECT valor FROM estado_local WHERE clave = ?')
    .get(CLAVE_BLOQUEO) as { valor: string } | undefined;
  if (!fila) return { fallidos: 0, bloqueadoHastaMs: 0 };
  try {
    return JSON.parse(fila.valor) as { fallidos: number; bloqueadoHastaMs: number };
  } catch {
    return { fallidos: 0, bloqueadoHastaMs: 0 };
  }
}

function guardarBloqueo(estado: { fallidos: number; bloqueadoHastaMs: number }): void {
  baseDeDatos()
    .prepare(
      `INSERT INTO estado_local (clave, valor) VALUES (?, ?)
       ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`,
    )
    .run(CLAVE_BLOQUEO, JSON.stringify(estado));
}

export type ResultadoEntrada =
  | { ok: true; sesion: SesionAdmin }
  | { ok: false; mensaje: string };

/** El mismo mensaje para cualquier fallo: nunca se dice si fallo el usuario o la contrasena. */
export const MENSAJE_INTENTO_FALLIDO = 'Intento fallido. Quedó registrado con fecha y hora.';

/** Cuanto hay que esperar tras `fallidos` fallos seguidos. 0 = nada. */
export function segundosDeEsperaTras(fallidos: number): number {
  const { fallosAntesDeEsperar, segundosDeEsperaInicial, segundosDeEsperaMaxima } = CONFIG.modoAdmin;
  if (fallidos < fallosAntesDeEsperar) return 0;
  const duplicaciones = fallidos - fallosAntesDeEsperar;
  return Math.min(segundosDeEsperaInicial * 2 ** duplicaciones, segundosDeEsperaMaxima);
}

/**
 * Intenta abrir una sesion. Nunca dice si fallo el usuario o la contrasena.
 */
export async function entrarModoAdmin(usuario: string, contrasena: string): Promise<ResultadoEntrada> {
  const ahora = Date.now();
  const bloqueo = leerBloqueo();

  if (bloqueo.bloqueadoHastaMs > ahora) {
    const segundos = Math.ceil((bloqueo.bloqueadoHastaMs - ahora) / 1000);
    // No cuenta como otro fallo: ni siquiera se comparo la contrasena.
    return {
      ok: false,
      mensaje: `Hubo varios intentos fallidos seguidos. Espera ${segundos} segundos e intenta otra vez.`,
    };
  }

  const admin = buscarAdministrador(usuario);
  // Se compara SIEMPRE, exista o no el usuario: mismo tiempo en los dos casos.
  const coincide = await bcrypt.compare(contrasena, admin?.contrasenaHash ?? HASH_DE_RELLENO);

  if (!admin || !admin.activo || !coincide) {
    const fallidos = bloqueo.fallidos + 1;
    const espera = segundosDeEsperaTras(fallidos);
    guardarBloqueo({ fallidos, bloqueadoHastaMs: espera > 0 ? ahora + espera * 1000 : 0 });

    // "Quedo registrado" es verdad: cada fallo va a la bitacora de eventos,
    // que viaja a la nube. Nunca el usuario tecleado ni la contrasena.
    registrarEvento('modo_admin_intento_fallido', { fallidosSeguidos: fallidos });
    if (espera > 0) {
      console.warn(`[admin] ${fallidos} intentos fallidos seguidos: espera de ${espera} s`);
      registrarEvento('modo_admin_bloqueado', { segundos: espera });
    }
    return { ok: false, mensaje: MENSAJE_INTENTO_FALLIDO };
  }

  guardarBloqueo({ fallidos: 0, bloqueadoHastaMs: 0 });
  cerrarSesionAdmin('reemplazada');

  sesion = {
    token: randomBytes(32).toString('hex'),
    adminId: admin.id,
    nombre: admin.nombre,
    rol: admin.rol,
    venceEnMs: 0,
  };
  renovar();

  // El id del administrador, nunca su usuario ni su contrasena.
  console.info('[admin] sesion abierta');
  registrarEvento('modo_admin_abierto', { adminId: admin.id });

  const { token, adminId, nombre, rol } = sesion;
  return { ok: true, sesion: { token, adminId, nombre, rol } };
}

/** ¿Hay alguien en el modo administrador ahora? (Para no actualizar encima de el.) */
export function haySesionAdminAbierta(): boolean {
  return sesion !== null && Date.now() <= sesion.venceEnMs;
}

/** Empuja el vencimiento: la sesion dura N minutos desde la ULTIMA actividad. */
function renovar(): void {
  if (!sesion) return;
  const duracion = CONFIG.modoAdmin.minutosDeInactividad * 60_000;
  sesion.venceEnMs = Date.now() + duracion;

  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => cerrarSesionAdmin('inactividad'), duracion);
  temporizador.unref();
}

/**
 * Comprueba el token y, si vale, renueva la sesion. Devuelve la sesion o
 * `null`. TODA operacion del modo administrador empieza por aqui.
 */
export function validarSesionAdmin(token: string): SesionAdmin | null {
  if (!sesion || Date.now() > sesion.venceEnMs) {
    if (sesion) cerrarSesionAdmin('inactividad');
    return null;
  }

  // Comparacion en tiempo constante: una comparacion normal se detiene en el
  // primer caracter distinto, y el tiempo que tarda dice cuantos acerto.
  const esperado = Buffer.from(sesion.token, 'utf8');
  const recibido = Buffer.from(token, 'utf8');
  if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) return null;

  renovar();
  const { adminId, nombre, rol } = sesion;
  return { token: sesion.token, adminId, nombre, rol };
}

export function cerrarSesionAdmin(motivo: 'salida' | 'inactividad' | 'reemplazada'): void {
  if (!sesion) return;
  sesion = null;
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;

  console.info(`[admin] sesion cerrada (${motivo})`);
  if (motivo === 'inactividad') avisarCierre();
}

/** SOLO PARA PRUEBAS: vence la sesion sin esperar los 2 minutos. */
export function vencerSesionAdminParaPrueba(): void {
  if (sesion) sesion.venceEnMs = Date.now() - 1;
}
