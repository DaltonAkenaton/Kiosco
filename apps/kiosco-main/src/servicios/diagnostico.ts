/**
 * ============================================================================
 *  DIAGNOSTICO: lo que el kiosco anota, guardado en un archivo  (06-10-2026)
 * ============================================================================
 *
 *  EL PROBLEMA. Todo el kiosco escribe en la consola lo que le pasa:
 *  "[camara] desconectada", "[sync] en_linea -> sin_conexion", errores...
 *  Pero la consola solo existe mientras alguien la mira, y en la PC de la
 *  facultad nadie la mira. Al cerrar el kiosco, todo eso se perdia. Si un
 *  dia la camara fallaba "a ratos", no habia forma de saber cuando ni por que.
 *
 *  LA SOLUCION. Al arrancar, este archivo "se cuelga" de console.info/warn/
 *  error: cada mensaje sigue saliendo en la consola como siempre Y ADEMAS se
 *  anota en un archivo de texto por dia:
 *
 *      <carpeta de datos>\diagnostico\kiosco-2026-10-06.log
 *
 *      2026-10-06 10:20:31  AVISO  [pantalla:warning] [camara] no disponible: desconectada
 *      2026-10-06 10:20:31  INFO   [camara] desconectada - desconectada
 *
 *  Como un diario de a bordo: no sirve de nada hasta el dia que algo falla,
 *  y ese dia es lo unico que sirve.
 *
 *  ¿Y "a distancia"? El archivo vive en el kiosco (como las fotos). Para que
 *  llegue a quien da soporte: modo administrador -> "Guardar diagnostico"
 *  lo copia a una memoria USB, y de ahi se manda por correo o WhatsApp.
 *
 *  LAS TRES REGLAS
 *    1. NUNCA rompe el kiosco. Si el disco esta lleno o la carpeta no se
 *       puede crear, se deja de anotar en silencio y ya. Por eso todo va en
 *       try/catch: un diario que tumba el barco es peor que no tener diario.
 *    2. NUNCA lleva PINes, tokens ni fotos (CLAUDE.md 16). El codigo ya no
 *       los manda a la consola, pero por si algun dia alguien se equivoca,
 *       cada renglon pasa por `limpiar()` antes de escribirse.
 *    3. NO CRECE SIN LIMITE. Un archivo por dia, con tope de tamaño, y los de
 *       mas de `diasQueSeGuardan` se borran solos.
 */

import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { CONFIG } from '@kiosko/compartido';

const D = CONFIG.diagnostico;

type Nivel = 'INFO' | 'AVISO' | 'ERROR';

let carpeta: string | null = null;
let consolaEnvuelta = false;
let obtenerZona: () => string = () => CONFIG.reloj.zonaHorariaPorDefecto;

/** La zona se vuelve a leer cada tanto, no en cada renglon: leerla cuesta una consulta. */
let zona: string = CONFIG.reloj.zonaHorariaPorDefecto;
let zonaLeidaEnMs = 0;
const MS_ENTRE_LECTURAS_DE_ZONA = 10 * 60 * 1000;
let formato: Intl.DateTimeFormat | null = null;

/** Para no pasarse del tope diario: el dia que se esta escribiendo y si ya se lleno. */
let diaActual = '';
let diaLleno = false;

/**
 * Limpia un renglon antes de escribirlo (regla 2).
 *
 *   - Una foto en base64 ("data:image/jpeg;base64,...") -> [imagen]
 *   - Un hash bcrypt de PIN ("$2b$10$...")             -> [hash]
 *   - Algo larguisimo                                   -> cortado
 *
 * Exportada para probarla.
 */
export function limpiar(texto: string): string {
  const limpio = texto
    .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gi, '[imagen]')
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[hash]')
    .replace(/[\r\n]+/g, ' ⏎ ');
  return limpio.length > D.maxCaracteresPorRenglon ? `${limpio.slice(0, D.maxCaracteresPorRenglon)}… [cortado]` : limpio;
}

/** "2026-10-06" y "10:20:31", en la hora de Nuevo Laredo (CLAUDE.md 6), no la de Windows. */
function fechaYHora(ahora: Date): { dia: string; hora: string } {
  if (Date.now() - zonaLeidaEnMs > MS_ENTRE_LECTURAS_DE_ZONA) {
    zonaLeidaEnMs = Date.now();
    try {
      const nueva = obtenerZona();
      if (nueva !== zona || !formato) {
        zona = nueva;
        formato = null;
      }
    } catch {
      // Sin base todavia (muy al principio del arranque): se queda la anterior.
    }
  }
  formato ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(formato.formatToParts(ahora).map((x) => [x.type, x.value]));
  return { dia: `${p['year']}-${p['month']}-${p['day']}`, hora: `${p['hour']}:${p['minute']}:${p['second']}` };
}

