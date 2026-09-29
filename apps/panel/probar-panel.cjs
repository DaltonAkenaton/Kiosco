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
  // Las descargas: si se dio carpeta de capturas, se guardan ahi (para
  // revisarlas a mano); si no, se cancelan. Nunca abren "Guardar como".
  const descargados = [];
  w.webContents.session.on('will-download', (evento, item) => {
    if (!carpetaCapturas) {
      evento.preventDefault();
      descargados.push(item.getFilename());
      return;
    }
    fs.mkdirSync(carpetaCapturas, { recursive: true });
    item.setSavePath(path.join(carpetaCapturas, item.getFilename()));
    descargados.push(item.getFilename());
  });
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

  /** El enlace del ultimo correo que le llego a `correo` en Mailpit (Supabase local). */
  const enlaceDelCorreo = async (correo) => {
    for (let intento = 0; intento < 10; intento++) {
      const lista = await (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent('to:' + correo)}`)).json();
      const id = lista.messages?.[0]?.ID;
      if (id) {
        const correoCompleto = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`)).json();
        return correoCompleto.Text.match(/https?:\/\/\S+verify\S+/)?.[0]?.replace(/[)\]>]+$/, '') ?? null;
      }
      await esperar(500);
    }
    return null;
  };
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
    // Empezar sin sesion: si una corrida anterior la dejo abierta, /entrar
    // (con razon) manda directo adentro y no habria donde escribir.
    await w.webContents.session.clearStorageData();
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
    comprobar('Asistencia tiene boton "Actualizar" y dice a que hora se actualizo',
      await js(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Actualizar')) && document.body.innerText.includes('actualizado a las')`));
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
    // Con Number('') a secas, un campo vacio se guardaba como 0 (auditoria 27-09).
    await escribir('panel-dialogo input.text-xl', '');
    await picar('Guardar');
    comprobar('un campo vacío NO se guarda como 0', (await texto()).includes('Escribe un número entero'));
    await escribir('panel-dialogo input.text-xl', '10');
    await picar('Guardar');
    comprobar('el mismo valor que ya tiene no se guarda (no ensucia la bitácora)', (await texto()).includes('Es el mismo valor'));
    await escribir('panel-dialogo input.text-xl', '12');
    await picar('Guardar');
    await esperar(800);
    const { rows: [tol] } = await bd.query(`select valor from configuracion where clave = 'tolerancia_retardo_minutos'`);
    comprobar('un valor valido se guarda', tol.valor === 12, JSON.stringify(tol.valor));
    comprobar('y avisa que se guardó', (await texto()).includes('Guardado. Ya cuenta desde ahora'));
    await capturar('4-configuracion');

    // ====================================================================
    console.log('\n--- registro manual ---');
    // El dia de la prueba: hoy, o AYER si se corre de madrugada (antes de las
    // 06:10 una entrada de hoy a las 06:05 estaria en el futuro y el panel,
    // con razon, la rechaza).
    const { rows: [{ dia: diaDePrueba, dmy: diaTexto }] } = await bd.query(`
      select d::text as dia, to_char(d, 'DD/MM/YYYY') as dmy
        from (select case when (now() at time zone 'America/Matamoros')::time >= '06:10'
                          then (now() at time zone 'America/Matamoros')::date
                          else (now() at time zone 'America/Matamoros')::date - 1 end as d) x`);
    await ir('/asistencia');
    await picar('+ Registrar a mano');
    await js(`(() => { const s = document.querySelector('panel-dialogo select');
      s.value = ${JSON.stringify(idCreado)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await esperar(200);
    await escribir('panel-dialogo input[type=date]', diaDePrueba);
    await escribir('panel-dialogo input[type=time]', '06:05');
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'No hubo luz en la manana (prueba)');
    await picar('Registrar');
    await esperar(1200);
    const { rows: [manual] } = await bd.query(
      `select origen, to_char(hora_estimada at time zone 'America/Matamoros', 'HH24:MI') as hora
         from marcas where empleado_id = $1 and origen = 'manual'`, [idCreado]);
    const errorDelDialogo = await js(`document.querySelector('panel-dialogo p.font-bold')?.textContent.trim() ?? ''`);
    comprobar('la marca manual se guarda a las 06:05 hora de Nuevo Laredo', manual?.hora === '06:05', manual?.hora ?? errorDelDialogo);
    // De madrugada la marca es de ayer: se amplia el filtro "Desde" para verla.
    await escribir('input[type=date]', diaDePrueba);
    await esperar(1200);
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
    await escribir('panel-dialogo input[type=date]', diaDePrueba);
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
    const resultadoHoy = await js(`[...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(${JSON.stringify(diaTexto)}))?.textContent.replace(/\\s+/g, ' ') ?? ''`);
    comprobar('su entrada de las 06:05 sale "A tiempo" en el reporte', resultadoHoy.includes('A tiempo'), resultadoHoy.trim().slice(0, 90));
    await capturar('6-reporte');

    // Los filtros se recuerdan: al volver a Reportes sigue elegida la persona.
    await ir('/asistencia');
    await ir('/reportes');
    comprobar('al volver a Reportes, el filtro de persona se recordó',
      (await js(`document.querySelector('select').value`)) === idCreado);

    await ir('/ausencias');
    await picar('+ Registrar incidencia');
    await esperar(800); // la ventana carga la lista de personas
    await js(`(() => { const s = document.querySelector('panel-dialogo select');
      s.value = ${JSON.stringify(idCreado)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Vacaciones de la prueba del panel');
    await picar('Registrar');
    await esperar(1000);
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
    console.log('\n--- justificar desde el reporte ---');
    // El dia mas reciente con un retardo. Antes se suponia "ayer", pero las
    // marcas de demostracion cubren los dias previos a cuando se CARGO la
    // semilla (seed.sql), no a hoy; y en lunes, "ayer" es domingo.
    const { rows: [dias] } = await bd.query(
      `select (now() at time zone 'America/Matamoros')::date::text as hoy,
              (select max(r.fecha)::text
                 from reporte_asistencia((now() at time zone 'America/Matamoros')::date - 30,
                                         (now() at time zone 'America/Matamoros')::date - 1) r
                where r.estado in ('retardo', 'retardo_mayor')) as ayer`);
    const ayer = dias.ayer;
    comprobar('hay un retardo reciente en los datos de prueba (si no: npm run supabase:aplicar)', ayer !== null);

    // Las fechas se recuerdan solo el mismo dia: guardadas "otro dia", el
    // filtro vuelve a "hasta hoy" (la pestaña que se quedo abierta del 26 al 28).
    await js(`sessionStorage.setItem('panel-filtro:reportes.hasta', JSON.stringify({ dia: '${ayer}', valor: '${ayer}' }))`);
    await ir('/reportes');
    comprobar('un "Hasta" guardado otro día vuelve a hoy',
      await js(`[...document.querySelectorAll('input[type=date]')][1]?.value`) === dias.hoy);

    await js(`(() => {
      sessionStorage.setItem('panel-filtro:reportes.desde', JSON.stringify({ dia: '${dias.hoy}', valor: '${ayer}' }));
      sessionStorage.setItem('panel-filtro:reportes.hasta', JSON.stringify({ dia: '${dias.hoy}', valor: '${ayer}' }));
      sessionStorage.setItem('panel-filtro:reportes.empleado', JSON.stringify(''));
      sessionStorage.setItem('panel-filtro:reportes.vista', JSON.stringify('dias'));
    })()`);
    await ir('/reportes');
    const antes = await js(`[...document.querySelectorAll('tbody tr')].filter((t) => t.textContent.includes('Justificado')).length`);
    // Se fue antes de su hora (una emergencia): "Justificar" propone Permiso.
    const salidaAntes = await js(`(() => {
      const fila = [...document.querySelectorAll('tbody tr')].find((t) => t.textContent.includes('min antes)')
        && !t.textContent.includes('Retardo') && [...t.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Justificar'));
      if (!fila) return false;
      [...fila.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Justificar').click();
      return true; })()`);
    if (salidaAntes) {
      await esperar(800);
      comprobar('quien se fue antes de su hora: "Justificar" propone Permiso',
        await js(`[...document.querySelectorAll('panel-dialogo select')].some((s) => s.value === 'permiso')`));
      await js(`[...document.querySelectorAll('panel-dialogo button')].find((x) => x.textContent.includes('Cancelar'))?.click()`);
      await esperar(500);
    } else {
      console.log('(sin salidas anticipadas ese dia en los datos de prueba: no se comprueba "Permiso")');
    }

    // El primer renglon con RETARDO (no cualquiera: tambien hay "Justificar" en salidas anticipadas).
    const hayBoton = await js(`(() => {
      const fila = [...document.querySelectorAll('tbody tr')].find((t) => t.textContent.includes('Retardo')
        && [...t.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Justificar'));
      const b = fila && [...fila.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Justificar');
      if (b) b.click(); return !!b; })()`);
    comprobar('un retardo tiene su botón "Justificar"', hayBoton);
    await esperar(800);
    comprobar('la ventana sugiere "Retardo justificado"',
      await js(`[...document.querySelectorAll('panel-dialogo select')].some((s) => s.value === 'retardo_justificado')`));
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Avisó que se le ponchó la llanta (prueba)');
    await picar('Registrar');
    await esperar(1500);
    const despues = await js(`[...document.querySelectorAll('tbody tr')].filter((t) => t.textContent.includes('Justificado')).length`);
    comprobar('al justificar, ese día pasa a "Justificado" y el reporte se recalcula', despues === antes + 1, `${antes} -> ${despues}`);
    await capturar('9-justificar');

    // ====================================================================
    console.log('\n--- Excel y PDF ---');
    descargados.length = 0;
    await picar('⬇ Descargar Excel');
    await esperar(1000);
    comprobar('Reportes descarga un Excel de verdad (.xlsx)', descargados.some((d) => d.endsWith('.xlsx')), descargados.join(','));
    if (carpetaCapturas) {
      const pdf = await w.webContents.printToPDF({ landscape: true, printBackground: true });
      fs.writeFileSync(path.join(carpetaCapturas, 'reporte.pdf'), pdf);
      comprobar('Reportes se puede guardar como PDF', pdf.length > 1000, `${pdf.length} bytes`);
    }
    await ir('/empleados');
    descargados.length = 0;
    await picar('⬇ Descargar lista (Excel)');
    await picar('Importar lista de Excel');
    await picar('⬇ Descargar plantilla');
    await esperar(1000);
    comprobar('la lista del personal y la plantilla se descargan en Excel',
      descargados.includes('plantilla-empleados.xlsx') && descargados.some((d) => d.startsWith('empleados-') && d.endsWith('.xlsx')),
      descargados.join(','));
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await esperar(300);

    // ====================================================================
    console.log('\n--- bitacora y mi cuenta ---');
    await ir('/bitacora');
    const bitacora = await texto();
    comprobar('la bitacora muestra los cambios con su motivo',
      bitacora.includes(motivoAlta) && bitacora.includes('No hubo luz en la manana (prueba)'));
    comprobar('y nunca un hash de PIN', !/\$2[aby]\$/.test(bitacora));
    comprobar('ni fechas en formato de maquina (2026-09-27T06:39...)', !/\d{4}-\d{2}-\d{2}T\d{2}:/.test(bitacora));
    // Lo normal: solo lo que hicieron personas. La marca manual SI (la hizo el jefe).
    const { rows: [{ n: deKioscos }] } = await bd.query(
      `select count(*)::int n from bitacora_auditoria where tabla = 'marcas' and actor is null`);
    comprobar('de inicio no se llena con los registros de los kioscos', !bitacora.includes('(a mano)') || deKioscos === 0 ||
      !(await js(`[...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent.includes('El sistema (un kiosco)'))`)));
    await js(`(() => { const s = document.querySelector('select.campo'); s.value = 'todo'; s.dispatchEvent(new Event('change')); })()`);
    await esperar(1500);
    comprobar('con "Todo" sí aparecen', deKioscos === 0 ||
      (await js(`[...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent.includes('El sistema (un kiosco)'))`)));
    await capturar('5-bitacora');
    await ir('/mi-cuenta');
    comprobar('Mi cuenta muestra el usuario del kiosco', (await texto()).includes('jefe'));

    // ====================================================================
    console.log('\n--- derechos ARCO ---');
    await ir('/empleados');
    await escribir('input[placeholder^="Buscar"]', 'rgomez');
    await picar('Sus datos (ARCO)');
    await escribir('panel-dialogo input.campo', 'Solicitud ARCO de acceso (prueba del panel)');
    await picar('Ver sus datos');
    await esperar(800);
    comprobar('la constancia ARCO se ve legible (no un archivo raro)', (await texto()).includes('Constancia de datos personales'));
    await capturar('8-constancia-arco');
    await picar('Cerrar');
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

    // ====================================================================
    console.log('\n--- ¿olvidaste tu contraseña? ---');
    // El correo local lo "recibe" Mailpit (http://127.0.0.1:54324): de ahi se
    // saca el enlace, como si la persona lo abriera desde su Gmail.
    await picar('Salir');
    await ir('/entrar');
    await escribir('input[type=email]', correoAcceso);
    await picar('¿Olvidaste tu contraseña?');
    await picar('Mandarme el correo para cambiarla');
    await esperar(2000);
    comprobar('pedir el correo dice que llegará (sin decir si el correo existe)', (await texto()).includes('en unos minutos le llega un correo'));
    const enlace = await enlaceDelCorreo(correoAcceso);
    comprobar('el correo llega con el enlace para cambiarla', Boolean(enlace), enlace ? 'llegó' : 'sin correo');
    await w.loadURL(enlace);
    await esperar(2500);
    comprobar('el enlace abre la pantalla "Contraseña nueva"',
      (await js('location.pathname')) === '/nueva-contrasena' && (await texto()).includes('Guardar y entrar'));
    await js(`(() => { for (const el of document.querySelectorAll('input[type=password]')) {
      el.value = 'recuperada-1234'; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    await esperar(200);
    await picar('Guardar y entrar');
    await esperar(2500);
    comprobar('con la contraseña nueva entra directo al panel', (await js('location.pathname')) === '/asistencia');
    await picar('Salir');
    await ir('/entrar');
    await escribir('input[type=email]', correoAcceso);
    await escribir('input[autocomplete=current-password]', 'recuperada-1234');
    await picar('Entrar');
    await esperar(1500);
    comprobar('y la próxima vez entra con ella', (await js('location.pathname')) === '/asistencia');
    await w.loadURL(enlace);
    await esperar(2500);
    comprobar('el mismo enlace no sirve dos veces', (await texto()).includes('Este enlace ya no sirve'));
    await ir('/asistencia');

    // ====================================================================
    console.log('\n--- cierre de sesión por inactividad ---');
    // No se esperan 30 minutos de verdad: se le dice al panel que la ultima
    // actividad fue hace casi 30 (y luego hace mas de 30) y se deja que revise.
    const limite = Number(await js(`localStorage.getItem('panel-minutos-inactividad') ?? '30'`));
    await js(`localStorage.setItem('panel-ultima-actividad', String(Date.now() - (${limite} * 60 - 40) * 1000))`);
    await esperar(6500);
    comprobar('a 40 segundos del límite aparece el aviso "¿Sigues ahí?"', (await texto()).includes('¿Sigues ahí?'));
    await picar('Sigo aquí');
    await esperar(6500);
    comprobar('"Sigo aquí" quita el aviso y la sesión sigue', !(await texto()).includes('¿Sigues ahí?') &&
      (await js('location.pathname')) !== '/entrar');
    await js(`localStorage.setItem('panel-ultima-actividad', String(Date.now() - (${limite} * 60 + 5) * 1000))`);
    await esperar(6500);
    comprobar('pasado el límite, la sesión se cierra sola', (await js('location.pathname')) === '/entrar');
    comprobar('y la pantalla de entrada explica por qué', (await texto()).includes('se cerró sola'));

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
      await bd.query(`delete from incidencias where notas = 'Avisó que se le ponchó la llanta (prueba)'`);
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
