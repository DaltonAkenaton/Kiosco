/**
 * ============================================================================
 *  GENERADOR DE TEMA:  tema.json  ->  src/tema.css
 * ============================================================================
 *
 *  El problema que resuelve
 *  ------------------------
 *  Los colores los necesitan dos mundos que no se entienden:
 *
 *      TypeScript (Electron)  ->  puede leer un .json
 *      CSS (la pantalla)      ->  NO puede leer un .json
 *
 *  La salida facil seria escribir los colores dos veces, una en cada lado,
 *  con un comentario que diga "acuerdate de cambiar tambien el otro".
 *  Eso SIEMPRE falla. Alguien cambia uno, olvida el otro, y el sistema queda
 *  con la ventana de un color y la pantalla de otro.
 *
 *  La solucion: un solo lugar manda (`tema.json`) y una herramienta genera lo
 *  demas. Es exactamente la misma regla del proyecto que aplicamos al PIN.
 *
 *  ¿Cuando corre esto?
 *  -------------------
 *  Solo. En package.json hay dos ganchos:
 *
 *      "prestart": "node generar-tema.mjs"
 *      "prebuild": "node generar-tema.mjs"
 *
 *  npm ejecuta automaticamente el script "preX" antes del script "X". Asi que
 *  cada `npm start` y cada `npm run build` regeneran el tema primero.
 *  No hay forma de que se te olvide.
 *
 *  Tambien lo puedes correr a mano:  node generar-tema.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const carpetaDeEsteArchivo = path.dirname(fileURLToPath(import.meta.url));
const raizDelMonorepo = path.resolve(carpetaDeEsteArchivo, '../..');

const ARCHIVO_ORIGEN = path.join(raizDelMonorepo, 'packages/compartido/src/tema.json');
// Por defecto, el del kiosco. El panel lo llama con su propio destino
// (`node ../kiosco-ui/generar-tema.mjs src/tema.css`): mismos colores, un
// solo generador.
const ARCHIVO_DESTINO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(carpetaDeEsteArchivo, 'src/tema.css');

const tema = JSON.parse(readFileSync(ARCHIVO_ORIGEN, 'utf8'));

// ----------------------------------------------------------------------------
//  Revision de seguridad visual (antes de generar nada)
// ----------------------------------------------------------------------------
/**
 * Convierte "#1e3a5f" a sus tres componentes de rojo, verde y azul.
 * Un color hexadecimal son tres pares: #RRGGBB, cada uno de 0 a 255.
 */
function aRgb(hex) {
  const limpio = hex.replace('#', '');
  return [
    parseInt(limpio.slice(0, 2), 16),
    parseInt(limpio.slice(2, 4), 16),
    parseInt(limpio.slice(4, 6), 16),
  ];
}

/**
 * Que tan distintos son dos colores, en una escala aproximada de 0 a 441.
 * Es la distancia en linea recta entre los dos puntos RGB. No es perfecta
 * (el ojo humano no percibe los colores de forma lineal), pero para detectar
 * "estos dos se parecen demasiado" sirve de sobra.
 */
function distancia(colorA, colorB) {
  const [r1, v1, a1] = aRgb(colorA);
  const [r2, v2, a2] = aRgb(colorB);
  return Math.sqrt((r1 - r2) ** 2 + (v1 - v2) ** 2 + (a1 - a2) ** 2);
}

/**
 * Debajo de esta distancia consideramos que dos colores se confunden de un
 * vistazo rapido, a dos metros, con sueño, a las 6 de la mañana.
 */
const DISTANCIA_MINIMA_SEGURA = 80;

const { colores } = tema;
const avisos = [];

/**
 * Excepciones aceptadas a proposito.
 *
 * A veces dos colores se parecen segun la medida, pero en la practica NUNCA
 * compiten porque aparecen en sitios distintos y no hay ninguna decision en la
 * que el usuario tenga que distinguirlos.
 *
 * ¿Por que una lista y no simplemente bajar el umbral?
 * Porque bajar el umbral apagaria TODOS los avisos, incluidos los reales.
 * Y dejar un aviso permanente en pantalla es peor: la gente se acostumbra a
 * ignorarlo y el dia que aparezca uno de verdad, tampoco lo va a ver.
 *
 * Cada excepcion exige un MOTIVO escrito. Si no puedes explicar por que es
 * segura, probablemente no lo es.
 */
