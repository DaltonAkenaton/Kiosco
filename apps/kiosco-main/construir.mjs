/**
 * ============================================================================
 *  COMPILADOR DEL PROCESO PRINCIPAL  (esbuild)
 * ============================================================================
 *
 *  ¿Por que hace falta compilar?
 *  -----------------------------
 *  Escribimos TypeScript (.ts), pero Electron solo entiende JavaScript (.js).
 *  Alguien tiene que traducir. Ese alguien es esbuild.
 *
 *  ¿Por que esbuild y no el compilador de TypeScript (tsc)?
 *  -------------------------------------------------------
 *  Por dos razones practicas:
 *
 *    1. VELOCIDAD. esbuild esta escrito en Go y tarda milisegundos donde tsc
 *       tarda segundos. Cuando estas probando algo, esa diferencia se nota.
 *
 *    2. EMPAQUETADO. esbuild junta todos los archivos en UNO solo. Esto es
 *       importante para el preload: Electron lo carga como un archivo suelto,
 *       y si tuviera `import` a otros archivos, no sabria donde buscarlos.
 *
 *  esbuild NO revisa tipos (solo los borra). Por eso el package.json tiene
 *  ademas el comando `npm run revisar-tipos`, que llama a tsc. La division es:
 *      esbuild -> traduce rapido
 *      tsc     -> revisa que todo cuadre
 *
 *  Uso:
 *      node construir.mjs          -> compila una vez (produccion)
 *      node construir.mjs --dev    -> compila con mapas de depuracion
 *      node construir.mjs --watch  -> recompila solo al guardar un archivo
 */

import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const carpetaDeEsteArchivo = path.dirname(fileURLToPath(import.meta.url));
const raizDelMonorepo = path.resolve(carpetaDeEsteArchivo, '../..');

const argumentos = process.argv.slice(2);
const esDesarrollo = argumentos.includes('--dev') || argumentos.includes('--watch');
const enModoVigilancia = argumentos.includes('--watch');

/** Opciones que comparten los dos archivos que compilamos. */
const opcionesComunes = {
  bundle: true,

  // "node" porque el proceso principal y el preload corren sobre Node.js,
  // no sobre un navegador normal.
  platform: 'node',

  // Version de Node que trae Electron 44. Le dice a esbuild que puede dejar
  // sintaxis moderna tal cual, sin convertirla a codigo viejo.
  target: 'node22',

  // CommonJS: el formato de modulos que Electron carga sin configuracion
  // extra, tanto para el main como (sobre todo) para el preload.
  format: 'cjs',

  /**
   * `external` = "no metas esto dentro del paquete".
   *
   * - 'electron' lo provee el propio Electron en tiempo de ejecucion.
   *
   * - 'electron-updater' se deja fuera A PROPOSITO, aunque si es una
   *   dependencia de verdad. Lee archivos suyos en tiempo de ejecucion
   *   (app-update.yml) y decide cosas segun donde esta instalado; meterlo
   *   dentro del paquete rompe esas suposiciones de formas que solo se
   *   notarian en la PC del kiosco, nunca aqui. Viaja como modulo normal
   *   dentro del .exe, que es como esta pensado.
   *
   * SQLite no aparece aqui porque usamos `node:sqlite`, que viene dentro de
   * Node (y por lo tanto de Electron). esbuild deja pasar solo cualquier
   * import que empiece con `node:`. Ver la decision D-013.
   *
   * bcryptjs y zod TAMPOCO aparecen: se empaquetan dentro del bundle. Por eso
   * estan declarados como devDependencies y no como dependencies — despues de
   * compilar no son dependencias de ejecucion, y declararlas como tales solo
   * lograria que electron-builder copiara dentro del .exe una segunda copia
   * que nadie usa.
   */
  external: ['electron', 'electron-updater'],

  // Mapas de depuracion: permiten que, cuando algo falle, el error apunte a
  // tu archivo .ts original en vez de al .js generado. Solo en desarrollo:
  // en produccion no queremos regalar el codigo fuente.
  sourcemap: esDesarrollo ? 'inline' : false,

  // Minificar = quitar espacios y acortar nombres. Hace el archivo mas chico
  // y de paso un poco mas molesto de leer para un curioso.
  minify: !esDesarrollo,

  // Deja escrito en el JavaScript final si se compilo para desarrollo.
  define: {
    'process.env.NODE_ENV': JSON.stringify(esDesarrollo ? 'development' : 'production'),
  },

  // Para que funcione `import { CONFIG } from '@kiosko/compartido'`.
  // Es el mismo atajo declarado en tsconfig.base.json; esbuild necesita que
  // se lo digamos aparte porque el no lee esa parte del tsconfig.
  alias: {
    '@kiosko/compartido': path.join(raizDelMonorepo, 'packages/compartido/src/index.ts'),
  },

  logLevel: 'info',
};

/**
 * Dos puntos de entrada distintos, con DOS salidas distintas.
 * No se pueden juntar: Electron carga cada uno por su lado y en momentos
 * diferentes del arranque.
 */
const objetivos = [
  {
    nombre: 'main',
    entryPoints: [path.join(carpetaDeEsteArchivo, 'src/main.ts')],
    outfile: path.join(carpetaDeEsteArchivo, 'dist/main.js'),
  },
  {
    nombre: 'preload',
    entryPoints: [path.join(carpetaDeEsteArchivo, 'src/preload.ts')],
    outfile: path.join(carpetaDeEsteArchivo, 'dist/preload.js'),
  },
];

/**
 * `nombre` es solo para nuestros mensajes en pantalla; esbuild no lo conoce
 * y se queja si se lo mandamos. Por eso lo separamos del resto de opciones.
 */
function separarNombre({ nombre, ...opciones }) {
  return { nombre, opciones };
}

if (enModoVigilancia) {
  // Modo vigilancia: se queda corriendo y recompila cada vez que guardas.
  for (const objetivo of objetivos) {
    const { nombre, opciones } = separarNombre(objetivo);
    const vigilante = await context({ ...opcionesComunes, ...opciones });
    await vigilante.watch();
    console.log(`[construir] vigilando ${nombre}...`);
  }
} else {
  // Compilacion normal: una pasada y listo.
  await Promise.all(
    objetivos.map((objetivo) => build({ ...opcionesComunes, ...separarNombre(objetivo).opciones })),
  );
  console.log(`[construir] listo (${esDesarrollo ? 'desarrollo' : 'produccion'})`);
}