/** Anota un renglon. Nunca lanza (regla 1). */
function anotar(nivel: Nivel, argumentos: unknown[]): void {
  if (!carpeta) return;
  try {
    const { dia, hora } = fechaYHora(new Date());
    if (dia !== diaActual) {
      diaActual = dia;
      diaLleno = false;
    }
    if (diaLleno) return;

    const archivo = path.join(carpeta, `kiosco-${dia}.log`);
    const tamano = fs.existsSync(archivo) ? fs.statSync(archivo).size : 0;
    if (tamano >= D.maxBytesPorDia) {
      diaLleno = true;
      fs.appendFileSync(archivo, `${dia} ${hora}  AVISO  [diagnostico] se llego al tope del dia; ya no se anota mas hoy\n`);
      return;
    }
    // Sincrono a proposito: son unos cuantos renglones por minuto, y asi lo
    // ultimo antes de una caida SI alcanza a quedar en el archivo.
    fs.appendFileSync(archivo, `${dia} ${hora}  ${nivel.padEnd(5)}  ${limpiar(format(...argumentos))}\n`);
  } catch {
    // Disco lleno, permisos... El kiosco sigue; el diario no (regla 1).
  }
}

/** Borra los archivos de mas de `diasQueSeGuardan` (regla 3). */
function borrarViejos(): void {
  if (!carpeta) return;
  try {
    const limite = Date.now() - D.diasQueSeGuardan * 24 * 60 * 60 * 1000;
    for (const nombre of fs.readdirSync(carpeta)) {
      if (!/^kiosco-\d{4}-\d{2}-\d{2}\.log$/.test(nombre)) continue;
      const ruta = path.join(carpeta, nombre);
      if (fs.statSync(ruta).mtimeMs < limite) fs.rmSync(ruta, { force: true });
    }
  } catch {
    // Regla 1.
  }
}

/**
 * Se llama UNA vez, lo mas temprano posible en el arranque, para que hasta
 * los mensajes del arranque queden anotados.
 *
 * @param carpetaDeDatos  la carpeta de datos del kiosco (userData)
 * @param zonaVigente     de donde leer la zona horaria (configuracion_cache)
 */
export function iniciarDiagnostico(carpetaDeDatos: string, zonaVigente?: () => string): void {
  if (!D.activo || carpeta) return;
  try {
    const destino = path.join(carpetaDeDatos, D.carpeta);
    fs.mkdirSync(destino, { recursive: true });
    carpeta = destino;
  } catch {
    return; // Regla 1: sin carpeta, sin diario.
  }
  if (zonaVigente) obtenerZona = zonaVigente;
  borrarViejos();

  if (consolaEnvuelta) return;
  consolaEnvuelta = true;

  // "Colgarse" de la consola: lo de siempre, mas el archivo.
  const original = { info: console.info, log: console.log, warn: console.warn, error: console.error };
  console.info = (...a: unknown[]) => { original.info(...a); anotar('INFO', a); };
  console.log = (...a: unknown[]) => { original.log(...a); anotar('INFO', a); };
  console.warn = (...a: unknown[]) => { original.warn(...a); anotar('AVISO', a); };
  console.error = (...a: unknown[]) => { original.error(...a); anotar('ERROR', a); };
  // Los errores no atendidos ya los escribe main.ts con console.error ("RED DE
  // SEGURIDAD CONTRA CAIDAS"), asi que tambien llegan aqui sin hacer nada mas.
}

/**
 * Copia los archivos del diario a `destino`, dentro de una carpeta con fecha,
 * junto con un `resumen.txt` que arma quien llama (version, estado...).
 * Devuelve cuantos archivos copio. Lanza si no se pudo escribir en el destino.
 */
export function copiarDiagnostico(destino: string, resumen: string): { carpeta: string; archivos: number } {
  const { dia, hora } = fechaYHora(new Date());
  const salida = path.join(destino, `diagnostico-kiosco-${dia}_${hora.replaceAll(':', '-')}`);
  fs.mkdirSync(salida, { recursive: true });
  let archivos = 0;
  if (carpeta && fs.existsSync(carpeta)) {
    for (const nombre of fs.readdirSync(carpeta)) {
      if (!nombre.endsWith('.log')) continue;
      fs.copyFileSync(path.join(carpeta, nombre), path.join(salida, nombre));
      archivos++;
    }
  }
  fs.writeFileSync(path.join(salida, 'resumen.txt'), resumen);
  return { carpeta: salida, archivos };
}

/** Solo pruebas: olvidar el estado para poder iniciar otra vez en otra carpeta. */
export function reiniciarDiagnosticoParaPrueba(): void {
  carpeta = null;
  diaActual = '';
  diaLleno = false;
  zonaLeidaEnMs = 0;
  formato = null;
}
