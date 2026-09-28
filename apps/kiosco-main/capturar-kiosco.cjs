/**
 * ============================================================================
 *  CAPTURAS DEL KIOSCO, EN TODOS SUS ESTADOS
 * ============================================================================
 *
 *  Para revisar el diseño sin tener que provocar cada situacion a mano: el
 *  kiosco REAL (sus manejadores, su base, su interfaz compilada) en una
 *  ventana OCULTA, con una carpeta de datos temporal, los 20 empleados de
 *  prueba y la camara falsa de Chromium (un patron de colores).
 *
 *      npm run compilar --prefix apps/kiosco-main      (main + preload)
 *      npm run ui:compilar                             (la interfaz)
 *      npm run capturar --prefix apps/kiosco-main -- C:\carpeta\de\capturas [1366x768]
 *
 *  Nunca muestra ventanas (ver la memoria del proyecto sobre pruebas de
 *  Electron sin ventanas) y no toca el kiosco instalado.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const argumentos = process.argv.slice(2).filter((a) => !a.endsWith('.cjs') && !a.startsWith('-'));
const carpeta = argumentos.find((a) => !/^\d+x\d+$/.test(a)) ?? path.join(os.tmpdir(), 'capturas-kiosco');
const [ancho, alto] = (argumentos.find((a) => /^\d+x\d+$/.test(a)) ?? '1920x1080').split('x').map(Number);

app.setPath('userData', path.join(os.tmpdir(), 'kiosko-capturas-' + Date.now()));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

app.whenReady().then(async () => {
  const bd = require('./dist/prueba-bundle.js');
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(carpeta, { recursive: true });

  bd.abrirBaseDeDatos();
  bd.sembrarEmpleadosDePrueba();
  bd.sembrarAdministradorDePrueba();
  try { bd.prepararLlaveDeFotos(); } catch (e) { console.log('(sin llave de fotos:', e.message, ')'); }
  bd.aplicarPoliticasDeSesion();
  bd.registrarManejadoresIpc();
  bd.registrarManejadoresAdmin();

  const w = new BrowserWindow({
    show: false,
    width: ancho,
    height: alto,
    useContentSize: true,
    backgroundColor: '#0f172a',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'dist', 'preload.js') },
  });
  w.webContents.on('console-message', (_e, nivel, mensaje) => { if (nivel >= 2) console.log('[pagina]', mensaje); });
  await w.loadFile(path.join(__dirname, 'dist', 'interfaz', 'index.html'));
  await esperar(2500);

  let n = 0;
  const capturar = async (nombre) => {
    n++;
    const archivo = path.join(carpeta, `${String(n).padStart(2, '0')}-${nombre}.png`);
    fs.writeFileSync(archivo, (await w.webContents.capturePage()).toPNG());
    console.log('captura', path.basename(archivo));
  };
  const js = (codigo) => w.webContents.executeJavaScript(codigo);
  const oprimir = async (tecla) => {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(tecla)}, bubbles: true }))`);
    await esperar(120);
  };
  /** Digitos, uno por uno. Para Esc o Enter: `oprimir`. */
  const teclear = async (digitos) => {
    for (const tecla of digitos) await oprimir(tecla);
  };
  const picar = (texto) => js(`(() => {
    const b = [...document.querySelectorAll('button, a')].find((x) => x.textContent.trim().includes(${JSON.stringify(texto)}));
    if (b) b.click(); return !!b; })()`);
  const pinDe = '1234';

  try {
    await capturar('principal');

    await teclear('03');
    await esperar(400);
    await capturar('pide-pin');

    await teclear('9999');
    await esperar(2500);
    await capturar('pin-incorrecto');

    await oprimir('Escape');
    await esperar(300);
    await teclear('03' + pinDe);
    await esperar(2500);
    await capturar('confirmar-entrada');
    await esperar(4500);
    await capturar('exito-entrada');
    await esperar(4000);
    await capturar('principal-tras-entrada');

    await teclear('03' + pinDe);
    await esperar(2500);
    await capturar('confirmar-salida');
    await oprimir('2'); // "Cambiar a ENTRADA"
    await esperar(500);
    await capturar('confirmar-cambiada');
    await picar('Cancelar');
    await esperar(1500);

    // PIN temporal: la ventana de "elige tu PIN"
    const temporal = bd.buscarPorUsuario('mibanez') ?? bd.listarActivos()[5];
    bd.baseDeDatos().prepare('UPDATE empleados_cache SET pin_temporal = 1 WHERE id = ?').run(temporal.id);
    const lista = await js(`[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^\\d{2}/.test(t))`);
    const numero = (lista.find((t) => t.includes(temporal.nombre.split(' ')[0])) ?? '09').slice(0, 2);
    await teclear(numero + pinDe);
    await esperar(1500);
    await oprimir('Enter');
    await esperar(2500);
    await capturar('elige-tu-pin');
    await teclear('5');
    await esperar(300);
    await capturar('elige-tu-pin-tecleando');
    await oprimir('Escape');
    await esperar(1500);

    // Bloqueo por intentos
    await teclear('05');
    for (let i = 0; i < 4; i++) { await teclear('0000'); await esperar(3000); }
    await teclear('0000');
    await esperar(6000);
    await capturar('bloqueado');
    await oprimir('Escape');
    await esperar(800);

    // Sin camara
    await js(`(() => {
      document.querySelectorAll('video').forEach((v) => v.srcObject?.getTracks().forEach((t) => t.stop()));
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotFoundError'));
      navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
    })()`);
    await esperar(8000);
    await capturar('sin-camara');

    // Barra: "Usar esta PC" y "Dar de alta"
    await picar('Usar esta PC');
    await esperar(1500);
    await capturar('usar-esta-pc');
    await oprimir('Escape');
    await picar('Cancelar');
    await esperar(500);

    // Modo administrador
    await picar('Administrador');
    await esperar(1000);
    await capturar('admin-entrar');
    const campos = await js(`[...document.querySelectorAll('input')].map((i) => i.type)`);
    console.log('campos de admin:', campos.join(','));
    await js(`(() => {
      const [u, c] = [...document.querySelectorAll('input')].filter((i) => i.type === 'text' || i.type === 'password');
      const poner = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      if (u && c) { poner(u, 'admin'); poner(c, 'admin-de-prueba'); }
    })()`);
    await picar('Entrar');
    await esperar(2500);
    await capturar('admin-lista');
    await js(`document.querySelector('tbody tr, [role=row], li')?.click()`);
    await esperar(1500);
    await capturar('admin-foto');
  } catch (fallo) {
    console.log('se detuvo:', fallo.message);
  }

  console.log('\ncapturas en', carpeta);
  app.exit(0);
});
