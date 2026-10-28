/**
 * ============================================================================
 *  FOTOS: HUELLA, CIFRADO Y DISCO  (ARQUITECTURA.md 5.1)
 * ============================================================================
 *
 *  > LA FOTO NUNCA SALE DEL KIOSCO. A la nube viaja solo su hash.
 *
 *  Lo que le pasa a una foto desde que llega de la pantalla:
 *
 *      data URL ──► bytes JPEG ──► SHA-256 ──► AES-256-GCM ──► disco
 *                                    │
 *                                    └──► se guarda con la marca y viaja
 *                                         a la nube (solo el hash)
 *
 *  ---------------------------------------------------------------------------
 *  ¿Por que el hash se saca ANTES de cifrar?
 *  ---------------------------------------------------------------------------
 *  Porque lo que queremos poder comprobar despues es la FOTO, no el archivo
 *  cifrado. Al abrirla, el kiosco compara la foto descifrada con el hash de
 *  la marca (y con el que tiene la nube). Y si se exporta la ORIGINAL a una
 *  USB (EXPORTACION.incluirOriginales, D-030), cualquiera puede repetir la
 *  comparacion fuera de la app. Con el hash del archivo cifrado, ninguna de
 *  las dos cosas seria posible.
 *
 *  ---------------------------------------------------------------------------
 *  Como es un archivo .jpg.enc por dentro
 *  ---------------------------------------------------------------------------
 *
 *      ┌──────┬──────────────┬──────────┬───────────┬──────────────────┐
 *      │ KFT1 │ id de llave  │   IV     │ etiqueta  │  JPEG cifrado    │
 *      │ 4 B  │ 16 B         │ 12 B     │ 16 B      │  el resto        │
 *      └──────┴──────────────┴──────────┴───────────┴──────────────────┘
 *
 *    KFT1        "esto es una foto del kiosco, formato 1". Si algun dia
 *                cambia el formato, las fotos viejas se siguen reconociendo.
 *    id llave    cual llave la cifro. Permite abrir fotos de una llave
 *                anterior con la contrasena de recuperacion.
 *    IV          al azar, distinto en cada foto. Dos fotos identicas dan
 *                archivos cifrados distintos.
 *    etiqueta    el sello de GCM. Si cambia UN bit del archivo, descifrar
 *                falla en vez de devolver basura.
 *
 *  Ademas se sella el UUID de la MARCA (como "dato asociado", sin escribirlo
 *  en el archivo). Consecuencia: si alguien renombra la foto de una marca con
 *  el nombre de otra, para "prestarle" una foto, descifrar falla y la foto
 *  sale como ALTERADA.
 *
 *  ---------------------------------------------------------------------------
 *  Privacidad (ARQUITECTURA.md 12)
 *  ---------------------------------------------------------------------------
 *    - El nombre del archivo es el UUID de la marca, nunca el del empleado.
 *    - Descifrada, la foto existe SOLO en memoria. Nunca se escribe en claro.
 *    - Nunca aparece en ningun log: ni su contenido ni su ruta completa.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '@kiosko/compartido';
import { umbralesDeCamara, zonaHorariaVigente } from '../configuracion-vigente';
import { carpetaDeDatos } from '../entorno';
import { escribirAtomico, type Llave, prepararLlaveDeFotos } from './llave-fotos';

/** "KFT" + version 1 del formato. */
const MAGIA = Buffer.from([0x4b, 0x46, 0x54, 0x01]);
const LARGO_ID_LLAVE = 16;
const LARGO_IV = 12;
const LARGO_ETIQUETA = 16;
const LARGO_ENCABEZADO = MAGIA.length + LARGO_ID_LLAVE + LARGO_IV;

/** Lo que queda de una foto recien guardada. */
export interface FotoGuardada {
  /** Relativa a la carpeta de datos, con "/": "fotos/2026/09/<uuid>.jpg.enc". */
  rutaRelativa: string;
  /** SHA-256 del JPEG, en hexadecimal (64 caracteres). */
  hash: string;
  /** Id de la llave con que se cifro. */
  llaveId: string;
}

/** El resultado de intentar abrir una foto. Los nombres coinciden con `foto_estado` de la nube. */
export type LecturaDeFoto =
  | { estado: 'con_foto'; jpeg: Buffer }
  /** Deberia estar y no esta. */
  | { estado: 'faltante' }
  /** Esta, pero no descifra o su hash no cuadra. */
  | { estado: 'alterada' }
  /** La cifro una llave que no esta abierta: hace falta la contrasena de recuperacion. */
  | { estado: 'llave_no_disponible'; llaveId: string };

/** SHA-256 en hexadecimal. Es el formato que exige la columna `foto_hash` de la nube. */
export function hashDeFoto(jpeg: Buffer): string {
  return createHash('sha256').update(jpeg).digest('hex');
}

