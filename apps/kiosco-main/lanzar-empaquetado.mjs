/**
 * ============================================================================
 *  ABRIR LA APP YA EMPAQUETADA, SIN INSTALARLA
 * ============================================================================
 *
 *  Es el escalon que faltaba entre "programando" y "instalado en el kiosco".
 *
 *  ---------------------------------------------------------------------------
 *  LOS TRES ESCALONES, Y POR QUE HACEN FALTA LOS TRES
 *  ---------------------------------------------------------------------------
 *
 *    1. npm run ui:servir + npm run kiosco:dev
 *       Todo el dia. Recarga sola al guardar. Rapidisimo.
 *       PERO: carga la interfaz desde http://localhost:4200, con la CSP
 *       relajada y sin empaquetar. No se parece al kiosco real.
 *
 *    2. npm run probar:empaquetado        <-- ESTE ARCHIVO
 *       10 segundos. La app EMPAQUETADA de verdad: `app.isPackaged` es true,
 *       la interfaz se carga desde `file://`, y la CSP es la estricta.
 *       Lo unico que se relaja es lo que estorba en tu escritorio: pantalla
 *       completa, arranque con Windows y bloqueo de Alt+F4.
 *
 *    3. npm run empaquetar + instalar el .exe
 *       Varios minutos y 107 MB. Antes de entregar.
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE EXISTE EL ESCALON 2
 *  ---------------------------------------------------------------------------
 *  Por el error E-015. La pantalla se veia perfecta en el escalon 1 y salia
 *  SIN UN SOLO ESTILO en el 3, porque la CSP estricta y las rutas `file://`
 *  solo aparecen al empaquetar. Entre uno y otro no habia nada, y reproducir
 *  el fallo costaba generar un instalador completo — algo que nadie hace
 *  mientras esta probando una idea.
 *
 *  Diez segundos si se hacen. Ese es todo el punto.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/**
 * La ruta la arma electron-builder con `productName`, no la elegimos nosotros.
 * Si algun dia cambia el nombre del producto, este archivo avisa en vez de
 * fallar con un "no encontrado" sin explicacion.
 */
const EJECUTABLE = path.join(aqui, 'dist-instalador', 'win-unpacked', 'Control de Asistencia.exe');

if (!fs.existsSync(EJECUTABLE)) {
  console.error(`\n[lanzar] no encontre la app empaquetada en:\n  ${EJECUTABLE}\n`);
  console.error('Corre primero:  npm run empaquetar:solo-carpeta\n');
  process.exit(1);
}

console.log('\n[lanzar] abriendo la app EMPAQUETADA en modo prueba');
console.log('         CSP estricta, rutas file://, sin DevTools — como el kiosco real');
console.log('         sin pantalla completa, sin arranque automatico, Alt+F4 funciona\n');

/**
 * `detached: false` y `stdio: 'inherit'` para que los mensajes del proceso
 * principal (los `console.info` del arranque, las banderas del reloj, los
 * avisos de la camara) salgan en ESTA terminal.
 *
 * Es la unica forma de ver esos mensajes sin DevTools, y en el escalon 2 las
 * DevTools estan apagadas a proposito: si las dejaramos abiertas, este modo
 * dejaria de parecerse al kiosco real justo en la parte que mas importa.
 */
const proceso = spawn(EJECUTABLE, ['--modo-prueba'], {
  stdio: 'inherit',
  windowsHide: false,
});

proceso.on('exit', (codigo) => {
  console.log(`\n[lanzar] la app se cerro (codigo ${codigo ?? 0})\n`);
  process.exit(codigo ?? 0);
});

proceso.on('error', (fallo) => {
  console.error('\n[lanzar] no se pudo abrir la app:', fallo.message, '\n');
  process.exit(1);
});
