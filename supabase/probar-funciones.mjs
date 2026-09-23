/**
 * ============================================================================
 *  PRUEBAS DE LAS EDGE FUNCTIONS DEL KIOSCO  (bloque 5)
 * ============================================================================
 *
 *  Llama a las funciones por HTTP, igual que lo hara el kiosco, contra el
 *  Supabase LOCAL:
 *
 *      npx supabase start        (levanta la base y las funciones; necesita Docker)
 *      npm run supabase:aplicar  (aplica las migraciones desde cero)
 *      npm run supabase:funciones:probar
 *
 *  A diferencia de probar-esquema.mjs, aqui no se puede trabajar dentro de una
 *  transaccion que se deshace al final: las funciones leen la base por su
 *  cuenta y no verian nada sin confirmar. Asi que cada corrida crea sus
 *  propios datos (con ids nuevos) y al final los borra.
 */

import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const BASE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const FUNCIONES = 'http://127.0.0.1:54321/functions/v1';

const bd = new pg.Client({ connectionString: BASE });
await bd.connect();

let fallos = 0;
let pruebas = 0;
function comprobar(nombre, condicion, detalle = '') {
  pruebas++;
  console.log(`${condicion ? 'OK   ' : 'FALLA'}  ${nombre}${detalle ? '  -> ' + detalle : ''}`);
  if (!condicion) fallos++;
}

const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');