/**
 * Convierte el data URL que manda la pantalla en los bytes del JPEG.
 *
 * Un data URL es un archivo metido en texto:
 *
 *     data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...
 *     └──── encabezado ────┘ └──── la imagen ────┘
 *
 * Devuelve `null` si no tiene forma de foto.
 */
export function bytesDeDataUrl(dataUrl: string): Buffer | null {
  const coma = dataUrl.indexOf(',');
  if (coma === -1) return null;
  const bytes = Buffer.from(dataUrl.slice(coma + 1), 'base64');
  return bytes.length > 0 ? bytes : null;
}

/** Cifra un JPEG, sellado a su marca. */
export function cifrarFoto(jpeg: Buffer, llave: Llave, marcaId: string): Buffer {
  const iv = randomBytes(LARGO_IV);
  const encabezado = Buffer.concat([MAGIA, Buffer.from(llave.id, 'hex'), iv]);

  const cifrador = createCipheriv('aes-256-gcm', llave.bytes, iv);
  cifrador.setAAD(Buffer.concat([encabezado, Buffer.from(marcaId, 'utf8')]));
  const cifrado = Buffer.concat([cifrador.update(jpeg), cifrador.final()]);

  return Buffer.concat([encabezado, cifrador.getAuthTag(), cifrado]);
}

/**
 * Descifra un archivo .jpg.enc.
 *
 * `llaves` son las que estan abiertas: normalmente solo la actual, mas las
 * que se hayan abierto con la contrasena de recuperacion.
 */
export function descifrarFoto(
  contenido: Buffer,
  llaves: Llave[],
  marcaId: string,
): LecturaDeFoto {
  if (
    contenido.length < LARGO_ENCABEZADO + LARGO_ETIQUETA ||
    !contenido.subarray(0, MAGIA.length).equals(MAGIA)
  ) {
    return { estado: 'alterada' };
  }

  const encabezado = contenido.subarray(0, LARGO_ENCABEZADO);
  const llaveId = contenido.subarray(MAGIA.length, MAGIA.length + LARGO_ID_LLAVE).toString('hex');
  const iv = contenido.subarray(MAGIA.length + LARGO_ID_LLAVE, LARGO_ENCABEZADO);
  const etiqueta = contenido.subarray(LARGO_ENCABEZADO, LARGO_ENCABEZADO + LARGO_ETIQUETA);
  const cifrado = contenido.subarray(LARGO_ENCABEZADO + LARGO_ETIQUETA);

  const llave = llaves.find((l) => l.id === llaveId);
  if (!llave) return { estado: 'llave_no_disponible', llaveId };

  try {
    const descifrador = createDecipheriv('aes-256-gcm', llave.bytes, iv);
    descifrador.setAAD(Buffer.concat([encabezado, Buffer.from(marcaId, 'utf8')]));
    descifrador.setAuthTag(etiqueta);
    const jpeg = Buffer.concat([descifrador.update(cifrado), descifrador.final()]);
    return { estado: 'con_foto', jpeg };
  } catch {
    // El sello no cuadra: el archivo se modifico, o es de otra marca.
    return { estado: 'alterada' };
  }
}

/** Ruta absoluta a partir de la relativa que se guarda en la base. */
export function rutaAbsolutaDeFoto(rutaRelativa: string): string {
  return path.join(carpetaDeDatos(), ...rutaRelativa.split('/'));
}

/**
 * "2026/09" segun la hora LOCAL de la captura, en la zona configurada.
 *
 * Local y no UTC: una foto de las 19:00 del 31 de octubre en Nuevo Laredo ya
 * es 1 de noviembre en UTC, y quien busque la carpeta de octubre no la
 * encontraria (ARQUITECTURA.md 6).
 */
function carpetaDelMes(capturadaEnMs: number): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHorariaVigente(),
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(capturadaEnMs));
  const ano = partes.find((p) => p.type === 'year')?.value ?? '0000';
  const mes = partes.find((p) => p.type === 'month')?.value ?? '00';
  return `${ano}/${mes}`;
}

/**
 * Saca la huella, cifra y guarda la foto. Devuelve donde quedo y su hash.
 *
 * Devuelve `null` si algo sale mal, y NUNCA lanza excepcion: si el disco esta
 * lleno o Windows no ofrece cifrado, el registro de asistencia sigue igual,
 * sin foto. La regla de oro manda sobre la evidencia.
 *
 * Lo que NUNCA hace es guardarla sin cifrar "para no perderla". Una foto en
 * claro en un pasillo publico es justo lo que el cliente pidio evitar.
 *
 * @param marcaId       el UUID de la marca: nombre del archivo y sello
 * @param dataUrl       la foto tal como llego de la pantalla
 * @param capturadaEnMs hora de la captura, para elegir la carpeta del mes
 */
