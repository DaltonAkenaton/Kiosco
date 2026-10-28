/**
 * ============================================================================
 *  LA LLAVE DE LAS FOTOS  (ARQUITECTURA.md 5.1, "Llave de cifrado y recuperacion")
 * ============================================================================
 *
 *  Todas las fotos del kiosco se cifran con UNA llave: 32 bytes al azar que
 *  se generan la primera vez que arranca la app. Este archivo decide donde
 *  vive esa llave y como se protege.
 *
 *  ---------------------------------------------------------------------------
 *  EL PROBLEMA: una llave necesita guardarse, y guardarla en claro no sirve
 *  ---------------------------------------------------------------------------
 *  Si la llave estuviera escrita tal cual en un archivo junto a las fotos,
 *  cifrarlas no serviria de nada: quien copie la carpeta se lleva las dos
 *  cosas. Por eso la llave NUNCA se escribe en claro. Se guarda "envuelta"
 *  (cifrada a su vez), y de DOS formas independientes:
 *
 *      llave-fotos.json
 *      ├── dpapi          envuelta por Windows (safeStorage de Electron).
 *      │                  La app la abre sola, sin preguntar nada. Solo
 *      │                  funciona en ESTA computadora y con ESTE perfil.
 *      │
 *      └── recuperacion   envuelta con la contrasena de recuperacion que
 *                         define el administrador. Funciona en CUALQUIER
 *                         computadora, a quien la sepa.
 *
 *  ¿Por que dos? Porque cada una tapa el hueco de la otra:
 *
 *    - Solo DPAPI: si se reinstala Windows o se recrea el perfil, las fotos
 *      quedan ilegibles PARA SIEMPRE. Y en esta facultad "las computadoras
 *      cambian con frecuencia" (ARQUITECTURA.md 1).
 *    - Solo contrasena: la app tendria que pedirla en cada arranque, y un
 *      kiosco que se queda esperando una contrasena a las 6 AM es un kiosco
 *      donde nadie checa.
 *
 *  ---------------------------------------------------------------------------
 *  ¿Y si Windows ya no puede abrir la llave?
 *  ---------------------------------------------------------------------------
 *  Pasa si alguien copia la carpeta de datos a otra PC, o si se recreo el
 *  perfil. El kiosco NO se detiene (regla de oro): aparta el archivo viejo
 *  con otro nombre (nunca lo borra), crea una llave nueva y sigue
 *  registrando. Las fotos viejas se recuperan despues con la contrasena.
 *  Cada foto lleva escrito el id de la llave que la cifro, asi que siempre se
 *  sabe cual hace falta.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { safeStorage } from 'electron';
import { CONFIG } from '@kiosko/compartido';
import { registrarEvento } from '../datos/repositorio-eventos';
import { carpetaDeDatos } from '../entorno';

const scryptAsincrono = promisify(scrypt) as (
  contrasena: string,
  sal: Buffer,
  largo: number,
  opciones: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** AES-256 usa llaves de 32 bytes. */
const LARGO_LLAVE = 32;
/** GCM recomienda un vector de inicio de 12 bytes. */
const LARGO_IV = 12;

/** La llave ya abierta, en memoria. Nunca sale de este proceso. */
export interface Llave {
  /** Identificador publico (no es secreto): va escrito en cada foto. */
  id: string;
  bytes: Buffer;
}

/** La envoltura con la contrasena de recuperacion, tal como queda en el archivo. */
interface EnvolturaRecuperacion {
  kdf: 'scrypt';
  costo: number;
  tamanoBloque: number;
  paralelismo: number;
  sal: string;
  iv: string;
  etiqueta: string;
  llaveCifrada: string;
  definidaEn: string;
}

/** El contenido de llave-fotos.json. Ningun campo es la llave en claro. */
interface ArchivoLlave {
  formato: 1;
  id: string;
  creadaEn: string;
  dpapi: string;
  recuperacion: EnvolturaRecuperacion | null;
}

/** La llave abierta en esta sesion. `null` hasta la primera vez que hace falta. */
let llaveActiva: Llave | null = null;
/** El archivo tal como esta en disco, para poder agregarle la recuperacion. */
let archivoActivo: ArchivoLlave | null = null;

function rutaDelArchivo(): string {
  return path.join(carpetaDeDatos(), CONFIG.fotos.archivoLlave);
}

/**
 * Escribe un archivo de forma ATOMICA: primero a un temporal y luego lo
 * renombra encima.
 *
 * Si la luz se va a media escritura, queda el archivo viejo completo o el
 * nuevo completo, nunca uno a medias. Con la llave eso es la diferencia entre
 * "no paso nada" y "se perdieron todas las fotos".
 */
