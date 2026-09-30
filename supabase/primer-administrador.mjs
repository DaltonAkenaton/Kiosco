/**
 * ============================================================================
 *  EL PRIMER ADMINISTRADOR  (se usa UNA vez por proyecto de Supabase)
 * ============================================================================
 *
 *  El problema del huevo y la gallina: para dar acceso al panel hace falta
 *  entrar al panel como administrador... y en un proyecto recien creado no
 *  hay ninguno. Este script crea el primero. Los demas se dan de alta desde
 *  el panel (Accesos).
 *
 *  Uso (desde la carpeta del proyecto):
 *
 *      npm run supabase:primer-admin
 *
 *  Pregunta, en la terminal:
 *    - la "Project URL" del proyecto (https://xxxx.supabase.co);
 *    - la llave SECRETA (service_role o "secret"). Solo se usa aqui, en tu
 *      computadora, y NO se guarda en ningun lado;
 *    - el correo y el nombre de la persona.
 *
 *  Muestra una contrasena temporal UNA vez. Al entrar al panel, pedira
 *  cambiarla por una propia.
 *
 *  Si el correo ya tiene cuenta (por ejemplo, creada a mano en el tablero de
 *  Supabase), la reutiliza y le pone la contrasena temporal.
 */

import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline';
import { stdin as entrada, stdout as salida } from 'node:process';

const rl = createInterface({ input: entrada, output: salida, terminal: false });
// Linea por linea: funciona igual tecleando que con las respuestas en un archivo.
const lineas = rl[Symbol.asyncIterator]();
async function preguntar(texto) {
  salida.write(texto);
  const { value } = await lineas.next();
  return value ?? '';
}

function salirCon(mensaje) {
  console.error(`\nERROR: ${mensaje}\n`);
  rl.close();
  process.exit(1);
}

console.log('\n=== Crear el primer administrador del panel ===\n');

const url = (process.env.SUPABASE_URL ?? (await preguntar('Project URL (https://xxxx.supabase.co): ')))
  .trim()
  .replace(/\/+$/, '');
if (!/^https?:\/\/[^\s]+$/.test(url)) salirCon('Esa no parece una direccion. Copiala de Supabase -> Project Settings -> API.');

const llave = (process.env.SUPABASE_LLAVE_SECRETA ?? (await preguntar('Llave SECRETA (service_role / secret): '))).trim();
if (!llave) salirCon('Falta la llave secreta.');

const correo = (process.env.CORREO_ADMIN ?? (await preguntar('Correo de la persona: '))).trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) salirCon('Ese correo no parece valido.');

const nombre = (process.env.NOMBRE_ADMIN ?? (await preguntar('Nombre completo: '))).trim();
if (nombre.length < 3) salirCon('Escribe el nombre completo.');
rl.close();

const encabezados = { 'content-type': 'application/json', apikey: llave, authorization: `Bearer ${llave}` };

// Contrasena temporal: 12 caracteres sin los que se confunden al leer (0/O, 1/l/I).
const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const contrasena = Array.from({ length: 12 }, () => alfabeto[randomInt(alfabeto.length)]).join('');

async function pedir(ruta, opciones) {
  let r;
  try {
    r = await fetch(`${url}${ruta}`, { ...opciones, headers: { ...encabezados, ...(opciones?.headers ?? {}) } });
  } catch (fallo) {
    salirCon(`No hay conexion con ${url}: ${fallo.message}`);
  }
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    // no era JSON
  }
  return { estado: r.status, json, texto };
}

// 1. La cuenta en Supabase Auth.
let userId;
const creada = await pedir('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email: correo, password: contrasena, email_confirm: true }),
});
if (creada.estado === 401 || creada.estado === 403) salirCon('La llave no sirve. Debe ser la SECRETA (service_role), no la publica.');
if (creada.estado === 200 || creada.estado === 201) {
  userId = creada.json.id;
} else {
  // ¿Ya existia? Se busca por correo con la funcion de la migracion 0017.
  const buscada = await pedir('/rest/v1/rpc/buscar_cuenta_por_correo', {
    method: 'POST',
    body: JSON.stringify({ p_correo: correo }),
  });
  if (buscada.estado !== 200 || !buscada.json) {
    salirCon(`No se pudo crear la cuenta (${creada.estado}): ${creada.texto.slice(0, 200)}`);
  }
  userId = buscada.json;
  const actualizada = await pedir(`/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ password: contrasena }),
  });
  if (actualizada.estado !== 200) salirCon(`La cuenta existe pero no se pudo cambiar su contrasena (${actualizada.estado}).`);
  console.log('(La cuenta ya existia: se le puso una contrasena temporal nueva.)');
}

// 2. Su fila de administrador (rol admin, contrasena temporal).
const fila = await pedir('/rest/v1/administradores?on_conflict=user_id', {
  method: 'POST',
  headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ user_id: userId, nombre, correo, rol: 'admin', activo: true, debe_cambiar_contrasena: true }),
});
if (fila.estado >= 300) {
  salirCon(
    `La cuenta se creo, pero no se pudo darle permiso de administrador (${fila.estado}): ${fila.texto.slice(0, 200)}\n` +
      '¿Ya se aplicaron las migraciones a este proyecto? (Actions -> "Publicar en Supabase")',
  );
}

// Desde GitHub Actions ("Crear administrador"), la contrasena va SOLO al
// resumen de la corrida, no al registro de pasos. Es temporal: deja de servir
// en cuanto la persona entra al panel y se pone una propia.
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Acceso creado',
      '',
      '| | |',
      '|---|---|',
      `| Panel | ${process.env.PANEL_URL ?? ''} |`,
      `| Correo | ${correo} |`,
      `| Contraseña temporal | \`${contrasena}\` |`,
      '',
      'Entra **ya**: al hacerlo, el panel pide ponerse una propia y ésta deja de servir. ' +
        'Después puedes borrar esta corrida (botón ··· → Delete workflow run).',
      '',
    ].join('\n'),
  );
  console.log('Listo. La contrasena temporal esta en el RESUMEN de esta corrida (no en este registro).');
  process.exit(0);
}

console.log(`
=============================================================
  LISTO. Anota esto y entregalo en persona:

    Correo:      ${correo}
    Contrasena:  ${contrasena}

  Es TEMPORAL: al entrar al panel pedira cambiarla.
  No se vuelve a mostrar.
=============================================================
`);
