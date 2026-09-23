/**
 * ============================================================================
 *  REVISION RAPIDA DE LAS MIGRACIONES
 * ============================================================================
 *
 *  Lee todos los `.sql` de `migrations/` y los pasa por el analizador REAL de
 *  PostgreSQL (el mismo codigo en C que usa el servidor, compilado a WASM).
 *  Si un archivo tiene un error de sintaxis, sale aqui en dos segundos.
 *
 *  ---------------------------------------------------------------------------
 *  QUE COMPRUEBA, Y SOBRE TODO QUE NO
 *  ---------------------------------------------------------------------------
 *  SI comprueba:
 *    - que cada sentencia este bien escrita;
 *    - que los cuerpos de las funciones `plpgsql` esten bien formados;
 *    - que no falte un `;`, un `$$` o un parentesis.
 *
 *  NO comprueba nada de lo que de verdad importa despues:
 *    - que las tablas y columnas que se mencionan existan;
 *    - que las politicas RLS dejen pasar a quien deben y frenen al resto;
 *    - que los triggers hagan lo que dicen;
 *    - que las restricciones rechacen lo que tienen que rechazar.
 *
 *  Para eso hace falta un Postgres de verdad:
 *
 *      npx supabase start
 *      npx supabase db reset     <- aplica las migraciones desde cero
 *
 *  Esta revision es el ESCALON 1, igual que `verificar-compilado.mjs` es el de
 *  la interfaz: caza rapido lo tonto para que el escalon lento se use en lo
 *  que si necesita un servidor. Pasar esta revision NO significa que las
 *  migraciones funcionen.
 *
 *  (La leccion viene del E-015: cinco comprobaciones en verde y la pantalla
 *  rota. "Todas las pruebas pasan" nunca quiso decir "funciona"; quiere decir
 *  "no falla nada de lo que se me ocurrio comprobar".)
 *
 *  Uso:  npm run supabase:revisar
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'libpg-query';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const CARPETA = path.join(aqui, 'migrations');

await pkg.loadModule();

const archivos = fs
  .readdirSync(CARPETA)
  .filter((f) => f.endsWith('.sql'))
  // Orden alfabetico = orden de aplicacion, porque van numeradas. Si algun dia
  // alguien nombra un archivo sin numero, aparecera fuera de lugar aqui y eso
  // ya es un aviso.
  .sort();

if (archivos.length === 0) {
  console.error('[migraciones] no hay ningun .sql en supabase/migrations');
  process.exit(1);
}

let fallos = 0;
let sentencias = 0;

for (const archivo of archivos) {
  const sql = fs.readFileSync(path.join(CARPETA, archivo), 'utf8');

  try {
    const arbol = await pkg.parse(sql);
    sentencias += arbol.stmts.length;

    // Los cuerpos `plpgsql` van dentro de un texto entre `$$`, asi que el
    // analizador de SQL los trata como una cadena cualquiera y no los revisa.
    // Hay que pedirselo aparte.
    if (/language\s+plpgsql/i.test(sql)) {
      await pkg.parsePlPgSQL(sql);
    }

    console.log(`  OK    ${archivo}  (${arbol.stmts.length} sentencias)`);
  } catch (fallo) {
    fallos++;
    console.error(`  FALLA ${archivo}`);
    console.error(`        ${fallo.message}`);
  }
}

console.log('');

if (fallos > 0) {
  console.error(`[migraciones] ${fallos} archivo(s) con errores de sintaxis\n`);
  process.exit(1);
}

console.log(
  `[migraciones] sintaxis correcta: ${archivos.length} archivos, ${sentencias} sentencias`,
);
console.log(
  '[migraciones] recuerda: esto NO prueba que funcionen.\n' +
    '              Para eso: npx supabase start && npx supabase db reset\n',
);
