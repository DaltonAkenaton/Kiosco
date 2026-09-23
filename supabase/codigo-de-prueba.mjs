/**
 * ============================================================================
 *  CODIGO DE ALTA DE PRUEBA  (solo desarrollo)
 * ============================================================================
 *
 *  Genera un codigo de 8 caracteres para dar de alta un kiosco de desarrollo
 *  contra el Supabase LOCAL, sin necesidad del panel (que llega en el bloque 7):
 *
 *      npm run supabase:codigo
 *
 *  Lo hace exactamente como lo hara el panel: entrando como el jefe de prueba
 *  de seed.sql y llamando a `generar_codigo_enrolamiento()`.
 */

import pg from 'pg';

const JEFE_DE_PRUEBA = '00000000-0000-4000-8000-00000000a001';
const nombre = process.argv[2] ?? 'Kiosco de desarrollo';

const bd = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
try {
  await bd.connect();
} catch {
  console.error('No hay Supabase local. Levantalo con: npx supabase start');
  process.exit(1);
}

try {
  await bd.query('begin');
  await bd.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: JEFE_DE_PRUEBA })]);
  await bd.query('set local role authenticated');
  const { rows: [r] } = await bd.query('select * from generar_codigo_enrolamiento($1, $2)', [nombre, 'Desarrollo']);
  await bd.query('commit');

  const vence = new Date(r.expira_en).toLocaleTimeString('es-MX', { timeZone: 'America/Matamoros' });
  console.log(`\n  Codigo para "${nombre}":  ${r.codigo.slice(0, 4)}-${r.codigo.slice(4)}   (vence a las ${vence})\n`);
} catch (fallo) {
  await bd.query('rollback').catch(() => {});
  console.error('No se pudo generar:', fallo.message);
  console.error('Si dice que no eres administrador, aplica los datos de prueba: npm run supabase:aplicar');
  process.exitCode = 1;
} finally {
  await bd.end();
}
