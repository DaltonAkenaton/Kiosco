/**
 * ============================================================================
 *  LA CREDENCIAL DEL KIOSCO  (ARQUITECTURA.md 3.3)
 * ============================================================================
 *
 *  Cuando el kiosco se da de alta, la nube le entrega un token: 64 caracteres
 *  al azar que lo identifican en cada peticion. Es su gafete.
 *
 *  Se guarda en `credencial-kiosco.json`, en la carpeta de datos, CIFRADO con
 *  `safeStorage` de Electron (DPAPI de Windows):
 *
 *      {
 *        "version": 1,
 *        "dispositivoId": "53b8...",        <- no es secreto
 *        "nombre": "Entrada principal",     <- tampoco
 *        "ubicacion": "Edificio A",
 *        "tokenDpapi": "AQAAANCMnd8BFdER..." <- el token, cifrado por Windows
 *      }
 *
 *  Si alguien copia el archivo a otra PC, Windows alla no lo puede descifrar.
 *  Eso es INTENCIONAL: un kiosco clonado no puede hacerse pasar por el
 *  original. La PC nueva se da de alta con su propio codigo, y la vieja se
 *  revoca en el panel (ARQUITECTURA.md 11, "Cambio de PC").
 *
 *  El token NUNCA se escribe en claro, ni en disco ni en el log.
 */

import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { CONFIG } from '@kiosko/compartido';
import { carpetaDeDatos } from '../entorno';
import { escribirAtomico } from './llave-fotos';

export interface CredencialKiosco {
  dispositivoId: string;
  nombre: string;
  ubicacion: string;
  token: string;
}

interface ArchivoCredencial {
  version: 1;
  dispositivoId: string;
  nombre: string;
  ubicacion: string;
  tokenDpapi: string;
}

function rutaDeLaCredencial(): string {
  return path.join(carpetaDeDatos(), CONFIG.almacenamiento.archivoCredencial);
}

/** Se lee una vez y se recuerda: se usa en cada peticion. */
let enMemoria: CredencialKiosco | null | undefined;

/**
 * La credencial, o `null` si el kiosco no esta dado de alta (o si Windows ya
 * no puede descifrarla: otro perfil u otra PC, que para efectos practicos es
 * lo mismo que no tenerla).
 */
export function leerCredencial(): CredencialKiosco | null {
  if (enMemoria !== undefined) return enMemoria;

  enMemoria = null;
  let archivo: ArchivoCredencial;
  try {
    archivo = JSON.parse(fs.readFileSync(rutaDeLaCredencial(), 'utf8')) as ArchivoCredencial;
  } catch {
    return null; // no existe: nunca se ha dado de alta
  }

  try {
    const token = safeStorage.decryptString(Buffer.from(archivo.tokenDpapi, 'base64'));
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('token con forma invalida');
    enMemoria = {
      dispositivoId: archivo.dispositivoId,
      nombre: archivo.nombre,
      ubicacion: archivo.ubicacion,
      token,
    };
  } catch (fallo) {
    // Copiado de otra PC, o se recreo el perfil de Windows. No se borra: se
    // queda como evidencia de que hubo una credencial.
    console.warn('[credencial] no se pudo descifrar la credencial de este kiosco:', (fallo as Error).message);
  }
  return enMemoria;
}

/** Guarda la credencial recien entregada por la nube. Lanza si Windows no ofrece cifrado. */
export function guardarCredencial(credencial: CredencialKiosco): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows no ofrece cifrado (safeStorage): no se puede guardar el token de forma segura');
  }
  const archivo: ArchivoCredencial = {
    version: 1,
    dispositivoId: credencial.dispositivoId,
    nombre: credencial.nombre,
    ubicacion: credencial.ubicacion,
    tokenDpapi: safeStorage.encryptString(credencial.token).toString('base64'),
  };
  escribirAtomico(rutaDeLaCredencial(), JSON.stringify(archivo, null, 2));
  enMemoria = { ...credencial };
}

/** Solo para pruebas: olvida lo que hay en memoria para volver a leer el archivo. */
export function olvidarCredencialEnMemoria(): void {
  enMemoria = undefined;
}

export { rutaDeLaCredencial };
