const { app } = require('electron');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', path.join(os.tmpdir(), 'kiosko-medir-' + Date.now()));

app.whenReady().then(async () => {
  const bd = require('./dist/prueba-bundle.js');
  bd.abrirBaseDeDatos();
  bd.sembrarEmpleadosDePrueba();
  const emp = bd.buscarPorUsuario('dgomez');

  const medir = async (nombre, fn, veces = 5) => {
    const tiempos = [];
    for (let i = 0; i < veces; i++) {
      const t = performance.now();
      await fn();
      tiempos.push(performance.now() - t);
    }
    const prom = tiempos.reduce((a, b) => a + b, 0) / veces;
    console.log(`${nombre.padEnd(38)} ${prom.toFixed(0).padStart(6)} ms  (${tiempos.map(t => t.toFixed(0)).join(', ')})`);
    return prom;
  };

  console.log('\n=== DONDE SE VA EL TIEMPO ===\n');
  await medir('hashearPin (crear el hash)', () => bd.hashearPin('1234'), 3);
  await medir('verificarPin CORRECTO', () => bd.verificarPin(emp, '1234'));
  await medir('buscarPorUsuario', () => bd.buscarPorUsuario('dgomez'), 20);
  await medir('simularVerificacion (usuario inexistente)', () => bd.simularVerificacion?.() ?? Promise.resolve(), 3);
  await medir('guardarMarca', () => bd.guardarMarca({
    id: bd.nuevoIdDeMarca(), empleadoId: emp.id, usuario: emp.usuario,
    tipo: 'entrada', reloj: bd.leerReloj(), banderas: [], foto: null,
  }), 10);
  console.log('\ncosto bcrypt configurado:', require('./dist/prueba-bundle.js').COSTO ?? '(ver configuracion)');
  app.exit(0);
});
