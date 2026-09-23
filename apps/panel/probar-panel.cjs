/**
 * ============================================================================
 *  PRUEBA DEL PANEL, USANDOLO  (bloques 7 y 8)
 * ============================================================================
 *
 *  Abre el panel en una ventana OCULTA de Electron y hace lo que haria el
 *  jefe: entra, da de alta a alguien, genera un codigo de kiosco, cambia la
 *  configuracion, registra una entrada a mano... y revisa en la base que cada
 *  cosa quedo, con su motivo en la bitacora.
 *
 *  Necesita:
 *      npx supabase start && npm run supabase:aplicar   (base con datos de prueba)
 *      npm run panel:servir                              (el panel en :4300)
 *      npm run panel:probar
 *
 *  Si le pasas una carpeta (`npm run panel:probar -- C:\capturas`), guarda una
 *  captura de cada pantalla ahi.
 *
 *  Nunca muestra ventanas: todo pasa en una oculta (ver la memoria del
 *  proyecto sobre pruebas de Electron sin ventanas).
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const PANEL = 'http://localhost:4300';
const carpetaCapturas = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.cjs'));

app.whenReady().then(async () => {
  let fallos = 0;
  const comprobar = (nombre, condicion, detalle = '') => {
    console.log(`${condicion ? 'OK   ' : 'FALLA'}  ${nombre}${detalle ? '  -> ' + detalle : ''}`);
    if (!condicion) fallos++;
  };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  const bd = new pg.Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  try {
    await bd.connect();
    const r = await fetch(PANEL);
    if (!r.ok) throw new Error('panel');
  } catch {
    console.log('FALLA  hace falta Supabase local (npx supabase start) y el panel (npm run panel:servir)');
    app.exit(1);
    return;
  }

  const w = new BrowserWindow({ show: false, width: 1440, height: 1000 });
  const erroresDeConsola = [];
  w.webContents.on('console-message', (_e, nivel, mensaje) => {
    // Nivel 3 = error. Los avisos de seguridad de Electron en desarrollo no cuentan.
    if (nivel >= 3 && !/Electron Security Warning/.test(mensaje)) erroresDeConsola.push(mensaje);
  });

  const js = (codigo) => w.webContents.executeJavaScript(codigo);
  /** Escribe en un campo como una persona (dispara el evento `input`). */
  const escribir = async (selector, valor) => {
    await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('no encontre ' + ${JSON.stringify(selector)});
      el.value = ${JSON.stringify(valor)}; el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await esperar(150);
  };
  /**
   * Pica el boton (o enlace) que dice ese texto. Primero busca el texto
   * EXACTO: "Registrar" no debe picar "+ Registrar a mano".
   */
  const picar = async (texto) => {
    const ok = await js(`(() => {
      const t = ${JSON.stringify(texto)};
      const todos = [...document.querySelectorAll('button, a')].filter((e) => !e.disabled);
      const limpio = (e) => e.textContent.replace(/\\s+/g, ' ').trim();
      const b = todos.find((e) => limpio(e) === t) ?? todos.find((e) => limpio(e).includes(t));
      if (b) b.click(); return !!b; })()`);
    if (!ok) throw new Error(`no encontre el boton "${texto}"`);
    await esperar(900);
  };
  const texto = () => js('document.body.innerText');
  const capturar = async (nombre) => {
    if (!carpetaCapturas) return;
    fs.mkdirSync(carpetaCapturas, { recursive: true });
    fs.writeFileSync(path.join(carpetaCapturas, `${nombre}.png`), (await w.webContents.capturePage()).toPNG());
  };
  const ir = async (ruta) => {
    await w.loadURL(PANEL + ruta);
    await esperar(1800);
  };

  const motivoAlta = `Prueba del panel ${Date.now()}`;
  let idCreado = null;

  try {
    // ====================================================================
    console.log('\n--- entrar ---');
    await ir('/entrar');
    await escribir('input[type=email]', 'jefe@prueba.local');
    await escribir('input[autocomplete=current-password]', 'equivocada');
    await picar('Entrar');
    await esperar(1000);
    comprobar('con contrasena equivocada: mensaje claro y no entra',
      (await texto()).includes('Correo o contraseña incorrectos') && (await js('location.pathname')) === '/entrar');

    await escribir('input[autocomplete=current-password]', 'panel-de-prueba');
    await picar('Entrar');
    await esperar(1500);
    comprobar('con la contrasena del panel entra a Asistencia', (await js('location.pathname')) === '/asistencia');
    comprobar('saluda con su nombre y rol', (await texto()).includes('Jefe de prueba') && (await texto()).includes('Administrador'));
    await capturar('1-asistencia');

    // ====================================================================
    console.log('\n--- empleados: alta con PIN generado ---');
    await ir('/empleados');
    comprobar('la lista trae a los 20 de prueba', (await texto()).includes('20 persona(s)'), (await texto()).match(/\d+ persona\(s\)/)?.[0]);
    await picar('+ Agregar empleado');
    await escribir('panel-dialogo input', ''); // el primer campo: nombre
    await js(`document.querySelectorAll('panel-dialogo input')[0].focus()`);
    const campos = ['Rogelio', 'Gomez', 'Paz', '2001'];
    for (let i = 0; i < campos.length; i++) {
      await js(`(() => { const el = document.querySelectorAll('panel-dialogo input')[${i}];
        el.value = ${JSON.stringify(campos[i])}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await esperar(150);
    }
    const usuarioPropuesto = await js(`document.querySelectorAll('panel-dialogo input')[4].value`);
    comprobar('propone el usuario solo (rgomez)', usuarioPropuesto === 'rgomez', usuarioPropuesto);
    await escribir('panel-dialogo input[placeholder^="Ej."]', motivoAlta);
    await picar('Dar de alta');
    await esperar(1500);
    const pinMostrado = await js(`document.querySelector('.hoja-de-pines td.font-mono.text-3xl')?.textContent.trim() ?? ''`);
    comprobar('muestra el PIN una vez, grande', /^[0-9]{4}$/.test(pinMostrado), pinMostrado);
    await capturar('2-pin');
    const { rows: [nuevo] } = await bd.query(
      `select id, pin_hash = extensions.crypt($1, pin_hash) as cuadra from empleados where usuario = 'rgomez'`, [pinMostrado]);
    idCreado = nuevo?.id ?? null;
    comprobar('quedo en la base, con ESE PIN', nuevo?.cuadra === true);
    const { rows: [b] } = await bd.query(
      `select motivo from bitacora_auditoria where tabla = 'empleados' and registro_id = $1`, [idCreado]);
    comprobar('y en la bitacora con el motivo escrito', b?.motivo === motivoAlta);
    await picar('Ya lo anoté, cerrar');

    // ====================================================================
    console.log('\n--- kioscos: codigo de alta ---');
    await ir('/kioscos');
    comprobar('muestra las alertas', (await texto()).includes('Para atender'));
    await picar('+ Dar de alta un kiosco');
    await escribir('panel-dialogo input[placeholder="Ej.: Entrada principal"]', 'Kiosco de la prueba del panel');
    await picar('Generar código');
    await esperar(800);
    const codigo = await js(`document.querySelector('p.font-mono.text-6xl')?.textContent.trim() ?? ''`);
    comprobar('muestra el codigo XXXX-XXXX', /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(codigo), codigo);
    await capturar('3-codigo');
    await picar('Listo');

    // ====================================================================
    console.log('\n--- configuracion ---');
    await ir('/configuracion');
    comprobar('las opciones tienen nombre entendible', (await texto()).includes('Tolerancia para llegar tarde'));
    await js(`(() => { const art = [...document.querySelectorAll('article')].find((a) => a.textContent.includes('Tolerancia para llegar tarde'));
      [...art.querySelectorAll('button')].find((b) => b.textContent.includes('Cambiar')).click(); })()`);
    await esperar(600);
    await escribir('panel-dialogo input.text-xl', '999');
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Prueba de un valor fuera de rango');
    await picar('Guardar');
    comprobar('un valor fuera de rango se rechaza con el rango', (await texto()).includes('Debe estar entre 0 y 120'));
    await escribir('panel-dialogo input.text-xl', '12');
    await picar('Guardar');
    await esperar(800);
    const { rows: [tol] } = await bd.query(`select valor from configuracion where clave = 'tolerancia_retardo_minutos'`);
    comprobar('un valor valido se guarda', tol.valor === 12, JSON.stringify(tol.valor));
    await capturar('4-configuracion');

    // ====================================================================
    console.log('\n--- registro manual ---');
    await ir('/asistencia');
    await picar('+ Registrar a mano');
    await js(`(() => { const s = document.querySelector('panel-dialogo select');
      s.value = ${JSON.stringify(idCreado)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await esperar(200);
    await escribir('panel-dialogo input[type=time]', '06:05');
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'No hubo luz en la manana (prueba)');
    await picar('Registrar');
    await esperar(1200);
    const { rows: [manual] } = await bd.query(
      `select origen, to_char(hora_estimada at time zone 'America/Matamoros', 'HH24:MI') as hora
         from marcas where empleado_id = $1 and origen = 'manual'`, [idCreado]);
    const errorDelDialogo = await js(`document.querySelector('panel-dialogo p.font-bold')?.textContent.trim() ?? ''`);
    comprobar('la marca manual se guarda a las 06:05 hora de Nuevo Laredo', manual?.hora === '06:05', manual?.hora ?? errorDelDialogo);
    comprobar('y aparece en la tabla (en la columna Kiosco dice "Captura manual")',
      await js(`[...document.querySelectorAll('tbody td')].some((td) => td.textContent.trim() === 'Captura manual')`));

    // ====================================================================
    console.log('\n--- bitacora y mi cuenta ---');
    await ir('/bitacora');
    const bitacora = await texto();
    comprobar('la bitacora muestra los cambios con su motivo',
      bitacora.includes(motivoAlta) && bitacora.includes('No hubo luz en la manana (prueba)'));
    comprobar('y nunca un hash de PIN', !/\$2[aby]\$/.test(bitacora));
    await capturar('5-bitacora');
    await ir('/mi-cuenta');
    comprobar('Mi cuenta muestra el usuario del kiosco', (await texto()).includes('jefe'));

    comprobar('ninguna pantalla dejo errores en la consola', erroresDeConsola.length === 0, erroresDeConsola.slice(0, 2).join(' | '));
  } catch (fallo) {
    console.log('FALLA  la prueba se detuvo:', fallo.message);
    await capturar('error');
    fallos++;
  } finally {
    // Limpieza: lo creado por esta prueba (la configuracion vuelve a 10).
    try {
      await bd.query('set session_replication_role = replica');
      if (idCreado) {
        await bd.query('delete from marcas where empleado_id = $1', [idCreado]);
        await bd.query('delete from empleados where id = $1', [idCreado]);
      }
      await bd.query(`delete from codigos_enrolamiento where nombre_dispositivo = 'Kiosco de la prueba del panel'`);
      await bd.query(`update configuracion set valor = '10' where clave = 'tolerancia_retardo_minutos'`);
      await bd.query('set session_replication_role = origin');
      await bd.end();
    } catch (e) {
      console.log('(no se pudo limpiar:', e.message, ')');
    }
  }

  console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASARON' : `\n${fallos} PRUEBA(S) FALLARON`);
  app.exit(fallos === 0 ? 0 : 1);
});
