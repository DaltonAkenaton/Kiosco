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
  // Las descargas (ARCO) se cancelan: si no, Electron abriria una ventana de
  // "Guardar como" en la pantalla del usuario.
  w.webContents.session.on('will-download', (evento) => evento.preventDefault());
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
  const correoAcceso = `supervisora-${Date.now()}@prueba.local`;
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
    console.log('\n--- horario y reporte (bloque 9) ---');
    await ir('/horarios');
    await js(`(() => { const tr = [...document.querySelectorAll('tr')].find((t) => t.textContent.includes('Rogelio Gomez Paz'));
      [...tr.querySelectorAll('button')].find((b) => b.textContent.includes('horario')).click(); })()`);
    await esperar(600);
    await js(`(() => { const s = document.querySelector('panel-dialogo select');
      const op = [...s.options].find((o) => o.textContent.startsWith('Matutino'));
      s.value = op.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    // Todos los dias, para que "hoy" tenga turno sea el dia que sea.
    await js(`[...document.querySelectorAll('panel-dialogo input[type=checkbox]')]
      .filter((c) => c.closest('label')?.classList.contains('w-36') && !c.checked).forEach((c) => c.click())`);
    await esperar(300);
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Horario de la prueba del panel');
    await picar('Guardar horario');
    await esperar(1000);
    comprobar('queda con horario Matutino', (await texto()).includes('Rogelio Gomez Paz') &&
      (await js(`[...document.querySelectorAll('tr')].find((t) => t.textContent.includes('Rogelio Gomez Paz'))?.textContent.includes('Matutino')`)));

    await ir('/reportes');
    await js(`(() => { const s = document.querySelector('select');
      s.value = ${JSON.stringify(idCreado)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await esperar(1500);
    await picar('Día por día');
    const resultadoHoy = await js(`[...document.querySelectorAll('tbody tr')].at(-1)?.textContent.replace(/\\s+/g, ' ') ?? ''`);
    comprobar('su entrada de las 06:05 sale "A tiempo" en el reporte', resultadoHoy.includes('A tiempo'), resultadoHoy.trim().slice(0, 90));
    await capturar('6-reporte');

    await ir('/ausencias');
    await picar('+ Registrar ausencia');
    await js(`(() => { const s = document.querySelector('panel-dialogo select');
      s.value = ${JSON.stringify(idCreado)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Vacaciones de la prueba del panel');
    await picar('Registrar');
    await esperar(800);
    comprobar('la ausencia aparece en la lista', (await texto()).includes('Vacaciones de la prueba del panel'));
    const { rows: [conAusencia] } = await bd.query(
      `select estado from reporte_asistencia((now() at time zone 'America/Matamoros')::date, (now() at time zone 'America/Matamoros')::date, $1)`,
      [idCreado]);
    comprobar('y el reporte de hoy ya dice "ausencia justificada"', conAusencia?.estado === 'incidencia', conAusencia?.estado);

    await ir('/asistencia');
    await js(`(() => { const tr = [...document.querySelectorAll('tbody tr')].find((t) => t.textContent.includes('Rogelio'));
      [...tr.querySelectorAll('button')].find((b) => b.textContent.includes('Corregir')).click(); })()`);
    await esperar(600);
    await js(`[...document.querySelectorAll('panel-dialogo input[type=radio]')][1].click()`); // "No debe contar"
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Registro de la prueba del panel');
    await picar('Guardar corrección');
    await esperar(1200);
    comprobar('el registro corregido se ve como "Anulado"',
      await js(`[...document.querySelectorAll('tbody tr')].find((t) => t.textContent.includes('Rogelio'))?.textContent.includes('Anulado') ?? false`));
    const { rows: [sigue] } = await bd.query(`select count(*)::int as n from marcas where empleado_id = $1`, [idCreado]);
    comprobar('y la marca original sigue en la base', sigue.n === 1);

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

    // ====================================================================
    console.log('\n--- derechos ARCO ---');
    await ir('/empleados');
    await escribir('input[placeholder^="Buscar"]', 'rgomez');
    await picar('Sus datos (ARCO)');
    await escribir('panel-dialogo input.campo', 'Solicitud ARCO de acceso (prueba del panel)');
    await picar('Descargar sus datos');
    const { rows: [arco] } = await bd.query(
      `select count(*)::int n from bitacora_auditoria where registro_id = $1 and datos_despues ->> 'arco' = 'exportacion_de_datos'`, [idCreado]);
    comprobar('descargar sus datos deja constancia en la bitacora', arco.n === 1);

    // ====================================================================
    console.log('\n--- datos de demostracion ---');
    await ir('/empleados');
    comprobar('con el interruptor apagado, NO aparece el boton de demostración',
      !(await texto()).includes('Generar datos de demostración'));
    await bd.query(`update configuracion set valor = '1' where clave = 'permitir_datos_demostracion'`);
    await ir('/entrar'); // volver a entrar para que lea la configuracion
    await ir('/empleados');
    await picar('🧪 Generar datos de demostración');
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Probar el panel con datos (prueba)');
    await picar('Generar');
    let pinesDemo = 0;
    for (let i = 0; i < 20 && !pinesDemo; i++) {
      await esperar(500);
      pinesDemo = await js(`document.querySelectorAll('.hoja-de-pines tbody tr').length`);
    }
    comprobar('genera 5 empleados DEMO y muestra sus PIN', pinesDemo === 5, String(pinesDemo));
    await picar('Ya lo anoté, cerrar');
    comprobar('en la lista se ven marcados DEMO', (await texto()).includes('DEMO'));
    await capturar('7-demostracion');

    // ====================================================================
    console.log('\n--- ventanas: Esc y clic afuera ---');
    await picar('+ Agregar empleado');
    // Presionar el raton sobre una casilla o un menu de la ventana NO debe
    // cancelarse: si se cancela, la casilla no recibe el cursor (E-021). Se
    // prueba con un evento de raton de verdad, no escribiendo por codigo.
    const presionCancelada = await js(`(() => {
      const objetivos = [...document.querySelectorAll('panel-dialogo input, panel-dialogo select')];
      return objetivos.some((el) => {
        const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        el.dispatchEvent(e);
        return e.defaultPrevented;
      });
    })()`);
    comprobar('presionar el ratón en una casilla de la ventana no se cancela', presionCancelada === false);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await esperar(300);
    comprobar('Esc cierra la ventana', !(await js(`!!document.querySelector('panel-dialogo')`)));
    await picar('+ Agregar empleado');
    await js(`(() => { const f = document.querySelector('panel-dialogo > div');
      f.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); f.click(); })()`);
    await esperar(300);
    comprobar('picar afuera cierra la ventana', !(await js(`!!document.querySelector('panel-dialogo')`)));

    // ====================================================================
    console.log('\n--- accesos al panel ---');
    await ir('/accesos');
    comprobar('la lista de accesos muestra al jefe', (await texto()).includes('Jefe de prueba'));
    await picar('+ Dar acceso a alguien');
    await escribir('panel-dialogo input:not([type=radio]):not([type=email])', 'Supervisora de la Prueba');
    await escribir('panel-dialogo input[type=email]', correoAcceso);
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Nueva supervisora (prueba del panel)');
    await picar('Dar acceso');
    // La primera llamada a una Edge Function "fria" puede tardar varios
    // segundos: se espera a que aparezca la contrasena, hasta 10 s.
    let temporal = '';
    for (let i = 0; i < 20 && !temporal; i++) {
      await esperar(500);
      temporal = await js(`document.querySelector('.hoja-de-pines .font-mono')?.textContent?.trim() ?? ''`);
    }
    comprobar('da una contrasena temporal y la muestra una vez', /^[A-Za-z2-9]{12}$/.test(temporal), temporal);
    await capturar('6-accesos');
    await picar('Ya la anoté, cerrar');
    comprobar('la persona nueva aparece como supervisora con contrasena temporal',
      (await texto()).includes('Supervisora de la Prueba') && (await texto()).includes('Todavía con contraseña temporal'));

    // Entra la persona nueva: el panel la manda a ponerse contrasena propia.
    await picar('Salir');
    await ir('/entrar');
    await escribir('input[type=email]', correoAcceso);
    await escribir('input[autocomplete=current-password]', temporal);
    await picar('Entrar');
    await esperar(1500);
    await ir('/asistencia');
    comprobar('con contrasena temporal, solo puede estar en Mi cuenta', (await js('location.pathname')) === '/mi-cuenta');
    comprobar('y se le explica por que', (await texto()).includes('contraseña temporal'));
    await js(`(() => { const c = [...document.querySelectorAll('section')].pop().querySelectorAll('input[type=password]');
      for (const el of c) { el.value = 'mi-contrasena-propia'; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    await esperar(200);
    await picar('Cambiar contraseña');
    await esperar(1500);
    await ir('/asistencia');
    comprobar('con su contrasena propia ya puede usar el panel', (await js('location.pathname')) === '/asistencia');

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
        await bd.query('delete from correcciones where empleado_id = $1', [idCreado]);
        await bd.query('delete from incidencias where empleado_id = $1', [idCreado]);
        await bd.query('delete from asignaciones_turno where empleado_id = $1', [idCreado]);
        await bd.query('delete from marcas where empleado_id = $1', [idCreado]);
        await bd.query('delete from empleados where id = $1', [idCreado]);
      }
      await bd.query(`delete from codigos_enrolamiento where nombre_dispositivo = 'Kiosco de la prueba del panel'`);
      const demo = `(select id from empleados where numero_empleado like 'DEMO-%')`;
      await bd.query(`delete from marcas where empleado_id in ${demo}`);
      await bd.query(`delete from asignaciones_turno where empleado_id in ${demo}`);
      await bd.query(`delete from empleados where numero_empleado like 'DEMO-%'`);
      await bd.query(`delete from dispositivos where nombre = 'Kiosco de demostración'`);
      await bd.query(`update configuracion set valor = '0' where clave = 'permitir_datos_demostracion'`);
      await bd.query('delete from administradores where correo = $1', [correoAcceso]);
      await bd.query('delete from auth.users where email = $1', [correoAcceso]);
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
