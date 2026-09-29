/**
 * Convierte recursos-instalador/icono.svg en recursos-instalador/icon.ico
 * (el icono del programa, del instalador y del acceso directo).
 *
 *     npx electron generar-icono.cjs
 *
 * Usa Electron (ya instalado) para dibujar el SVG en cada tamaño, sin
 * programas extra. Un .ico es un paquete de varias imagenes PNG: Windows
 * elige la del tamaño que necesite (escritorio, barra de tareas, lista...).
 * Ventana oculta: no muestra nada en pantalla.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TAMANOS = [256, 128, 64, 48, 32, 16];
const carpeta = path.join(__dirname, 'recursos-instalador');

app.whenReady().then(async () => {
  try {
  const svg = fs.readFileSync(path.join(carpeta, 'icono.svg'), 'utf8');
  // Se dibuja UNA vez a 256 px y se reduce a los demas tamaños (abrir una
  // ventana por tamaño fallaba al segundo intento).
  const w = new BrowserWindow({ show: false, width: 256, height: 256, useContentSize: true, transparent: true, frame: false });
  const temporal = path.join(os.tmpdir(), 'icono-kiosco.html');
  fs.writeFileSync(temporal, `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`);
  await w.loadFile(temporal);
  await new Promise((r) => setTimeout(r, 400));
  const grande = await w.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  w.destroy();
  const pngs = TAMANOS.map((t) => ({ t, png: grande.resize({ width: t, height: t, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(carpeta, 'icono-256.png'), pngs[0].png);

  // Formato ICO: cabecera (6 bytes) + una entrada de 16 bytes por imagen + los PNG.
  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(pngs.length, 4);
  let desplazamiento = 6 + 16 * pngs.length;
  const entradas = pngs.map(({ t, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(t >= 256 ? 0 : t, 0); // 0 significa 256
    e.writeUInt8(t >= 256 ? 0 : t, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(desplazamiento, 12);
    desplazamiento += png.length;
    return e;
  });
  fs.writeFileSync(path.join(carpeta, 'icon.ico'), Buffer.concat([cabecera, ...entradas, ...pngs.map((p) => p.png)]));
  console.log('icono listo:', TAMANOS.join(', '), 'px');
  } catch (fallo) {
    console.log('NO SE PUDO:', fallo.message);
  }
  app.exit(0);
});
