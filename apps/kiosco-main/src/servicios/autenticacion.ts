/**
 * ============================================================================
 *  VERIFICACION DEL PIN
 * ============================================================================
 *
 *  Todo esto corre en el PROCESO PRINCIPAL, nunca en la pantalla
 *  (CLAUDE.md 3.4: "la verificacion ocurre en el proceso main").
 *
 *  ¿Por que importa tanto donde corre?
 *  Porque para comparar el PIN hay que tener el hash. Si la comparacion
 *  ocurriera en Angular, el hash tendria que viajar a la pantalla, y
 *  cualquiera con las herramientas de desarrollador abiertas podria leerlo
 *  y atacarlo con calma en su casa.
 *
 *  Aqui el hash nunca sale del proceso principal.
 */

import bcrypt from 'bcryptjs';
import { CONFIG, type EmpleadoEnCache } from '@kiosko/compartido';
import { baseDeDatos } from '../datos/base-de-datos';

/**
 * ----------------------------------------------------------------------------
 *  ¿Que es bcrypt y por que es LENTO a proposito?
 * ----------------------------------------------------------------------------
 *  Un hash normal (como SHA-256) esta hecho para ser rapidisimo. Eso es malo
 *  para contraseñas: una tarjeta grafica puede probar miles de millones por
 *  segundo, y un PIN de 4 digitos solo tiene 10 000 combinaciones. Se rompe
 *  en un parpadeo.
 *
 *  bcrypt esta hecho para ser LENTO. Su "costo" (10 en este proyecto) define
 *  cuantas vueltas da: cada +1 DUPLICA el tiempo.
 *
 *      costo 10  ->  ~60 ms por intento
 *
 *  60 ms no los nota el empleado. Pero para quien quiera probar las 10 000
 *  combinaciones, son 10 minutos por empleado... y eso suponiendo que pudiera
 *  probarlas todas seguidas, que es justo lo que impide el bloqueo de abajo.
 *
 *  Y recuerda lo que dice el CLAUDE.md 3.4: "el PIN identifica; LA FOTO es la
 *  evidencia". La seguridad de verdad del sistema es la fotografia. El PIN
 *  solo evita el chiste facil de checar por un compañero.
 */

/** Genera el hash de un PIN. Se usa al crear empleados de prueba. */
export function hashearPin(pin: string): string {
  return bcrypt.hashSync(pin, CONFIG.seguridadPin.costoBcrypt);
}

/**
 * Compara un PIN contra su hash.
 *
 * `compareSync` vuelve a hashear el PIN con la misma sal que trae el hash
 * guardado y compara los resultados. Por eso NO hace falta descifrar nada:
 * un hash no se puede revertir, solo se puede repetir la operacion.
 */
function pinCoincide(pin: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(pin, hash);
  } catch {
    // Un hash corrupto en la base no debe tumbar el kiosco. Se trata como
    // "no coincide" y el jefe puede resetear el PIN desde el panel.
    console.error('[auth] hash invalido en la base de datos');
    return false;
  }
}

// ============================================================================
//  Bloqueo por intentos fallidos
// ============================================================================

export interface EstadoDeBloqueo {
  bloqueado: boolean;
  segundosRestantes: number;
  fallidos: number;
}

/**
 * Lee el estado de bloqueo de un empleado.
 *
 * OJO con el "olvido": los intentos fallidos solo cuentan si son RECIENTES.
 *
 * Sin eso habria un error molesto y muy dificil de diagnosticar: los fallos
 * se sumarian para siempre. Alguien que se equivoca una vez el lunes, otra el
 * martes y otra el miercoles quedaria bloqueado el jueves al primer error,
 * sin entender por que. Y en el log no se veria nada raro.
 *
 * El bloqueo existe para frenar a quien esta probando PINes uno tras otro
 * AHORA MISMO, no para castigar a quien es distraido a lo largo de la semana.
 */
