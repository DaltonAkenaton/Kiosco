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

  // Si truena, que diga QUE codigo fue (Electron solo dice "Script failed to execute").
  const js = (codigo) => w.webContents.executeJavaScript(codigo).catch((e) => {
    throw new Error(`${e.message}\n       en: ${codigo.replace(/\s+/g, ' ').slice(0, 200)}`);
  });
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
  /** Elige `valor` en el <select> (o escribe en el <input>) cuya etiqueta dice `etiqueta`. */
  const elegir = async (etiqueta, valor) => {
    const ok = await js(`(() => {
      const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes(${JSON.stringify(etiqueta)}));
      const c = l?.querySelector('select, input'); if (!c) return false;
      c.value = ${JSON.stringify(valor)}; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`no encontre el campo "${etiqueta}"`);
    await esperar(1500);
  };
  /**
   * El buscador de empleado (componentes/elegir-empleado.ts): abre el n-esimo
   * (dentro de `dentro`), escribe `buscar` y pica a la persona con ese id.
   */
  const elegirEmpleado = async (dentro, n, id, buscar = '') => {
    const ok = await js(`(() => {
      const c = document.querySelectorAll(${JSON.stringify(dentro + ' panel-elegir-empleado input')})[${n}];
      if (!c) return false;
      c.focus(); c.click();
      c.value = ${JSON.stringify(buscar)}; c.dispatchEvent(new Event('input', { bubbles: true }));
      return true; })()`);
    if (!ok) throw new Error(`no encontre el buscador de empleado ${n} en "${dentro}"`);
    await esperar(200);
    const picado = await js(`(() => {
      const li = document.querySelector('panel-elegir-empleado li[data-id="${id}"]');
      if (li) li.click(); return !!li; })()`);
    if (!picado) throw new Error(`en el buscador no aparece ${id} con "${buscar}"`);
    await esperar(400);
  };
  /** El numero rojo del menu junto a esa seccion ("Kioscos ②"), o 0. */
  const insignia = async (seccion) => Number(await js(`(() => {
    const a = [...document.querySelectorAll('.enlace-menu')].find((x) => x.textContent.includes(${JSON.stringify(seccion)}));
    return a?.querySelector('.insignia-pendientes')?.textContent ?? '0'; })()`));

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
  let idEventoDescarte = null;
  const { rows: [{ valor: revisarDesdeAntes }] } = await bd.query(
    `select valor from configuracion where clave = 'pendientes_revisar_desde'`);
  await bd.query(`update configuracion set valor = to_jsonb(((now() at time zone 'America/Matamoros')::date - 14)::text)
                   where clave = 'pendientes_revisar_desde'`);

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
    // Los datos de prueba tienen faltas (horario desde hace un mes, registros
    // solo de los ultimos 5 dias): hay pendientes, asi que entra ahi (0029).
    comprobar('con la contrasena del panel entra a Pendientes (porque hay casos sin atender)',
      (await js('location.pathname')) === '/pendientes', await js('location.pathname'));
    comprobar('y el menú dice cuántos', (await insignia('Pendientes')) > 0, String(await insignia('Pendientes')));
    await ir('/asistencia');
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
    // Sin numero no se guarda (obligatorio desde el 20-10-2026).
    await js(`(() => { const el = document.querySelectorAll('panel-dialogo input')[3];
      el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await picar('Dar de alta');
    await esperar(600);
    comprobar('sin numero de empleado no se guarda y dice por que',
      (await texto()).includes('Falta el número de empleado'));
    // "no tiene" en el numero (29-09-2026: se guardaba tal cual).
    await js(`(() => { const el = document.querySelectorAll('panel-dialogo input')[3];
      el.value = 'no tiene'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await picar('Dar de alta');
    await esperar(600);
    comprobar('un numero de empleado con espacios ("no tiene") no se guarda y dice por que',
      (await texto()).includes('sólo puede llevar letras sin acento'));
    await js(`(() => { const el = document.querySelectorAll('panel-dialogo input')[3];
      el.value = '2001'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
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
    await picar('Siguiente: asignar su horario');
    await esperar(1800);
    comprobar('"Siguiente: asignar su horario" abre el editor de horario de esa persona',
      (await js('location.pathname')) === '/horarios' && (await texto()).includes('Horario de Rogelio'));
    await picar('Cancelar');
    await esperar(400);

    // ====================================================================
    console.log('\n--- kioscos: codigo de alta ---');
    // Un descarte hecho en un kiosco (0025): el jefe debe verlo aqui, en palabras.
    const { rows: [eventoDescarte] } = await bd.query(
      `insert into eventos_dispositivo (id, dispositivo_id, tipo, detalle, ocurrido_en)
       values (gen_random_uuid(), '00000000-0000-4000-8000-00000000d001', 'registros_descartados',
               '{"adminId": "00000000-0000-4000-8000-00000000a001", "cantidad": 7, "motivo": "prueba del panel"}', now())
       returning id`);
    idEventoDescarte = eventoDescarte.id;
    await ir('/kioscos');
    comprobar('muestra las alertas', (await texto()).includes('Para atender'));

    // Camara que falla a ratos (0028): 3 desconexiones en la semana.
    for (const dias of [1, 2, 3]) {
      await bd.query(`insert into eventos_dispositivo (id, dispositivo_id, tipo, detalle, ocurrido_en)
        values (gen_random_uuid(), '00000000-0000-4000-8000-00000000d001', 'camara_desconectada', '{}', now() - make_interval(days => $1))`, [dias]);
    }
    await picar('↻ Actualizar');
    await esperar(1000);
    comprobar('avisa de la cámara que se desconecta a ratos (con cuántas veces)',
      /la cámara se desconectó \d+ veces desde el/.test(await texto()));
    comprobar('y el menú muestra el número junto a "Kioscos"', (await insignia('Kioscos')) >= 1, String(await insignia('Kioscos')));

    // "Ya lo vi": se esconde (y baja el numero) hasta que empeore.
    const antesDeVer = await insignia('Kioscos');
    await js(`[...document.querySelectorAll('li')].find((li) => /se desconectó \\d+ veces/.test(li.textContent))
      ?.querySelector('button')?.click()`);
    await esperar(500);
    comprobar('"Ya lo vi" esconde el aviso y baja el número del menú',
      !/la cámara se desconectó \d+ veces/.test(await texto()) && (await insignia('Kioscos')) === antesDeVer - 1,
      `${antesDeVer} -> ${await insignia('Kioscos')}`);
    await ir('/kioscos');
    comprobar('y sigue escondido al volver a la página', !/la cámara se desconectó \d+ veces/.test(await texto()));
    await bd.query(`insert into eventos_dispositivo (id, dispositivo_id, tipo, detalle, ocurrido_en)
      values (gen_random_uuid(), '00000000-0000-4000-8000-00000000d001', 'camara_desconectada', '{}', now())`);
    await picar('↻ Actualizar');
    await esperar(1000);
    comprobar('si la cámara se desconecta OTRA vez, el aviso vuelve', /la cámara se desconectó \d+ veces/.test(await texto()));

    // Alguien dado de baja que registro en un kiosco sin internet (0028).
    const { rows: [deBaja] } = await bd.query(
      `insert into empleados (usuario, nombre, apellido_paterno, pin_hash)
       values ('zbaja' || floor(random() * 1e6)::int, 'Zoila', 'DeBaja', extensions.crypt('1234', extensions.gen_salt('bf', 4)))
       returning id`);
    // La baja, como si la hubiera hecho el jefe desde el panel (actor y motivo en la bitacora).
    await bd.query('begin');
    await bd.query(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001"}', true)`);
    await bd.query(`select set_config('app.motivo', 'Ya no trabaja aquí (prueba del panel)', true)`);
    await bd.query('update empleados set activo = false where id = $1', [deBaja.id]);
    await bd.query('commit');
    await bd.query(
      `insert into marcas (id, empleado_id, dispositivo_id, tipo, hora_dispositivo, hora_estimada, monotonico_ms, arranque_id)
       values (gen_random_uuid(), $1, '00000000-0000-4000-8000-00000000d001', 'entrada', now(), now(), 0, gen_random_uuid())`, [deBaja.id]);
    // Desde la 0029 eso es un PENDIENTE (con su interruptor en Configuración),
    // y ya no sale en la franja de Asistencia.
    await ir('/pendientes');
    comprobar('el registro de alguien dado de baja aparece en Pendientes',
      (await texto()).includes('Zoila DeBaja') && /registros? después de su baja/i.test(await texto()));
    comprobar('y ya no en la franja de Asistencia (no se avisa dos veces)',
      await (async () => { await ir('/asistencia'); return !(await texto()).includes('personas que ya estaban dadas de baja'); })());
    await bd.query(`update configuracion set valor = '0' where clave = 'pendientes_registros_de_baja'`);
    await ir('/asistencia');
    comprobar('con ese tipo de pendiente apagado, Asistencia avisa arriba como antes',
      (await texto()).includes('Para atender') && (await texto()).includes('personas que ya estaban dadas de baja'));
    comprobar('y el menú lo cuenta junto a "Asistencia"', (await insignia('Asistencia')) >= 1);
    await picar('Ver cuáles');
    await esperar(1000);
    comprobar('"Ver cuáles" filtra justo esos registros', (await texto()).includes('Zoila DeBaja') &&
      (await texto()).includes('Persona dada de baja'));
    await elegir('Revisión', '');
    await bd.query(`update configuracion set valor = '1' where clave = 'pendientes_registros_de_baja'`);
    await ir('/kioscos');
    comprobar('PC compartida: un kiosco que no se reporta sale "Cerrado" y no como alerta',
      (await texto()).includes('Cerrado') && !/no se reporta desde/.test(await texto()));
    comprobar('"Lo que se hizo en los kioscos": el descarte con quién, cuántos y el motivo',
      (await texto()).includes('Lo que se hizo en los kioscos')
        && /Jefe de prueba descartó 7 registro\(s\).*«prueba del panel»/.test(await texto()));
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
    console.log('\n--- respaldo desde el panel (0027) ---');
    const motivoRespaldo = `Respaldo de prueba ${Date.now()}`;
    await picar('Descargar respaldo');
    comprobar('el respaldo avisa que son datos personales', (await texto()).includes('Son datos personales de todo el personal'));
    await escribir('panel-dialogo input[placeholder^="Ej."]', motivoRespaldo);
    descargados.length = 0;
    await picar('Descargar');
    for (let i = 0; i < 30 && !descargados.some((d) => /^respaldo-\d{4}-\d{2}-\d{2}\.xlsx$/.test(d)); i++) await esperar(500);
    comprobar('descarga el respaldo en Excel (respaldo-AAAA-MM-DD.xlsx)',
      descargados.some((d) => /^respaldo-\d{4}-\d{2}-\d{2}\.xlsx$/.test(d)), descargados.join(','));
    await esperar(500);
    comprobar('y avisa que se descargó', (await texto()).includes('Respaldo descargado'));
    const { rows: [resp] } = await bd.query(
      `select count(*)::int n from bitacora_auditoria where tabla = 'respaldo' and motivo = $1`, [motivoRespaldo]);
    comprobar('la descarga del respaldo queda en la bitácora', resp.n === 1);

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
    await elegirEmpleado('panel-dialogo', 0, idCreado, 'rogelio');
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
    await elegirEmpleado('', 0, idCreado, 'rogelio');
    await esperar(1500);
    await picar('Día por día');
    const resultadoHoy = await js(`[...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(${JSON.stringify(diaTexto)}))?.textContent.replace(/\\s+/g, ' ') ?? ''`);
    comprobar('su entrada de las 06:05 sale "A tiempo" en el reporte', resultadoHoy.includes('A tiempo'), resultadoHoy.trim().slice(0, 90));
    await capturar('6-reporte');

    // Dia por dia: lo mas reciente arriba por defecto, y un boton lo invierte (30-09-2026).
    const encabezados = () => js(`[...document.querySelectorAll('tr.encabezado-dia')].map((t) => t.textContent.trim())`);
    // Con todas las personas, para que haya varios dias que ordenar.
    await js(`document.querySelector('panel-elegir-empleado button[aria-label="Quitar"]').click()`);
    await esperar(1500);
    const diasAntes = await encabezados();
    comprobar('"Día por día" empieza con los más recientes', (await texto()).includes('↓ Más recientes primero'));
    await picar('↓ Más recientes primero');
    await esperar(300);
    const diasDespues = await encabezados();
    comprobar('y el botón invierte el orden de los días',
      diasAntes.length > 1 && JSON.stringify(diasDespues) === JSON.stringify([...diasAntes].reverse()), `${diasAntes.length} días`);
    await picar('↑ Más antiguos primero');

    // Quien falto mas (21-10-2026): el resumen se ordena por faltas, y "Este mes" pone las fechas solo.
    await picar('Resumen por persona');
    await esperar(300);
    const ordenar = (valor) => js(`(() => { const s = document.querySelector('[data-prueba=orden-resumen]');
        s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await ordenar('faltas');
    await esperar(300);
    const faltasEnOrden = await js(`[...document.querySelectorAll('tbody tr')].map((tr) => Number(tr.cells[5].textContent.trim()))`);
    comprobar('"Más faltas primero" ordena el resumen por faltas',
      faltasEnOrden.length > 1 && faltasEnOrden.every((n, i) => i === 0 || n <= faltasEnOrden[i - 1]), faltasEnOrden.join(','));
    await picar('Este mes');
    await esperar(1500);
    const [mesDesde, mesHasta] = await js(`[...document.querySelectorAll('input[type=date]')].map((i) => i.value)`);
    comprobar('"Este mes" pone del día primero a hoy', mesDesde === mesHasta.slice(0, 8) + '01', `${mesDesde} a ${mesHasta}`);
    await ordenar('nombre');
    await picar('Día por día');
    await esperar(1000);
    await elegirEmpleado('', 0, idCreado, 'rogelio');
    await esperar(1000);

    // Los filtros se recuerdan: al volver a Reportes sigue elegida la persona.
    await ir('/asistencia');
    await ir('/reportes');
    comprobar('al volver a Reportes, el filtro de persona se recordó',
      (await js(`document.querySelector('panel-elegir-empleado input').value`)).includes('Rogelio'));

    await ir('/ausencias');
    await picar('+ Registrar incidencia');
    await esperar(800); // la ventana carga la lista de personas
    await elegirEmpleado('panel-dialogo', 0, idCreado, '2001'); // por su numero
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Vacaciones de la prueba del panel');
    await picar('Registrar');
    await esperar(1000);
    comprobar('la ausencia aparece en la lista', (await texto()).includes('Vacaciones de la prueba del panel'));
    // Filtros (21-10-2026): por tipo la esconde; quitandolos vuelve.
    await js(`(() => { const s = document.querySelector('[data-prueba=filtro-tipo]'); s.value = 'incapacidad';
        s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await esperar(1000);
    comprobar('filtrar por "Incapacidad" esconde las vacaciones', !(await texto()).includes('Vacaciones de la prueba del panel'));
    await picar('Quitar filtros');
    await esperar(1000);
    comprobar('y "Quitar filtros" las vuelve a mostrar', (await texto()).includes('Vacaciones de la prueba del panel'));
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
    comprobar('la descarga del respaldo se lee con palabras', bitacora.includes('Descargó el respaldo completo'));
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
    // Filtros nuevos (06-10-2026)
    await elegir('Qué tipo de cambio', 'altas');
    comprobar('filtro "Altas de personal": aparece el alta, no la captura manual',
      (await texto()).includes(motivoAlta) && !(await texto()).includes('No hubo luz en la manana (prueba)'));
    await elegir('Qué tipo de cambio', '');
    await elegir('Buscar en el motivo', 'hubo luz');
    comprobar('buscar en el motivo encuentra la captura manual y no lo demás',
      (await texto()).includes('No hubo luz en la manana (prueba)') && !(await texto()).includes(motivoAlta));
    await elegir('Buscar en el motivo', '');
    await elegir('Qué tipo de cambio', 'bajas');
    comprobar('filtro "Bajas de personal": la de la prueba de Asistencia, con su motivo',
      (await texto()).includes('Ya no trabaja aquí (prueba del panel)') && !(await texto()).includes(motivoAlta));
    await picar('Quitar filtros');
    comprobar('"Quitar filtros" vuelve a mostrar todo', (await texto()).includes(motivoAlta));
    await capturar('5-bitacora');
    await ir('/mi-cuenta');
    comprobar('Mi cuenta muestra el usuario del kiosco', (await texto()).includes('jefe'));

    // ====================================================================
    console.log('\n--- pendientes (0029) ---');
    await ir('/pendientes');
    await esperar(1500); // revisa los casos al entrar
    const pendientesAntes = await insignia('Pendientes');
    await capturar('8-pendientes');
    comprobar('Pendientes: una tarjeta corta por persona ("N faltas"), sin la lista de casos a la vista',
      /\d+ faltas?/.test(await texto()) && /Ver los casos \(\d+\)/.test(await texto()) && !/Ver su(s registros| reporte)/.test(await texto()));
    comprobar('dice desde cuándo se revisa', /Se revisa desde el \d+ de \w+ de \d{4}/.test(await texto()));
    await elegirEmpleado('', 0, (await bd.query(`select empleado_id from pendientes where estado = 'pendiente' and tipo = 'falta' limit 1`)).rows[0].empleado_id);
    await esperar(600);
    comprobar('con el buscador en una persona, sus casos se ven solos', /Ver su(s registros| reporte)/.test(await texto()));
    await js(`document.querySelector('panel-elegir-empleado button[aria-label="Quitar"]').click()`);
    await esperar(600);
    // Picar el rectangulo (no solo el boton) despliega los casos (20-10-2026).
    await js(`document.querySelector('main section h2').click()`);
    await esperar(300);
    await capturar('8b-pendientes-desplegado');
    comprobar('"Ver los casos" despliega los de esa persona', (await texto()).includes('Ver su reporte') && (await texto()).includes('Faltó'));
    comprobar('en una falta se puede registrar la incidencia ahí mismo', (await texto()).includes('Registrar incidencia'));
    const { rows: faltasSeguidas } = await bd.query(`
      select empleado_id from pendientes where estado = 'pendiente' and tipo = 'falta'
       group by 1 having count(*) >= 3 limit 1`);
    if (faltasSeguidas.length) {
      comprobar('quien tiene varias faltas seguidas: pregunta si está enfermo, de vacaciones o ya no trabaja aquí',
        /Faltó \d+ días seguidos/.test(await texto()) && (await texto()).includes('¿Está enfermo, de vacaciones o ya no'));
    }
    await picar('Atender');
    await picar('Se habló con la persona');
    await esperar(200);
    comprobar('las respuestas de siempre se escriben de un clic',
      (await js(`document.querySelector('panel-dialogo input[placeholder^="Ej."]').value`)) === 'Se habló con la persona');
    await picar('Marcar como atendido');
    await esperar(1200);
    comprobar('al atenderlo, el número del menú baja', (await insignia('Pendientes')) === pendientesAntes - 1,
      `${pendientesAntes} -> ${await insignia('Pendientes')}`);
    const { rows: [atendido] } = await bd.query(
      `select que_se_hizo from pendientes where estado = 'atendido' order by cerrado_en desc limit 1`);
    comprobar('queda en la base con lo que se hizo', atendido?.que_se_hizo === 'Se habló con la persona');
    await picar('Atendidos (historia)');
    comprobar('y en "Atendidos", con quién lo atendió',
      (await texto()).includes('Atendido por Jefe de prueba') && (await texto()).includes('Se habló con la persona'));
    await picar('Sin atender');

    // Atender y justificar en un paso, con confirmacion (21-10-2026).
    const { rows: [aJustificar] } = await bd.query(
      `select id, empleado_id, desde::text from pendientes where estado = 'pendiente' and tipo = 'falta' order by desde limit 1`);
    await elegirEmpleado('', 0, aJustificar.empleado_id);
    await esperar(600);
    const diaAJustificar = new Date(aJustificar.desde + 'T18:00:00Z').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    await js(`[...[...document.querySelectorAll('main li')].find((e) => e.textContent.includes('Faltó') && e.textContent.includes(${JSON.stringify(diaAJustificar)}))
      .querySelectorAll('button')].find((b) => b.textContent.trim() === 'Atender').click()`);
    await esperar(500);
    await picar('Tenía permiso del jefe');
    comprobar('"Tenía permiso del jefe" marca "Además, justificar ese día" (como Permiso)',
      (await js(`document.querySelector('[data-prueba=justificar-dia] input[type=checkbox]').checked`)) &&
      (await js(`document.querySelector('[data-prueba=justificar-dia] select').value`)) === 'permiso');
    await js(`(() => { const s = document.querySelector('[data-prueba=justificar-dia] select'); s.value = 'incapacidad';
        s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await picar('Marcar como atendido');
    await esperar(500);
    comprobar('antes de justificar pregunta, con el tipo a la vista',
      ((await js(`document.querySelector('[data-prueba=confirmar-justificacion]')?.textContent`)) ?? '').includes('Incapacidad'));
    await picar('Sí, justificar y atender');
    await esperar(2500);
    const { rows: [justificada] } = await bd.query(
      `select (select estado from pendientes where id = $1) estado,
              (select tipo from incidencias where empleado_id = $2 and fecha_inicio = $3::date) tipo`,
      [aJustificar.id, aJustificar.empleado_id, aJustificar.desde]);
    comprobar('queda atendida Y con su incidencia (Incapacidad)', justificada.estado === 'atendido' && justificada.tipo === 'incapacidad',
      JSON.stringify(justificada));
    await picar('Atendidos (historia)');
    await esperar(1200);
    comprobar('en "Atendidos" dice "✓ Día justificado: Incapacidad"',
      (await texto()).includes('Día justificado: Incapacidad'));
    await js(`document.querySelector('panel-elegir-empleado button[aria-label="Quitar"]').click()`);
    await esperar(600);
    await picar('Sin atender');
    // Faltas y retardos se ven en REPORTES, en su semana (20-10-2026: en
    // Asistencia solo se veian entradas y salidas, y una falta ni eso).
    const { rows: [unaFalta] } = await bd.query(
      `select empleado_id, desde::text from pendientes where estado = 'pendiente' and tipo = 'falta' order by desde desc limit 1`);
    await elegirEmpleado('', 0, unaFalta.empleado_id);
    await esperar(600);
    const diaDeLaFalta = new Date(unaFalta.desde + 'T18:00:00Z').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const enLaFalta = await js(`(() => {
      const li = [...document.querySelectorAll('main li')].find((e) => e.textContent.includes('Faltó') && e.textContent.includes(${JSON.stringify(diaDeLaFalta)}));
      // Por su texto: el primer boton del renglon es el (i) de ayuda.
      const boton = li && [...li.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ver su reporte');
      if (boton) { boton.click(); return 'ok'; }
      return [...document.querySelectorAll('main li')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60)).join(' | ') || document.querySelector('main').textContent.replace(/\\s+/g, ' ').slice(0, 300);
    })()`);
    if (enLaFalta !== 'ok') throw new Error(`no encontre la falta del ${diaDeLaFalta}; se ve: ${enLaFalta}`);
    await esperar(1500);
    const lunesEnReportes = await js(`document.querySelector('input[type=date]').value`);
    const filtro = async (clave) => JSON.parse((await js(`sessionStorage.getItem('panel-filtro:${clave}')`)) ?? '""');
    comprobar('en una FALTA, "Ver su reporte" abre Reportes día por día, en su semana (desde el lunes) y con esa persona',
      (await js('location.pathname')) === '/reportes' && (await filtro('reportes.vista')) === 'dias' &&
      (await filtro('reportes.empleado')) === unaFalta.empleado_id &&
      new Date(lunesEnReportes + 'T12:00:00Z').getUTCDay() === 1 && lunesEnReportes <= unaFalta.desde &&
      (await texto()).includes('Falta'), `${lunesEnReportes} ${unaFalta.desde}`);
    comprobar('y la fila de ESE día se ve resaltada (y sólo esa)',
      (await js(`document.querySelectorAll('tr.fila-resaltada').length`)) === 1 &&
      (await js(`document.querySelector('tr.fila-resaltada').textContent`)).includes('Falta'));
    await capturar('8c-reporte-de-la-falta');
    // Lo que se corrige sobre el registro mismo sigue yendo a Asistencia, en
    // LA FECHA DEL CASO (20-10-2026: llegaba con la de hoy y no se veia).
    const { rows: [otroCaso] } = await bd.query(
      `select empleado_id, desde::text from pendientes where estado = 'pendiente'
          and tipo in ('salida_no_registrada', 'foto_tapada', 'registro_de_baja') order by desde desc limit 1`);
    if (otroCaso) {
      await ir('/pendientes');
      await elegirEmpleado('', 0, otroCaso.empleado_id);
      await esperar(600);
      await picar('Ver sus registros');
      await esperar(1500);
      const desdeEnAsistencia = await js(`document.querySelector('input[type=date]').value`);
      const { rows: [delCaso] } = await bd.query(
        `select count(*)::int n from pendientes where estado = 'pendiente' and empleado_id = $1 and desde = $2
            and tipo in ('salida_no_registrada', 'foto_tapada', 'registro_de_baja')`,
        [otroCaso.empleado_id, desdeEnAsistencia]);
      comprobar('"Ver sus registros" abre Asistencia con esa persona y en LA FECHA DEL CASO (no hoy)',
        (await js('location.pathname')) === '/asistencia' && (await filtro('asistencia.empleado')) === otroCaso.empleado_id &&
        delCaso.n > 0, `${otroCaso.empleado_id} ${desdeEnAsistencia}`);
    }
    // Atender "Tarde en la semana" cierra tambien las llegadas tarde de esa
    // semana (casilla marcada de entrada; 20-10-2026).
    const { rows: [semana] } = await bd.query(`
      select s.id, s.empleado_id, count(d.id)::int as dias
        from pendientes s
        join pendientes d on d.empleado_id = s.empleado_id and d.tipo = 'retardo_dia' and d.estado = 'pendiente'
                         and d.desde between s.desde and s.hasta
       where s.tipo = 'retardos_semana' and s.estado = 'pendiente'
       group by 1, 2 limit 1`);
    if (semana) {
      await ir('/pendientes');
      await elegirEmpleado('', 0, semana.empleado_id);
      await esperar(600);
      await js(`[...document.querySelectorAll('li')].find((li) => li.textContent.includes('Tarde en la semana'))
        .querySelector('button.boton-principal').click()`);
      await esperar(400);
      comprobar('al atender la semana, pregunta en un recuadro por CADA día que llegó tarde (todos marcados)',
        (await texto()).includes('¿Estas llegadas tarde quedan atendidas con lo mismo?') &&
        (await js(`[...document.querySelectorAll('[data-prueba=dias-de-la-semana] input[type=checkbox]')].map((x) => x.checked).join()`)) ===
          Array(semana.dias).fill('true').join());
      await escribir('panel-dialogo input[placeholder^="Ej."]', 'Se habló con la persona de toda la semana');
      await picar('Marcar como atendido');
      await esperar(1500);
      const { rows: [quedan] } = await bd.query(`
        select count(*)::int as n from pendientes d, pendientes s
         where s.id = $1 and d.empleado_id = s.empleado_id and d.tipo = 'retardo_dia' and d.estado = 'pendiente'
           and d.desde between s.desde and s.hasta`, [semana.id]);
      comprobar(`y se cierran la semana y sus ${semana.dias} llegada(s) tarde`, quedan.n === 0);
    }
    await ir('/configuracion');
    comprobar('Configuración tiene la sección Pendientes, con "0 = apagado" explicado',
      (await texto()).includes('Minutos tarde sumados en la semana') && (await texto()).includes('Los empleados checan con su número de empleado'));

    // ====================================================================
    console.log('\n--- cambio de horario por un día (0029) ---');
    const { rows: [{ manana }] } = await bd.query(`select ((now() at time zone 'America/Matamoros')::date + 1)::text as manana`);
    const { rows: [vespertino] } = await bd.query(`select id from empleados where numero_empleado = '1016'`);
    await ir('/horarios');
    await picar('+ Cambio por un día');
    await js(`[...document.querySelectorAll('panel-dialogo input[type=radio]')][1].click()`); // intercambio
    await esperar(300);
    await escribir('panel-dialogo input[type=date]', manana);
    await elegirEmpleado('panel-dialogo', 0, idCreado, 'gomez paz');
    await esperar(800);
    await elegirEmpleado('panel-dialogo', 1, vespertino.id, '1016');
    await esperar(1200);
    await capturar('9-cambio-por-un-dia');
    comprobar('antes de guardar, dice cómo queda cada quien',
      (await texto()).includes('Rogelio Gomez Paz') && /trabaja 14:00–22:00/.test(await texto()), (await texto()).match(/Ese día, .*\./)?.[0]);
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Intercambio de la prueba del panel');
    await picar('Guardar cambio');
    await esperar(1200);
    const { rows: cambios } = await bd.query(
      `select intercambio_id, hora_inicio::text from ajustes_horario where motivo = 'Intercambio de la prueba del panel' order by hora_inicio`);
    comprobar('se guardan los dos lados del intercambio',
      cambios.length === 2 && cambios[0].intercambio_id === cambios[1].intercambio_id, JSON.stringify(cambios));
    comprobar('y se ven en "Cambios por un día"', (await texto()).includes('Intercambio:'));
    await picar('Quitar');
    await escribir('panel-dialogo input[placeholder^="Ej."]', 'Al final no se hizo (prueba)');
    await js(`document.querySelector('panel-dialogo button[type=submit]').click()`);
    await esperar(1200);
    const { rows: [{ quedan }] } = await bd.query(
      `select count(*)::int as quedan from ajustes_horario where motivo = 'Intercambio de la prueba del panel'`);
    comprobar('quitar un intercambio quita a los dos', quedan === 0, String(quedan));

    // ====================================================================
    // Turno: los minutos solo aceptan numeros, y el campo vacio dice cuanto vale (20-10-2026).
    await ir('/horarios');
    await picar('Cambiar');
    await esperar(400);
    comprobar('el campo vacío de tolerancia dice cuánto vale la general',
      /^\d+ \(la general\)$/.test(await js(`document.querySelector('panel-dialogo input[inputmode=numeric]')?.placeholder ?? ''`)));
    await escribir('panel-dialogo input[inputmode=numeric]', 'a1b5');
    comprobar('la tolerancia del turno no acepta letras ("a1b5" queda "15")',
      (await js(`document.querySelector('panel-dialogo input[inputmode=numeric]').value`)) === '15');
    await esperar(600);
    await capturar('9b-turno');
    await picar('Cancelar');

    console.log('\n--- notas (0029) ---');
    await ir('/notas');
    await picar('+ Nueva nota');
    await escribir('panel-dialogo input[placeholder="Ej.: Pendientes de la semana"]', 'Lista de la prueba del panel');
    await escribir('panel-dialogo input[aria-label="Casilla nueva"]', 'Pedir lista a RH');
    await picar('+ Agregar casilla');
    // La segunda se queda escrita sin picar "+": al guardar también cuenta.
    await escribir('panel-dialogo input[aria-label="Casilla nueva"]', 'Revisar la cámara');
    await picar('Guardar');
    await esperar(1200);
    comprobar('la nota se ve con sus dos casillas, para "Sólo yo"',
      (await texto()).includes('Lista de la prueba del panel') && (await texto()).includes('Revisar la cámara')
        && (await texto()).includes('Sólo yo'));
    await js(`[...document.querySelectorAll('article')].find((a) => a.textContent.includes('Lista de la prueba del panel'))
      .querySelector('input[type=checkbox]').click()`);
    await esperar(1000);
    const { rows: [nota] } = await bd.query(`select tareas, visibilidad from notas where titulo = 'Lista de la prueba del panel'`);
    await capturar('10-notas');
    comprobar('palomear una casilla se guarda al momento',
      nota?.tareas?.length === 2 && nota.tareas[0].hecha === true && nota.tareas[1].hecha === false && nota.visibilidad === 'privada',
      JSON.stringify(nota));
    await escribir('input[type=search]', 'camara');
    comprobar('el buscador de notas encuentra por una casilla, sin importar acentos',
      (await texto()).includes('Lista de la prueba del panel'));
    await escribir('input[type=search]', 'zzz-nada');
    comprobar('y dice cuando ninguna coincide', (await texto()).includes('Ninguna nota tiene «zzz-nada»'));
    await escribir('input[type=search]', '');
    await js(`[...document.querySelectorAll('article')].find((a) => a.textContent.includes('Lista de la prueba del panel'))
      .querySelectorAll('input[type=checkbox]')[1].click()`);
    await esperar(1000);
    // 21-10-2026: no desaparece al palomear la ultima (se iba de las manos); se va al cambiar de filtro.
    comprobar('al palomear la última casilla, la nota se queda a la vista…', (await texto()).includes('Lista de la prueba del panel'));
    await picar('Todo hecho');
    comprobar('…está en "Todo hecho"…', (await texto()).includes('Lista de la prueba del panel'));
    await picar('Por hacer');
    comprobar('…y al volver a "Por hacer" ya no sale', !(await texto()).includes('Lista de la prueba del panel'));

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
    comprobar('con la contraseña nueva entra directo al panel', ['/pendientes', '/asistencia'].includes(await js('location.pathname')));
    await picar('Salir');
    await ir('/entrar');
    await escribir('input[type=email]', correoAcceso);
    await escribir('input[autocomplete=current-password]', 'recuperada-1234');
    await picar('Entrar');
    await esperar(1500);
    comprobar('y la próxima vez entra con ella', ['/pendientes', '/asistencia'].includes(await js('location.pathname')));
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
      // 0029: los pendientes se vuelven a crear solos al abrir el panel.
      await bd.query('delete from pendientes');
      await bd.query(`delete from ajustes_horario where motivo like '%prueba del panel%'`);
      await bd.query(`delete from notas where titulo = 'Lista de la prueba del panel'`);
      await bd.query(`update configuracion set valor = '1' where clave = 'pendientes_registros_de_baja'`);
      await bd.query(`update configuracion set valor = $1 where clave = 'pendientes_revisar_desde'`, [JSON.stringify(revisarDesdeAntes)]);
      // La persona dada de baja de la prueba (0028) y su registro.
      const zoila = `(select id from empleados where nombre = 'Zoila' and apellido_paterno = 'DeBaja')`;
      await bd.query(`delete from marcas where empleado_id in ${zoila}`);
      await bd.query(`delete from empleados where id in ${zoila}`);
      if (idCreado) {
        await bd.query('delete from correcciones where empleado_id = $1', [idCreado]);
        await bd.query('delete from incidencias where empleado_id = $1', [idCreado]);
        await bd.query('delete from asignaciones_turno where empleado_id = $1', [idCreado]);
        await bd.query('delete from marcas where empleado_id = $1', [idCreado]);
        await bd.query('delete from empleados where id = $1', [idCreado]);
      }
      await bd.query(`delete from codigos_enrolamiento where nombre_dispositivo = 'Kiosco de la prueba del panel'`);
      if (idEventoDescarte) await bd.query('delete from eventos_dispositivo where id = $1', [idEventoDescarte]);
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
