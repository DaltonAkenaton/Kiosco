/**
 * ============================================================================
 *  RECUPERAR FOTOS DE UNA LLAVE ANTERIOR  (ARQUITECTURA.md 5.1)
 * ============================================================================
 *
 *  Cuando Windows ya no puede abrir la llave de las fotos (se reinstalo
 *  Windows, se recreo el perfil, o se copio la carpeta de datos de una PC
 *  muerta a otra), el kiosco la APARTA sin borrarla y sigue con una llave
 *  nueva (ver llave-fotos.ts). Las fotos viejas quedan "con llave anterior":
 *  existen, pero no se pueden ver.
 *
 *  Aqui se recuperan con la CONTRASENA DE RECUPERACION:
 *
 *    1. Se abren las llaves apartadas (llave-fotos.<fecha>.<motivo>.json) con
 *       la contrasena.
 *    2. Cada foto cifrada con una de ellas se descifra EN MEMORIA y se vuelve
 *       a cifrar con la llave actual. Su hash no cambia (es del JPEG), asi
 *       que la integridad que conoce la nube sigue valiendo.
 *    3. Desde ese momento se ven como cualquier otra.
 *
 *  Los archivos de llave apartados NO se borran: si algo saliera mal a media
 *  recuperacion, se puede repetir.
 *
 *  Nunca se escribe una foto en claro: se reemplaza el archivo cifrado por
 *  otro cifrado, de forma atomica.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '@kiosko/compartido';
import { baseDeDatos } from '../datos/base-de-datos';
import { carpetaDeDatos } from '../entorno';
import { registrarEvento } from '../datos/repositorio-eventos';
import { cifrarFoto, descifrarFoto, rutaAbsolutaDeFoto } from './fotos';
import { abrirLlaveConRecuperacion, escribirAtomico, type Llave, prepararLlaveDeFotos } from './llave-fotos';

export interface ResultadoRecuperacion {
  /** Cuantas llaves anteriores abrio la contrasena. */
  llavesAbiertas: number;
  /** Fotos que ya se pueden ver. */
  recuperadas: number;
  /** Fotos que siguen sin poder abrirse (otra contrasena, archivo danado). */
  pendientes: number;
}

/** Las llaves apartadas en la carpeta de datos: llave-fotos.<algo>.json */
function archivosDeLlavesApartadas(): string[] {
  const base = CONFIG.fotos.archivoLlave.replace(/\.json$/, '');
  try {
    return fs
      .readdirSync(carpetaDeDatos())
      .filter((nombre) => nombre.startsWith(`${base}.`) && nombre.endsWith('.json'))
      .map((nombre) => path.join(carpetaDeDatos(), nombre));
  } catch {
    return [];
  }
}

/** Cuantas fotos (no borradas) estan cifradas con una llave que no es la actual. */
export function contarFotosConLlaveAnterior(): number {
  const actual = prepararLlaveDeFotos();
  if (!actual) return 0;
  const fila = baseDeDatos()
    .prepare('SELECT COUNT(*) AS n FROM fotos WHERE eliminada_en IS NULL AND llave_id <> ?')
    .get(actual.id) as { n: number };
  return fila.n;
}

export async function recuperarFotosConContrasena(contrasena: string): Promise<ResultadoRecuperacion | null> {
  const actual = prepararLlaveDeFotos();
  if (!actual) return null;

  // 1. Abrir las llaves apartadas con la contrasena.
  const llaves: Llave[] = [];
  for (const ruta of archivosDeLlavesApartadas()) {
    let contenido: string;
    try {
      contenido = fs.readFileSync(ruta, 'utf8');
    } catch {
      continue;
    }
    const llave = await abrirLlaveConRecuperacion(contenido, contrasena);
    if (llave && llave.id !== actual.id && !llaves.some((l) => l.id === llave.id)) llaves.push(llave);
  }
  if (llaves.length === 0) return { llavesAbiertas: 0, recuperadas: 0, pendientes: contarFotosConLlaveAnterior() };

  // 2. Volver a cifrar con la llave actual lo que abrieron.
  const bd = baseDeDatos();
  const fotos = bd
    .prepare('SELECT marca_id, ruta_relativa, llave_id FROM fotos WHERE eliminada_en IS NULL AND llave_id <> ?')
    .all(actual.id) as { marca_id: string; ruta_relativa: string; llave_id: string }[];
  const actualizar = bd.prepare('UPDATE fotos SET llave_id = ? WHERE marca_id = ?');

  let recuperadas = 0;
  for (const foto of fotos) {
    const llave = llaves.find((l) => l.id === foto.llave_id);
    if (!llave) continue;
    const ruta = rutaAbsolutaDeFoto(foto.ruta_relativa);
    let contenido: Buffer;
    try {
      contenido = fs.readFileSync(ruta);
    } catch {
      continue; // falta el archivo: la auditoria ya lo muestra como "faltante"
    }
    const lectura = descifrarFoto(contenido, [llave], foto.marca_id);
    if (lectura.estado !== 'con_foto') continue;
    escribirAtomico(ruta, cifrarFoto(lectura.jpeg, actual, foto.marca_id));
    actualizar.run(actual.id, foto.marca_id);
    recuperadas++;
  }

  const pendientes = contarFotosConLlaveAnterior();
  registrarEvento('fotos_recuperadas', { recuperadas, pendientes, llaves: llaves.map((l) => l.id) });
  console.info(`[recuperacion] ${recuperadas} foto(s) recuperadas; ${pendientes} siguen con llave anterior`);
  return { llavesAbiertas: llaves.length, recuperadas, pendientes };
}