export function estadoDeBloqueo(empleadoId: string): EstadoDeBloqueo {
  const fila = baseDeDatos()
    .prepare(
      'SELECT fallidos, ultimo_intento_ms, bloqueado_hasta_ms FROM intentos_pin WHERE empleado_id = ?',
    )
    .get(empleadoId) as
    | { fallidos: number; ultimo_intento_ms: number; bloqueado_hasta_ms: number | null }
    | undefined;

  if (!fila) return { bloqueado: false, segundosRestantes: 0, fallidos: 0 };

  const ahora = Date.now();
  const hasta = fila.bloqueado_hasta_ms ?? 0;

  // Si sigue bloqueado, el olvido no aplica: hay que esperar el castigo.
  if (hasta > ahora) {
    return {
      bloqueado: true,
      // `Math.ceil` para no decir "faltan 0 segundos" cuando faltan 400 ms.
      segundosRestantes: Math.ceil((hasta - ahora) / 1000),
      fallidos: fila.fallidos,
    };
  }

  // ¿Ya paso la ventana de olvido desde el ultimo fallo?
  const ventanaMs = CONFIG.seguridadPin.minutosParaOlvidarIntentos * 60 * 1000;
  const intentosCaducados = ahora - fila.ultimo_intento_ms > ventanaMs;

  return {
    bloqueado: false,
    segundosRestantes: 0,
    fallidos: intentosCaducados ? 0 : fila.fallidos,
  };
}

/**
 * Registra un intento fallido y bloquea si ya son demasiados.
 *
 * Devuelve el estado despues de registrarlo.
 */
function registrarFallo(empleadoId: string): EstadoDeBloqueo {
  const ahora = Date.now();
  const actual = estadoDeBloqueo(empleadoId);
  const fallidos = actual.fallidos + 1;

  const { intentosFallidosMaximos, segundosDeBloqueo } = CONFIG.seguridadPin;
  const bloqueadoHasta =
    fallidos >= intentosFallidosMaximos ? ahora + segundosDeBloqueo * 1000 : null;

  baseDeDatos()
    .prepare(
      `INSERT INTO intentos_pin (empleado_id, fallidos, ultimo_intento_ms, bloqueado_hasta_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (empleado_id) DO UPDATE SET
         fallidos           = excluded.fallidos,
         ultimo_intento_ms  = excluded.ultimo_intento_ms,
         bloqueado_hasta_ms = excluded.bloqueado_hasta_ms`,
    )
    .run(empleadoId, fallidos, ahora, bloqueadoHasta);

  if (bloqueadoHasta !== null) {
    console.warn(`[auth] empleado bloqueado por ${segundosDeBloqueo} s tras ${fallidos} fallos`);
  }

  return {
    bloqueado: bloqueadoHasta !== null,
    segundosRestantes: bloqueadoHasta !== null ? segundosDeBloqueo : 0,
    fallidos,
  };
}

/** Borra el conteo de fallos. Se llama cuando el PIN es correcto. */
function limpiarFallos(empleadoId: string): void {
  baseDeDatos().prepare('DELETE FROM intentos_pin WHERE empleado_id = ?').run(empleadoId);
}

/**
 * ----------------------------------------------------------------------------
 *  Retardo creciente
 * ----------------------------------------------------------------------------
 *  Despues de cada fallo, el sistema espera un poco antes de responder.
 *
 *      fallo 1 ->  400 ms
 *      fallo 2 ->  800 ms
 *      fallo 3 -> 1600 ms
 *      fallo 4 -> 3200 ms   (topado en 5000)
 *
 *  ¿Para que, si ya hay bloqueo a los 4 intentos? Porque el bloqueo se puede
 *  "esperar", y el retardo hace que cada intento cueste tiempo REAL desde el
 *  primero. Probar PINes a mano deja de ser practico mucho antes de llegar
 *  al bloqueo.
 *
 *  (Los numeros de arriba salen de `retardoBaseMs` y `retardoMaximoMs` en la
 *  configuracion; si los cambias ahi, esta tabla del comentario deja de ser
 *  cierta. Es el riesgo de escribir ejemplos concretos en un comentario.)
 *
 *  Y hay un segundo motivo, mas sutil: iguala el tiempo de respuesta. Sin
 *  retardo, un "usuario no existe" responde al instante y un "PIN incorrecto"
 *  tarda los 60 ms de bcrypt. Esa diferencia le dice a un atacante cuales
 *  usuarios existen. Se llama "ataque de temporizacion".
 */