/** Llama a una funcion. Devuelve { estado, cuerpo }. */
async function llamar(funcion, cuerpo, token = null, metodo = 'POST') {
  const respuesta = await fetch(`${FUNCIONES}/${funcion}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-kiosco-token': token } : {}) },
    body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
  });
  let json = null;
  try {
    json = await respuesta.json();
  } catch {
    // sin cuerpo JSON
  }
  return { estado: respuesta.status, cuerpo: json };
}

/** Corre SQL como un usuario del panel (igual que probar-esquema.mjs), y confirma. */
async function comoUsuario(uuid, sql, parametros = []) {
  await bd.query('begin');
  try {
    await bd.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uuid })]);
    await bd.query('set local role authenticated');
    const resultado = await bd.query(sql, parametros);
    await bd.query('commit');
    return resultado;
  } catch (fallo) {
    await bd.query('rollback');
    throw fallo;
  }
}

// ============================================================================
//  Preparacion: un admin, un supervisor y un empleado, nuevos en cada corrida
// ============================================================================
const corrida = randomUUID().slice(0, 8);
const ADMIN = randomUUID();
const SUPERVISOR = randomUUID();
const EMPLEADO = randomUUID();

for (const [id, correo] of [[ADMIN, `admin-${corrida}`], [SUPERVISOR, `super-${corrida}`]]) {
  await bd.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
    [id, `${correo}@prueba.local`],
  );
}
await bd.query(`insert into administradores (user_id, nombre, rol) values ($1, 'Admin Funciones', 'admin')`, [ADMIN]);
await bd.query(`insert into administradores (user_id, nombre, rol) values ($1, 'Super Funciones', 'supervisor')`, [SUPERVISOR]);
await bd.query(
  `insert into empleados (id, usuario, numero_empleado, nombre, apellido_paterno, pin_hash)
   values ($1, $2, $3, 'Prueba', 'Funciones', extensions.crypt('1234', extensions.gen_salt('bf', 4)))`,
  [EMPLEADO, `pf${corrida.replace(/[0-9]/g, 'x')}`, `F-${corrida}`],
);

try {
  // ==========================================================================
  //  Panel: credenciales de kiosco y codigo de enrolamiento
  // ==========================================================================
  console.log('\n--- panel: credenciales y codigos ---');

  await comoUsuario(ADMIN, `select establecer_credenciales_kiosco($1, $2, 'contrasena-kiosco')`, [
    ADMIN,
    `jefe${corrida.replace(/[^a-z]/g, '')}x`,
  ]);
  const { rows: [cred] } = await bd.query(
    'select usuario_kiosco, contrasena_kiosco_hash from administradores where user_id = $1', [ADMIN]);
  comprobar('la contrasena del kiosco se guarda como bcrypt', cred.contrasena_kiosco_hash.startsWith('$2'));
  comprobar('y no en claro', !cred.contrasena_kiosco_hash.includes('contrasena-kiosco'));

  let rechazada = false;
  try {
    await comoUsuario(SUPERVISOR, `select establecer_credenciales_kiosco($1, 'otro', 'contrasena-kiosco')`, [ADMIN]);
  } catch {
    rechazada = true;
  }
  comprobar('un supervisor NO puede cambiar las credenciales de otro', rechazada);

  let supervisorSinCodigo = false;
  try {
    await comoUsuario(SUPERVISOR, `select * from generar_codigo_enrolamiento('Kiosco del supervisor')`);
  } catch {
    supervisorSinCodigo = true;
  }
  comprobar('un supervisor NO puede generar codigos', supervisorSinCodigo);

  const { rows: [generado] } = await comoUsuario(
    ADMIN, `select * from generar_codigo_enrolamiento('Entrada principal', 'Edificio A')`);
  comprobar('el codigo tiene 8 caracteres sin 0/O/1/I/L', /^[A-HJKMNP-Z2-9]{8}$/.test(generado.codigo), generado.codigo);
  const minutos = (new Date(generado.expira_en) - Date.now()) / 60000;
  comprobar('vence en ~15 minutos', minutos > 14 && minutos <= 15.1, minutos.toFixed(1));
  const { rows: guardados } = await bd.query(
    'select codigo_hash from codigos_enrolamiento where codigo_hash = $1', [sha256(generado.codigo)]);
  comprobar('en la base queda su hash, no el codigo', guardados.length === 1);

  let sinPermiso = false;
  try {
    await comoUsuario(ADMIN, `select recibir_registros(gen_random_uuid(), null, '{}'::jsonb)`);
  } catch {
    sinPermiso = true;
  }
  comprobar('ni un admin del panel puede llamar recibir_registros directo', sinPermiso);

  // ==========================================================================
  //  enrolar-kiosco
  // ==========================================================================
  console.log('\n--- enrolar-kiosco ---');

  const malo = await llamar('enrolar-kiosco', { codigo: 'ZZZZZZZZ', versionApp: '0.1.0' });
  comprobar('un codigo que no existe no sirve', malo.estado === 400 && malo.cuerpo?.error === 'codigo_invalido', String(malo.estado));

  const corto = await llamar('enrolar-kiosco', { codigo: 'ABC', versionApp: '0.1.0' });
  comprobar('un codigo de otro largo se rechaza', corto.estado === 400);

  // Como lo anotaria alguien: minusculas y con guion.
  const tecleado = `${generado.codigo.slice(0, 4)}-${generado.codigo.slice(4)}`.toLowerCase();
  const alta = await llamar('enrolar-kiosco', { codigo: tecleado, versionApp: '0.1.0' });
  comprobar('el codigo bueno da de alta al kiosco (con guion y minusculas)', alta.estado === 200, alta.cuerpo?.error ?? String(alta.estado));
  const TOKEN = alta.cuerpo?.token ?? '';
  const KIOSCO = alta.cuerpo?.dispositivoId ?? '';
  comprobar('entrega un token de 64 hex', /^[0-9a-f]{64}$/.test(TOKEN));
  comprobar('con el nombre que puso el jefe', alta.cuerpo?.nombre === 'Entrada principal' && alta.cuerpo?.ubicacion === 'Edificio A');
  comprobar('toda respuesta trae la hora del servidor', typeof alta.cuerpo?.servidorAhoraMs === 'number');

  const { rows: [disp] } = await bd.query('select token_hash, enrolado_por, version_app from dispositivos where id = $1', [KIOSCO]);
  comprobar('en la base queda el hash del token, no el token', disp?.token_hash === sha256(TOKEN) && disp?.token_hash !== TOKEN);
  comprobar('queda anotado quien lo autorizo', disp?.enrolado_por === ADMIN);

  const otraVez = await llamar('enrolar-kiosco', { codigo: generado.codigo, versionApp: '0.1.0' });
  comprobar('el mismo codigo NO sirve dos veces', otraVez.estado === 400);

  await bd.query(
    `insert into codigos_enrolamiento (codigo_hash, creado_por, expira_en, nombre_dispositivo)
     values ($1, $2, now() - interval '1 minute', 'Vencido')`, [sha256('VENCID22'), ADMIN]);
  const vencido = await llamar('enrolar-kiosco', { codigo: 'VENCID22', versionApp: '0.1.0' });
  comprobar('un codigo vencido no sirve', vencido.estado === 400);

  const get = await llamar('enrolar-kiosco', null, null, 'GET');
  comprobar('solo acepta POST', get.estado === 405, String(get.estado));

  // ==========================================================================
  //  latido
  // ==========================================================================
  console.log('\n--- latido ---');

  const latidoSinToken = await llamar('latido', { versionApp: '0.1.0', camaraOk: true, pendientes: 0, desfaseRelojMs: 0 });
  comprobar('sin token: no autorizado', latidoSinToken.estado === 401);

  const latidoFalso = await llamar('latido', { versionApp: '0.1.0', camaraOk: true, pendientes: 0, desfaseRelojMs: 0 }, 'a'.repeat(64));
  comprobar('con un token inventado: no autorizado', latidoFalso.estado === 401);

  const latido = await llamar('latido', { versionApp: '0.2.0', camaraOk: false, pendientes: 7, desfaseRelojMs: 1500 }, TOKEN);
  comprobar('con su token: aceptado', latido.estado === 200, JSON.stringify(latido.cuerpo));
  const { rows: [tras] } = await bd.query(
    'select version_app, camara_ok, pendientes, desfase_reloj_ms, ultima_conexion from dispositivos where id = $1', [KIOSCO]);
  comprobar('el panel ya ve version, camara, pendientes y desfase',
    tras.version_app === '0.2.0' && tras.camara_ok === false && tras.pendientes === 7 && tras.desfase_reloj_ms === 1500);

  // ==========================================================================
  //  catalogo
  // ==========================================================================
  console.log('\n--- catalogo ---');

  const cat = await llamar('catalogo', { desde: null }, TOKEN);
  comprobar('el catalogo responde', cat.estado === 200, String(cat.estado));
  const emp = cat.cuerpo?.empleados?.find((e) => e.id === EMPLEADO);
  comprobar('trae al empleado con el hash de su PIN', emp && emp.pin_hash.startsWith('$2') && emp.activo === true);
  const adm = cat.cuerpo?.administradores?.find((a) => a.id === ADMIN);
  comprobar('trae al admin con su contrasena de KIOSCO', adm && adm.contrasena_hash === cred.contrasena_kiosco_hash && adm.usuario === cred.usuario_kiosco);
  comprobar('el supervisor sin credenciales de kiosco no baja',
    !cat.cuerpo?.administradores?.some((a) => a.id === SUPERVISOR));
  comprobar('trae la configuracion (zona horaria)', cat.cuerpo?.configuracion?.zona_horaria === 'America/Matamoros');
  comprobar('y un cursor para la proxima vez', typeof cat.cuerpo?.cursor === 'string');

  const incremental = await llamar('catalogo', { desde: cat.cuerpo.cursor }, TOKEN);
  comprobar('con el cursor, el empleado sin cambios ya no baja',
    !incremental.cuerpo?.empleados?.some((e) => e.id === EMPLEADO));

  await bd.query('update empleados set activo = false where id = $1', [EMPLEADO]);
  const trasBaja = await llamar('catalogo', { desde: cat.cuerpo.cursor }, TOKEN);
  const deBaja = trasBaja.cuerpo?.empleados?.find((e) => e.id === EMPLEADO);
  comprobar('una BAJA si baja, con activo = false (asi el kiosco lo desactiva)', deBaja && deBaja.activo === false);
  await bd.query('update empleados set activo = true where id = $1', [EMPLEADO]);

  // ==========================================================================
  //  recibir-registros
  // ==========================================================================
  console.log('\n--- recibir-registros ---');

  const reloj = (ms) => ({
    horaDispositivoMs: ms, horaEstimadaMs: ms, monotonicoMs: 12345.6, arranqueId: randomUUID(), desfaseServidorMs: 0,
  });
  const ahora = Date.now();
  const marca = {
    id: randomUUID(), empleadoId: EMPLEADO, usuario: 'x', tipo: 'entrada', origen: 'manual',
    reloj: reloj(ahora - 60_000), banderas: ['reloj_sospechoso'], fotoHash: 'a'.repeat(64),
  };
  const marcaFantasma = { ...marca, id: randomUUID(), empleadoId: randomUUID() };
  const evento = { id: randomUUID(), tipo: 'camara_desconectada', detalle: { motivo: 'prueba' }, reloj: reloj(ahora) };
  const acceso = { id: randomUUID(), marcaId: marca.id, adminId: ADMIN, accion: 'ver', consultadoEn: new Date().toISOString() };
  const accesoHuerfano = { ...acceso, id: randomUUID(), marcaId: randomUUID() };

  const envio = await llamar('recibir-registros',
    { marcas: [marca, marcaFantasma], eventos: [evento], accesosFoto: [acceso, accesoHuerfano] }, TOKEN);
  comprobar('el lote se recibe', envio.estado === 200, JSON.stringify(envio.cuerpo));
  const aceptados = new Set(envio.cuerpo?.aceptados ?? []);
  const rechazo = (id) => envio.cuerpo?.rechazados?.find((r) => r.id === id)?.motivo;
  comprobar('la marca buena se acepta', aceptados.has(marca.id));
  comprobar('el evento y el acceso a foto tambien', aceptados.has(evento.id) && aceptados.has(acceso.id));
  comprobar('la marca de un empleado inexistente se rechaza SOLA, con motivo', rechazo(marcaFantasma.id) === 'empleado_desconocido');
  comprobar('el acceso a una marca inexistente, igual', rechazo(accesoHuerfano.id) === 'marca_desconocida');

  const { rows: [guardada] } = await bd.query(
    'select dispositivo_id, origen, foto_estado, banderas, en_cuarentena from marcas where id = $1', [marca.id]);
  comprobar('la marca queda ligada a SU kiosco', guardada?.dispositivo_id === KIOSCO);
  comprobar('el origen es kiosco aunque el paquete diga otra cosa', guardada?.origen === 'kiosco');
  comprobar('con foto -> foto_estado con_foto', guardada?.foto_estado === 'con_foto');
  comprobar('las banderas se conservan', guardada?.banderas?.includes('reloj_sospechoso'));

  const repetido = await llamar('recibir-registros', { marcas: [marca] }, TOKEN);
  const { rows: [{ n }] } = await bd.query('select count(*)::int as n from marcas where id = $1', [marca.id]);
  comprobar('mandarla otra vez NO la duplica (y cuenta como aceptada)', n === 1 && repetido.cuerpo?.aceptados?.includes(marca.id));

  const estado = { id: randomUUID(), marcaId: marca.id, estado: 'conservada' };
  const cambio = await llamar('recibir-registros', { estadosDeFoto: [estado] }, TOKEN);
  const { rows: [conservada] } = await bd.query('select foto_estado from marcas where id = $1', [marca.id]);
  comprobar('el kiosco puede informar que la foto se conservo',
    cambio.cuerpo?.aceptados?.includes(estado.id) && conservada.foto_estado === 'conservada');

  const deforme = await llamar('recibir-registros', { marcas: [{ ...marca, tipo: 'brinco' }] }, TOKEN);
  comprobar('un lote con forma invalida se rechaza entero, diciendo el campo', deforme.estado === 400 && /tipo/.test(deforme.cuerpo?.mensaje ?? ''),
    deforme.cuerpo?.mensaje);
  comprobar('y el mensaje no incluye el valor', !/brinco/.test(deforme.cuerpo?.mensaje ?? ''));

  const sinToken = await llamar('recibir-registros', { marcas: [marca] });
  comprobar('sin token no se recibe nada', sinToken.estado === 401);

  // ==========================================================================
  //  Kiosco revocado  (CLAUDE.md 3.3)
  // ==========================================================================
  console.log('\n--- kiosco revocado ---');

  let supervisorNoRevoca = false;
  try {
    await comoUsuario(SUPERVISOR, 'select revocar_dispositivo($1)', [KIOSCO]);
  } catch {
    supervisorNoRevoca = true;
  }
  comprobar('un supervisor NO puede dar de baja un kiosco', supervisorNoRevoca);

  await comoUsuario(ADMIN, 'select revocar_dispositivo($1)', [KIOSCO]);
  const { rows: [revocado] } = await bd.query('select activo, revocado_en, revocado_por from dispositivos where id = $1', [KIOSCO]);
  comprobar('revocar deja las tres columnas coherentes',
    revocado.activo === false && revocado.revocado_en !== null && revocado.revocado_por === ADMIN);

  comprobar('revocado: el latido se rechaza',
    (await llamar('latido', { versionApp: '0.1.0', camaraOk: true, pendientes: 0, desfaseRelojMs: 0 }, TOKEN)).estado === 403);
  comprobar('revocado: ya no baja el catalogo (ni los PINes)',
    (await llamar('catalogo', { desde: null }, TOKEN)).estado === 403);

  const revocadoEnMs = new Date(revocado.revocado_en).getTime();
  const anterior = { ...marca, id: randomUUID(), reloj: reloj(revocadoEnMs - 3_600_000), banderas: [] };
  const posterior = { ...marca, id: randomUUID(), reloj: reloj(revocadoEnMs + 60_000), banderas: [] };
  const tardio = await llamar('recibir-registros', { marcas: [anterior, posterior] }, TOKEN);
  comprobar('revocado: lo de ANTES de la baja se acepta', tardio.cuerpo?.aceptados?.includes(anterior.id), JSON.stringify(tardio.cuerpo));
  comprobar('revocado: lo de DESPUES se rechaza con motivo',
    tardio.cuerpo?.rechazados?.find((r) => r.id === posterior.id)?.motivo === 'dispositivo_revocado');
  comprobar('y la respuesta avisa que el kiosco esta dado de baja', tardio.cuerpo?.dispositivoRevocado === true);
  const { rows: [enCuarentena] } = await bd.query('select en_cuarentena, banderas from marcas where id = $1', [anterior.id]);
  comprobar('lo aceptado queda en cuarentena, con su bandera',
    enCuarentena?.en_cuarentena === true && enCuarentena.banderas.includes('dispositivo_revocado'));
} finally {
  // ==========================================================================
  //  Limpieza
  // ==========================================================================
  //  Las marcas son inmutables: su trigger impide borrarlas, a proposito. Para
  //  limpiar DATOS DE PRUEBA se apagan los triggers solo en esta conexion
  //  (session_replication_role = replica). Solo lo puede hacer el superusuario
  //  de la base local; el panel y las funciones nunca.
  await bd.query('rollback').catch(() => {});
  await bd.query('set session_replication_role = replica');
  const dispositivos = `(select id from dispositivos where enrolado_por = $1)`;
  await bd.query(`delete from accesos_foto where dispositivo_id in ${dispositivos} or admin_id = $1`, [ADMIN]);
  await bd.query(`delete from eventos_dispositivo where dispositivo_id in ${dispositivos}`, [ADMIN]);
  await bd.query('delete from marcas where empleado_id = $1', [EMPLEADO]);
  await bd.query('delete from codigos_enrolamiento where creado_por = $1', [ADMIN]);
  await bd.query('delete from dispositivos where enrolado_por = $1', [ADMIN]);
  await bd.query('delete from empleados where id = $1', [EMPLEADO]);
  await bd.query('delete from administradores where user_id = any($1)', [[ADMIN, SUPERVISOR]]);
  await bd.query('delete from auth.users where id = any($1)', [[ADMIN, SUPERVISOR]]);
  await bd.query('set session_replication_role = origin');
  await bd.end();
}

console.log(
  fallos === 0
    ? `\nTODAS LAS PRUEBAS PASARON  (${pruebas})`
    : `\n${fallos} de ${pruebas} PRUEBA(S) FALLARON`,
);
process.exit(fallos === 0 ? 0 : 1);
