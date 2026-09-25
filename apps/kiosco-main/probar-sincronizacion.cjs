/**
 * ============================================================================
 *  PRUEBA DE PUNTA A PUNTA: KIOSCO <-> SUPABASE LOCAL  (bloque 6)
 * ============================================================================
 *
 *  Un kiosco de verdad (el mismo codigo, dentro de Electron) contra las Edge
 *  Functions de verdad (el Supabase local). Necesita:
 *
 *      npx supabase start
 *      npm run supabase:aplicar     (migraciones + seed.sql con los 20 empleados)
 *      npm run probar:sincronizacion
 *
 *  Usa una carpeta de datos temporal: no toca el kiosco de desarrollo. Lo que
 *  crea en la nube (dispositivos, marcas, eventos) lo borra al final.
 */
const { app } = require('electron');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

app.setPath('userData', path.join(os.tmpdir(), 'kiosko-sync-' + Date.now()));

const JEFE = '00000000-0000-4000-8000-00000000a001';
const DGOMEZ_NUBE = '00000000-0000-4000-8000-000000001001';

app.whenReady().then(async () => {
  const bd = require('./dist/prueba-bundle.js');
  const pg = require('pg');
  const nube = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });

  let fallos = 0;
  const comprobar = (nombre, condicion, detalle = '') => {
    console.log(`${condicion ? 'OK   ' : 'FALLA'}  ${nombre}${detalle ? '  -> ' + detalle : ''}`);
    if (!condicion) fallos++;
  };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    await nube.connect();
  } catch {
    console.log('FALLA  no hay Supabase local. Levantalo con: npx supabase start && npm run supabase:aplicar');
    app.exit(1);
    return;
  }

  /** Un codigo de alta, generado como lo hara el panel. */
  async function codigoNuevo() {
    await nube.query('begin');
    await nube.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: JEFE })]);
    await nube.query('set local role authenticated');
    const { rows: [r] } = await nube.query(`select * from generar_codigo_enrolamiento('Kiosco de la prueba', 'Pruebas')`);
    await nube.query('commit');
    return r.codigo;
  }

  const estados = [];
  const dispositivos = [];

  try {
    bd.abrirBaseDeDatos();
    bd.iniciarSincronizacion({
      avisar: (cambios) => { if (cambios.nube) estados.push(cambios.nube); },
      obtenerEstado: () => ({ camaraDisponible: true }),
    });

    // ======================================================================
    console.log('\n--- dar de alta ---');
    comprobar('sin credencial, el kiosco pide alta', bd.estadoDeLaNube() === 'sin_alta', bd.estadoDeLaNube());

    const malo = await bd.enrolar('ZZZZ-ZZZZ');
    comprobar('un codigo que no existe: mensaje claro', malo.ok === false && /no sirve/.test(malo.mensaje), malo.mensaje);

    const codigo = await codigoNuevo();
    const alta = await bd.enrolar(`${codigo.slice(0, 4)}-${codigo.slice(4)}`.toLowerCase());
    comprobar('con el codigo del panel se da de alta', alta.ok === true && alta.nombre === 'Kiosco de la prueba', JSON.stringify(alta));

    const credencial = bd.leerCredencial();
    dispositivos.push(credencial.dispositivoId);
    const archivo = require('node:fs').readFileSync(bd.rutaDeLaCredencial(), 'utf8');
    comprobar('el token NO esta en claro en el archivo', !archivo.includes(credencial.token));
    bd.olvidarCredencialEnMemoria();
    comprobar('pero Windows lo descifra al volver a leerlo', bd.leerCredencial()?.token === credencial.token);

    const otraAlta = await bd.enrolar(await codigoNuevo());
    comprobar('ya dado de alta, no se deja dar de alta otra vez', otraAlta.ok === false);

    // ======================================================================
    console.log('\n--- primera vuelta: baja el catalogo ---');
    // `enrolar` ya pidio una vuelta; se espera a que termine.
    for (let i = 0; i < 50 && bd.estadoDeLaNube() !== 'en_linea'; i++) await esperar(200);
    await bd.ciclo();
    comprobar('queda en linea', bd.estadoDeLaNube() === 'en_linea', estados.join(' > '));

    const dalton = bd.buscarPorUsuario('dgomez');
    comprobar('bajaron los empleados de la nube (dgomez con su id de la nube)', dalton && dalton.id === DGOMEZ_NUBE);
    comprobar('con su PIN (1234) funcionando sin internet', dalton && (await bd.verificarPin(dalton, '1234')).ok === true);
    comprobar('bajo el jefe con su contrasena de KIOSCO', (await bd.entrarModoAdmin('jefe', 'jefe-de-prueba')).ok === true);
    bd.cerrarSesionAdmin('salida');
    const zona = bd.baseDeDatos().prepare("SELECT valor FROM configuracion_cache WHERE clave = 'zona_horaria'").get();
    comprobar('bajo la configuracion', zona && JSON.parse(zona.valor) === 'America/Matamoros');

    const desfase = Number(bd.leerEstadoLocal('desfase_servidor_ms'));
    comprobar('midio el desfase del reloj contra el servidor (misma PC: casi 0)', Math.abs(desfase) < 3000, String(desfase));

    const { rows: [disp] } = await nube.query('select ultima_conexion, version_app, camara_ok from dispositivos where id = $1', [credencial.dispositivoId]);
    comprobar('el latido llego: el panel ve la ultima conexion', disp.ultima_conexion !== null && disp.camara_ok === true);

    // ======================================================================
    console.log('\n--- subir ---');
    const idMarca = bd.nuevoIdDeMarca();
    bd.guardarMarca({ id: idMarca, empleadoId: DGOMEZ_NUBE, usuario: 'dgomez', tipo: 'entrada', reloj: bd.leerReloj(), banderas: [], foto: null });
    const idFantasma = bd.nuevoIdDeMarca();
    bd.guardarMarca({ id: idFantasma, empleadoId: crypto.randomUUID(), usuario: 'nadie', tipo: 'entrada', reloj: bd.leerReloj(), banderas: [], foto: null });
    bd.registrarEvento('camara_desconectada', { detalle: 'prueba' });

    await bd.ciclo();
    const { rows: [enNube] } = await nube.query('select dispositivo_id, foto_estado from marcas where id = $1', [idMarca]);
    comprobar('la marca llego a la nube, ligada a este kiosco', enNube && enNube.dispositivo_id === credencial.dispositivoId);
    comprobar('sin foto -> sin_camara', enNube && enNube.foto_estado === 'sin_camara');
    const renglon = (id) => bd.baseDeDatos().prepare('SELECT sincronizado_en, rechazado_en, ultimo_error FROM outbox WHERE id = ?').get(id);
    comprobar('en el kiosco queda como enviada', renglon(idMarca).sincronizado_en !== null);
    comprobar('la de un empleado que la nube no conoce: rechazada, con motivo, sin borrarse',
      renglon(idFantasma).rechazado_en !== null && renglon(idFantasma).ultimo_error === 'empleado_desconocido');
    const { rows: [{ n: eventos }] } = await nube.query('select count(*)::int as n from eventos_dispositivo where dispositivo_id = $1', [credencial.dispositivoId]);
    comprobar('el evento tambien llego', eventos >= 1);
    comprobar('no queda nada "por enviar"', bd.contarPendientes() === 0, String(bd.contarPendientes()));

    // ======================================================================
    console.log('\n--- cambios en la oficina ---');
    await nube.query(`update empleados set pin_hash = extensions.crypt('5555', extensions.gen_salt('bf', 4)) where id = $1`, [DGOMEZ_NUBE]);
    await nube.query(`update empleados set activo = false where usuario = 'fortiz'`);
    bd.reiniciarSincronizacionParaPrueba(); // para no esperar los 5 minutos del catalogo
    await bd.ciclo();
    comprobar('un PIN cambiado en el panel ya vale en el kiosco',
      (await bd.verificarPin(bd.buscarPorUsuario('dgomez'), '5555')).ok === true);
    comprobar('una baja en el panel desactiva al empleado en el kiosco', bd.buscarPorUsuario('fortiz')?.activo === false);

    // ======================================================================
    console.log('\n--- el reloj se movio sin internet (CLAUDE.md 6) ---');
    // Se simula: la ultima vez que hablo con la nube, Windows iba 10 minutos
    // adelantado. Ahora va bien. Lo registrado mientras tanto es dudoso.
    bd.reiniciarSincronizacionParaPrueba();
    bd.guardarEstadoLocal('desfase_servidor_ms', String(10 * 60 * 1000));
    const idSinRed = bd.nuevoIdDeMarca();
    bd.guardarMarca({ id: idSinRed, empleadoId: DGOMEZ_NUBE, usuario: 'dgomez', tipo: 'salida', reloj: bd.leerReloj(), banderas: [], foto: null });
    bd.iniciarSincronizacion({ avisar: () => {}, obtenerEstado: () => ({ camaraDisponible: true }) });
    for (let i = 0; i < 50 && bd.contarPendientes() > 0; i++) {
      await bd.ciclo();
      await esperar(200);
    }
    const { rows: [dudosa] } = await nube.query('select banderas from marcas where id = $1', [idSinRed]);
    comprobar('lo registrado sin internet llega marcado como hora dudosa',
      dudosa?.banderas?.includes('reloj_sospechoso'), JSON.stringify(dudosa));
    const local = bd.baseDeDatos().prepare('SELECT banderas FROM marcas WHERE id = ?').get(idSinRed);
    comprobar('y tambien en el kiosco', local.banderas.includes('reloj_sospechoso'), local.banderas);

    // ======================================================================
    console.log('\n--- la oficina no reconoce el kiosco ---');
    const { rows: [{ token_hash: hashOriginal }] } = await nube.query('select token_hash from dispositivos where id = $1', [credencial.dispositivoId]);
    await nube.query(`update dispositivos set token_hash = $2 where id = $1`, [credencial.dispositivoId, 'f'.repeat(64)]);
    bd.reiniciarSincronizacionParaPrueba();
    await bd.ciclo();
    comprobar('token desconocido -> "no reconocido" (y pide alta)', bd.estadoDeLaNube() === 'no_reconocido', bd.estadoDeLaNube());
    await nube.query(`update dispositivos set token_hash = $2 where id = $1`, [credencial.dispositivoId, hashOriginal]);

    const realta = await bd.enrolar(await codigoNuevo());
    comprobar('se puede dar de alta de nuevo', realta.ok === true);
    const nueva = bd.leerCredencial();
    dispositivos.push(nueva.dispositivoId);
    for (let i = 0; i < 50 && bd.estadoDeLaNube() !== 'en_linea'; i++) await esperar(200);
    comprobar('y vuelve a quedar en linea', bd.estadoDeLaNube() === 'en_linea', bd.estadoDeLaNube());

    // ======================================================================
    console.log('\n--- kiosco revocado ---');
    await nube.query('begin');
    await nube.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: JEFE })]);
    await nube.query('set local role authenticated');
    await nube.query('select revocar_dispositivo($1)', [nueva.dispositivoId]);
    await nube.query('commit');

    // Una marca hecha DESPUES de la revocacion.
    const idTardia = bd.nuevoIdDeMarca();
    bd.guardarMarca({ id: idTardia, empleadoId: DGOMEZ_NUBE, usuario: 'dgomez', tipo: 'salida', reloj: bd.leerReloj(), banderas: [], foto: null });
    bd.reiniciarSincronizacionParaPrueba();
    await bd.ciclo();
    comprobar('el kiosco se entera de que lo dieron de baja', bd.estadoDeLaNube() === 'revocado', bd.estadoDeLaNube());
    comprobar('lo registrado despues de la baja queda rechazado (guardado, con motivo)',
      renglon(idTardia).rechazado_en !== null && renglon(idTardia).ultimo_error === 'dispositivo_revocado');
    comprobar('y el kiosco sigue registrando: la marca esta en la base local',
      bd.baseDeDatos().prepare('SELECT COUNT(*) AS n FROM marcas WHERE id = ?').get(idTardia).n === 1);
  } catch (fallo) {
    console.log('FALLA  error inesperado:', fallo);
    fallos++;
  } finally {
    // ----------------------------------------------------------------------
    //  Limpieza de la nube (las marcas son inmutables: se apagan los triggers
    //  solo en esta conexion, como en probar-funciones.mjs)
    // ----------------------------------------------------------------------
    try {
      await nube.query('rollback').catch(() => {});
      await nube.query('set session_replication_role = replica');
      await nube.query('delete from marcas where dispositivo_id = any($1)', [dispositivos]);
      await nube.query('delete from eventos_dispositivo where dispositivo_id = any($1)', [dispositivos]);
      await nube.query('delete from accesos_foto where dispositivo_id = any($1)', [dispositivos]);
      await nube.query(`delete from codigos_enrolamiento where nombre_dispositivo = 'Kiosco de la prueba'`);
      await nube.query('delete from dispositivos where id = any($1)', [dispositivos]);
      await nube.query(`update empleados set pin_hash = extensions.crypt('1234', extensions.gen_salt('bf', 10)) where id = $1`, [DGOMEZ_NUBE]);
      await nube.query(`update empleados set activo = true where usuario = 'fortiz'`);
      await nube.query('set session_replication_role = origin');
      await nube.end();
    } catch (fallo) {
      console.log('(no se pudo limpiar la nube:', fallo.message, ')');
    }
  }

  console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASARON' : `\n${fallos} PRUEBA(S) FALLARON`);
  app.exit(fallos === 0 ? 0 : 1);
});