function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function aplicarRetardo(fallidos: number): Promise<void> {
  const { retardoBaseMs, retardoMaximoMs } = CONFIG.seguridadPin;
  // 2 ** n es "2 elevado a n": 1, 2, 4, 8, 16...
  const retardo = Math.min(retardoBaseMs * 2 ** Math.max(0, fallidos - 1), retardoMaximoMs);
  await esperar(retardo);
}

// ============================================================================
//  La funcion principal
// ============================================================================

export type ResultadoVerificacion =
  | { ok: true; empleado: EmpleadoEnCache }
  | { ok: false; motivo: 'pin_incorrecto' }
  | { ok: false; motivo: 'empleado_bloqueado'; segundosRestantes: number };

/**
 * Verifica el PIN de un empleado, con bloqueo y retardo.
 *
 * Es `async` por el retardo creciente: hay que poder esperar sin congelar el
 * proceso principal (si lo congelara, la ventana entera se quedaria tiesa).
 */
export async function verificarPin(
  empleado: EmpleadoEnCache,
  pin: string,
): Promise<ResultadoVerificacion> {
  // --- 1. ¿Esta bloqueado? ------------------------------------------------
  const bloqueo = estadoDeBloqueo(empleado.id);
  if (bloqueo.bloqueado) {
    return {
      ok: false,
      motivo: 'empleado_bloqueado',
      segundosRestantes: bloqueo.segundosRestantes,
    };
  }

  // --- 2. Comparar ---------------------------------------------------------
  if (pinCoincide(pin, empleado.pinHash)) {
    limpiarFallos(empleado.id);
    return { ok: true, empleado };
  }

  // --- 3. Fallo: registrar, esperar y responder ---------------------------
  const estado = registrarFallo(empleado.id);
  await aplicarRetardo(estado.fallidos);

  if (estado.bloqueado) {
    return {
      ok: false,
      motivo: 'empleado_bloqueado',
      segundosRestantes: estado.segundosRestantes,
    };
  }

  return { ok: false, motivo: 'pin_incorrecto' };
}

/**
 * Espera el mismo tiempo que habria tardado una verificacion real.
 *
 * Se llama cuando el USUARIO NO EXISTE. Sin esto, responder al instante le
 * diria a quien esta probando que ese usuario no esta en el sistema, y con
 * eso podria averiguar la lista completa de empleados probando nombres.
 *
 * Es el ataque de temporizacion que se menciona arriba. La defensa es que
 * todos los caminos tarden parecido.
 */
export async function simularVerificacion(): Promise<void> {
  // Hashear algo desechable cuesta lo mismo que compararlo: ~60 ms con
  // costo 10. Asi el tiempo de respuesta se parece al del camino real.
  bcrypt.hashSync('0000', CONFIG.seguridadPin.costoBcrypt);
  await esperar(CONFIG.seguridadPin.retardoBaseMs);
}

/**
 * SOLO PARA PRUEBAS: hace que los intentos fallidos de un empleado parezcan
 * mas viejos de lo que son.
 *
 * ¿Por que existe? Para poder comprobar que el "olvido" de intentos funciona
 * sin tener que esperar 15 minutos reales en cada prueba.
 *
 * Es la alternativa honesta a la trampa habitual, que seria bajar el tiempo
 * de olvido a 2 segundos "para probar": eso comprueba una configuracion que
 * nadie va a usar en produccion. Aqui se prueba la de verdad, simulando el
 * paso del tiempo.
 */
export function envejecerIntentos(empleadoId: string, milisegundos: number): void {
  baseDeDatos()
    .prepare('UPDATE intentos_pin SET ultimo_intento_ms = ultimo_intento_ms - ? WHERE empleado_id = ?')
    .run(milisegundos, empleadoId);
}
