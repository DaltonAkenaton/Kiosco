/**
 * Prueba de extremo a extremo de la verificación de PIN, corriendo dentro de
 * Electron (mismo entorno que el kiosco real). Usa el bundle ya compilado.
 */
const { app } = require('electron');
const path = require('node:path');
const os = require('node:os');

// Base de datos aparte, para no tocar la del kiosco.
app.setPath('userData', path.join(os.tmpdir(), 'kiosko-prueba-' + Date.now()));

// El PIN con el que la semilla carga a los cinco empleados de prueba.
// Ver PIN_DE_PRUEBA en src/datos/semilla.ts.
const PIN_DE_LA_SEMILLA = '1234';

app.whenReady().then(async () => {
  const bd = require('./dist/prueba-bundle.js');
  let fallos = 0;
  const comprobar = (nombre, condicion, detalle = '') => {
    console.log(`${condicion ? 'OK   ' : 'FALLA'}  ${nombre}${detalle ? '  -> ' + detalle : ''}`);
    if (!condicion) fallos++;
  };

  bd.abrirBaseDeDatos();
  bd.sembrarEmpleadosDePrueba();

  // --- 1. El empleado existe y se encuentra por usuario ---
  const dgomez = bd.buscarPorUsuario('dgomez');
  comprobar('buscarPorUsuario("dgomez") encuentra al empleado', dgomez !== null);
  comprobar('el nombre es correcto', dgomez && dgomez.nombre === 'Dalton Akenaton', dgomez && dgomez.nombre);

  // --- 2. Usuario inexistente ---
  comprobar('un usuario que no existe devuelve null', bd.buscarPorUsuario('noexiste') === null);

  // --- 3. PIN correcto ---
  const bueno = await bd.verificarPin(dgomez, '1234');
  comprobar('PIN correcto (1234) es aceptado', bueno.ok === true);

  // --- 4. PIN incorrecto ---
  const malo = await bd.verificarPin(dgomez, '9999');
  comprobar('PIN incorrecto (9999) es rechazado', malo.ok === false, malo.motivo);

  // --- 5. El hash guardado NO es el PIN ---
  comprobar('lo guardado es un hash bcrypt, no el PIN', dgomez.pinHash.startsWith('$2') && !dgomez.pinHash.includes('1234'));

  // --- 6. NO se bloquea antes de tiempo ---
  const mibanez = bd.buscarPorUsuario('mibanez');
  const tres = [];
  for (let i = 0; i < 3; i++) tres.push(await bd.verificarPin(mibanez, '0000'));
  comprobar('con 3 fallos todavia NO se bloquea', tres[2].motivo === 'pin_incorrecto', tres[2].motivo);
  const cuarto = await bd.verificarPin(mibanez, '0000');
  comprobar('se bloquea al CUARTO intento fallido', cuarto.motivo === 'empleado_bloqueado', cuarto.motivo);

  // --- 6b. Bloqueo y retardo creciente ---
  const t0 = Date.now();
  let ultimo;
  for (let i = 0; i < 4; i++) ultimo = await bd.verificarPin(dgomez, '0000');
  const tardo = Date.now() - t0;
  comprobar('se bloquea tras 4 intentos fallidos', ultimo.ok === false && ultimo.motivo === 'empleado_bloqueado', ultimo.motivo);
  comprobar('el retardo creciente hizo efecto (>2s en 4 intentos)', tardo > 2000, tardo + ' ms');

  // --- 7. Estando bloqueado, ni el PIN correcto pasa ---
  const bloqueado = await bd.verificarPin(dgomez, '1234');
  comprobar('bloqueado: ni con el PIN correcto entra', bloqueado.ok === false && bloqueado.motivo === 'empleado_bloqueado');

  // --- 8. Acción sugerida sin marcas previas ---
  comprobar('sin marcas previas se sugiere ENTRADA', bd.accionSugeridaPara(dgomez.id) === 'entrada');

  // --- 8b. Los intentos viejos se olvidan ---
  // Se simula el paso del tiempo escribiendo un ultimo intento muy antiguo,
  // en vez de esperar 15 minutos de verdad.
  const psanchez = bd.buscarPorUsuario('psanchez');
  await bd.verificarPin(psanchez, '0000');
  await bd.verificarPin(psanchez, '0000');
  await bd.verificarPin(psanchez, '0000');
  comprobar('lleva 3 fallos acumulados', bd.estadoDeBloqueo(psanchez.id).fallidos === 3, String(bd.estadoDeBloqueo(psanchez.id).fallidos));
  bd.envejecerIntentos(psanchez.id, 20 * 60 * 1000); // como si fueran de hace 20 min
  comprobar('tras 20 min los fallos se olvidan', bd.estadoDeBloqueo(psanchez.id).fallidos === 0, String(bd.estadoDeBloqueo(psanchez.id).fallidos));
  // El PIN de la semilla, que es el mismo para los cinco de prueba.
  // Estaba escrito a mano como '4444' y esta prueba se rompio el dia que la
  // semilla cambio. Una prueba que repite un valor en vez de leerlo del sitio
  // donde vive es una prueba que caduca sola.
  const trasOlvido = await bd.verificarPin(psanchez, PIN_DE_LA_SEMILLA);
  comprobar('y el PIN correcto vuelve a funcionar', trasOlvido.ok === true);

  // --- 9. Apellidos con acentos y compuestos ---
  comprobar('"De la Cruz" generó jdelacruz', bd.buscarPorUsuario('jdelacruz') !== null);
  comprobar('"Munoz" generó rmunoz', bd.buscarPorUsuario('rmunoz') !== null);

  // ======================================================================
  //  GUARDADO DE MARCAS Y FOTOS
  // ======================================================================
  console.log('\n--- guardado de marcas y fotos ---');

  const fs2 = require('node:fs');

  // Una imagen JPEG minima de verdad (1x1 pixel), en data URL.
  const JPEG_1PX =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL' +
    'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
    'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

  const idMarca = bd.nuevoIdDeMarca();
  const relojDeLaFoto = bd.leerReloj();
  const foto = bd.guardarFoto(idMarca, JPEG_1PX, relojDeLaFoto.horaEstimadaMs);
  const rutaFoto = foto && bd.rutaAbsolutaDeFoto(foto.rutaRelativa);
  comprobar('la foto se escribe en disco', foto !== null && fs2.existsSync(rutaFoto));
  comprobar('el archivo se llama como la marca', !!foto && foto.rutaRelativa.includes(idMarca));

  const marcasAntes = bd.contarMarcas();
  const pendientesAntes = bd.contarPendientes();

  bd.guardarMarca({
    id: idMarca,
    empleadoId: dgomez.id,
    usuario: dgomez.usuario,
    tipo: 'entrada',
    reloj: relojDeLaFoto,
    banderas: [],
    foto,
  });

  comprobar('la marca quedo guardada', bd.contarMarcas() === marcasAntes + 1);
  comprobar('se encolo en la bandeja de salida', bd.contarPendientes() === pendientesAntes + 1);

  const pendiente = bd.marcasPendientes(50).find((m) => m.id === idMarca);
  const paquete = pendiente ? JSON.parse(pendiente.payload) : null;
  comprobar('el paquete por enviar lleva el mismo id', paquete && paquete.id === idMarca);
  comprobar('el paquete lleva el hash de la foto', paquete && paquete.fotoHash === foto.hash);

  comprobar('tras ENTRADA se sugiere SALIDA', bd.accionSugeridaPara(dgomez.id) === 'salida');
  // Olvido checar la salida y regresa al DIA SIGUIENTE (analisis 26-09-2026):
  // la entrada de ayer ya no esta "abierta"; hoy toca ENTRADA, no salida.
  comprobar('si olvidó la salida y vuelve al día siguiente, se sugiere ENTRADA (no salida)',
    bd.accionSugeridaPara(dgomez.id, Date.now() + 20 * 60 * 60 * 1000) === 'entrada');
  comprobar('pero a las 8 horas de haber entrado sí se sugiere SALIDA',
    bd.accionSugeridaPara(dgomez.id, Date.now() + 8 * 60 * 60 * 1000) === 'salida');

  // --- Deteccion de camara tapada ---
  comprobar('imagen negra y plana = obstruida', bd.pareceObstruida({ brilloPromedio: 5, varianza: 2 }) === true);
  comprobar('imagen normal = NO obstruida', bd.pareceObstruida({ brilloPromedio: 120, varianza: 900 }) === false);
  comprobar('hoja blanca sin textura = obstruida', bd.pareceObstruida({ brilloPromedio: 250, varianza: 3 }) === true);

  // --- Reloj hacia atras ---
  const ultima = bd.horaDeLaUltimaMarca();
  const atrasado = Object.assign({}, bd.leerReloj(), { horaEstimadaMs: ultima - 60000 });
  comprobar('una marca hacia atras levanta reloj_sospechoso',
    bd.detectarAnomaliasDeReloj(atrasado, ultima).includes('reloj_sospechoso'));

  // --- Fecha absurda (pila del BIOS agotada) ---
  const viejo = Object.assign({}, bd.leerReloj(), { horaEstimadaMs: new Date('2009-05-01').getTime() });
  comprobar('una fecha de 2009 levanta reloj_sospechoso',
    bd.detectarAnomaliasDeReloj(viejo, null).includes('reloj_sospechoso'));

  // --- Un reloj normal NO levanta banderas ---
  comprobar('un reloj normal no levanta banderas',
    bd.detectarAnomaliasDeReloj(bd.leerReloj(), null).length === 0);


  // ======================================================================
  //  EL PASE DE CONFIRMACION  (bloque 3)
  // ======================================================================
  //  Es la pieza que separa "valide mi PIN" de "guarda mi marca". Si falla,
  //  fallan las dos cosas que protege: que nadie registre a nombre ajeno y
  //  que la hora guardada sea la de cuando el empleado llego.
  console.log('\n--- pase de confirmacion ---');

  const vivosAntes = bd.pasesVivos();
  const relojDelPase = bd.leerReloj();

  const token = bd.crearPase({
    empleadoId: dgomez.id,
    usuario: dgomez.usuario,
    nombreParaMostrar: 'Dalton G.',
    accionSugerida: 'entrada',
    reloj: relojDelPase,
  });

  comprobar('el pase son 64 caracteres hexadecimales', /^[0-9a-f]{64}$/.test(token), token.slice(0, 12) + '...');
  comprobar('el pase NO contiene el id del empleado', !token.includes(dgomez.id));
  comprobar('queda un pase vivo mas', bd.pasesVivos() === vivosAntes + 1);

  const canjeado = bd.canjearPase(token);
  comprobar('el pase se canjea y trae al empleado correcto', canjeado && canjeado.empleadoId === dgomez.id);

  // LA PRUEBA QUE IMPORTA: la hora que sale del pase es la que entro, no una
  // nueva. Si esto fallara, la marca quedaria con la hora de la confirmacion.
  comprobar(
    'la hora guardada en el pase es la del momento de validar',
    canjeado && canjeado.reloj.horaEstimadaMs === relojDelPase.horaEstimadaMs,
  );

  comprobar('canjearlo una SEGUNDA vez devuelve null', bd.canjearPase(token) === null);
  comprobar('el pase ya no cuenta como vivo', bd.pasesVivos() === vivosAntes);

  // Un pase inventado no vale, aunque tenga la forma correcta.
  comprobar('un pase inventado no vale', bd.canjearPase('a'.repeat(64)) === null);

  // Cancelar tira el pase de inmediato, sin esperar a que caduque.
  const tokenCancelado = bd.crearPase({
    empleadoId: mibanez.id,
    usuario: mibanez.usuario,
    nombreParaMostrar: 'Maria I.',
    accionSugerida: 'entrada',
    reloj: bd.leerReloj(),
  });
  bd.descartarPase(tokenCancelado);
  comprobar('un pase cancelado ya no se puede canjear', bd.canjearPase(tokenCancelado) === null);

  // Dos pases seguidos nunca son iguales (salen de randomBytes, no de un
  // contador). Si se repitieran, el segundo empleado podria canjear el pase
  // del primero.
  const datosDePase = {
    empleadoId: dgomez.id,
    usuario: dgomez.usuario,
    nombreParaMostrar: 'Dalton G.',
    accionSugerida: 'entrada',
    reloj: bd.leerReloj(),
  };
  const t1 = bd.crearPase(datosDePase);
  const t2 = bd.crearPase(datosDePase);
  comprobar('dos pases seguidos son distintos', t1 !== t2);
  bd.descartarPase(t1);
  bd.descartarPase(t2);

  // ======================================================================
  //  EVENTOS DEL DISPOSITIVO
  // ======================================================================
  //  Lo que explica los huecos: camara caida, kiosco pausado. Si un evento se
  //  perdiera, faltaria justo la informacion que justifica una marca que no
  //  esta.
  console.log('\n--- eventos del dispositivo ---');

  const eventosAntes = bd.contarEventosPendientes();
  const marcasEnColaAntes = bd.marcasPendientes(100).length;

  bd.registrarEvento('kiosco_pausado', { minutos: 15 });

  comprobar('el evento se encola', bd.contarEventosPendientes() === eventosAntes + 1);

  // LA PRUEBA QUE IMPORTA: eventos y marcas comparten bandeja, pero el
  // sincronizador de marcas NO debe recoger eventos. Si los mezclara,
  // intentaria insertarlos en la tabla `marcas` del servidor.
  comprobar(
    'un evento NO aparece entre las marcas por enviar',
    bd.marcasPendientes(100).length === marcasEnColaAntes,
  );

  const evento = bd.eventosPendientes(10).find((e) => JSON.parse(e.payload).tipo === 'kiosco_pausado');
  const cuerpo = evento ? JSON.parse(evento.payload) : null;
  comprobar('el evento lleva su tipo y su detalle', cuerpo && cuerpo.detalle.minutos === 15);
  comprobar('el evento lleva lecturas de reloj', cuerpo && typeof cuerpo.reloj.horaEstimadaMs === 'number');

  // Nunca datos personales en un evento (CLAUDE.md 16).
  comprobar(
    'el evento no trae nombres ni PINes',
    evento && !/dgomez|1234|Dalton/.test(evento.payload),
  );

  // ======================================================================
  //  FOTOS CIFRADAS  (bloque 3.b, CLAUDE.md 5.1)
  // ======================================================================
  //  La foto nunca sale del kiosco: vive cifrada y a la nube va su hash. Si
  //  algo de esto falla en silencio, el sintoma no se ve hasta el dia que el
  //  jefe necesita una foto como evidencia... y esta ilegible, o es otra.
  console.log('\n--- fotos cifradas ---');

  const crypto = require('node:crypto');
  const pathMod = require('node:path');
  const carpetaDatos = app.getPath('userData');
  const jpegOriginal = bd.bytesDeDataUrl(JPEG_1PX);
  const DIA = 24 * 60 * 60 * 1000;

  comprobar('el hash es el SHA-256 del JPEG (64 hex)',
    foto && foto.hash === crypto.createHash('sha256').update(jpegOriginal).digest('hex'));

  comprobar('la ruta es fotos/AAAA/MM/<uuid>.jpg.enc',
    foto && /^fotos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg\.enc$/.test(foto.rutaRelativa), foto && foto.rutaRelativa);

  comprobar('la ruta no dice de quien es la foto',
    foto && !/dgomez|dalton|gomez/i.test(foto.rutaRelativa));

  const cifradoEnDisco = fs2.readFileSync(rutaFoto);
  comprobar('abierto fuera de la app, el archivo NO es un JPEG',
    cifradoEnDisco[0] !== 0xff && !cifradoEnDisco.includes(jpegOriginal.subarray(0, 64)));

  const leida = bd.leerFoto(foto.rutaRelativa, idMarca, foto.hash);
  comprobar('se descifra y es la misma foto', leida.estado === 'con_foto' && leida.jpeg.equals(jpegOriginal), leida.estado);

  comprobar('lo que va a la nube no lleva la ruta de la foto',
    pendiente && !pendiente.payload.includes('fotos/') && !pendiente.payload.includes('.jpg'));

  const registrada = bd.obtenerFoto(idMarca);
  comprobar('la foto queda registrada con su marca', registrada && registrada.hash === foto.hash && !registrada.eliminadaEn);

  // --- Evidencia manipulada ---
  const alterado = Buffer.from(cifradoEnDisco);
  alterado[alterado.length - 1] ^= 0x01; // un solo bit
  fs2.writeFileSync(rutaFoto, alterado);
  comprobar('cambiar UN bit del archivo -> alterada',
    bd.leerFoto(foto.rutaRelativa, idMarca, foto.hash).estado === 'alterada');
  fs2.writeFileSync(rutaFoto, cifradoEnDisco);

  const otraMarca = bd.nuevoIdDeMarca();
  comprobar('la foto de una marca presentada como de otra -> alterada',
    bd.descifrarFoto(cifradoEnDisco, [bd.prepararLlaveDeFotos()], otraMarca).estado === 'alterada');

  comprobar('si el hash no es el de la marca -> alterada',
    bd.leerFoto(foto.rutaRelativa, idMarca, '0'.repeat(64)).estado === 'alterada');

  comprobar('si el archivo no existe -> faltante',
    bd.leerFoto('fotos/2000/01/' + otraMarca + '.jpg.enc', otraMarca, foto.hash).estado === 'faltante');

  // --- La llave ---
  const llave = bd.prepararLlaveDeFotos();
  const archivoLlave = fs2.readFileSync(bd.rutaDeLaLlave(), 'utf8');
  comprobar('la llave NO esta en claro en su archivo',
    !archivoLlave.includes(llave.bytes.toString('base64')) && !archivoLlave.includes(llave.bytes.toString('hex')));

  comprobar('al principio no hay contrasena de recuperacion', bd.tieneContrasenaDeRecuperacion() === false);

  const corta = await bd.definirContrasenaDeRecuperacion('corta');
  comprobar('una contrasena de recuperacion corta se rechaza', corta.ok === false);

  const CONTRASENA = 'caballo correcto bateria grapa';
  const definida = await bd.definirContrasenaDeRecuperacion(CONTRASENA);
  comprobar('una contrasena larga se acepta', definida.ok === true);
  comprobar('ya hay contrasena de recuperacion', bd.tieneContrasenaDeRecuperacion() === true);

  const conRecuperacion = fs2.readFileSync(bd.rutaDeLaLlave(), 'utf8');
  comprobar('la contrasena NO queda escrita en el archivo', !conRecuperacion.includes(CONTRASENA));

  const recuperada = await bd.abrirLlaveConRecuperacion(conRecuperacion, CONTRASENA);
  comprobar('con la contrasena se abre la llave SIN Windows',
    recuperada && recuperada.id === llave.id && recuperada.bytes.equals(llave.bytes));

  comprobar('con una contrasena equivocada no se abre',
    (await bd.abrirLlaveConRecuperacion(conRecuperacion, 'caballo correcto bateria grapo')) === null);

  // --- Simular que la carpeta llego a OTRA PC (Windows ya no abre la llave) ---
  const json = JSON.parse(conRecuperacion);
  json.dpapi = crypto.randomBytes(64).toString('base64');
  fs2.writeFileSync(bd.rutaDeLaLlave(), JSON.stringify(json));
  bd.olvidarLlaveEnMemoria();

  const nueva = bd.prepararLlaveDeFotos();
  comprobar('sin DPAPI, el kiosco crea otra llave y sigue', nueva && nueva.id !== llave.id);

  const apartadas = fs2.readdirSync(carpetaDatos).filter((n) => n.includes('.ilegible.json'));
  comprobar('la llave vieja se APARTA, no se borra', apartadas.length === 1, apartadas.join(','));

  comprobar('las fotos viejas piden la llave anterior',
    bd.leerFoto(foto.rutaRelativa, idMarca, foto.hash).estado === 'llave_no_disponible');

  const vieja = await bd.abrirLlaveConRecuperacion(
    fs2.readFileSync(pathMod.join(carpetaDatos, apartadas[0]), 'utf8'), CONTRASENA);
  const rescatada = bd.leerFoto(foto.rutaRelativa, idMarca, foto.hash, [vieja]);
  comprobar('con la contrasena de recuperacion se rescatan',
    rescatada.estado === 'con_foto' && rescatada.jpeg.equals(jpegOriginal), rescatada.estado);

  // --- Recuperar desde el modo administrador (vuelve a cifrar con la llave actual) ---
  const conLlaveVieja = bd.contarFotosConLlaveAnterior();
  comprobar('el modo administrador sabe cuantas fotos tienen candado anterior', conLlaveVieja >= 1, String(conLlaveVieja));
  const fallida = await bd.recuperarFotosConContrasena('contrasena equivocada');
  comprobar('con la contrasena equivocada no se abre ninguna llave ni se toca nada',
    fallida.llavesAbiertas === 0 && bd.contarFotosConLlaveAnterior() === conLlaveVieja);
  const recuperacion = await bd.recuperarFotosConContrasena(CONTRASENA);
  comprobar('con la buena, las fotos se recuperan', recuperacion.recuperadas >= 1 && recuperacion.pendientes === 0,
    JSON.stringify(recuperacion));
  const ahoraSeVe = bd.leerFoto(foto.rutaRelativa, idMarca, foto.hash);
  comprobar('y ya se ven SIN la contrasena (cifradas con la llave actual, mismo hash)',
    ahoraSeVe.estado === 'con_foto' && ahoraSeVe.jpeg.equals(jpegOriginal), ahoraSeVe.estado);

  // --- Retencion ---
  console.log('\n--- retencion de fotos ---');

  const hace = (dias) => Object.assign({}, bd.leerReloj(), { horaEstimadaMs: Date.now() - dias * DIA });
  const marcaConFoto = (dias) => {
    const id = bd.nuevoIdDeMarca();
    const r = hace(dias);
    const f = bd.guardarFoto(id, JPEG_1PX, r.horaEstimadaMs);
    bd.guardarMarca({ id, empleadoId: psanchez.id, usuario: psanchez.usuario, tipo: 'entrada', reloj: r, banderas: [], foto: f });
    return { id, foto: f };
  };

  comprobar('sin configuracion, la retencion es la de respaldo (30)', bd.diasDeRetencion() === 30);

  const vencida = marcaConFoto(40);
  const enDisputa = marcaConFoto(45);
  const reciente = marcaConFoto(2);
  comprobar('"Conservar" se aplica a una foto viva',
    bd.cambiarConservar(enDisputa.id, true, { motivo: 'queja del empleado', por: 'admin-prueba' }) === true);

  const marcasAntesDeDepurar = bd.contarMarcas();
  const borradas = bd.depurarFotosVencidas();
  comprobar('se borra la foto de hace 40 dias', !fs2.existsSync(bd.rutaAbsolutaDeFoto(vencida.foto.rutaRelativa)), `borradas=${borradas}`);
  comprobar('queda anotada como eliminada', !!bd.obtenerFoto(vencida.id).eliminadaEn);
  comprobar('la foto "Conservar" NO se borra', fs2.existsSync(bd.rutaAbsolutaDeFoto(enDisputa.foto.rutaRelativa)));
  comprobar('la foto reciente NO se borra', fs2.existsSync(bd.rutaAbsolutaDeFoto(reciente.foto.rutaRelativa)));
  comprobar('las MARCAS no se borran nunca', bd.contarMarcas() === marcasAntesDeDepurar);
  comprobar('una foto ya borrada no se puede "conservar"',
    bd.cambiarConservar(vencida.id, true, { motivo: null, por: 'admin-prueba' }) === false);

  // Adelantar el reloj de Windows 60 dias NO basta para borrar evidencia:
  // manda la hora de la ultima marca registrada.
  bd.depurarFotosVencidas(Date.now() + 60 * DIA);
  comprobar('adelantar el reloj no borra las fotos recientes',
    fs2.existsSync(bd.rutaAbsolutaDeFoto(reciente.foto.rutaRelativa)));

  // Quitar "Conservar" la devuelve al ciclo normal.
  bd.cambiarConservar(enDisputa.id, false, { motivo: 'caso cerrado', por: 'admin-prueba' });
  bd.depurarFotosVencidas();
  comprobar('sin "Conservar", la vencida se borra en la siguiente vuelta',
    !fs2.existsSync(bd.rutaAbsolutaDeFoto(enDisputa.foto.rutaRelativa)));

  // El plazo lo manda la configuracion, y un valor absurdo no se obedece.
  const bdLocal = bd.baseDeDatos();
  bdLocal.prepare("INSERT OR REPLACE INTO configuracion_cache (clave, valor) VALUES ('dias_retencion_fotos', '90')").run();
  comprobar('el plazo sale de la configuracion (90)', bd.diasDeRetencion() === 90);
  bdLocal.prepare("INSERT OR REPLACE INTO configuracion_cache (clave, valor) VALUES ('dias_retencion_fotos', '0')").run();
  comprobar('un plazo de 0 dias NO se obedece', bd.diasDeRetencion() === 30);
  bdLocal.prepare("DELETE FROM configuracion_cache WHERE clave = 'dias_retencion_fotos'").run();

  // --- Fotos en claro de versiones anteriores ---
  console.log('\n--- fotos heredadas sin cifrar ---');

  const carpetaVieja = pathMod.join(carpetaDatos, 'fotos_pendientes');
  fs2.mkdirSync(carpetaVieja, { recursive: true });
  const idHeredada = bd.nuevoIdDeMarca();
  const rutaHeredada = pathMod.join(carpetaVieja, idHeredada + '.jpg');
  fs2.writeFileSync(rutaHeredada, jpegOriginal);
  fs2.writeFileSync(pathMod.join(carpetaVieja, 'huerfana.jpg'), jpegOriginal);
  bd.guardarMarca({ id: idHeredada, empleadoId: dgomez.id, usuario: dgomez.usuario, tipo: 'salida', reloj: bd.leerReloj(), banderas: [], foto: null });
  // Asi dejaban la marca las versiones anteriores: ruta absoluta y sin hash.
  bdLocal.prepare('UPDATE marcas SET foto_ruta_local = ? WHERE id = ?').run(rutaHeredada, idHeredada);

  const migracion = bd.migrarFotosHeredadas();
  comprobar('la foto heredada se cifra', migracion.cifradas === 1, JSON.stringify(migracion));
  comprobar('la huerfana (sin marca) se borra', migracion.huerfanasBorradas === 1);
  comprobar('la carpeta vieja desaparece', !fs2.existsSync(carpetaVieja));
  const heredada = bd.obtenerFoto(idHeredada);
  comprobar('la heredada queda con su hash y se puede abrir',
    heredada && heredada.hash === foto.hash &&
    bd.leerFoto(heredada.rutaRelativa, idHeredada, heredada.hash).estado === 'con_foto');
  comprobar('correr la migracion otra vez no hace nada',
    JSON.stringify(bd.migrarFotosHeredadas()) === JSON.stringify({ cifradas: 0, huerfanasBorradas: 0 }));

  // ======================================================================
  //  20 EMPLEADOS DE PRUEBA
  // ======================================================================
  console.log('\n--- semilla de 20 empleados ---');

  comprobar('la semilla trae 20 empleados', bd.contarEmpleados() === 20, String(bd.contarEmpleados()));
  bd.sembrarEmpleadosDePrueba();
  comprobar('sembrar otra vez no duplica a nadie', bd.contarEmpleados() === 20);
  const vigesimo = bd.buscarPorUsuario('fortiz');
  comprobar('el numero sale de la posicion en la lista (1020)', vigesimo && vigesimo.numeroEmpleado === '1020');
  comprobar('"Treviño" genero atrevino', bd.buscarPorUsuario('atrevino') !== null);

  // ======================================================================
  //  MODO ADMINISTRADOR  (CLAUDE.md 5.2)
  // ======================================================================
  console.log('\n--- modo administrador ---');

  bd.sembrarAdministradorDePrueba();
  const { usuario: U_ADMIN, contrasena: C_ADMIN } = bd.ADMIN_DE_PRUEBA;

  const mala = await bd.entrarModoAdmin(U_ADMIN, 'equivocada');
  comprobar('contrasena equivocada: no entra', mala.ok === false);
  const nadie = await bd.entrarModoAdmin('noexiste', C_ADMIN);
  comprobar('usuario inexistente: mismo mensaje que contrasena mala',
    nadie.ok === false && mala.ok === false && nadie.mensaje === mala.mensaje);

  const buena = await bd.entrarModoAdmin(U_ADMIN, C_ADMIN);
  comprobar('con la contrasena correcta entra', buena.ok === true);
  const tokenAdmin = buena.ok ? buena.sesion.token : '';
  comprobar('el token son 64 hex', /^[0-9a-f]{64}$/.test(tokenAdmin));
  comprobar('con el token la sesion vale', bd.validarSesionAdmin(tokenAdmin) !== null);
  comprobar('con otro token no', bd.validarSesionAdmin('b'.repeat(64)) === null);

  bd.vencerSesionAdminParaPrueba();
  comprobar('pasado el tiempo de inactividad, la sesion ya no vale', bd.validarSesionAdmin(tokenAdmin) === null);

  // --- La consulta de auditoria ---
  const todas = bd.buscarMarcasParaAuditoria({ desde: null, hasta: null, empleadoId: null, bandera: null, soloConFoto: false });
  comprobar('la auditoria trae marcas', todas.length > 0, String(todas.length));
  const deDalton = todas.find((m) => m.id === idMarca);
  comprobar('la auditoria SI trae el nombre completo', deDalton && deDalton.nombreCompleto === 'Dalton Akenaton Gomez Arellano');
  comprobar('y el numero de empleado', deDalton && deDalton.numeroEmpleado === '1001');

  const vencidaEnAuditoria = todas.find((m) => m.id === vencida.id);
  comprobar('una foto borrada sale como eliminada_por_antiguedad',
    vencidaEnAuditoria && vencidaEnAuditoria.fotoEstado === 'eliminada_por_antiguedad');

  const soloPedro = bd.buscarMarcasParaAuditoria({ desde: null, hasta: null, empleadoId: psanchez.id, bandera: null, soloConFoto: false });
  comprobar('filtro por empleado', soloPedro.length > 0 && soloPedro.every((m) => m.empleadoId === psanchez.id));

  const conFoto = bd.buscarMarcasParaAuditoria({ desde: null, hasta: null, empleadoId: null, bandera: null, soloConFoto: true });
  comprobar('filtro "solo con foto"', conFoto.length > 0 && conFoto.every((m) => m.fotoEstado === 'disponible' || m.fotoEstado === 'conservada'));

  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Matamoros' }).format(new Date());
  const deHoy = bd.buscarMarcasParaAuditoria({ desde: hoy, hasta: hoy, empleadoId: null, bandera: null, soloConFoto: false });
  comprobar('filtro por fecha: hoy no trae la de hace 40 dias',
    deHoy.some((m) => m.id === idMarca) && !deHoy.some((m) => m.id === vencida.id));

  // Medianoche LOCAL, no UTC, y respetando el horario de verano (CLAUDE.md 6).
  // Nuevo Laredo: UTC-5 en verano, UTC-6 en invierno.
  const z = 'America/Matamoros';
  comprobar('1-nov-2026 (aun horario de verano) empieza a las 05:00 UTC',
    new Date(bd.inicioDelDiaLocal('2026-11-01', z)).toISOString() === '2026-11-01T05:00:00.000Z');
  comprobar('2-nov-2026 (ya horario normal) empieza a las 06:00 UTC',
    new Date(bd.inicioDelDiaLocal('2026-11-02', z)).toISOString() === '2026-11-02T06:00:00.000Z');
  comprobar('8-mar-2026 empieza a las 06:00 UTC',
    new Date(bd.inicioDelDiaLocal('2026-03-08', z)).toISOString() === '2026-03-08T06:00:00.000Z');
  comprobar('9-mar-2026 (ya horario de verano) empieza a las 05:00 UTC',
    new Date(bd.inicioDelDiaLocal('2026-03-09', z)).toISOString() === '2026-03-09T05:00:00.000Z');

  // Una hora cualquiera (el registro manual del panel). NO es "medianoche +
  // 6 horas": la noche del cambio, entre 00:00 y 06:00 pasan 7 o 5 horas.
  comprobar('1-nov-2026 06:00 (despues de repetir la hora) = 12:00 UTC',
    new Date(bd.instanteLocal('2026-11-01', 6, 0, z)).toISOString() === '2026-11-01T12:00:00.000Z');
  comprobar('8-mar-2026 06:00 (despues de perder la hora) = 11:00 UTC',
    new Date(bd.instanteLocal('2026-03-08', 6, 0, z)).toISOString() === '2026-03-08T11:00:00.000Z');
  comprobar('23-sep-2026 22:00 = 03:00 UTC del dia siguiente',
    new Date(bd.instanteLocal('2026-09-23', 22, 0, z)).toISOString() === '2026-09-24T03:00:00.000Z');

  // --- Bitacora de quien miro que foto ---
  const outboxAntes = bd.baseDeDatos().prepare("SELECT COUNT(*) AS n FROM outbox WHERE tipo_registro = 'acceso_foto'").get().n;
  bd.registrarAccesoFoto(idMarca, 'admin-de-prueba', 'ver');
  comprobar('ver una foto queda en la bitacora', bd.accesosDeFoto(idMarca).some((a) => a.accion === 'ver'));
  comprobar('y va a la bandeja de salida',
    bd.baseDeDatos().prepare("SELECT COUNT(*) AS n FROM outbox WHERE tipo_registro = 'acceso_foto'").get().n === outboxAntes + 1);
  comprobar('un acceso NO aparece entre las marcas por enviar',
    !bd.marcasPendientes(500).some((m) => JSON.parse(m.payload).accion));

  // --- Intentos fallidos: se regresa, no se bloquea (decision del 22-09-2026) ---
  // Un fallo NO castiga al jefe: con la contrasena correcta entra enseguida.
  const unFallo = await bd.entrarModoAdmin(U_ADMIN, 'Admin-De-Prueba'); // mayusculas puestas
  comprobar('un fallo dice "Intento fallido. Quedo registrado..."',
    unFallo.ok === false && unFallo.mensaje === bd.MENSAJE_INTENTO_FALLIDO, unFallo.mensaje);
  comprobar('el fallo queda registrado de verdad (evento en la bandeja)',
    bd.eventosPendientes(1000).some((e) => JSON.parse(e.payload).tipo === 'modo_admin_intento_fallido'));
  comprobar('el evento no lleva lo que se tecleo',
    !bd.eventosPendientes(1000).some((e) => /Admin-De-Prueba|equivocada|"admin"/.test(e.payload)));
  const trasUnFallo = await bd.entrarModoAdmin(U_ADMIN, C_ADMIN);
  comprobar('tras un fallo, la contrasena correcta entra SIN esperar', trasUnFallo.ok === true);

  // La espera: solo a partir del 5.o fallo SEGUIDO, y se duplica con tope.
  comprobar('con 4 fallos seguidos no hay espera', bd.segundosDeEsperaTras(4) === 0);
  comprobar('con 5, 30 segundos', bd.segundosDeEsperaTras(5) === 30);
  comprobar('con 6, un minuto', bd.segundosDeEsperaTras(6) === 60);
  comprobar('con 20, el tope de 5 minutos', bd.segundosDeEsperaTras(20) === 300);

  // Al final porque deja una espera activa.
  for (let i = 0; i < 5; i++) await bd.entrarModoAdmin(U_ADMIN, 'equivocada');
  const enEspera = await bd.entrarModoAdmin(U_ADMIN, C_ADMIN);
  comprobar('tras 5 fallos seguidos hay que esperar, aun con la contrasena correcta',
    enEspera.ok === false && /Espera \d+ segundos/.test(enEspera.mensaje), enEspera.mensaje);

  // ======================================================================
  //  EXPORTACION A USB  (CLAUDE.md 5.2, cierre del 3.b)
  // ======================================================================
  //  La unica salida de las fotos. Lo que no puede fallar en silencio: que
  //  el ZIP abra, que cada foto quede en la bitacora, y que la marca de agua
  //  de verdad este grabada en los pixeles.
  console.log('\n--- exportacion a USB ---');

  const { nativeImage } = require('electron');

  // --- El ZIP ---
  const carpetaExport = pathMod.join(os.tmpdir(), 'kiosko-export-' + Date.now());
  fs2.mkdirSync(carpetaExport, { recursive: true });
  const rutaZipPrueba = pathMod.join(carpetaExport, 'prueba.zip');
  const hora = { ano: 2026, mes: 9, dia: 23, hora: 6, minuto: 2, segundo: 15 };
  const escritor = new bd.EscritorZip(rutaZipPrueba, hora);
  const binario = crypto.randomBytes(5000);
  escritor.agregar('fotos/año.bin', binario);
  escritor.agregar('texto.txt', Buffer.from('hola'));
  escritor.cerrar();
  const leidoZip = bd.leerZipSinComprimir(fs2.readFileSync(rutaZipPrueba));
  comprobar('el ZIP se vuelve a leer con sus dos archivos', leidoZip.size === 2);
  comprobar('los bytes salen identicos (y el nombre con ñ intacto)',
    leidoZip.get('fotos/año.bin')?.equals(binario) === true);

  // --- La letra de la marca de agua ---
  comprobar('el texto se pasa a mayusculas sin acentos, respetando la Ñ',
    bd.textoDibujable('Gómez Ñoño é%') === 'GOMEZ ÑOÑO E?', bd.textoDibujable('Gómez Ñoño é%'));

  // --- La marca de agua, sobre una foto de 640x480 gris ---
  const gris = Buffer.alloc(640 * 480 * 4, 128);
  const jpegGris = nativeImage.createFromBitmap(gris, { width: 640, height: 480 }).toJPEG(70);
  const marcada = bd.grabarMarcaDeAgua(
    jpegGris,
    [{ texto: 'ENTRADA 23/09/2026 06:02:15', color: { r: 255, g: 255, b: 255 } }],
    { escalaMaxima: 3, opacidadDeFranja: 0.7, calidadJpeg: 85 },
  );
  const pixelesMarcados = marcada && nativeImage.createFromBuffer(marcada).toBitmap();
  const pixel = (x, y) => pixelesMarcados[(y * 640 + x) * 4 + 1]; // canal verde
  let blancosAbajo = 0;
  for (let y = 440; y < 480; y++) for (let x = 0; x < 640; x++) if (pixel(x, y) > 200) blancosAbajo++;
  comprobar('la foto marcada sigue siendo un JPEG de 640x480',
    marcada && JSON.stringify(nativeImage.createFromBuffer(marcada).getSize()) === '{"width":640,"height":480}');
  comprobar('arriba la foto queda igual (gris)', marcada && Math.abs(pixel(320, 100) - 128) < 12, marcada && String(pixel(320, 100)));
  comprobar('abajo hay franja oscura', marcada && pixel(630, 475) < 60, marcada && String(pixel(630, 475)));
  comprobar('y texto blanco grabado en los pixeles', blancosAbajo > 500, String(blancosAbajo));

  // Un renglon demasiado largo se achica o se corta, pero nunca se sale.
  const angosto = Buffer.alloc(40 * 30 * 4, 128);
  let sinReventar = true;
  try {
    bd.pintarMarcaDeAgua(angosto, 40, 30, [{ texto: 'X'.repeat(200), color: { r: 255, g: 255, b: 255 } }],
      { escalaMaxima: 3, opacidadDeFranja: 0.7 });
  } catch (e) { sinReventar = false; }
  comprobar('un texto larguisimo en una foto chica no revienta', sinReventar && angosto.length === 40 * 30 * 4);

  // --- Memorias USB: lo que contesta PowerShell ---
  comprobar('una sola memoria (objeto, no lista) se entiende',
    bd.interpretarRespuesta('{"DeviceID":"E:","VolumeName":"KINGSTON","FreeSpace":1000,"Size":2000}').length === 1);
  comprobar('un lector de tarjetas vacio (sin tamano) no se ofrece',
    bd.interpretarRespuesta('[{"DeviceID":"E:","VolumeName":"","FreeSpace":null,"Size":null},{"DeviceID":"F:","VolumeName":"USB","FreeSpace":5,"Size":9}]')
      .map((m) => m.unidad).join() === 'F:');
  comprobar('sin memorias (respuesta vacia) da lista vacia', bd.interpretarRespuesta('').length === 0);
  comprobar('basura no revienta', bd.interpretarRespuesta('no es json').length === 0);

  const discoSistema = (process.env.SystemDrive || 'C:') + '\\';
  comprobar('el disco del sistema NO es destino valido', bd.esDiscoDeEstaComputadora(discoSistema + 'Usuarios\\x'));
  comprobar('una carpeta de red tampoco', bd.esDiscoDeEstaComputadora('\\\\servidor\\compartida'));
  comprobar('otra letra (una USB) si', !bd.esDiscoDeEstaComputadora('Q:\\'));

  comprobar('a la exportacion solo se le manda una letra, no una ruta',
    bd.EsquemaExportarAUsb.safeParse({ token: 'a'.repeat(64), filtros: { desde: null, hasta: null, empleadoId: null, bandera: null, soloConFoto: false }, unidad: 'C:\\Windows' }).success === false);

  // --- La exportacion completa ---
  // Una marca nueva con una foto de verdad (640x480) para dgomez.
  const idExportada = bd.nuevoIdDeMarca();
  const relojExport = bd.leerReloj();
  const fotoExport = bd.guardarFoto(idExportada, 'data:image/jpeg;base64,' + jpegGris.toString('base64'), relojExport.horaEstimadaMs);
  bd.guardarMarca({ id: idExportada, empleadoId: dgomez.id, usuario: dgomez.usuario, tipo: 'entrada', reloj: relojExport, banderas: ['reloj_sospechoso'], foto: fotoExport });

  const filtrosDalton = { desde: null, hasta: null, empleadoId: dgomez.id, bandera: null, soloConFoto: false };
  const marcasDalton = bd.buscarMarcasParaExportar(filtrosDalton);
  const conFotoDalton = marcasDalton.filter((m) => m.fotoEstado === 'disponible' || m.fotoEstado === 'conservada');
  const adminIdPrueba = buena.ok ? buena.sesion.adminId : '';

  const accesosEnBandejaAntes = bd.baseDeDatos().prepare("SELECT COUNT(*) AS n FROM outbox WHERE tipo_registro = 'acceso_foto'").get().n;
  const exportado = await bd.exportarRegistros(filtrosDalton, carpetaExport, { id: adminIdPrueba, nombre: 'Admin de prueba' }, 'usb');
  comprobar('la exportacion termina bien', exportado.ok === true, exportado.ok ? '' : exportado.mensaje);

  const archivosEnCarpeta = fs2.readdirSync(carpetaExport);
  comprobar('no queda ningun archivo .incompleto', !archivosEnCarpeta.some((a) => a.endsWith('.incompleto')), archivosEnCarpeta.join());

  if (exportado.ok) {
    const r = exportado.resultado;
    comprobar('el nombre del ZIP no dice de quien es', /^asistencia_inicio_a_hoy_hecho-\d{4}-\d{2}-\d{2}_\d{4}\.zip$/.test(r.archivo), r.archivo);
    comprobar('cuenta todos los registros', r.registros === marcasDalton.length, `${r.registros} de ${marcasDalton.length}`);
    comprobar('cada foto disponible sale o se reporta con problema',
      r.fotos + r.fotosConProblema === conFotoDalton.length && r.fotos >= 1, `${r.fotos}+${r.fotosConProblema} de ${conFotoDalton.length}`);

    const contenido = bd.leerZipSinComprimir(fs2.readFileSync(pathMod.join(carpetaExport, r.archivo)));
    const nombres = [...contenido.keys()];
    comprobar('el ZIP trae registros.csv y LEEME.txt', contenido.has('registros.csv') && contenido.has('LEEME.txt'));
    const fotosEnZip = nombres.filter((n) => n.startsWith('fotos/'));
    comprobar('trae una foto por cada foto exportada', fotosEnZip.length === r.fotos, String(fotosEnZip.length));
    comprobar('los nombres de las fotos no dicen de quien son', !fotosEnZip.some((n) => /dgomez|dalton|gomez|1001/i.test(n)));
    comprobar('sin originales (EXPORTACION.incluirOriginales = false)', !nombres.some((n) => n.startsWith('originales/')));

    const fotoDelZip = contenido.get(fotosEnZip.find((n) => n.includes(idExportada)) ?? '');
    comprobar('la foto nueva va en el ZIP', !!fotoDelZip);
    comprobar('la foto exportada NO es la original: lleva la marca grabada',
      fotoDelZip && crypto.createHash('sha256').update(fotoDelZip).digest('hex') !== fotoExport.hash);

    const csv = contenido.get('registros.csv').toString('utf8');
    comprobar('el CSV empieza con BOM (para que Excel lea los acentos)', csv.charCodeAt(0) === 0xfeff);
    const lineasCsv = csv.slice(1).trim().split('\r\n');
    comprobar('el CSV trae encabezado + un renglon por registro', lineasCsv.length === marcasDalton.length + 1, String(lineasCsv.length));
    const renglonNuevo = lineasCsv.find((l) => l.startsWith(idExportada)) ?? '';
    comprobar('el renglon lleva la huella ORIGINAL (la que tiene la nube)', renglonNuevo.includes(fotoExport.hash));
    comprobar('y la revision en palabras', renglonNuevo.includes('Hora dudosa'), renglonNuevo);

    const accesosExport = bd.accesosDeFoto(idExportada).filter((a) => a.accion === 'exportar');
    comprobar('la foto exportada queda en la bitacora accesos_foto', accesosExport.length === 1 && accesosExport[0].adminId === adminIdPrueba);
    const accesosEnBandejaDespues = bd.baseDeDatos().prepare("SELECT COUNT(*) AS n FROM outbox WHERE tipo_registro = 'acceso_foto'").get().n;
    comprobar('y cada acceso va a la bandeja de salida', accesosEnBandejaDespues - accesosEnBandejaAntes === conFotoDalton.length, `${accesosEnBandejaDespues - accesosEnBandejaAntes}`);

    const eventoExport = bd.eventosPendientes(1000).find((e) => e.payload.includes('exportacion_usb'));
    comprobar('la exportacion entera deja un evento', !!eventoExport);
    comprobar('el evento no lleva nombres ni la ruta',
      eventoExport && !/Dalton|dgomez|kiosko-export|asistencia_/.test(eventoExport.payload), eventoExport && eventoExport.payload);
  }

  const vacia = await bd.exportarRegistros(
    { desde: '2001-01-01', hasta: '2001-01-02', empleadoId: null, bandera: null, soloConFoto: false },
    carpetaExport, { id: adminIdPrueba, nombre: 'x' }, 'usb');
  comprobar('sin registros no se crea nada y se explica por que', vacia.ok === false && /No hay registros/.test(vacia.mensaje));

  const noExiste = await bd.exportarRegistros(filtrosDalton, pathMod.join(carpetaExport, 'no', 'existe'), { id: adminIdPrueba, nombre: 'x' }, 'usb');
  comprobar('si la memoria ya no esta, error entendible (no una ruta)', noExiste.ok === false && /memoria/.test(noExiste.mensaje) && !/kiosko-export/.test(noExiste.mensaje));

  fs2.rmSync(carpetaExport, { recursive: true, force: true });

  // ======================================================================
  //  SINCRONIZACION, DEL LADO LOCAL  (bloque 6)
  // ======================================================================
  //  Lo que se puede probar sin servidor: que se arme bien lo que sube, que
  //  lo rechazado salga de la cola sin borrarse, y que el catalogo se aplique
  //  sin perder nada local. La prueba contra la nube de verdad esta en
  //  probar-sincronizacion.cjs.
  console.log('\n--- sincronizacion (local) ---');

  const bdSql = bd.baseDeDatos();
  const renglones = bd.renglonesParaSubir(1000);
  const loteLocal = bd.armarCuerpo(renglones);
  comprobar('el lote junta marcas, eventos y accesos a fotos',
    loteLocal.marcas.length > 0 && loteLocal.eventos.length > 0 && loteLocal.accesosFoto.length > 0,
    `${loteLocal.marcas.length}/${loteLocal.eventos.length}/${loteLocal.accesosFoto.length}`);
  comprobar('cada marca va tal cual se guardo (con sus lecturas de reloj)',
    loteLocal.marcas.every((m) => m.id && m.empleadoId && m.reloj && typeof m.reloj.horaEstimadaMs === 'number'));
  comprobar('lo que sube nunca lleva la foto ni su ruta',
    !JSON.stringify(loteLocal).includes('.jpg') && !JSON.stringify(loteLocal).includes('data:image'));

  // La foto conservada en la prueba de exportacion ya dejo su estado en cola.
  comprobar('"Conservar" deja en cola su estado para la nube',
    loteLocal.estadosDeFoto.some((e) => e.estado === 'conservada'), JSON.stringify(loteLocal.estadosDeFoto.slice(0, 2)));

  const pendientesAntesSync = bd.contarPendientes();
  const [primero, segundo, tercero] = renglones;
  bd.marcarEnviados([primero.id]);
  bd.marcarRechazados([{ id: segundo.id, motivo: 'empleado_desconocido' }]);
  bd.anotarFallo([tercero.id], 'sin red');
  comprobar('enviado y rechazado salen de "por enviar"; el fallo pasajero no',
    bd.contarPendientes() === pendientesAntesSync - 2, `${pendientesAntesSync} -> ${bd.contarPendientes()}`);
  const filaRechazada = bdSql.prepare('SELECT rechazado_en, ultimo_error FROM outbox WHERE id = ?').get(segundo.id);
  comprobar('lo rechazado NO se borra: queda con fecha y motivo',
    filaRechazada && filaRechazada.rechazado_en && filaRechazada.ultimo_error === 'empleado_desconocido');
  const filaFallida = bdSql.prepare('SELECT intentos, ultimo_error FROM outbox WHERE id = ?').get(tercero.id);
  comprobar('un fallo pasajero suma un intento y anota el error', filaFallida.intentos >= 1 && filaFallida.ultimo_error === 'sin red');
  comprobar('lo rechazado ya no vuelve a subir', !bd.renglonesParaSubir(1000).some((r) => r.id === segundo.id));
  comprobar('el modo administrador lista lo rechazado con su motivo',
    bd.listarRechazados(50).some((r) => r.id === segundo.id && r.motivo === 'empleado_desconocido'));
  comprobar('Volver a enviarlos lo regresa a la cola', bd.reintentarRechazados() >= 1 && bd.renglonesParaSubir(1000).some((r) => r.id === segundo.id));
  bd.marcarRechazados([{ id: segundo.id, motivo: 'empleado_desconocido' }]);

  // --- El catalogo ---
  const idNube = crypto.randomUUID();
  const antesDalton = bd.buscarPorUsuario('dgomez');
  const hashNube = bd.hashearPin('9876');
  const recienteMs = Date.now() + 60_000;
  bd.aplicarCatalogo({
    empleados: [{
      id: idNube, usuario: 'dgomez', numero_empleado: '1001', nombre: 'Dalton', apellido_paterno: 'Gómez',
      apellido_materno: 'Arellano', pin_hash: hashNube, pin_temporal: false, activo: true,
      actualizado_en: new Date().toISOString(),
    }],
    administradores: [],
    configuracion: { intentos_pin_maximos: 6, umbral_brillo_minimo: 'no es numero', zona_horaria: 'America/Matamoros' },
    ultimasMarcas: [
      { empleadoId: idNube, tipo: 'salida', horaEstimada: new Date(recienteMs).toISOString() },
      // Mas vieja que la local: NO debe pisarla.
      { empleadoId: antesDalton.id, tipo: 'entrada', horaEstimada: '2001-01-01T00:00:00Z' },
    ],
    cursor: '2026-09-23T12:00:00.000Z',
  });
  const daltonNube = bd.buscarPorUsuario('dgomez');
  comprobar('manda la nube: "dgomez" ahora es el de la nube', daltonNube && daltonNube.id === idNube && daltonNube.pinHash === hashNube);
  const apartado = bd.buscarPorId(antesDalton.id);
  comprobar('el local con el mismo usuario se aparta (inactivo), NO se borra',
    apartado && apartado.activo === false && apartado.usuario.startsWith('dgomez.anterior.'), apartado && apartado.usuario);
  comprobar('sus marcas siguen ahi', bdSql.prepare('SELECT COUNT(*) AS n FROM marcas WHERE empleado_id = ?').get(antesDalton.id).n > 0);
  comprobar('la ultima marca de la nube, si es mas nueva, se usa', bd.accionSugeridaPara(idNube) === 'entrada');
  comprobar('una ultima marca MAS VIEJA que la local no la pisa',
    bdSql.prepare('SELECT hora_estimada_ms FROM ultimas_marcas_cache WHERE empleado_id = ?').get(antesDalton.id).hora_estimada_ms > Date.parse('2002-01-01'));
  comprobar('el cursor se recuerda para la proxima vez', bd.leerEstadoLocal('cursor_catalogo') === '2026-09-23T12:00:00.000Z');

  // --- La configuracion del jefe ---
  comprobar('el kiosco obedece la configuracion de la nube (6 intentos de PIN)', bd.reglasDelPin().intentosMaximos === 6);
  comprobar('un valor absurdo NO se obedece: se usa el respaldo',
    bd.umbralesDeCamara().brilloMinimo === 45, String(bd.umbralesDeCamara().brilloMinimo));
  comprobar('la zona horaria que manda la nube se obedece', bd.zonaHorariaVigente() === 'America/Matamoros');
  bdSql.prepare(`INSERT OR REPLACE INTO configuracion_cache (clave, valor) VALUES ('zona_horaria', '"Marte/Olympus"')`).run();
  comprobar('una zona que no existe NO se obedece: se usa la de respaldo', bd.zonaHorariaVigente() === 'America/Matamoros');
  // Las horas para "salida no registrada" tambien mandan en la sugerencia.
  bdSql.prepare(`INSERT OR REPLACE INTO configuracion_cache (clave, valor) VALUES ('horas_para_cierre_automatico', '10')`).run();
  const ultimaDalton = bdSql.prepare('SELECT tipo, hora_estimada_ms AS ms FROM ultimas_marcas_cache WHERE empleado_id = ?').get(idNube);
  bdSql.prepare('UPDATE ultimas_marcas_cache SET tipo = ? WHERE empleado_id = ?').run('entrada', idNube);
  comprobar('con "salida no registrada" en 10 h: a las 12 h de entrar ya se sugiere ENTRADA',
    bd.accionSugeridaPara(idNube, ultimaDalton.ms + 12 * 3_600_000) === 'entrada');
  comprobar('y a las 8 h todavía SALIDA', bd.accionSugeridaPara(idNube, ultimaDalton.ms + 8 * 3_600_000) === 'salida');
  bdSql.prepare('UPDATE ultimas_marcas_cache SET tipo = ? WHERE empleado_id = ?').run(ultimaDalton.tipo, idNube);
  bdSql.prepare('DELETE FROM configuracion_cache').run();
  comprobar('sin configuracion, el respaldo de configuracion.ts', bd.reglasDelPin().intentosMaximos === 4);

  // --- El reloj ---
  comprobar('desfase: PC 5 s adelantada -> +5000', bd.calcularDesfase(10_000, 10_200, 5_100) === 5000);
  comprobar('un viaje muy largo no sirve para medir el desfase', bd.calcularDesfase(0, 60_000, 30_000) === null);
  comprobar('sin hora del servidor no hay medicion', bd.calcularDesfase(0, 100, NaN) === null);

  // --- El codigo de alta ---
  comprobar('el codigo de alta acepta guion y minusculas',
    bd.EsquemaEnrolamiento.safeParse({ codigo: 'k7m4-qx2p' }).success === true);
  comprobar('y rechaza otra cosa', bd.EsquemaEnrolamiento.safeParse({ codigo: "'; drop table" }).success === false);

  // ======================================================================
  //  VALIDACION DE LO QUE LLEGA DE LA PANTALLA
  // ======================================================================
  //  Estas pruebas nacen de E-019: una expresión regular a la que le faltaba
  //  una barra invertida (`/^d+$/` en vez de `/^\d+$/`) rechazaba TODOS los
  //  códigos. El síntoma era "Código incorrecto" con el código correcto, y
  //  costó horas encontrarlo.
  //
  //  Un validador roto no se queja: rechaza. Y rechazar se ve exactamente
  //  igual que funcionar bien cuando el dato de verdad estaba mal.
  console.log('\n--- validacion de entradas ---');

  const okPausa = bd.EsquemaPausa.safeParse({ codigo: '1234' });
  comprobar('el esquema de pausa ACEPTA un codigo de digitos', okPausa.success === true,
    okPausa.success ? '' : JSON.stringify(okPausa.error.issues[0]?.message));

  comprobar('el esquema de pausa rechaza letras',
    bd.EsquemaPausa.safeParse({ codigo: 'abcd' }).success === false);

  comprobar('el esquema de pausa rechaza vacio',
    bd.EsquemaPausa.safeParse({ codigo: '' }).success === false);

  comprobar('el esquema de pausa rechaza campos de mas',
    bd.EsquemaPausa.safeParse({ codigo: '1234', admin: true }).success === false);

  // Y el registro, que es el canal por el que entra la evidencia.
  const pasePrueba = 'a'.repeat(64);
  comprobar('el esquema de registro ACEPTA un pase valido',
    bd.EsquemaRegistro.safeParse({
      tokenRegistro: pasePrueba,
      tipo: 'entrada',
      fotoJpegBase64: null,
      medicionesImagen: null,
    }).success === true);

  comprobar('el esquema de registro rechaza un pase corto',
    bd.EsquemaRegistro.safeParse({
      tokenRegistro: 'abc',
      tipo: 'entrada',
      fotoJpegBase64: null,
      medicionesImagen: null,
    }).success === false);

  comprobar('el esquema de registro rechaza un tipo inventado',
    bd.EsquemaRegistro.safeParse({
      tokenRegistro: pasePrueba,
      tipo: 'brinco',
      fotoJpegBase64: null,
      medicionesImagen: null,
    }).success === false);

  console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASARON' : `\n${fallos} PRUEBA(S) FALLARON`);
  app.exit(fallos === 0 ? 0 : 1);
});
