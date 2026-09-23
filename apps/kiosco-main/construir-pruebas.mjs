/**
 * Compila el paquete que usan las pruebas automatizadas.
 *
 * Es aparte de `construir.mjs` porque las pruebas necesitan acceso directo a
 * funciones internas (repositorios, autenticacion) que la aplicacion normal
 * no expone. Mezclarlos haria que ese acceso terminara en el .exe final.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));

await build({
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  alias: {
    '@kiosko/compartido': path.resolve(aqui, '../../packages/compartido/src/index.ts'),
  },
  entryPoints: [path.join(aqui, 'src/prueba-exports.ts')],
  outfile: path.join(aqui, 'dist/prueba-bundle.js'),
  logLevel: 'warning',
});
