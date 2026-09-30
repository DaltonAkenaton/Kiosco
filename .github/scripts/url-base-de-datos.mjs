/**
 * ============================================================================
 *  ARMA LA CONEXION A LA BASE DEL AMBIENTE (para respaldos y resumen diario)
 * ============================================================================
 *
 *  Antes habia que copiar a mano un secreto SUPABASE_DB_URL (Supabase ->
 *  Connect -> Session pooler) y cambiarlo al pasar a produccion. Nunca se
 *  llego a crear, y los respaldos no corrian. Ahora se arma solo:
 *
 *    - que proyecto: el que diga AMBIENTE en configuracion.ts;
 *    - el servidor: se le pregunta a la API de Supabase (SUPABASE_ACCESS_TOKEN);
 *    - la contrasena: SUPABASE_PASSWORD_PRUEBAS / _PRODUCCION.
 *
 *  Si alguien SI pone el secreto SUPABASE_DB_URL, se respeta ese.
 *
 *  Escribe SUPABASE_DB_URL en $GITHUB_ENV (tapada en el registro) para los
 *  pasos siguientes.
 */

import { appendFileSync, readFileSync } from 'node:fs';

const env = process.env;
let url = (env.SUPABASE_DB_URL ?? '').trim();

if (!url) {
  const config = readFileSync('packages/compartido/src/configuracion.ts', 'utf8');
  const ambiente = /^export const AMBIENTE: .* = '(pruebas|produccion)';/m.exec(config)?.[1];
  const ref = ambiente === 'produccion' ? env.REF_PRODUCCION : env.REF_PRUEBAS;
  const contrasena = ambiente === 'produccion' ? env.PASS_PRODUCCION : env.PASS_PRUEBAS;
  if (!ambiente || !ref || !contrasena || !env.SUPABASE_ACCESS_TOKEN) {
    console.error('::error::No se puede armar la conexion: faltan secretos de Supabase (ver "Publicar en Supabase").');
    process.exit(1);
  }

  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/database/pooler`, {
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  });
  if (!r.ok) {
    console.error(`::error::Supabase no dio los datos de conexion (${r.status}). Revisa SUPABASE_ACCESS_TOKEN.`);
    process.exit(1);
  }
  const datos = await r.json();
  const primaria = (Array.isArray(datos) ? datos : [datos]).find((d) => (d.database_type ?? 'PRIMARY') === 'PRIMARY');
  if (!primaria?.db_host || !primaria?.db_user) {
    console.error('::error::Respuesta inesperada de Supabase al pedir los datos de conexion.');
    process.exit(1);
  }
  // Puerto 5432 = "session pooler": el que sirve para pg_dump y psql.
  url = `postgresql://${primaria.db_user}:${encodeURIComponent(contrasena)}@${primaria.db_host}:5432/${primaria.db_name ?? 'postgres'}`;
  console.log(`Base de ${ambiente} (${primaria.db_host}).`);
} else {
  console.log('Se usa el secreto SUPABASE_DB_URL.');
}

console.log(`::add-mask::${url}`);
appendFileSync(env.GITHUB_ENV, `SUPABASE_DB_URL=${url}\n`);