export function escribirAtomico(ruta: string, contenido: string | Buffer): void {
  const temporal = `${ruta}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporal, contenido);
  fs.renameSync(temporal, ruta);
}

/**
 * Aparta un archivo de llave que ya no se puede usar, SIN BORRARLO.
 *
 * Con la contrasena de recuperacion todavia abre las fotos viejas, asi que
 * borrarlo seria destruir evidencia.
 */
function apartar(ruta: string, sufijo: string): string {
  const destino = ruta.replace(/\.json$/, `.${Date.now()}.${sufijo}.json`);
  fs.renameSync(ruta, destino);
  return path.basename(destino);
}

/**
 * Deja la llave lista para usarse: la abre si existe, o la crea si no.
 *
 * Devuelve `null` solo si Windows no ofrece cifrado (safeStorage no
 * disponible). En ese caso NO se inventa una alternativa insegura: las fotos
 * no se guardan, y el registro sigue sin foto (regla de oro).
 *
 * Se puede llamar las veces que sea: despues de la primera devuelve la llave
 * que ya esta en memoria.
 */
export function prepararLlaveDeFotos(): Llave | null {
  if (llaveActiva) return llaveActiva;

  if (!safeStorage.isEncryptionAvailable()) {
    console.error('[llave] Windows no ofrece cifrado (safeStorage); las fotos no se guardaran');
    registrarEvento('cifrado_no_disponible', {});
    return null;
  }

  const ruta = rutaDelArchivo();

  if (fs.existsSync(ruta)) {
    let archivo: ArchivoLlave | null = null;
    try {
      archivo = JSON.parse(fs.readFileSync(ruta, 'utf8')) as ArchivoLlave;
    } catch {
      archivo = null;
    }

    if (archivo) {
      try {
        const texto = safeStorage.decryptString(Buffer.from(archivo.dpapi, 'base64'));
        const bytes = Buffer.from(texto, 'base64');
        if (bytes.length !== LARGO_LLAVE) throw new Error('largo de llave invalido');

        llaveActiva = { id: archivo.id, bytes };
        archivoActivo = archivo;
        return llaveActiva;
      } catch {
        // Windows no la abre: otra PC u otro perfil. Se aparta y se sigue.
        const apartado = apartar(ruta, 'ilegible');
        console.error(`[llave] Windows no pudo abrir la llave; apartada como ${apartado}`);
        registrarEvento('llave_fotos_reemplazada', {
          motivo: 'dpapi_ilegible',
          llaveAnteriorId: archivo.id,
          conRecuperacion: archivo.recuperacion !== null,
        });
      }
    } else {
      const apartado = apartar(ruta, 'danada');
      console.error(`[llave] el archivo de la llave esta danado; apartado como ${apartado}`);
      registrarEvento('llave_fotos_reemplazada', { motivo: 'archivo_danado' });
    }
  }

  return crearLlave(ruta);
}

function crearLlave(ruta: string): Llave {
  const bytes = randomBytes(LARGO_LLAVE);
  const archivo: ArchivoLlave = {
    formato: 1,
    id: randomBytes(16).toString('hex'),
    creadaEn: new Date().toISOString(),
    dpapi: safeStorage.encryptString(bytes.toString('base64')).toString('base64'),
    recuperacion: null,
  };

  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  escribirAtomico(ruta, JSON.stringify(archivo, null, 2));

  llaveActiva = { id: archivo.id, bytes };
  archivoActivo = archivo;

  console.info('[llave] llave de fotos creada; falta definir la contrasena de recuperacion');
  registrarEvento('llave_fotos_creada', { llaveId: archivo.id });
  return llaveActiva;
}

/**
 * ¿Ya se definio la contrasena de recuperacion?
 *
 * Mientras sea `false`, las fotos dependen SOLO de este perfil de Windows.
 * El modo administrador lo avisa hasta que se defina.
 */
export function tieneContrasenaDeRecuperacion(): boolean {
  prepararLlaveDeFotos();
  return archivoActivo?.recuperacion != null;
}

async function derivarLlave(
  contrasena: string,
  sal: Buffer,
  parametros: { costo: number; tamanoBloque: number; paralelismo: number },
): Promise<Buffer> {
  return scryptAsincrono(contrasena, sal, LARGO_LLAVE, {
    N: parametros.costo,
    r: parametros.tamanoBloque,
    p: parametros.paralelismo,
    // scrypt usa ~128·N·r bytes; el tope por defecto de Node es justo eso y
    // falla. Se le da el doble de margen.
    maxmem: 256 * parametros.costo * parametros.tamanoBloque,
  });
}

/**
 * Envuelve la llave con la contrasena de recuperacion (o la cambia).
 *
 * La contrasena NO se guarda en ningun lado: solo la llave cifrada con ella.
 * Si se olvida y Windows ya no abre la llave, las fotos se pierden. Por eso
 * se entrega impresa con las demas credenciales (ARQUITECTURA.md 1.1).
 */
export async function definirContrasenaDeRecuperacion(
  contrasena: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  if (contrasena.length < CONFIG.fotos.largoMinimoContrasenaRecuperacion) {
    return {
      ok: false,
      mensaje: `La contraseña debe tener al menos ${CONFIG.fotos.largoMinimoContrasenaRecuperacion} letras o números.`,
    };
  }

  const llave = prepararLlaveDeFotos();
  if (!llave || !archivoActivo) {
    return { ok: false, mensaje: 'Esta computadora no ofrece cifrado; no hay llave que proteger.' };
  }

  const parametros = CONFIG.fotos.scrypt;
  const sal = randomBytes(16);
  const iv = randomBytes(LARGO_IV);
  const envolvente = await derivarLlave(contrasena, sal, parametros);

  const cifrador = createCipheriv('aes-256-gcm', envolvente, iv);
  // El id de la llave va como "dato asociado": queda sellado junto con la
  // llave, asi que una envoltura no se puede trasplantar a otro archivo.
  cifrador.setAAD(Buffer.from(llave.id, 'utf8'));
  const llaveCifrada = Buffer.concat([cifrador.update(llave.bytes), cifrador.final()]);

  const nuevo: ArchivoLlave = {
    ...archivoActivo,
    recuperacion: {
      kdf: 'scrypt',
      ...parametros,
      sal: sal.toString('base64'),
      iv: iv.toString('base64'),
      etiqueta: cifrador.getAuthTag().toString('base64'),
      llaveCifrada: llaveCifrada.toString('base64'),
      definidaEn: new Date().toISOString(),
    },
  };

  escribirAtomico(rutaDelArchivo(), JSON.stringify(nuevo, null, 2));
  archivoActivo = nuevo;

  console.info('[llave] contrasena de recuperacion definida');
  registrarEvento('recuperacion_fotos_definida', { llaveId: llave.id });
  return { ok: true };
}

/**
 * Abre una llave con la contrasena de recuperacion, SIN Windows.
 *
 * Recibe el CONTENIDO del archivo, no una ruta, porque su uso real es leer el
 * disco de una PC muerta desde otra computadora: el archivo puede venir de
 * cualquier lado (una USB, un disco conectado por fuera).
 *
 * Devuelve `null` si la contrasena es incorrecta, si el archivo no tiene
 * envoltura de recuperacion, o si esta danado. Las tres cosas se ven igual a
 * proposito: no se le dice a quien prueba contrasenas cual fallo.
 */
export async function abrirLlaveConRecuperacion(
  contenidoDelArchivo: string,
  contrasena: string,
): Promise<Llave | null> {
  try {
    const archivo = JSON.parse(contenidoDelArchivo) as ArchivoLlave;
    const r = archivo.recuperacion;
    if (!r || r.kdf !== 'scrypt') return null;

    const envolvente = await derivarLlave(contrasena, Buffer.from(r.sal, 'base64'), r);
    const descifrador = createDecipheriv('aes-256-gcm', envolvente, Buffer.from(r.iv, 'base64'));
    descifrador.setAAD(Buffer.from(archivo.id, 'utf8'));
    descifrador.setAuthTag(Buffer.from(r.etiqueta, 'base64'));
    const bytes = Buffer.concat([
      descifrador.update(Buffer.from(r.llaveCifrada, 'base64')),
      descifrador.final(), // lanza si la contrasena no es la correcta
    ]);

    return { id: archivo.id, bytes };
  } catch {
    return null;
  }
}

/** La ruta del archivo de la llave, para el manual y para las pruebas. */
export function rutaDeLaLlave(): string {
  return rutaDelArchivo();
}

/**
 * Olvida la llave que esta en memoria. SOLO PARA PRUEBAS: simula un arranque
 * nuevo de la app sin tener que cerrarla.
 */
export function olvidarLlaveEnMemoria(): void {
  llaveActiva = null;
  archivoActivo = null;
}
