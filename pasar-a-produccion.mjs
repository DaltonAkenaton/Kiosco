/**
 * ============================================================================
 *  PASAR A PRODUCCION  (npm run pasar-a-produccion)
 * ============================================================================
 *
 *  Un solo comando. Hace, en orden:
 *
 *    1. Revisa que todo este guardado y al dia con GitHub.
 *    2. Cambia AMBIENTE a 'produccion' en packages/compartido/src/configuracion.ts.
 *    3. Pone la version del kiosco en 1.0.0.
 *    4. Guarda el cambio (commit), lo sube y publica la etiqueta v1.0.0.
 *
 *  Al subirlo, GitHub hace el resto SOLO:
 *    - "Pruebas" -> "Publicar en Supabase": tablas, funciones y acceso en la
 *      base de PRODUCCION;
 *    - "Publicar el panel": panel.mi-cuenta.workers.dev pasa a
 *      produccion (panel-pruebas... se queda en pruebas);
 *    - "Instalador del kiosco": el .exe 1.0.0 en el repositorio de versiones
 *      de produccion.
 *
 *  Despues solo falta: Actions -> "Crear administrador" (el primer acceso) e
 *  instalar el kiosco 1.0.0 a mano en cada PC.
 *
 *  No pregunta nada y no toca nada si algo no esta en orden.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG = 'packages/compartido/src/configuracion.ts';
const PAQUETE = 'apps/kiosco-main/package.json';
const VERSION = '1.0.0';

function sh(comando) {
  return execSync(comando, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function alto(mensaje) {
  console.error(`\n✋ ${mensaje}\n   No se cambió nada.\n`);
  process.exit(1);
}

console.log('\n=== Pasar a producción ===\n');

// 1. Todo en orden
if (sh('git rev-parse --abbrev-ref HEAD') !== 'main') alto('Hay que estar en la rama main.');
if (sh('git status --porcelain')) alto('Hay cambios sin guardar (git status). Guárdalos o descártalos primero.');
sh('git fetch origin main');
if (sh('git rev-parse HEAD') !== sh('git rev-parse origin/main')) {
  alto('Esta copia no está igual que GitHub. Corre "git pull" (o sube lo pendiente) y vuelve a intentar.');
}
if (sh(`git tag -l v${VERSION}`)) alto(`La etiqueta v${VERSION} ya existe: parece que ya se pasó a producción.`);

// 2. AMBIENTE
const config = readFileSync(CONFIG, 'utf8');
const linea = /^export const AMBIENTE: 'pruebas' \| 'produccion' = '(pruebas|produccion)';$/m;
const actual = linea.exec(config)?.[1];
if (!actual) alto(`No encontré la línea de AMBIENTE en ${CONFIG}.`);
if (actual === 'produccion') alto('AMBIENTE ya dice produccion.');
writeFileSync(CONFIG, config.replace(linea, "export const AMBIENTE: 'pruebas' | 'produccion' = 'produccion';"));
console.log('✔ AMBIENTE = produccion');

// 3. Version
const paquete = readFileSync(PAQUETE, 'utf8');
const conVersion = paquete.replace(/"version": "[^"]+"/, `"version": "${VERSION}"`);
if (conVersion === paquete) alto(`No encontré la versión en ${PAQUETE}.`);
writeFileSync(PAQUETE, conVersion);
console.log(`✔ Kiosco versión ${VERSION}`);

// 4. Guardar, subir y etiquetar
sh(`git add ${CONFIG} ${PAQUETE}`);
sh(`git commit -m "Pasar a produccion: AMBIENTE = produccion, kiosco ${VERSION}"`);
sh('git push origin main');
sh(`git tag v${VERSION}`);
sh(`git push origin v${VERSION}`);
console.log(`✔ Subido y etiquetado v${VERSION}`);

console.log(`
Listo. Ahora GitHub trabaja solo (10-15 minutos). En GitHub -> Actions deben
salir en verde: "Pruebas", "Publicar en Supabase", "Publicar el panel" e
"Instalador del kiosco".

Después:
  1. Actions -> "Crear administrador" -> tu correo y nombre -> la contraseña
     temporal sale en el resumen de esa corrida.
  2. Entrar a https://panel.mi-cuenta.workers.dev y cambiarla.
  3. Instalar el kiosco ${VERSION} a mano en cada PC (borrando antes la carpeta
     de pruebas si esa PC la tuvo).
`);
