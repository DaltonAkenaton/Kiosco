/**
 * ============================================================================
 *  REVISION DE LA INTERFAZ YA COMPILADA
 * ============================================================================
 *
 *  Corre solo, despues de cada `ng build`. Revisa el `index.html` generado
 *  buscando cosas que la Content-Security-Policy del kiosco va a BLOQUEAR
 *  cuando la app corra empaquetada.
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE EXISTE ESTE ARCHIVO
 *  ---------------------------------------------------------------------------
 *  Por el error E-015, que es el mas caro que ha tenido el proyecto en tiempo
 *  de diagnostico. Resumido:
 *
 *    - En desarrollo, la pantalla se veia perfecta.
 *    - Todas las pruebas pasaban.
 *    - La revision de tipos, limpia.
 *    - El instalador se generaba sin una sola advertencia.
 *    - Y al abrir el .exe, la pantalla aparecia SIN UN SOLO ESTILO.
 *
 *  La causa era una linea que Angular genera solo en produccion:
 *
 *      <link rel="stylesheet" href="styles.css"
 *            media="print" onload="this.media='all'">
 *
 *  Ese `onload=` es codigo en linea. La CSP del kiosco lo bloquea —
 *  correctamente, esa es exactamente su razon de ser — asi que el `media`
 *  nunca cambiaba de "print" a "all" y la hoja de estilos nunca se aplicaba.
 *
 *  ---------------------------------------------------------------------------
 *  LA LECCION QUE ESTE ARCHIVO CONVIERTE EN CODIGO
 *  ---------------------------------------------------------------------------
 *  El problema de fondo no fue la linea: fue que NADA la detecto. Entre el
 *  `ng build` y el ojo humano mirando la pantalla no habia nada revisando, y
 *  el sintoma solo aparecia en la ultima etapa de todas — la mas lenta de
 *  reproducir, porque hay que generar un instalador de 107 MB.
 *
 *  Un error que solo se ve en el ultimo paso tiene que cazarse en el primero.
 *
 *  Uso:  node verificar-compilado.mjs
 *        (corre solo como `postbuild` en package.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(aqui, '../kiosco-main/dist/interfaz/index.html');

if (!fs.existsSync(INDEX)) {
  console.error(`[verificar] no encontre ${INDEX}`);
  process.exit(1);
}

const html = fs.readFileSync(INDEX, 'utf8');

/** Cada problema encontrado: que es, por que importa, y como se arregla. */
const problemas = [];

// ---------------------------------------------------------------------------
//  1. Manejadores de eventos EN LINEA  (onload=, onclick=, onerror=...)
// ---------------------------------------------------------------------------
//  Son la causa exacta de E-015. La CSP con `script-src 'self'` los bloquea
//  sin decir nada: no hay error en pantalla, la cosa simplemente no ocurre.
//
//  El patron pide un espacio antes del `on` para no confundirse con atributos
//  que llevan esas letras en medio, como `content=` en las etiquetas <meta>.
for (const coincidencia of html.matchAll(/\son([a-z]+)\s*=\s*["'][^"']*["']/gi)) {
  problemas.push({
    que: `manejador en linea: ${coincidencia[0].trim().slice(0, 60)}`,
    porque:
      'la CSP de produccion lo bloquea en silencio; en desarrollo funciona y ' +
      'en el .exe no',
  });
}

// ---------------------------------------------------------------------------
//  2. Hojas de estilo diferidas con media="print"
// ---------------------------------------------------------------------------
//  Es la otra mitad del mismo truco. Aunque el `onload` desapareciera, una
//  hoja que se queda en `media="print"` no se aplica nunca.
for (const coincidencia of html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi)) {
  const etiqueta = coincidencia[0];
  if (/media\s*=\s*["']print["']/i.test(etiqueta)) {
    problemas.push({
      que: `hoja de estilos diferida: ${etiqueta.slice(0, 80)}`,
      porque:
        'con media="print" la hoja no se aplica en pantalla; depende de un ' +
        'script que la CSP bloquea',
    });
  }
}

// ---------------------------------------------------------------------------
//  3. Scripts EN LINEA (sin `src`)
// ---------------------------------------------------------------------------
//  Mismo motivo: `script-src 'self'` solo permite archivos, no codigo suelto
//  dentro del HTML. Angular normalmente no genera ninguno, pero una
//  configuracion nueva podria hacerlo sin avisar.
for (const coincidencia of html.matchAll(/<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  // Los scripts de tipo "speculationrules" o JSON no se ejecutan, no estorban.
  if (/type\s*=\s*["'](application\/json|speculationrules)["']/i.test(coincidencia[0])) continue;
  if (coincidencia[1].trim() === '') continue;

  problemas.push({
    que: `script en linea de ${coincidencia[1].trim().length} caracteres`,
    porque: 'la CSP de produccion solo permite scripts con `src`, no codigo dentro del HTML',
  });
}

// ---------------------------------------------------------------------------
//  4. Que la hoja de estilos exista de verdad
// ---------------------------------------------------------------------------
//  Una comprobacion boba que cuesta dos lineas: si el HTML apunta a un archivo
//  que no se genero, el sintoma seria identico al de E-015.
for (const coincidencia of html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)) {
  const archivo = path.resolve(path.dirname(INDEX), coincidencia[1]);
  if (!fs.existsSync(archivo)) {
    problemas.push({
      que: `la hoja de estilos ${coincidencia[1]} no existe`,
      porque: 'el HTML la pide y no esta: la pantalla saldria sin estilos',
    });
  }
}

// ---------------------------------------------------------------------------
//  Resultado
// ---------------------------------------------------------------------------
if (problemas.length === 0) {
  console.log('[verificar] interfaz compilada OK: nada que la CSP vaya a bloquear');
  process.exit(0);
}

console.error('\n[verificar] LA INTERFAZ COMPILADA TIENE PROBLEMAS\n');

for (const problema of problemas) {
  console.error(`  x ${problema.que}`);
  console.error(`    ${problema.porque}\n`);
}

console.error(
  'Esto se veria bien en `npm run kiosco:dev` y roto en el .exe instalado.\n' +
    'Revisa la seccion `optimization` de angular.json y el error E-015 en\n' +
    'docs/curso/errores-y-aprendizajes.md.\n',
);

process.exit(1);