export function guardarFoto(
  marcaId: string,
  dataUrl: string,
  capturadaEnMs: number,
): FotoGuardada | null {
  try {
    const jpeg = bytesDeDataUrl(dataUrl);
    if (!jpeg) {
      console.warn('[fotos] llego algo que no es una foto');
      return null;
    }
    return guardarBytesDeFoto(marcaId, jpeg, capturadaEnMs);
  } catch (fallo) {
    console.error('[fotos] no se pudo guardar la foto:', fallo);
    return null;
  }
}

/** Igual que `guardarFoto`, pero con los bytes ya decodificados. */
export function guardarBytesDeFoto(
  marcaId: string,
  jpeg: Buffer,
  capturadaEnMs: number,
): FotoGuardada | null {
  const llave = prepararLlaveDeFotos();
  if (!llave) return null;

  const hash = hashDeFoto(jpeg);
  const rutaRelativa = `${CONFIG.fotos.carpeta}/${carpetaDelMes(capturadaEnMs)}/${marcaId}${CONFIG.fotos.extension}`;
  const rutaAbsoluta = rutaAbsolutaDeFoto(rutaRelativa);

  fs.mkdirSync(path.dirname(rutaAbsoluta), { recursive: true });
  // Atomico: si se va la luz a la mitad, no queda una foto truncada que
  // despues pareceria "alterada" sin que nadie la haya tocado.
  escribirAtomico(rutaAbsoluta, cifrarFoto(jpeg, llave, marcaId));

  // El TAMANO y nada mas (ARQUITECTURA.md 14: nunca fotos en los logs).
  console.info(`[fotos] guardada cifrada (${Math.round(jpeg.length / 1024)} KB)`);
  return { rutaRelativa, hash, llaveId: llave.id };
}

/**
 * Abre una foto y comprueba que sea la que se tomo.
 *
 * Dos comprobaciones distintas, y hacen falta las dos:
 *   - el sello de GCM dice que el archivo no se toco desde que se cifro;
 *   - el hash dice que lo que se cifro es la foto que se registro con la
 *     marca (y que viajo a la nube).
 *
 * El JPEG devuelto vive SOLO en memoria. Quien lo reciba no debe escribirlo
 * en disco (ARQUITECTURA.md 5.2).
 *
 * @param llavesExtra llaves anteriores abiertas con la contrasena de recuperacion
 */
export function leerFoto(
  rutaRelativa: string,
  marcaId: string,
  hashEsperado: string | null,
  llavesExtra: Llave[] = [],
): LecturaDeFoto {
  let contenido: Buffer;
  try {
    contenido = fs.readFileSync(rutaAbsolutaDeFoto(rutaRelativa));
  } catch {
    return { estado: 'faltante' };
  }

  const actual = prepararLlaveDeFotos();
  const llaves = actual ? [actual, ...llavesExtra] : llavesExtra;
  const lectura = descifrarFoto(contenido, llaves, marcaId);

  if (lectura.estado === 'con_foto' && hashEsperado !== null && hashDeFoto(lectura.jpeg) !== hashEsperado) {
    return { estado: 'alterada' };
  }
  return lectura;
}

/**
 * Borra el archivo de una foto. Devuelve `true` si al terminar ya no existe.
 *
 * `force: true` no se queja si el archivo ya no estaba: el resultado deseado
 * (que no exista) se cumple igual.
 */
export function borrarArchivoDeFoto(rutaRelativa: string): boolean {
  const ruta = rutaAbsolutaDeFoto(rutaRelativa);
  try {
    fs.rmSync(ruta, { force: true });
    // Si el mes se quedo vacio, tambien se va la carpeta: no tiene caso
    // dejar un arbol de carpetas vacias de hace dos anos.
    const carpeta = path.dirname(ruta);
    if (fs.readdirSync(carpeta).length === 0) fs.rmdirSync(carpeta);
  } catch (fallo) {
    console.warn('[fotos] no se pudo borrar una foto:', fallo);
  }
  return !fs.existsSync(ruta);
}

/**
 * ¿La foto parece obstruida (el lente tapado)?
 *
 * La pantalla MIDE (es quien tiene el video) y el proceso principal DECIDE
 * (es quien conoce los umbrales configurables). Esa division importa: si la
 * pantalla decidiera, bastaria con manipularla para que nunca levantara la
 * bandera.
 *
 * Se necesitan las dos medidas porque cada una sola se engana facil:
 *   - solo brillo    -> una hoja de papel blanco pasaria (es muy clara)
 *   - solo varianza  -> un cuarto a oscuras con ruido pasaria
 */
export function pareceObstruida(mediciones: {
  brilloPromedio: number;
  varianza: number;
}): boolean {
  const { brilloMinimo, varianzaMinima } = umbralesDeCamara();
  return mediciones.brilloPromedio < brilloMinimo || mediciones.varianza < varianzaMinima;
}