const excepciones = tema.excepcionesDeContraste ?? [];

function estaAceptado(colorA, colorB) {
  return excepciones.some(
    ({ par }) => par.includes(colorA) && par.includes(colorB),
  );
}

// El aviso que mas importa: ENTRADA y SALIDA tienen que ser inconfundibles.
// El CLAUDE.md seccion 4 pide "la mayor distincion visual posible".
if (distancia(colores.entrada, colores.salida) < DISTANCIA_MINIMA_SEGURA * 2) {
  avisos.push(
    `ENTRADA (${colores.entrada}) y SALIDA (${colores.salida}) se parecen demasiado. ` +
      `Alguien puede registrar la accion equivocada.`,
  );
}

// Si un color institucional se parece a ENTRADA o SALIDA, los adornos de la
// pantalla compiten con la informacion importante.
//
// Se recorren todos los colores que empiecen por "institucion", asi que si
// manana agregas `institucionCuaternario` queda revisado sin tocar nada.
const coloresInstitucionales = Object.keys(colores).filter((clave) =>
  clave.startsWith('institucion'),
);

for (const institucional of coloresInstitucionales) {
  for (const semantico of ['entrada', 'salida', 'peligro']) {
    if (distancia(colores[institucional], colores[semantico]) >= DISTANCIA_MINIMA_SEGURA) continue;

    if (estaAceptado(institucional, semantico)) {
      console.log(`[tema] excepcion aceptada: ${institucional} / ${semantico}`);
      continue;
    }

    avisos.push(
      `${institucional} (${colores[institucional]}) se parece mucho a ` +
        `${semantico} (${colores[semantico]}). El adorno institucional puede ` +
        `restarle fuerza a la informacion del registro.\n` +
        `         Si en tu diseño esos dos colores nunca compiten, agregalo a ` +
        `"excepcionesDeContraste" en tema.json con un motivo escrito.`,
    );
  }
}

// El texto tiene que leerse sobre el fondo.
if (distancia(colores.texto, colores.fondo) < 200) {
  avisos.push(
    `El texto (${colores.texto}) tiene poco contraste contra el fondo ` +
      `(${colores.fondo}). Va a costar leerlo en un pasillo con poca luz.`,
  );
}

for (const aviso of avisos) {
  console.warn(`[tema] AVISO: ${aviso}`);
}

// ----------------------------------------------------------------------------
//  Generacion del CSS
// ----------------------------------------------------------------------------
/**
 * Convierte cada color en una variable CSS.
 *   institucionPrimario  ->  --kiosko-institucion-primario
 *
 * La expresion regular busca cada letra mayuscula y le pone un guion delante,
 * que es la costumbre de nombres en CSS.
 *
 * ¿Por que el prefijo `--kiosko-` y no `--color-`?
 * Porque `--color-*` es el espacio de nombres que usa Tailwind para SUS
 * colores. Si usaramos el mismo, en styles.css acabariamos escribiendo
 * `--color-fondo: var(--color-fondo)`, que se apunta a si mismo: una
 * referencia circular que el navegador descarta en silencio, y el color
 * simplemente no aparece. Con dos nombres distintos, el traspaso es
 * explicito y no depende del orden en que se carguen los archivos.
 */
function aNombreCss(clave) {
  return clave.replace(/[A-Z]/g, (letra) => `-${letra.toLowerCase()}`);
}

const lineasDeColores = Object.entries(colores)
  .map(([clave, valor]) => `  --kiosko-${aNombreCss(clave)}: ${valor};`)
  .join('\n');

const contenido = `/* ==========================================================================
   ARCHIVO GENERADO AUTOMATICAMENTE - NO LO EDITES A MANO
   ==========================================================================

   Se genera a partir de:  packages/compartido/src/tema.json
   Lo genera el script:    apps/kiosco-ui/generar-tema.mjs

   Cualquier cambio que escribas aqui se va a perder la proxima vez que
   arranques o compiles la interfaz.

   Para cambiar un color:  edita tema.json y guarda.
   ========================================================================== */

:root {
${lineasDeColores}
}
`;

writeFileSync(ARCHIVO_DESTINO, contenido, 'utf8');

const cantidad = Object.keys(colores).length;
console.log(
  `[tema] ${cantidad} colores generados en src/tema.css` +
    (avisos.length > 0 ? ` (con ${avisos.length} aviso(s) arriba)` : ''),
);
