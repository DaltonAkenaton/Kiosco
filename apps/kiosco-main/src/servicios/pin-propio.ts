/**
 * ============================================================================
 *  PIN PROPIO  (D-042: "como en el cajero")
 * ============================================================================
 *
 *  El jefe da de alta a alguien y el sistema inventa su PIN. Ese PIN lo vio
 *  el jefe: es TEMPORAL. La primera vez que la persona checa con el, y
 *  DESPUES de guardar su registro (la asistencia nunca se arriesga), el kiosco
 *  le ofrece elegir uno propio.
 *
 *  ¿Como se sabe que quien cambia el PIN es quien acaba de teclearlo bien?
 *  Igual que con las marcas (identificaciones-pendientes.ts): al registrar,
 *  el proceso principal guarda en memoria un PERMISO y a la pantalla solo le
 *  da un texto al azar. Sin ese texto no se puede cambiar el PIN de nadie.
 *
 *  A diferencia del pase de la marca, este permiso NO se gasta si el PIN
 *  elegido no sirve (muy facil, igual al temporal): la persona puede escribir
 *  otro. Se gasta solo cuando el cambio se guarda, o al vencer.
 */

import { randomBytes } from 'node:crypto';
import { CONFIG, type ResultadoCambioPin } from '@kiosko/compartido';
import { guardarPinPropio } from '../datos/repositorio-empleados';
import { hashearPin, pinCoincide } from './autenticacion';

interface PermisoDePin {
  empleadoId: string;
  /** El hash del PIN temporal con el que se identifico. */
  pinAnteriorHash: string;
  caducaEnMonotonicoMs: number;
}

const permisos = new Map<string, PermisoDePin>();

function limpiarCaducados(): void {
  const ahora = performance.now();
  for (const [token, permiso] of permisos) {
    if (permiso.caducaEnMonotonicoMs <= ahora) permisos.delete(token);
  }
}

/** Da el permiso para elegir PIN. Lo llama `registrarMarca` si el PIN era temporal. */
export function crearPermisoDePin(empleadoId: string, pinAnteriorHash: string): string {
  limpiarCaducados();
  const token = randomBytes(32).toString('hex');
  permisos.set(token, {
    empleadoId,
    pinAnteriorHash,
    caducaEnMonotonicoMs: performance.now() + CONFIG.seguridadPin.segundosParaElegirPin * 1000,
  });
  return token;
}

/**
 * PINes que cualquiera adivinaria: todos iguales (0000, 7777) y escaleras
 * (1234, 4321, 0123, 9876). Es la misma regla que usa la nube al inventar
 * PINes (`pin_al_azar`, migracion 0015).
 */
export function pinDemasiadoFacil(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digitos = [...pin].map(Number);
  const pasos = digitos.slice(1).map((d, i) => d - (digitos[i] ?? 0));
  return pasos.every((p) => p === 1) || pasos.every((p) => p === -1);
}

/** Guarda el PIN elegido, si el permiso sigue vivo y el PIN sirve. */
export function elegirPinPropio(token: string, pinNuevo: string): ResultadoCambioPin {
  limpiarCaducados();
  const permiso = permisos.get(token);
  if (!permiso) {
    return {
      ok: false,
      volverAEmpezar: false,
      mensaje: 'Pasó demasiado tiempo. Te lo volveremos a preguntar la próxima vez que registres.',
    };
  }

  if (pinDemasiadoFacil(pinNuevo)) {
    return {
      ok: false,
      volverAEmpezar: true,
      mensaje: 'Ese es muy fácil de adivinar (números iguales o seguidos). Elige otro.',
    };
  }
  if (pinCoincide(pinNuevo, permiso.pinAnteriorHash)) {
    return {
      ok: false,
      volverAEmpezar: true,
      mensaje: 'Es el mismo que te dio el jefe. Elige uno distinto, que sólo tú sepas.',
    };
  }

  permisos.delete(token);
  const guardado = guardarPinPropio(permiso.empleadoId, hashearPin(pinNuevo), permiso.pinAnteriorHash);
  if (!guardado) {
    // Entre medias cambio su PIN (el jefe le dio otro y ya llego al kiosco).
    return {
      ok: false,
      volverAEmpezar: false,
      mensaje: 'No se pudo cambiar: tu PIN cambió mientras tanto. Pregúntale a tu jefe.',
    };
  }
  return { ok: true };
}

/** Para las pruebas: cuantos permisos hay vivos. */
export function permisosDePinVivos(): number {
  limpiarCaducados();
  return permisos.size;
}
