/**
 * ============================================================================
 *  ARMA EL ARCHIVO DE ENTORNO DEL PANEL CON LAS CREDENCIALES DE PRODUCCION
 * ============================================================================
 *
 *  Corre antes de `ng build` (ver `prebuild` en package.json).
 *
 *  Si existen las variables de entorno SUPABASE_URL y SUPABASE_LLAVE_PUBLICA
 *  (Netlify las pone), escribe `src/entorno/entorno.produccion.ts` con ellas.
 *  Si no existen, no toca nada: se usa lo que ya diga el archivo.
 *
 *  Asi las credenciales viven en Netlify y no en el repositorio (CLAUDE.md 1.1).
 *
 *  Y una red de seguridad: si la llave es la `service_role` (la que abre TODO,
 *  CLAUDE.md 3.2), se niega a compilar. Esa llave publicada en una pagina web
 *  le daria a cualquiera la base de datos completa.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const llave = (process.env.SUPABASE_LLAVE_PUBLICA ?? '').trim();

if (!url && !llave) {
  console.log('[entorno] Sin SUPABASE_URL ni SUPABASE_LLAVE_PUBLICA: se usa el archivo tal como esta.');
  process.exit(0);
}

function fallar(mensaje) {
  console.error(`\n[entorno] ERROR: ${mensaje}\n`);
  process.exit(1);
}

if (!url || !llave) fallar('Faltan datos: hacen falta LAS DOS variables, SUPABASE_URL y SUPABASE_LLAVE_PUBLICA.');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  fallar(`SUPABASE_URL no parece de Supabase: "${url}". Debe verse como https://abcdefgh.supabase.co`);
}

// Llaves nuevas de Supabase: "sb_publishable_..." (publica) y "sb_secret_..." (secreta).
if (llave.startsWith('sb_secret_')) {
  fallar('Esa es la llave SECRETA. En el panel va la PUBLICA ("publishable" o "anon"). La secreta nunca va en una pagina web.');
}
// Llaves de antes: un JWT que dice su rol adentro.
if (llave.startsWith('eyJ')) {
  let rol = '';
  try {
    rol = JSON.parse(Buffer.from(llave.split('.')[1] ?? '', 'base64url').toString('utf8')).role ?? '';
  } catch {
    fallar('La llave no se pudo leer. Copiala otra vez completa desde Supabase -> Project Settings -> API.');
  }
  if (rol !== 'anon') {
    fallar(`Esa llave es de rol "${rol}". En el panel va SOLO la "anon public". La service_role nunca va en una pagina web.`);
  }
} else if (!llave.startsWith('sb_publishable_')) {
  fallar('La llave no se reconoce. Copia la "anon public" (o la "publishable") desde Supabase -> Project Settings -> API.');
}

const destino = join(dirname(fileURLToPath(import.meta.url)), 'src', 'entorno', 'entorno.produccion.ts');
writeFileSync(
  destino,
  `/**
 * GENERADO por escribir-entorno.mjs a partir de las variables de entorno de
 * Netlify. No se edita a mano en el servidor: se cambia en Netlify.
 * Es la llave PUBLICA: por si sola no deja ver nada (RLS, CLAUDE.md 3.2).
 */
export const ENTORNO = {
  produccion: true,
  supabaseUrl: ${JSON.stringify(url)},
  supabaseLlavePublica: ${JSON.stringify(llave)},
};
`,
  'utf8',
);
console.log(`[entorno] Panel conectado a ${url}`);
