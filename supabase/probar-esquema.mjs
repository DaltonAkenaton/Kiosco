/**
 * ============================================================================
 *  PRUEBAS DEL ESQUEMA, CONTRA UN POSTGRES DE VERDAD
 * ============================================================================
 *
 *  Corre contra el Supabase local (Docker). Comprueba lo que la revision de
 *  sintaxis NO puede comprobar:
 *
 *    - que el trigger de inmutabilidad rechace lo que tiene que rechazar;
 *    - que las restricciones frenen los datos imposibles;
 *    - que las politicas RLS nieguen por defecto;
 *    - que la bitacora de auditoria se llene sola y oculte el hash del PIN;
 *    - que las funciones de tiempo den la fecha correcta.
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE ESTO TIENE QUE EXISTIR
 *  ---------------------------------------------------------------------------
 *  Porque una politica RLS mal escrita **no falla**: deja pasar. Y un trigger
 *  que no se dispara tampoco falla: simplemente no protege. Los dos errores se
 *  ven exactamente igual que el exito — todo funciona, nada se queja — hasta el
 *  dia en que alguien borra una marca y resulta que si se podia.
 *
 *  La primera vez que se corrio esto ya encontro un error de diseno: un indice
 *  sobre `fecha_laboral()`, que Postgres rechaza porque esa funcion no es
 *  IMMUTABLE (lee la zona horaria de una tabla). Ver E-018.
 *
 *  Uso:
 *      npx supabase start        (una vez, necesita Docker)
 *      npm run supabase:probar
 */

import pg from 'pg';

const CADENA = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const bd = new pg.Client({ connectionString: CADENA });

let fallos = 0;
let pruebas = 0;

function comprobar(nombre, condicion, detalle = '') {
  pruebas++;
  const marca = condicion ? 'OK   ' : 'FALLA';
  console.log(`${marca}  ${nombre}${detalle ? '  -> ' + detalle : ''}`);
  if (!condicion) fallos++;
}

/**
 * Corre algo que DEBE fallar, y comprueba que falle.
 *
 * Es la forma de prueba mas importante de este archivo. Comprobar que algo
 * permitido funciona es facil; lo que protege al sistema es comprobar que lo
 * prohibido **de verdad** esta prohibido.
 */
async function debeFallar(nombre, sql, textoEsperado = '') {
  pruebas++;

  /*
    EL PUNTO DE GUARDADO ES OBLIGATORIO, Y CUESTA UN RATO ENTENDER POR QUE.

    En PostgreSQL, cuando una sentencia falla dentro de una transaccion, la
    transaccion entera queda ABORTADA: todo lo que venga despues se rechaza con
    "current transaction is aborted" hasta que se haga rollback.

    Como este archivo esta lleno de pruebas que DEBEN fallar, sin esto la
    primera se comprobaria bien y las veinte siguientes moririan en cadena —
    que fue exactamente lo que paso la primera vez que se corrio.

    Un `savepoint` es una marca a la que se puede volver. Se pone antes de la
    sentencia, y al volver a el la transaccion queda sana otra vez, como si esa
    sentencia nunca se hubiera intentado.
  */
  await bd.query('savepoint antes_de_la_prueba');

  try {
    await bd.query(sql);
    console.log(`FALLA  ${nombre}  -> NO fallo, y deberia`);
    fallos++;
    await bd.query('release savepoint antes_de_la_prueba');
  } catch (e) {
    const cuadra = textoEsperado === '' || e.message.includes(textoEsperado);
    console.log(
      `${cuadra ? 'OK   ' : 'FALLA'}  ${nombre}  -> ${e.message.split('\n')[0].slice(0, 68)}`,
    );
    if (!cuadra) fallos++;
    await bd.query('rollback to savepoint antes_de_la_prueba');
  }
}

await bd.connect();

// ============================================================================
//  Datos de prueba
// ============================================================================
console.log('\n--- preparando datos ---');

await bd.query('begin');

const { rows: [empleado] } = await bd.query(`
  insert into empleados (usuario, nombre, apellido_paterno, apellido_materno, pin_hash)
  values ('pprueba', 'Persona', 'Prueba', 'Test',
          extensions.crypt('1234', extensions.gen_salt('bf', 10)))
  returning id, pin_hash
`);
comprobar('se puede dar de alta un empleado', !!empleado.id);
comprobar('el PIN quedo hasheado, no en claro',
  empleado.pin_hash.startsWith('$2') && !empleado.pin_hash.includes('1234'));

const { rows: [dispositivo] } = await bd.query(`
  insert into dispositivos (nombre, ubicacion, token_hash)
  values ('Kiosco de prueba', 'Entrada', 'hash-de-prueba')
  returning id
`);

const { rows: [marca] } = await bd.query(`
  insert into marcas (id, empleado_id, dispositivo_id, tipo,
                      hora_dispositivo, hora_estimada, monotonico_ms, arranque_id,
                      foto_hash, foto_estado)
  values (gen_random_uuid(), $1, $2, 'entrada',
          now(), now(), 12345, gen_random_uuid(),
          repeat('a', 64), 'con_foto')
  returning id
`, [empleado.id, dispositivo.id]);
comprobar('se puede insertar una marca', !!marca.id);


// ============================================================================
//  1. LA INMUTABILIDAD DE LAS MARCAS
// ============================================================================
//  Es la regla mas importante de todo el esquema. Si esto falla, el registro
//  de asistencia deja de ser evidencia.
console.log('\n--- inmutabilidad de las marcas ---');

await debeFallar(
  'DELETE de una marca es rechazado',
  `delete from marcas where id = '${marca.id}'`,
  'no se borran',
);

await debeFallar(
  'cambiar el TIPO de una marca es rechazado',
  `update marcas set tipo = 'salida' where id = '${marca.id}'`,
  'no se editan',
);

await debeFallar(
  'cambiar la HORA de una marca es rechazado',
  `update marcas set hora_estimada = now() - interval '3 hours' where id = '${marca.id}'`,
  'no se editan',
);

// El hash es la huella de la evidencia: si se pudiera cambiar, una foto
// sustituida pasaria la verificacion.
await debeFallar(
  'cambiar el HASH de la foto es rechazado',
  `update marcas set foto_hash = repeat('b', 64) where id = '${marca.id}'`,
  'no se editan',
);

// La unica excepcion: el estado de la foto, que cambia con el tiempo.
await bd.query(
  `update marcas set foto_estado = 'eliminada_por_antiguedad' where id = '${marca.id}'`,
);
const { rows: [tras] } = await bd.query(
  `select foto_estado from marcas where id = '${marca.id}'`,
);
comprobar('cambiar foto_estado SI se permite (la unica excepcion)',
  tras.foto_estado === 'eliminada_por_antiguedad');


// ============================================================================
//  2. RESTRICCIONES: los datos imposibles no entran
// ============================================================================
console.log('\n--- restricciones ---');

await debeFallar(
  'una bandera inventada es rechazada',
  `update marcas set banderas = array['bandera_falsa'] where id = '${marca.id}'`,
);

await debeFallar(
  'un foto_estado inventado es rechazado',
  `insert into marcas (id, empleado_id, tipo, hora_dispositivo, hora_estimada,
                       monotonico_ms, arranque_id, foto_estado)
   values (gen_random_uuid(), '${empleado.id}', 'entrada', now(), now(), 1,
           gen_random_uuid(), 'inventado')`,
);

await debeFallar(
  'un PIN sin hashear es rechazado por el CHECK',
  `insert into empleados (usuario, nombre, apellido_paterno, pin_hash)
   values ('xmalo', 'X', 'Malo', '1234')`,
  'pin_hash',
);

await debeFallar(
  'un usuario con mayusculas es rechazado',
  `insert into empleados (usuario, nombre, apellido_paterno, pin_hash)
   values ('XMayus', 'X', 'Mayus', '$2a$10$abcdefghijklmnopqrstuv')`,
);

await debeFallar(
  'un turno donde la falta ocurre ANTES que la tolerancia es rechazado',
  `insert into turnos (nombre, hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta)
   values ('Imposible', '06:00', '14:00', 30, 10)`,
);

await debeFallar(
  'un dispositivo activo con fecha de revocacion es rechazado',
  `insert into dispositivos (nombre, token_hash, activo, revocado_en)
   values ('Incoherente', 'otro-hash', true, now())`,
);

await debeFallar(
  'una correccion con motivo de menos de 20 caracteres es rechazada',
  `insert into correcciones (marca_id, empleado_id, accion, motivo, admin_id)
   values ('${marca.id}', '${empleado.id}', 'anular', 'error', gen_random_uuid())`,
);


// ============================================================================
//  3. ASIGNACIONES DE TURNO QUE SE ENCIMAN
// ============================================================================
//  Un empleado con dos turnos el mismo dia no hace fallar nada: hace que el
//  calculo de jornadas de la fase 3 de un numero equivocado. Por eso se
//  prohibe en la base y no en la aplicacion.
console.log('\n--- asignaciones de turno ---');

const { rows: [turno] } = await bd.query(
  `select id from turnos where nombre = 'Matutino'`,
);

await bd.query(`
  insert into asignaciones_turno (empleado_id, turno_id, vigente_desde, vigente_hasta)
  values ('${empleado.id}', '${turno.id}', '2026-01-01', '2026-06-30')
`);
comprobar('se puede asignar un turno con vigencia', true);

await debeFallar(
  'dos turnos encimados para el mismo empleado es rechazado',
  `insert into asignaciones_turno (empleado_id, turno_id, vigente_desde, vigente_hasta)
   values ('${empleado.id}', '${turno.id}', '2026-05-01', '2026-12-31')`,
);

// Pegados pero sin encimarse: el rango es '[)', asi que el 30-06 no choca.
await bd.query(`
  insert into asignaciones_turno (empleado_id, turno_id, vigente_desde)
  values ('${empleado.id}', '${turno.id}', '2026-06-30')
`);
comprobar('dos turnos consecutivos (sin encimarse) SI se permiten', true);


// ============================================================================
//  4. LA COLUMNA GENERADA DEL TURNO NOCTURNO
// ============================================================================
//  El turno que cruza medianoche es obligatorio desde la v1 (ARQUITECTURA.md 1.1).
console.log('\n--- turno que cruza medianoche ---');

const { rows: turnos } = await bd.query(
  `select nombre, cruza_medianoche from turnos order by nombre`,
);
const nocturno = turnos.find((t) => t.nombre === 'Nocturno');
const matutino = turnos.find((t) => t.nombre === 'Matutino');

comprobar('el turno 22:00-06:00 se marca como que cruza medianoche',
  nocturno?.cruza_medianoche === true);
comprobar('el turno 06:00-14:00 NO cruza medianoche',
  matutino?.cruza_medianoche === false);

await debeFallar(
  'cruza_medianoche no se puede escribir a mano (es generada)',
  `update turnos set cruza_medianoche = false where nombre = 'Nocturno'`,
);


// ============================================================================
//  5. TIEMPO Y ZONA HORARIA
// ============================================================================
console.log('\n--- tiempo ---');

const { rows: [zona] } = await bd.query('select zona_horaria() as z');
comprobar('la zona horaria configurada es America/Matamoros',
  zona.z === 'America/Matamoros', zona.z);

/*
  LA PRUEBA QUE IMPORTA. Las 22:30 del 21 de septiembre en Nuevo Laredo son las
  03:30 UTC del 22. Si la fecha laboral se sacara de UTC, esa salida apareceria
  un dia despues de su entrada y la jornada quedaria partida en dos.
*/
const { rows: [f] } = await bd.query(`
  select fecha_laboral('2026-09-22T03:30:00Z'::timestamptz) as dia
`);
comprobar('una marca de las 22:30 locales pertenece al dia ANTERIOR en UTC',
  f.dia.toISOString().slice(0, 10) === '2026-09-21',
  f.dia.toISOString().slice(0, 10));

/*
  OJO CON ESTA PRUEBA: se pide el resultado YA CONVERTIDO A TEXTO.

  `hora_local()` devuelve un `timestamp` SIN zona — literalmente "lo que marcaba
  el reloj de la pared". Si se dejara que el driver de Node lo convirtiera a un
  objeto Date, le pegaria encima la zona horaria de ESTA computadora, y la
  prueba mediria el reloj de quien la corre en vez de la funcion.

  La primera version fallaba justo por eso: la funcion devolvia 22:30 correcto,
  el driver lo convirtio a 03:30Z, y la prueba acuso a la funcion. Cuando algo
  de zonas horarias falla, sospecha primero de la capa que convierte.
*/
const { rows: [h] } = await bd.query(`
  select to_char(hora_local('2026-09-22T03:30:00Z'::timestamptz), 'YYYY-MM-DD HH24:MI') as hl
`);
comprobar('hora_local convierte 03:30 UTC en 22:30 locales',
  h.hl === '2026-09-21 22:30', h.hl);


// ============================================================================
//  6. PINES
// ============================================================================
console.log('\n--- PIN ---');

const { rows: [v1] } = await bd.query(
  `select verificar_pin('pprueba', '1234') as id`,
);
comprobar('verificar_pin acepta el PIN correcto', v1.id === empleado.id);

const { rows: [v2] } = await bd.query(
  `select verificar_pin('pprueba', '9999') as id`,
);
comprobar('verificar_pin rechaza el PIN incorrecto', v2.id === null);

/*
  `establecer_pin` no se puede probar desde aqui todavia, y el motivo es una
  buena senal: comprueba PRIMERO el permiso y despues el formato del PIN.

  Esta conexion corre como `postgres`, que no tiene sesion de Supabase, asi que
  `auth.uid()` es NULL y la funcion se niega antes de mirar el PIN. Ese orden es
  el correcto —autorizar antes de validar la entrada— asi que la prueba de
  formato se hace mas abajo, ya con un administrador de verdad.
*/


// ============================================================================
//  7. COMO ADMINISTRADOR
// ============================================================================
//  Hasta aqui todo corrio como `postgres`, que se salta la RLS y no es nadie.
//  Ahora se crea un administrador real y se entra como el, que es exactamente
//  como entra el panel.
console.log('\n--- como administrador del panel ---');

const ID_ADMIN = '11111111-1111-1111-1111-111111111111';

// Un usuario de autenticacion minimo. En produccion lo crea Supabase Auth
// cuando alguien se registra; aqui se inserta a mano para poder probar.
await bd.query(`
  insert into auth.users (id, instance_id, aud, role, email)
  values ('${ID_ADMIN}', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'admin@prueba.local')
`);

await bd.query(`
  insert into administradores (user_id, nombre, rol)
  values ('${ID_ADMIN}', 'Admin de Prueba', 'admin')
`);

async function entrarComo(uuid) {
  await bd.query('reset role');
  await bd.query(
    `select set_config('request.jwt.claims', '{"sub":"${uuid}"}', true)`,
  );
  await bd.query('set local role authenticated');
}

await entrarComo(ID_ADMIN);

const { rows: [esAdmin] } = await bd.query(
  'select es_administrador() as e, puede_administrar() as p',
);
comprobar('el administrador SI es administrador', esAdmin.e === true);
comprobar('y con rol admin SI puede administrar', esAdmin.p === true);

const { rows: marcasAdmin } = await bd.query('select * from marcas');
comprobar('el administrador SI ve las marcas', marcasAdmin.length > 0,
  `${marcasAdmin.length} filas`);

const { rows: cfgAdmin } = await bd.query('select * from configuracion');
comprobar('el administrador SI ve la configuracion', cfgAdmin.length > 0,
  `${cfgAdmin.length} claves`);

// AHORA si se puede probar el formato del PIN: ya paso el permiso.
await debeFallar(
  'establecer_pin rechaza un PIN que no son 4 digitos',
  `select establecer_pin('${empleado.id}', '12')`,
  '4 digitos',
);

await bd.query(`select establecer_pin('${empleado.id}', '5678', true)`);
await bd.query('reset role');
const { rows: [nuevoPin] } = await bd.query(
  `select verificar_pin('pprueba', '5678') as id`,
);
comprobar('un administrador SI puede cambiar un PIN', nuevoPin.id === empleado.id);

/*
  Y el cambio de PIN queda en la bitacora SIN el hash.

  ⚠ OJO CON EL ORDEN: se ordena por `id`, no por `creado_en`.

  En PostgreSQL, `now()` devuelve la hora de INICIO DE LA TRANSACCION, no la
  del instante en que se llama. Como toda esta prueba corre dentro de una sola
  transaccion, TODAS las filas de bitacora tienen exactamente el mismo
  `creado_en`, y `order by creado_en desc limit 1` devuelve una cualquiera.

  Esta prueba fallaba por eso y acusaba a la bitacora de no guardar el valor
  nuevo. La bitacora estaba bien; la consulta era ambigua.

  El `id` es `generated always as identity`: siempre crece, aunque el reloj no
  se mueva. Para "la ultima fila" es lo correcto.

  (En produccion no se nota, porque cada cambio es su propia transaccion. Es el
  tipo de detalle que solo aparece al escribir pruebas.)
*/
const { rows: [bitPin] } = await bd.query(`
  select datos_despues from bitacora_auditoria
   where tabla = 'empleados' and registro_id = '${empleado.id}'
   order by id desc limit 1
`);
// Desde la 0028, un hash que CAMBIO se anota "[nuevo]" (sigue sin guardarse el hash).
comprobar('el reseteo de PIN queda en la bitacora, con el hash oculto',
  bitPin?.datos_despues?.pin_hash === '[nuevo]' &&
  bitPin?.datos_despues?.pin_temporal === true);

// El codigo de enrolamiento no lo ve NI SIQUIERA un administrador.
await entrarComo(ID_ADMIN);
const { rows: codigosAdmin } = await bd.query('select * from codigos_enrolamiento');
comprobar('ni el administrador ve los codigos de enrolamiento',
  codigosAdmin.length === 0);

// Y las marcas siguen siendo inmutables tambien para el.
await debeFallar(
  'ni el administrador puede borrar una marca',
  `delete from marcas where id = '${marca.id}'`,
);

await bd.query('reset role');


// ============================================================================
//  8. LA BITACORA DE AUDITORIA SE LLENA SOLA
// ============================================================================
console.log('\n--- bitacora de auditoria ---');

await bd.query(`update empleados set nombre = 'Persona Cambiada' where id = '${empleado.id}'`);

// Se busca LA fila de este cambio concreto, no "la ultima": ver la nota sobre
// `now()` y las transacciones, mas abajo.
const { rows: [bit] } = await bd.query(`
  select accion, datos_antes, datos_despues
    from bitacora_auditoria
   where tabla = 'empleados'
     and registro_id = '${empleado.id}'
     and accion = 'UPDATE'
     and datos_despues ->> 'nombre' = 'Persona Cambiada'
   order by id desc limit 1
`);

comprobar('un UPDATE de empleado queda en la bitacora', !!bit);
comprobar('la bitacora guarda el valor anterior',
  bit?.datos_antes?.nombre === 'Persona');
comprobar('la bitacora guarda el valor nuevo',
  bit?.datos_despues?.nombre === 'Persona Cambiada');

/*
  ⚠ LA PRUEBA MAS IMPORTANTE DE ESTA SECCION.

  Sin esto, cada reseteo de PIN dejaria el hash anterior guardado para siempre
  en la tabla que MENOS se borra del sistema. Tendriamos un historial completo
  de todos los hashes de PIN de cada empleado, acumulandose durante anos.
*/
comprobar('el hash del PIN NO aparece en la bitacora',
  bit?.datos_antes?.pin_hash === '[oculto]' && bit?.datos_despues?.pin_hash === '[oculto]');


// ============================================================================
//  9. RLS: NEGAR POR DEFECTO
// ============================================================================
//  El caso contrario al anterior: alguien con sesion valida de Supabase que
//  NO esta dado de alta como administrador. Registrarse no da acceso a nada.
console.log('\n--- RLS (como usuario del panel, sin ser admin) ---');

// Un usuario autenticado que NO esta en la tabla administradores.
await entrarComo('00000000-0000-0000-0000-000000000001');

const { rows: [admin] } = await bd.query('select es_administrador() as e');
comprobar('quien no esta en administradores NO es administrador', admin.e === false);

const { rows: sinPermiso } = await bd.query('select * from marcas');
comprobar('sin ser admin no se ve ninguna marca', sinPermiso.length === 0,
  `${sinPermiso.length} filas`);

const { rows: empSinPermiso } = await bd.query('select id, nombre from empleados');
comprobar('sin ser admin no se ve ningun empleado', empSinPermiso.length === 0,
  `${empSinPermiso.length} filas`);

const { rows: cfgSinPermiso } = await bd.query('select * from configuracion');
comprobar('sin ser admin no se ve la configuracion', cfgSinPermiso.length === 0,
  `${cfgSinPermiso.length} filas`);

// Los codigos de enrolamiento no los ve NADIE por el panel, ni siquiera un
// admin: generarlos y canjearlos es trabajo de Edge Functions.
const { rows: codigos } = await bd.query('select * from codigos_enrolamiento');
comprobar('los codigos de enrolamiento no se ven desde el panel',
  codigos.length === 0);

await debeFallar(
  'sin ser admin no se puede insertar un empleado',
  `insert into empleados (usuario, nombre, apellido_paterno, pin_hash)
   values ('zcolado', 'Z', 'Colado', '$2a$10$abcdefghijklmnopqrstuv')`,
);

await debeFallar(
  'establecer_pin rechaza a quien no es administrador',
  `select establecer_pin('${empleado.id}', '5678')`,
  'administrador',
);

await bd.query('reset role');

// ============================================================================
//  0011 · Eventos de fotos
// ============================================================================
// El kiosco ya los genera. Si la nube no los conociera, el sincronizador los
// reintentaria para siempre y la bandeja de salida no se vaciaria nunca.
console.log('\n--- eventos de fotos (0011) ---');

for (const tipo of [
  'llave_fotos_creada',
  'llave_fotos_reemplazada',
  'recuperacion_fotos_definida',
  'cifrado_no_disponible',
  'fotos_depuradas',
  'fotos_heredadas_cifradas',
  'modo_admin_abierto', // 0012
  'modo_admin_intento_fallido', // 0012
  'modo_admin_bloqueado', // 0012
  'exportacion_usb', // 0013
  'camara_desconectada', // los de la 0006 siguen valiendo
]) {
  await bd.query('savepoint evento_de_foto');
  try {
    await bd.query(
      `insert into eventos_dispositivo (id, tipo, ocurrido_en) values (gen_random_uuid(), $1, now())`,
      [tipo],
    );
    comprobar(`se acepta el evento ${tipo}`, true);
  } catch (e) {
    comprobar(`se acepta el evento ${tipo}`, false, e.message);
  }
  await bd.query('release savepoint evento_de_foto');
}

// 0012: "Conservar" queda en la bitacora de fotos, igual que "ver".
{
  const marcaDePrueba = (await bd.query('select id from marcas limit 1')).rows[0];
  for (const accion of ['ver', 'exportar', 'conservar', 'quitar_conservar']) {
    await bd.query('savepoint acceso_foto');
    try {
      await bd.query(
        `insert into accesos_foto (id, marca_id, admin_id, accion, consultado_en)
         values (gen_random_uuid(), $1, gen_random_uuid(), $2, now())`,
        [marcaDePrueba.id, accion],
      );
      comprobar(`accesos_foto acepta la accion ${accion}`, true);
    } catch (e) {
      comprobar(`accesos_foto acepta la accion ${accion}`, false, e.message);
    }
    await bd.query('release savepoint acceso_foto');
  }

  await debeFallar(
    'accesos_foto rechaza una accion inventada',
    `insert into accesos_foto (id, marca_id, admin_id, accion, consultado_en)
     values (gen_random_uuid(), '${marcaDePrueba.id}', gen_random_uuid(), 'borrar', now())`,
    'accesos_foto_accion_check',
  );
}

await debeFallar(
  'un tipo de evento inventado se sigue rechazando',
  `insert into eventos_dispositivo (id, tipo, ocurrido_en) values (gen_random_uuid(), 'foto_subida', now())`,
  'eventos_dispositivo_tipo_check',
);


// ============================================================================
//  0015 · Lo que hace el panel: roles, motivo y bitacora
// ============================================================================
console.log('\n--- acciones del panel (0015) ---');

await bd.query('reset role');
// La seccion anterior dejo puesta la "sesion" de un usuario inexistente; sin
// limpiarla, la bitacora lo anotaria como autor de lo que sigue.
await bd.query(`select set_config('request.jwt.claims', '', true)`);
const ID_SUPERVISOR = '22222222-2222-2222-2222-222222222222';
await bd.query(`
  insert into auth.users (id, instance_id, aud, role, email)
  values ('${ID_SUPERVISOR}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'super@prueba.local')
`);
await bd.query(`insert into administradores (user_id, nombre, rol) values ('${ID_SUPERVISOR}', 'Supervisor de Prueba', 'supervisor')`);

await entrarComo(ID_ADMIN);
const { rows: [alta] } = await bd.query(
  `select * from alta_empleado('Nueva', 'Persona', 'Prueba', '9001', 'npersona', 'Alta de prueba del panel')`,
);
comprobar('alta_empleado devuelve el id y un PIN de 4 digitos', !!alta.id && /^[0-9]{4}$/.test(alta.pin), alta.pin);
comprobar('el PIN no es de los faciles de adivinar', !['0000', '1111', '1234', '4321'].includes(alta.pin));
{
  // El hash ya no lo puede leer el panel (0024): se revisa como el dueno de la base.
  await bd.query('reset role');
  const { rows: [ok] } = await bd.query(
    `select pin_hash = extensions.crypt($1, pin_hash) as cuadra from empleados where id = $2`, [alta.pin, alta.id]);
  await entrarComo(ID_ADMIN);
  comprobar('y ese PIN es el que quedo guardado (como hash)', ok.cuadra === true);
}

// 0024: RLS dice que renglones, no que columnas. Con el hash de un PIN de 4
// digitos, cualquiera del panel sacaria el PIN de todos en segundos.
await debeFallar('el panel NO puede leer el hash de los PIN (ni un administrador)',
  `select pin_hash from empleados limit 1`, 'permission denied');
await debeFallar('ni la contrasena del modo administrador del kiosco',
  `select contrasena_kiosco_hash from administradores limit 1`, 'permission denied');
await debeFallar('ni pidiendo todas las columnas con *',
  `select * from empleados limit 1`, 'permission denied');
comprobar('pero si todo lo que el panel usa',
  (await bd.query(`select id, usuario, nombre, pin_temporal, activo, anonimizado_en from empleados where id = $1`, [alta.id])).rows.length === 1);

await debeFallar('sin motivo no hay alta',
  `select * from alta_empleado('Otra', 'Persona', '', '', 'opersona', '')`, 'motivo');
await debeFallar('un usuario repetido se rechaza con mensaje claro',
  `select * from alta_empleado('Otra', 'Persona', '', '', 'npersona', 'Alta repetida de prueba')`, 'Ya hay alguien');

const pinNuevo = (await bd.query(`select restablecer_pin($1, 'Olvido su PIN en la prueba') as pin`, [alta.id])).rows[0].pin;
{
  await bd.query('reset role');
  const { rows: [e] } = await bd.query(
    `select pin_temporal, pin_hash = extensions.crypt($1, pin_hash) as cuadra from empleados where id = $2`, [pinNuevo, alta.id]);
  await entrarComo(ID_ADMIN);
  comprobar('restablecer_pin da un PIN nuevo que funciona, marcado como temporal', e.cuadra && e.pin_temporal);
}

await bd.query(`select cambiar_estado_empleado($1, false, 'Baja de prueba del panel')`, [alta.id]);
comprobar('la baja desactiva, no borra',
  (await bd.query('select activo from empleados where id = $1', [alta.id])).rows[0]?.activo === false);

await debeFallar('una tolerancia fuera de rango se rechaza',
  `select actualizar_configuracion('tolerancia_retardo_minutos', '999', 'Prueba de rango absurdo')`, 'entre');
await debeFallar('texto donde va un numero se rechaza',
  `select actualizar_configuracion('tolerancia_retardo_minutos', '"diez"', 'Prueba de tipo equivocado')`, 'número');
await debeFallar('una zona horaria inventada se rechaza',
  `select actualizar_configuracion('zona_horaria', '"America/Narnia"', 'Prueba de zona inventada')`, 'zona');
await bd.query(`select actualizar_configuracion('tolerancia_retardo_minutos', '15', 'El jefe dio 15 minutos')`);
comprobar('un valor valido se guarda',
  (await bd.query(`select valor from configuracion where clave = 'tolerancia_retardo_minutos'`)).rows[0].valor === 15);

await bd.query(`select revocar_dispositivo($1, 'Se cambio la computadora del kiosco')`, [dispositivo.id]);

// El supervisor: registra a mano, pero no administra.
await entrarComo(ID_SUPERVISOR);
const idManual = (await bd.query(
  `select registrar_marca_manual($1, 'entrada', now() - interval '2 hours', 'Se fue la luz en la manana') as id`,
  [empleado.id])).rows[0].id;
{
  const { rows: [m] } = await bd.query('select origen, banderas, dispositivo_id from marcas where id = $1', [idManual]);
  comprobar('un supervisor puede registrar a mano: origen manual, bandera manual, sin kiosco',
    m.origen === 'manual' && m.banderas.includes('manual') && m.dispositivo_id === null);
}
await debeFallar('una marca manual en el futuro se rechaza',
  `select registrar_marca_manual('${empleado.id}', 'salida', now() + interval '1 day', 'Prueba de hora futura')`, 'futuro');
await debeFallar('un supervisor NO puede dar de alta empleados',
  `select * from alta_empleado('X', 'Y', '', '', 'xysuper', 'Intento del supervisor')`, 'administrador');
await debeFallar('un supervisor NO puede cambiar la configuracion',
  `select actualizar_configuracion('tolerancia_retardo_minutos', '20', 'Intento del supervisor')`, 'administrador');

// La bitacora, vista como postgres.
await bd.query('reset role');
{
  const { rows: [b] } = await bd.query(
    `select motivo, actor, datos_despues ->> 'pin_hash' as pin from bitacora_auditoria
      where tabla = 'empleados' and registro_id = $1 and accion = 'INSERT'`, [alta.id]);
  comprobar('la bitacora guarda el MOTIVO y quien lo hizo', b?.motivo === 'Alta de prueba del panel' && b?.actor === ID_ADMIN);
  comprobar('y nunca el hash del PIN', b?.pin === '[oculto]');

  const { rows: [manual] } = await bd.query(
    `select motivo, actor from bitacora_auditoria where tabla = 'marcas' and registro_id = $1`, [idManual]);
  comprobar('la marca manual queda en la bitacora con su motivo',
    manual?.motivo === 'Se fue la luz en la manana' && manual?.actor === ID_SUPERVISOR);

  const { rows: [baja] } = await bd.query(
    `select motivo from bitacora_auditoria where tabla = 'dispositivos' and registro_id = $1 and accion = 'UPDATE'
      order by id desc limit 1`, [dispositivo.id]);
  comprobar('revocar un kiosco queda con su motivo', baja?.motivo === 'Se cambio la computadora del kiosco');

  const antes = (await bd.query(`select count(*)::int as n from bitacora_auditoria where tabla = 'dispositivos'`)).rows[0].n;
  await bd.query(`update dispositivos set ultima_conexion = now(), pendientes = 3, camara_ok = true where id = $1`, [dispositivo.id]);
  const despues = (await bd.query(`select count(*)::int as n from bitacora_auditoria where tabla = 'dispositivos'`)).rows[0].n;
  comprobar('el LATIDO de un kiosco no llena la bitacora', despues === antes, `${antes} -> ${despues}`);

  await bd.query(`update administradores set usuario_kiosco = 'supercito', contrasena_kiosco_hash = '$2a$10$abcdefghijklmnopqrstuv' where user_id = $1`, [ID_SUPERVISOR]);
  const { rows: [cred] } = await bd.query(
    `select datos_despues ->> 'contrasena_kiosco_hash' as h from bitacora_auditoria
      where tabla = 'administradores' and accion = 'UPDATE' order by id desc limit 1`);
  comprobar('la bitacora tampoco guarda el hash de la contrasena del kiosco', cred?.h === '[nuevo]', cred?.h);
}

// ============================================================================
//  0016 · Jornadas, retardos, faltas y reportes
// ============================================================================
//  Las horas de las marcas estan escritas A MANO en UTC, no calculadas: si el
//  calculo del sistema tuviera un error, una prueba que usa el mismo calculo
//  para armar sus datos lo repetiria y pasaria igual.
//
//  Nuevo Laredo: UTC-5 en horario de verano (hasta el 1-nov-2026, desde el
//  8-mar-2026) y UTC-6 en invierno.
console.log('\n--- jornadas y reportes (0016) ---');

await bd.query('reset role');
await bd.query(`select set_config('request.jwt.claims', '', true)`);

const crearEmpleado = async (usuario) => (await bd.query(
  `insert into empleados (usuario, nombre, apellido_paterno, pin_hash)
   values ($1, 'Prueba', 'Jornadas', extensions.crypt('1234', extensions.gen_salt('bf', 4))) returning id`,
  [usuario])).rows[0].id;
const velador = await crearEmpleado('jvelador');
const empMatutino = await crearEmpleado('jmatutino');
const sabatino = await crearEmpleado('jsabatino');

const { rows: [kioscoB] } = await bd.query(
  `insert into dispositivos (nombre, token_hash) values ('Kiosco B de prueba', 'hash-b') returning id`);
const marcar = async (empleadoId, tipo, horaUtc, kiosco = dispositivo.id) => (await bd.query(
  `insert into marcas (id, empleado_id, dispositivo_id, tipo, hora_dispositivo, hora_estimada, monotonico_ms, arranque_id)
   values (gen_random_uuid(), $1, $2, $3, $4, $4, 0, gen_random_uuid()) returning id`,
  [empleadoId, kiosco, tipo, horaUtc])).rows[0].id;

const idTurno = async (nombre) => (await bd.query('select id from turnos where nombre = $1', [nombre])).rows[0].id;
await entrarComo(ID_ADMIN);
await bd.query(`select asignar_horario($1, $2, '2026-01-01', '[{"dia":0},{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5},{"dia":6}]', 'Velador de prueba')`,
  [velador, await idTurno('Nocturno')]);
await bd.query(`select asignar_horario($1, $2, '2026-09-01', '[{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5}]', 'Matutino de prueba')`,
  [empMatutino, await idTurno('Matutino')]);
await bd.query(`select asignar_horario($1, $2, '2026-09-01',
  '[{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5},{"dia":6,"inicio":"07:00","fin":"13:00"}]', 'Sabados entra a las 7')`,
  [sabatino, await idTurno('Matutino')]);
await bd.query(`select guardar_dia_festivo('2026-09-16', 'Independencia')`);
await bd.query(`select registrar_incidencia($1, 'vacaciones', '2026-09-10', '2026-09-10', 'Vacaciones de prueba')`, [empMatutino]);

await bd.query('reset role');
await bd.query(`select set_config('request.jwt.claims', '', true)`);

// --- Velador: las dos noches de cambio de horario ---
await marcar(velador, 'entrada', '2026-11-01T03:00:00Z'); // 22:00 CDT del 31-oct
await marcar(velador, 'salida', '2026-11-01T12:00:00Z');  // 06:00 CST del 1-nov (se repitio la 1:00)
await marcar(velador, 'entrada', '2026-03-08T04:00:00Z'); // 22:00 CST del 7-mar
await marcar(velador, 'salida', '2026-03-08T11:00:00Z');  // 06:00 CDT del 8-mar (se salto la 2:00)

// --- Matutino (06:00-14:00, L-V) ---
await marcar(empMatutino, 'entrada', '2026-09-14T11:05:00Z');             // lun 06:05, kiosco A
await marcar(empMatutino, 'salida', '2026-09-14T19:00:00Z', kioscoB.id);  // 14:00, kiosco B
const entradaMartes = await marcar(empMatutino, 'entrada', '2026-09-15T11:20:00Z'); // mar 06:20: retardo
await marcar(empMatutino, 'salida', '2026-09-15T19:00:00Z');
// mie 16: festivo. jue 17: no vino.
const entradaViernes = await marcar(empMatutino, 'entrada', '2026-09-18T11:45:00Z'); // vie 06:45: tarde de mas
await marcar(empMatutino, 'salida', '2026-09-18T19:00:00Z');
await marcar(empMatutino, 'entrada', '2026-09-20T15:00:00Z'); // dom 10:00: no tenia turno
await marcar(empMatutino, 'salida', '2026-09-20T17:00:00Z');
await marcar(empMatutino, 'entrada', '2026-09-21T11:00:00Z'); // lun 06:00
await marcar(empMatutino, 'entrada', '2026-09-21T11:01:00Z'); // ...y otra vez "por si no quedo"
await marcar(empMatutino, 'salida', '2026-09-21T19:00:00Z');
await marcar(empMatutino, 'entrada', '2026-09-22T11:00:00Z'); // mar 22: nunca marco salida
await marcar(empMatutino, 'entrada', '2026-09-11T11:00:00Z'); // vie 11: 06:00...
const salidaComoEntrada = await marcar(empMatutino, 'entrada', '2026-09-11T19:00:00Z'); // ...y la salida quedo como ENTRADA

await marcar(empMatutino, 'entrada', '2026-09-08T11:50:00Z'); // mar 8: 06:50, 50 min tarde...
await marcar(empMatutino, 'salida', '2026-09-08T19:40:00Z');  // ...y se quedo hasta las 14:40

// --- Sabatino: el sabado entra a las 7 ---
await marcar(sabatino, 'entrada', '2026-09-19T12:05:00Z'); // sab 07:05
await marcar(sabatino, 'salida', '2026-09-19T18:00:00Z');  // 13:00
await marcar(sabatino, 'salida', '2026-09-14T19:00:00Z');  // lun: salida sin entrada

await entrarComo(ID_ADMIN);
const reporte = async (empleadoId, desde, hasta) =>
  (await bd.query(`select * from reporte_asistencia($1, $2, $3) order by fecha, programado_inicio nulls last`,
    [desde, hasta, empleadoId])).rows;
const dia = (filas, fecha, cond = () => true) =>
  filas.find((f) => f.fecha.toISOString().slice(0, 10) === fecha && cond(f));

{
  const noche = await reporte(velador, '2026-10-31', '2026-10-31');
  comprobar('turno nocturno la noche en que se REPITE una hora: 9 horas reales',
    Number(noche[0]?.horas) === 9 && noche[0]?.estado === 'a_tiempo', JSON.stringify(noche[0]?.horas));
  comprobar('y su fin programado son las 06:00 del dia siguiente (12:00 UTC)',
    noche[0]?.programado_fin?.toISOString() === '2026-11-01T12:00:00.000Z', noche[0]?.programado_fin?.toISOString());

  const marzo = await reporte(velador, '2026-03-07', '2026-03-07');
  comprobar('turno nocturno la noche en que se PIERDE una hora: 7 horas reales',
    Number(marzo[0]?.horas) === 7 && marzo[0]?.estado === 'a_tiempo', JSON.stringify(marzo[0]?.horas));
}

{
  const semana = await reporte(empMatutino, '2026-09-10', '2026-09-22');
  const lunes = dia(semana, '2026-09-14');
  comprobar('entrar por un kiosco y salir por otro: UNA jornada completa',
    lunes?.estado === 'a_tiempo' && lunes?.estado_salida === 'completa' && Number(lunes?.horas) === 7.92,
    `${lunes?.estado} ${lunes?.estado_salida} ${lunes?.horas}`);
  comprobar('06:20 con 10 de tolerancia: retardo de 20 minutos',
    dia(semana, '2026-09-15')?.estado === 'retardo' && dia(semana, '2026-09-15')?.minutos_tarde === 20);
  comprobar('dia festivo: no cuenta como falta', dia(semana, '2026-09-16')?.estado === 'festivo');
  comprobar('dia con turno y sin ningun registro: falta',
    dia(semana, '2026-09-17')?.estado === 'falta' && dia(semana, '2026-09-17')?.entrada === null);
  comprobar('llego 45 min tarde: SI vino, asi que es "retardo mayor" y no falta (0019)',
    dia(semana, '2026-09-18')?.estado === 'retardo_mayor' && dia(semana, '2026-09-18')?.minutos_tarde === 45);
  comprobar('y como salio a su hora, no repuso nada', dia(semana, '2026-09-18')?.minutos_repuestos === null);
  comprobar('un retardo de 20 min sin quedarse mas: tampoco repuso', dia(semana, '2026-09-15')?.minutos_repuestos === null);
  comprobar('vacaciones: incidencia, no falta', dia(semana, '2026-09-10')?.estado === 'incidencia'
    && dia(semana, '2026-09-10')?.incidencia === 'vacaciones');
  const domingo = dia(semana, '2026-09-20');
  comprobar('trabajo un domingo sin turno: aparece como "sin turno" con sus horas',
    domingo?.estado === 'sin_turno' && Number(domingo?.horas) === 2);
  const repetido = dia(semana, '2026-09-21');
  comprobar('dos toques de entrada seguidos: UNA jornada desde el primero',
    repetido?.estado === 'a_tiempo' && repetido?.estado_salida === 'completa' && Number(repetido?.horas) === 8,
    `${repetido?.estado_salida} ${repetido?.horas}`);
  comprobar('entro y nunca marco salida: "salida no registrada", sin horas inventadas',
    dia(semana, '2026-09-22')?.estado_salida === 'salida_no_registrada' && dia(semana, '2026-09-22')?.horas === null);
  comprobar('la salida que quedo como entrada: se ve como salida no registrada',
    dia(semana, '2026-09-11')?.estado_salida === 'salida_no_registrada');
}

// --- 0019: repuso el tiempo, regla vieja opcional, "todavia no llega" ---
{
  const martes8 = dia(await reporte(empMatutino, '2026-09-08', '2026-09-08'), '2026-09-08');
  comprobar('llego 50 min tarde y se quedo 40 min mas: "repuso 40 min"',
    martes8?.estado === 'retardo_mayor' && martes8?.minutos_tarde === 50 && martes8?.minutos_repuestos === 40,
    JSON.stringify({ estado: martes8?.estado, tarde: martes8?.minutos_tarde, repuso: martes8?.minutos_repuestos }));
}
await entrarComo(ID_ADMIN);
await bd.query(`select actualizar_configuracion('llegar_muy_tarde_es_falta', '1', 'Probar la regla vieja')`);
comprobar('con la regla vieja encendida, llegar 45 min tarde vuelve a ser falta',
  dia(await reporte(empMatutino, '2026-09-18', '2026-09-18'), '2026-09-18')?.estado === 'falta');
await bd.query(`select actualizar_configuracion('llegar_muy_tarde_es_falta', '0', 'Regresar a la regla nueva')`);
{
  // Un turno que empezo hace una hora y termina en 3: quien no ha llegado
  // todavia puede llegar tarde: "pendiente", no falta.
  await bd.query('reset role');
  const enCurso = await crearEmpleado('jencurso');
  const { rows: [t] } = await bd.query(`
    insert into turnos (nombre, hora_inicio, hora_fin)
    values ('Turno en curso', ((now() - interval '1 hour') at time zone 'America/Matamoros')::time(0),
                              ((now() + interval '3 hours') at time zone 'America/Matamoros')::time(0))
    returning id`);
  await bd.query(`insert into turno_versiones (turno_id, vigente_desde, hora_inicio, hora_fin)
                  select id, '2000-01-01', hora_inicio, hora_fin from turnos where id = $1`, [t.id]);
  await entrarComo(ID_ADMIN);
  await bd.query(`select asignar_horario($1, $2, '2026-01-01', '[{"dia":0},{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5},{"dia":6}]', 'Turno en curso de prueba')`,
    [enCurso, t.id]);
  // El dia en que EMPEZO el turno (hace una hora): corriendo la prueba a las
  // 00:30, el turno empezo "ayer" a las 23:30 y su fecha laboral es ayer.
  const hoy = (await bd.query(`select ((now() - interval '1 hour') at time zone 'America/Matamoros')::date::text as d`)).rows[0].d;
  const fila = (await reporte(enCurso, hoy, hoy))[0];
  comprobar('su turno empezo hace una hora y no ha llegado: "todavia no llega" (pendiente), no falta',
    fila?.estado === 'pendiente', fila?.estado);
}

// --- 0019: cambiar el horario de un turno NO cambia el pasado ---
{
  const antes = dia(await reporte(empMatutino, '2026-09-14', '2026-09-14'), '2026-09-14');
  const matutino = await idTurno('Matutino');
  await bd.query(`select guardar_turno($1, 'Matutino', '05:00', '13:00', null, null, 'La dirección adelantó el turno', '2026-10-05')`,
    [matutino]);
  const despues = dia(await reporte(empMatutino, '2026-09-14', '2026-09-14'), '2026-09-14');
  comprobar('adelantar el Matutino a las 5:00 desde el 5 de octubre: el 14 de septiembre sigue igual (a tiempo, 06:00)',
    despues?.estado === antes?.estado && despues?.programado_inicio?.toISOString() === '2026-09-14T11:00:00.000Z',
    `${despues?.estado} ${despues?.programado_inicio?.toISOString()}`);
  const octubre = dia(await reporte(empMatutino, '2026-10-05', '2026-10-05'), '2026-10-05');
  comprobar('y desde el 5 de octubre ya se espera a las 5:00',
    octubre?.programado_inicio?.toISOString() === '2026-10-05T10:00:00.000Z', octubre?.programado_inicio?.toISOString());
  await bd.query(`select guardar_turno($1, 'Matutino', '06:00', '14:00', null, null, 'Regresar el turno a como estaba', '2026-10-05')`,
    [matutino]);
}
// Lo que sigue (correcciones) corre como administrador, igual que antes.
await entrarComo(ID_ADMIN);

// --- Correcciones: la marca original no se toca ---
await bd.query(`select corregir_marca($1, 'cambiar_tipo', 'Se equivoco de boton al salir')`, [salidaComoEntrada]);
await bd.query(`select corregir_marca($1, 'anular', 'Registro duplicado por error del kiosco')`, [entradaViernes]);
{
  const semana = await reporte(empMatutino, '2026-09-10', '2026-09-22');
  const viernes11 = dia(semana, '2026-09-11');
  comprobar('corregida a salida: jornada completa de 8 horas, marcada como corregida',
    viernes11?.estado_salida === 'completa' && Number(viernes11?.horas) === 8 && viernes11?.corregida === true);
  // Desde la 0021: como quedo su SALIDA de ese dia, si vino: "sin entrada",
  // no falta (antes de la 0021 salia como falta).
  comprobar('anulada la entrada del 18 (quedó su salida): "sin entrada", no falta',
    dia(semana, '2026-09-18')?.estado === 'sin_entrada' && dia(semana, '2026-09-18')?.entrada === null);
  const { rows: [original] } = await bd.query('select tipo from marcas where id = $1', [salidaComoEntrada]);
  comprobar('la marca original sigue intacta (tipo entrada)', original.tipo === 'entrada');
}
await debeFallar('una marca no se anula dos veces',
  `select corregir_marca('${entradaViernes}', 'anular', 'Segundo intento de anular')`, 'anulado');

// --- Cambiar la tolerancia recalcula el historico ---
await bd.query(`select actualizar_configuracion('tolerancia_retardo_minutos', '25', 'Prueba de recalculo')`);
comprobar('con 25 de tolerancia, el retardo del martes 15 ya es "a tiempo" (sin tocar la marca)',
  dia(await reporte(empMatutino, '2026-09-15', '2026-09-15'), '2026-09-15')?.estado === 'a_tiempo');
await bd.query(`select actualizar_configuracion('tolerancia_retardo_minutos', '10', 'Regresar la tolerancia')`);

// --- Horario propio por dia ---
{
  const semana = await reporte(sabatino, '2026-09-14', '2026-09-19');
  comprobar('el sabado entra a las 7 (horario propio del dia): 07:05 es a tiempo',
    dia(semana, '2026-09-19')?.estado === 'a_tiempo' && dia(semana, '2026-09-19')?.minutos_tarde === 5);
  comprobar('una salida sin entrada aparece aparte, con su estado',
    semana.some((f) => f.estado_salida === 'salida_sin_entrada'));
}

// --- 0020: incidencias que "se dan por buenas" ---
{
  await bd.query(`select registrar_incidencia($1, 'olvido_registro', '2026-09-17', '2026-09-17', 'Sí vino, el kiosco no lo registró')`, [empMatutino]);
  await bd.query(`select registrar_incidencia($1, 'retardo_justificado', '2026-09-15', '2026-09-15', 'Se ponchó la llanta, avisó')`, [empMatutino]);
  const semana = await reporte(empMatutino, '2026-09-10', '2026-09-17');
  const jueves = dia(semana, '2026-09-17');
  comprobar('"no se registró" (el kiosco no lo tomó): el día que era falta queda "justificado" con sus 8 horas',
    jueves?.estado === 'justificado' && Number(jueves?.horas_acreditadas) === 8,
    `${jueves?.estado} ${jueves?.horas_acreditadas}`);
  const martes = dia(semana, '2026-09-15');
  comprobar('retardo justificado: se ve a qué hora llegó, pero cuenta como día completo',
    martes?.estado === 'justificado' && martes?.minutos_tarde === 20 && Number(martes?.horas_acreditadas) === 8);
  comprobar('vacaciones: no es falta, pero NO suman horas',
    dia(semana, '2026-09-10')?.estado === 'incidencia' && dia(semana, '2026-09-10')?.horas_acreditadas === null);
  comprobar('un día normal: las horas acreditadas son las trabajadas',
    Number(dia(semana, '2026-09-14')?.horas_acreditadas) === Number(dia(semana, '2026-09-14')?.horas));

  const matutino = await idTurno('Matutino');
  const { rows: [g] } = await bd.query(
    `select registrar_incidencia_grupal($1, 'falla_sistema', '2026-09-21', '2026-09-21', 'Se cayó el kiosco de 6 a 8') as n`, [matutino]);
  comprobar('"se cayó el sistema" para todo el turno matutino de una vez', g.n >= 2, String(g.n));
  comprobar('y a cada uno le cuenta el día como justificado',
    dia(await reporte(sabatino, '2026-09-21', '2026-09-21'), '2026-09-21')?.estado === 'justificado');
  await debeFallar('incidencia para varios: a lo más un mes',
    `select registrar_incidencia_grupal(null, 'falla_sistema', '2026-01-01', '2026-06-01', 'Rango demasiado largo')`, 'mes');
}

// --- 0021: arreglos del analisis a fondo (cada uno se comprobo roto antes) ---
{
  const intenta = async (sql, p = []) => {
    await bd.query('savepoint intento');
    try {
      await bd.query(sql, p);
      await bd.query('release savepoint intento');
      return true;
    } catch {
      await bd.query('rollback to savepoint intento');
      return false;
    }
  };
  const hoyLocal = (await bd.query(`select (now() at time zone 'America/Matamoros')::date::text d`)).rows[0].d;
  const masDias = async (n) => (await bd.query(`select ($1::date + $2::int)::text d`, [hoyLocal, n])).rows[0].d;

  await bd.query('reset role');
  const deBaja = await crearEmpleado('jdebaja');
  const olvidadizo = await crearEmpleado('jolvidadizo');
  await entrarComo(ID_ADMIN);
  const matutino = await idTurno('Matutino');
  const lav = '[{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5}]';
  await bd.query(`select asignar_horario($1, $2, '2026-09-01', $3, 'Horario de la prueba 0021')`, [deBaja, matutino, lav]);
  await bd.query(`select asignar_horario($1, $2, '2026-09-01', $3, 'Horario de la prueba 0021')`, [olvidadizo, matutino, lav]);

  // (a) Dar de baja cierra el horario: no mas faltas despues.
  await bd.query(`select cambiar_estado_empleado($1, false, 'Renunció (prueba 0021)')`, [deBaja]);
  const trasBaja = await reporte(deBaja, await masDias(1), await masDias(10));
  comprobar('(a) dado de baja: ya no le cuentan faltas los días siguientes', trasBaja.length === 0, String(trasBaja.length));

  // (b, g) Cierre automatico vs. turno mas largo
  comprobar('(b) "salida no registrada" en 4 h con turnos de 8: se rechaza',
    !(await intenta(`select actualizar_configuracion('horas_para_cierre_automatico', '4', 'Prueba 0021 cierre corto')`)));
  comprobar('(g) un turno de 20 h con el cierre en 16: se rechaza',
    !(await intenta(`select guardar_turno(null, 'Turno larguísimo', '06:00', '02:00', null, null, 'Prueba 0021 turno largo')`)));

  // (c) Reglas cruzadas
  comprobar('(c) "retardo mayor" por debajo de la tolerancia: se rechaza',
    !(await intenta(`select actualizar_configuracion('minutos_para_falta', '5', 'Prueba 0021 cruzada')`)));
  comprobar('(c) tolerancia por encima de "retardo mayor": se rechaza',
    !(await intenta(`select actualizar_configuracion('tolerancia_retardo_minutos', '40', 'Prueba 0021 cruzada')`)));

  // (i) Anticipacion minima
  comprobar('(i) anticipación de 0 minutos (5:59 sería falta): se rechaza',
    !(await intenta(`select actualizar_configuracion('minutos_anticipacion_entrada', '0', 'Prueba 0021 anticipacion')`)));

  // (d) Dias futuros
  const futuros = await reporte(olvidadizo, await masDias(1), await masDias(7));
  comprobar('(d) los días futuros dicen "programado", no "todavía no llega"',
    futuros.length > 0 && futuros.every((f) => f.estado === 'programado'), [...new Set(futuros.map((f) => f.estado))].join(','));

  // (e) Olvido la entrada pero si registro la salida
  await bd.query('reset role');
  await marcar(olvidadizo, 'salida', '2026-09-15T19:00:00Z'); // mar 15, 14:00
  await entrarComo(ID_ADMIN);
  const martes = await reporte(olvidadizo, '2026-09-15', '2026-09-15');
  comprobar('(e) olvidó la entrada pero registró la salida: "sin entrada" (sí vino), no falta',
    martes.length === 1 && martes[0].estado === 'sin_entrada' && martes[0].salida !== null,
    martes.map((f) => f.estado).join(','));

  // (f) Incidencia duplicada
  await bd.query(`select registrar_incidencia($1, 'vacaciones', '2026-09-16', '2026-09-16', 'Prueba 0021 duplicado')`, [olvidadizo]);
  comprobar('(f) la misma incidencia dos veces: se rechaza',
    !(await intenta(`select registrar_incidencia($1, 'vacaciones', '2026-09-16', '2026-09-16', 'Prueba 0021 duplicado')`, [olvidadizo])));

  // (j) Horario a alguien dado de baja
  comprobar('(j) asignarle horario a alguien dado de baja: se rechaza (pide reactivarlo)',
    !(await intenta(`select asignar_horario($1, $2, '2026-10-01', $3, 'Prueba 0021 baja con horario')`, [deBaja, matutino, lav])));

  // (k) Trabajo un dia marcado como ausencia: sus horas cuentan
  await bd.query('reset role');
  await marcar(olvidadizo, 'entrada', '2026-09-16T11:00:00Z');
  await marcar(olvidadizo, 'salida', '2026-09-16T19:00:00Z');
  await entrarComo(ID_ADMIN);
  const conAusencia = dia(await reporte(olvidadizo, '2026-09-16', '2026-09-16'), '2026-09-16');
  comprobar('(k) trabajó un día marcado como vacaciones: sus 8 horas sí cuentan',
    conAusencia?.estado === 'incidencia' && Number(conAusencia?.horas_acreditadas) === 8, JSON.stringify(conAusencia?.horas_acreditadas));

  // (h) Camara caida: desde cuando
  await bd.query('reset role');
  const { rows: [k] } = await bd.query(`insert into dispositivos (nombre, token_hash) values ('Kiosco cámara', 'hash-camara') returning id`);
  const caidaDesde = async () => (await bd.query('select camara_caida_desde c from dispositivos where id = $1', [k.id])).rows[0].c;
  await bd.query('update dispositivos set camara_ok = false where id = $1', [k.id]);
  const primera = await caidaDesde();
  await bd.query('update dispositivos set camara_ok = false, pendientes = 2 where id = $1', [k.id]);
  const sigue = await caidaDesde();
  await bd.query('update dispositivos set camara_ok = true where id = $1', [k.id]);
  comprobar('(h) la cámara caída guarda desde cuándo, lo conserva y se borra al volver',
    primera !== null && String(primera) === String(sigue) && (await caidaDesde()) === null);
  await entrarComo(ID_ADMIN);
}

// --- 0022: salida olvidada y entrada al dia siguiente; turno doble ---
{
  await bd.query('reset role');
  const vespertino15 = await crearEmpleado('jdoble');
  await entrarComo(ID_ADMIN);
  await bd.query(`select asignar_horario($1, $2, '2026-09-01', '[{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5}]', 'Horario de la prueba 0022')`,
    [vespertino15, await idTurno('Matutino')]);
  await bd.query('reset role');
  // Lunes 21: entra 15:00 (un turno de tarde de apoyo) y OLVIDA la salida.
  await marcar(vespertino15, 'entrada', '2026-09-21T20:00:00Z');
  // Martes 22: entra a las 6:00 (15 h despues) y sale a las 14:00.
  await marcar(vespertino15, 'entrada', '2026-09-22T11:00:00Z');
  await marcar(vespertino15, 'salida', '2026-09-22T19:00:00Z');
  // Miercoles 23: turno doble, de 6:00 a 20:00.
  await marcar(vespertino15, 'entrada', '2026-09-23T11:00:00Z');
  await marcar(vespertino15, 'salida', '2026-09-24T01:00:00Z');
  await entrarComo(ID_ADMIN);
  const s = await reporte(vespertino15, '2026-09-21', '2026-09-23');
  const martes22 = dia(s, '2026-09-22');
  comprobar('olvidó la salida de las 15:00 y al día siguiente entró a las 6:00: esa entrada NO se pierde (jornada de 8 h)',
    martes22?.estado === 'a_tiempo' && Number(martes22?.horas) === 8, `${martes22?.estado} ${martes22?.horas}`);
  comprobar('y la de la tarde anterior queda como "no registró salida"',
    s.some((f) => f.estado_salida === 'salida_no_registrada'));
  const miercoles = dia(s, '2026-09-23');
  comprobar('turno doble de 6:00 a 20:00: 14 horas y "+6 h extra"',
    Number(miercoles?.horas) === 14 && miercoles?.minutos_extra === 360, `${miercoles?.horas} ${miercoles?.minutos_extra}`);
}

// --- Quien puede ver el reporte ---
await entrarComo(ID_SUPERVISOR);
comprobar('un supervisor puede ver el reporte', (await reporte(empMatutino, '2026-09-14', '2026-09-14')).length > 0);
await debeFallar('un supervisor NO puede cambiar horarios',
  `select asignar_horario('${empMatutino}', (select id from turnos limit 1), '2026-10-01', '[{"dia":1}]', 'Intento del supervisor')`,
  'administrador');
await bd.query('reset role');

// ============================================================================
//  0017 · ADMINISTRADORES, DERECHOS ARCO Y LIMITE DE ALTAS
// ============================================================================
console.log('\n--- administradores desde el panel (0017) ---');

await entrarComo(ID_ADMIN);
await debeFallar('el panel NO puede llamar registrar_administrador (solo la Edge Function)',
  `select registrar_administrador('${ID_ADMIN}', '${ID_SUPERVISOR}', 'Alguien', 'a@b.c', 'admin', 'Intento directo desde el panel')`,
  'permission denied');
await debeFallar('nadie cambia su propio acceso',
  `select cambiar_administrador('${ID_ADMIN}', 'supervisor', true, 'Quitarme el rol a mi mismo')`, 'propio');
await debeFallar('cambiar permisos exige motivo',
  `select cambiar_administrador('${ID_SUPERVISOR}', 'admin', true, 'corto')`, 'motivo');
await bd.query(`select cambiar_administrador('${ID_SUPERVISOR}', 'admin', true, 'Ahora también administra el sistema')`);
{
  const { rows: [s] } = await bd.query(`select rol from administradores where user_id = '${ID_SUPERVISOR}'`);
  comprobar('un admin puede subir a otro de supervisor a administrador', s.rol === 'admin');
}
await bd.query(`select cambiar_administrador('${ID_SUPERVISOR}', 'supervisor', true, 'Regresa a solo consultar')`);
await entrarComo(ID_SUPERVISOR);
await debeFallar('un supervisor NO puede cambiar permisos',
  `select cambiar_administrador('${ID_ADMIN}', 'supervisor', true, 'Intento del supervisor')`, 'administrador');
await bd.query('reset role');

// La Edge Function llama como service_role; aqui, como postgres, que tambien pasa.
await bd.query(`update administradores set debe_cambiar_contrasena = false where user_id = '${ID_ADMIN}'`);
await debeFallar('registrar_administrador exige que quien actua sea admin activo',
  `select registrar_administrador('${ID_SUPERVISOR}', '${ID_SUPERVISOR}', 'Alguien Nuevo', 'n@p.l', 'admin', 'Me doy permisos a mi mismo')`,
  'administrador');
await bd.query(`select set_config('request.jwt.claims', '', true)`); // como la Edge Function: sin sesion, actua p_actor
await bd.query(`select marcar_contrasena_temporal('${ID_ADMIN}', '${ID_SUPERVISOR}', 'Olvidó su contraseña del panel')`);
{
  const { rows: [s] } = await bd.query(`select debe_cambiar_contrasena from administradores where user_id = '${ID_SUPERVISOR}'`);
  comprobar('restablecer deja la contraseña como temporal', s.debe_cambiar_contrasena === true);
  const { rows: [b] } = await bd.query(
    `select motivo, actor from bitacora_auditoria where tabla = 'administradores' and registro_id = '${ID_SUPERVISOR}' and motivo = 'Olvidó su contraseña del panel'`);
  comprobar('y queda en bitácora con motivo y con quién lo hizo',
    b?.motivo === 'Olvidó su contraseña del panel' && b?.actor === ID_ADMIN);
}
await entrarComo(ID_SUPERVISOR);
await bd.query('select contrasena_panel_cambiada()');
await bd.query('reset role');
{
  const { rows: [s] } = await bd.query(`select debe_cambiar_contrasena from administradores where user_id = '${ID_SUPERVISOR}'`);
  comprobar('al poner una propia, deja de ser temporal', s.debe_cambiar_contrasena === false);
}

console.log('\n--- derechos ARCO (0017) ---');
const { rows: [arco] } = await bd.query(`
  insert into empleados (usuario, nombre, apellido_paterno, apellido_materno, numero_empleado, pin_hash)
  values ('rarco', 'Rosa', 'Arcos', 'Prueba', 'A-777', extensions.crypt('4821', extensions.gen_salt('bf', 4)))
  returning id`);
await bd.query(`
  insert into marcas (id, empleado_id, dispositivo_id, tipo, hora_dispositivo, hora_estimada,
                      monotonico_ms, arranque_id, foto_estado)
  values (gen_random_uuid(), $1, $2, 'entrada', now(), now(), 1, gen_random_uuid(), 'sin_camara')`,
  [arco.id, dispositivo.id]);

await entrarComo(ID_SUPERVISOR);
await debeFallar('un supervisor NO puede exportar los datos de una persona',
  `select datos_de_empleado('${arco.id}', 'Solicitud de acceso ARCO')`, 'administrador');
await entrarComo(ID_ADMIN);
{
  const { rows: [r] } = await bd.query(`select datos_de_empleado($1, 'Solicitud de acceso ARCO') as d`, [arco.id]);
  comprobar('exportar ARCO trae sus datos y sus marcas',
    r.d.empleado?.nombre === 'Rosa' && r.d.marcas.length === 1);
  comprobar('y NO trae el hash del PIN', !JSON.stringify(r.d).includes('pin_hash'));
}
await debeFallar('suprimir exige escribir su usuario para confirmar',
  `select anonimizar_empleado('${arco.id}', 'otro', 'Solicitud de supresión ARCO')`, 'usuario');
await bd.query(`select anonimizar_empleado($1, 'RArco ', 'Solicitud de supresión ARCO')`, [arco.id]);
await bd.query('reset role');
{
  const { rows: [e] } = await bd.query('select * from empleados where id = $1', [arco.id]);
  comprobar('suprimido: ya no dice quién era',
    e.nombre === 'Persona' && e.usuario.startsWith('anon') && e.numero_empleado === null && !e.activo && !!e.anonimizado_en);
  const { rows: [m] } = await bd.query('select count(*)::int n from marcas where empleado_id = $1', [arco.id]);
  comprobar('sus marcas se conservan (registro laboral)', m.n === 1);
  const { rows: [b] } = await bd.query(
    `select count(*)::int n from bitacora_auditoria
      where registro_id = $1 and (coalesce(datos_antes::text, '') || coalesce(datos_despues::text, '')) ~ '(Rosa|Arcos|rarco|A-777)'`,
    [arco.id]);
  comprobar('y en la bitácora ya no queda su nombre', b.n === 0);
  const { rows: [s] } = await bd.query(
    `select count(*)::int n from bitacora_auditoria where registro_id = $1 and datos_despues ->> 'arco' = 'supresion_de_datos'`,
    [arco.id]);
  comprobar('la supresión misma queda anotada', s.n === 1);
}
await entrarComo(ID_ADMIN);
await debeFallar('a una persona suprimida ya no se le puede reactivar',
  `select cambiar_estado_empleado('${arco.id}', true, 'Reactivar a quien fue suprimido')`, 'suprimidos');
await bd.query('reset role');

console.log('\n--- limite de altas de kiosco (0017) ---');
for (let i = 0; i < 10; i++) await bd.query(`select anotar_intento_enrolamiento('1.2.3.4', false)`);
{
  const { rows: [a] } = await bd.query(`select enrolamiento_permitido('1.2.3.4') p, enrolamiento_permitido('5.6.7.8') q`);
  comprobar('tras 10 códigos equivocados, ese origen ya no puede intentar', a.p === false);
  comprobar('otro origen sí puede', a.q === true);
}
await entrarComo(ID_ADMIN);
await debeFallar('el panel no puede leer los intentos ni anotarlos',
  `select anotar_intento_enrolamiento('x', true)`, 'permission denied');
await bd.query('reset role');

// ============================================================================
//  0018 · DATOS DE DEMOSTRACION
// ============================================================================
console.log('\n--- datos de demostracion (0018) ---');
await entrarComo(ID_ADMIN);
await debeFallar('con el interruptor apagado (lo normal), NO se generan datos falsos',
  `select * from generar_datos_demostracion(7, 'Probar el panel con datos')`, 'apagados');
await bd.query(`select actualizar_configuracion('permitir_datos_demostracion', '1', 'Sistema de pruebas: permitir demostración')`);
await entrarComo(ID_SUPERVISOR);
await debeFallar('un supervisor NO puede generarlos',
  `select * from generar_datos_demostracion(7, 'Probar el panel con datos')`, 'administrador');
await entrarComo(ID_ADMIN);
{
  const { rows: generados } = await bd.query(`select * from generar_datos_demostracion(14, 'Probar el panel con datos')`);
  comprobar('encendido: genera 5 empleados y da su PIN', generados.length === 5 && generados.every((g) => /^\d{4}$/.test(g.pin)));
  const { rows: [demo] } = await bd.query(`
    select count(distinct e.id)::int as personas, count(m.id)::int as marcas,
           count(distinct m.dispositivo_id)::int as kioscos
      from empleados e join marcas m on m.empleado_id = e.id
     where e.numero_empleado like 'DEMO-%'`);
  comprobar('marcados DEMO, con registros de 2 semanas de un solo kiosco de demostración',
    demo.personas === 5 && demo.marcas > 40 && demo.kioscos === 1, JSON.stringify(demo));
  const { rows: [velador] } = await bd.query(`
    select count(*)::int n from asignaciones_turno a join turnos t on t.id = a.turno_id
      join empleados e on e.id = a.empleado_id where e.numero_empleado like 'DEMO-%' and t.nombre = 'Nocturno'`);
  comprobar('incluye un velador del turno nocturno', velador.n === 1);
  const { rows: [rep] } = await bd.query(`
    select count(*) filter (where estado = 'a_tiempo')::int a_tiempo, count(*)::int total
      from reporte_asistencia((now() at time zone 'America/Matamoros')::date - 14,
                              (now() at time zone 'America/Matamoros')::date - 1) r
      join empleados e on e.id = r.empleado_id where e.numero_empleado like 'DEMO-%'`);
  comprobar('el reporte los califica (la mayoría a tiempo)', rep.total > 30 && rep.a_tiempo > rep.total / 2, JSON.stringify(rep));
  const { rows: otra } = await bd.query(`select * from generar_datos_demostracion(3, 'Otra tanda de prueba')`);
  comprobar('se puede generar otra tanda sin chocar usuarios', new Set(otra.map((g) => g.usuario)).size === 5 &&
    !otra.some((o) => generados.some((g) => g.usuario === o.usuario)));
}
await bd.query('reset role');

// ============================================================================
console.log('\n--- respaldo desde el panel (0027) ---');
// El panel baja cada tabla con SUS permisos (RLS y columnas de 0024). Se
// prueba con la MISMA lista de tablas y columnas que usa el panel: si un dia
// alguien agrega ahi una columna sin permiso (un hash), esto lo detecta.
{
  const { TABLAS_DEL_RESPALDO } = await import('../apps/panel/src/app/servicios/respaldo.ts');
  await bd.query(`select set_config('request.jwt.claims', '', true)`);

  await entrarComo(ID_ADMIN);
  await bd.query(`select registrar_descarga_respaldo('Respaldo mensual de prueba')`);
  await bd.query('reset role');
  const { rows: [anotado] } = await bd.query(`
    select actor, motivo, datos_despues from bitacora_auditoria
     where tabla = 'respaldo' order by id desc limit 1`);
  comprobar('la descarga queda en la bitácora, con quién y por qué',
    anotado?.actor === ID_ADMIN && anotado?.motivo === 'Respaldo mensual de prueba', JSON.stringify(anotado));

  await entrarComo(ID_ADMIN);
  await debeFallar('sin motivo no hay respaldo', `select registrar_descarga_respaldo('corto')`);
  for (const t of TABLAS_DEL_RESPALDO) {
    const columnas = t.columnas === '*' ? '*' : t.columnas;
    try {
      await bd.query('savepoint lectura');
      await bd.query(`select ${columnas} from ${t.tabla} order by ${t.orden.join(', ')} limit 1`);
      await bd.query('release savepoint lectura');
      comprobar(`el administrador puede leer "${t.tabla}" para el respaldo`, true);
    } catch (e) {
      await bd.query('rollback to savepoint lectura');
      comprobar(`el administrador puede leer "${t.tabla}" para el respaldo`, false, e.message);
    }
  }
  for (const [tabla, columna] of [['empleados', 'pin_hash'], ['administradores', 'contrasena_kiosco_hash'], ['dispositivos', 'token_hash']]) {
    const t = TABLAS_DEL_RESPALDO.find((x) => x.tabla === tabla);
    comprobar(`el respaldo NO pide "${columna}" de ${tabla}`, t && t.columnas !== '*' && !t.columnas.includes(columna));
  }

  await entrarComo(ID_SUPERVISOR);
  await debeFallar('un supervisor NO puede descargar el respaldo',
    `select registrar_descarga_respaldo('Respaldo mensual de prueba')`, 'administrador');
  await bd.query('reset role');
  await bd.query('set local role anon');
  await debeFallar('sin sesión, ni siquiera se puede llamar', `select registrar_descarga_respaldo('Respaldo mensual de prueba')`);
}
await bd.query('reset role');

console.log('\n--- avisos del panel y registros tras la baja (0028) ---');
{
  await bd.query('reset role');
  const crear = async (usuario) => (await bd.query(
    `insert into empleados (usuario, nombre, apellido_paterno, pin_hash)
     values ($1, 'Prueba', 'Baja', extensions.crypt('1234', extensions.gen_salt('bf', 4))) returning id`,
    [usuario])).rows[0].id;
  const { rows: [k] } = await bd.query(
    `insert into dispositivos (nombre, token_hash) values ('Kiosco avisos', 'hash-avisos') returning id`);
  const marcarEn = async (empleadoId, horaSql, origen = 'kiosco') => (await bd.query(
    `insert into marcas (id, empleado_id, dispositivo_id, tipo, origen, hora_dispositivo, hora_estimada, monotonico_ms, arranque_id)
     values (gen_random_uuid(), $1, $2, 'entrada', $3, ${horaSql}, ${horaSql}, 0, gen_random_uuid())
     returning id, banderas`, [empleadoId, k.id, origen])).rows[0];
  const bajaDe = async (id) => (await bd.query('select dado_de_baja_en b from empleados where id = $1', [id])).rows[0].b;

  // (a) La fecha de baja
  const ana = await crear('abaja');
  await bd.query('update empleados set activo = false where id = $1', [ana]);
  comprobar('(a) al dar de baja se anota cuándo', (await bajaDe(ana)) !== null);
  await bd.query('update empleados set nombre = $2 where id = $1', [ana, 'Ana']);
  comprobar('(a) otra edición no mueve la fecha de baja', (await bajaDe(ana)) !== null);

  // (b) La bandera: sólo después de la baja y sólo del kiosco
  const despues = await marcarEn(ana, `now() + interval '5 minutes'`);
  comprobar('(b) registro del kiosco DESPUÉS de la baja: sale con "empleado_de_baja"',
    despues.banderas.includes('empleado_de_baja'), JSON.stringify(despues.banderas));
  const antes = await marcarEn(ana, `now() - interval '2 hours'`);
  comprobar('(b) registro hecho ANTES de la baja (llegó tarde por falta de internet): sin bandera',
    !antes.banderas.includes('empleado_de_baja'), JSON.stringify(antes.banderas));
  const aMano = await marcarEn(ana, `now() + interval '6 minutes'`, 'manual');
  comprobar('(b) captura a mano del jefe: sin bandera (lo hizo a propósito)',
    !aMano.banderas.includes('empleado_de_baja'), JSON.stringify(aMano.banderas));

  // (c) Reactivar borra la fecha; sus registros ya no se marcan
  await bd.query('update empleados set activo = true where id = $1', [ana]);
  comprobar('(c) al reactivarla, la fecha de baja se borra', (await bajaDe(ana)) === null);
  const otraVez = await marcarEn(ana, `now() + interval '7 minutes'`);
  comprobar('(c) y sus registros ya no llevan la bandera', !otraVez.banderas.includes('empleado_de_baja'));

  // (d) Avisos: camara que falla a ratos (3 desconexiones en 7 dias, por defecto)
  const evento = (dias) => bd.query(
    `insert into eventos_dispositivo (id, dispositivo_id, tipo, detalle, ocurrido_en)
     values (gen_random_uuid(), $1, 'camara_desconectada', '{}', now() - make_interval(days => $2))`, [k.id, dias]);
  await evento(1); await evento(2); await evento(30); // la de hace 30 dias no cuenta
  const avisos = async () => {
    await entrarComo(ID_ADMIN);
    const { rows } = await bd.query('select * from avisos_del_panel()');
    await bd.query('reset role');
    return rows;
  };
  let lista = await avisos();
  comprobar('(d) 2 desconexiones recientes (y una vieja): todavía no es aviso',
    !lista.some((a) => a.tipo === 'camara_inestable' && a.dispositivo_id === k.id));
  await evento(3);
  lista = await avisos();
  const inestable = lista.find((a) => a.tipo === 'camara_inestable' && a.dispositivo_id === k.id);
  comprobar('(d) 3 desconexiones en 7 días: aviso de cámara que falla a ratos, con cuántas',
    inestable?.cantidad === 3 && inestable?.dispositivo === 'Kiosco avisos', JSON.stringify(inestable));

  // (e) Camara caida: solo despues de los minutos configurados
  await bd.query(`update dispositivos set camara_ok = false where id = $1`, [k.id]);
  lista = await avisos();
  comprobar('(e) cámara recién caída: todavía no es aviso (un parpadeo no alarma)',
    !lista.some((a) => a.tipo === 'camara_caida' && a.dispositivo_id === k.id));
  await bd.query(`update dispositivos set camara_caida_desde = now() - interval '20 minutes' where id = $1`, [k.id]);
  lista = await avisos();
  comprobar('(e) caída hace 20 min (el aviso es a los 15): sí es aviso',
    lista.some((a) => a.tipo === 'camara_caida' && a.dispositivo_id === k.id));

  // (f) Registros de personas dadas de baja, hasta que se anulan. Desde la
  // 0029 van a Pendientes; en la franja solo si eso se apaga.
  await bd.query(`update configuracion set valor = '0' where clave = 'pendientes_registros_de_baja'`);
  const beto = await crear('bbaja');
  await bd.query('update empleados set activo = false where id = $1', [beto]);
  const deBeto = await marcarEn(beto, `now() + interval '1 minute'`);
  lista = await avisos();
  const antesDeAnular = lista.find((a) => a.tipo === 'registros_de_baja')?.cantidad ?? 0;
  comprobar('(f) los registros tras la baja salen en los avisos', antesDeAnular >= 2, String(antesDeAnular));
  await entrarComo(ID_ADMIN);
  await bd.query(`select corregir_marca($1, 'anular', 'Prueba 0028: no trabajó')`, [deBeto.id]);
  await bd.query('reset role');
  lista = await avisos();
  const trasAnular = lista.find((a) => a.tipo === 'registros_de_baja')?.cantidad ?? 0;
  comprobar('(f) al anular uno, deja de contarse', trasAnular === antesDeAnular - 1, `${antesDeAnular} -> ${trasAnular}`);
  await bd.query(`update configuracion set valor = '1' where clave = 'pendientes_registros_de_baja'`);
  lista = await avisos();
  comprobar('(f) con Pendientes encendido (lo normal desde la 0029), ya no salen en la franja',
    !lista.some((a) => a.tipo === 'registros_de_baja'));

  // (g) Quien puede verlos
  await entrarComo('33333333-3333-3333-3333-333333333333'); // con sesion, pero no es administrador
  const { rows: ajeno } = await bd.query('select * from avisos_del_panel()');
  comprobar('(g) alguien con sesión que NO es administrador: cero avisos', ajeno.length === 0, String(ajeno.length));
  await bd.query('reset role');
  await bd.query('set local role anon');
  await debeFallar('(g) sin sesión ni siquiera se puede llamar', 'select * from avisos_del_panel()');
  await entrarComo(ID_ADMIN);
  const { rows: [col] } = await bd.query('select dado_de_baja_en from empleados where id = $1', [beto]);
  comprobar('(g) el panel puede leer la fecha de baja', col?.dado_de_baja_en !== null);
  await bd.query('reset role');

  // (h) Bitacora: un cambio de PIN se nota, sin guardar el hash
  await bd.query(`update empleados set pin_hash = extensions.crypt('9876', extensions.gen_salt('bf', 4)) where id = $1`, [beto]);
  const { rows: [pin] } = await bd.query(`
    select datos_antes ->> 'pin_hash' a, datos_despues ->> 'pin_hash' d from bitacora_auditoria
     where tabla = 'empleados' and registro_id = $1 order by id desc limit 1`, [beto]);
  comprobar('(h) cambio de PIN en la bitácora: "[oculto]" → "[nuevo]", nunca el hash',
    pin?.a === '[oculto]' && pin?.d === '[nuevo]', JSON.stringify(pin));
  await bd.query(`update empleados set nombre = 'Beto' where id = $1`, [beto]);
  const { rows: [otro] } = await bd.query(`
    select datos_despues ->> 'pin_hash' d from bitacora_auditoria
     where tabla = 'empleados' and registro_id = $1 order by id desc limit 1`, [beto]);
  comprobar('(h) otro cambio (el nombre) no dice que el PIN cambió', otro?.d === '[oculto]', JSON.stringify(otro));

  // (i) La camara que cae y vuelve no ensucia la bitacora
  const cuenta = async () => (await bd.query(
    `select count(*)::int n from bitacora_auditoria where tabla = 'dispositivos' and registro_id = $1`, [k.id])).rows[0].n;
  const antesCamara = await cuenta();
  await bd.query('update dispositivos set camara_ok = true where id = $1', [k.id]);
  await bd.query('update dispositivos set camara_ok = false where id = $1', [k.id]);
  comprobar('(i) la cámara que cae y vuelve no deja renglones en la bitácora', (await cuenta()) === antesCamara,
    `${antesCamara} -> ${await cuenta()}`);
}

// ============================================================================
//  0029 · PENDIENTES, CAMBIOS DE HORARIO Y NOTAS
// ============================================================================
//  `revisar_pendientes()` mira los ultimos 14 dias desde HOY, asi que aqui las
//  fechas no pueden ser fijas: todo se arma desde el LUNES DE LA SEMANA
//  PASADA (siempre cae dentro de esos 14 dias). Las horas si son a mano, en
//  hora de Nuevo Laredo, y la base las convierte.
console.log('\n--- pendientes (0029) ---');
{
  await bd.query('reset role');
  await bd.query(`select set_config('request.jwt.claims', '', true)`);
  // "Revisar desde" queda en el dia en que se aplico la migracion (hoy, en
  // local): aqui se abre para que cuente la semana pasada. Ver (h).
  comprobar('"Revisar desde" se puso sola: el día en que se aplicó la migración',
    /^\d{4}-\d{2}-\d{2}$/.test((await bd.query(
      `select valor #>> '{}' v from configuracion where clave = 'pendientes_revisar_desde'`)).rows[0]?.v ?? ''));
  await bd.query(`update configuracion set valor = '"2000-01-01"' where clave = 'pendientes_revisar_desde'`);
  const { rows: [{ lunes }] } = await bd.query(
    `select (date_trunc('week', (now() at time zone 'America/Matamoros')::date) - interval '7 days')::date::text as lunes`);
  const diaN = (n) => `('${lunes}'::date + ${n})`;
  const { rows: [{ viernes }] } = await bd.query(`select ('${lunes}'::date + 4)::text as viernes`);
  const crear = async (usuario, numero = null) => (await bd.query(
    `insert into empleados (usuario, numero_empleado, nombre, apellido_paterno, pin_hash)
     values ($1, $2, 'Prueba', 'Pendientes', extensions.crypt('1234', extensions.gen_salt('bf', 4))) returning id`,
    [usuario, numero])).rows[0].id;
  const { rows: [k] } = await bd.query(
    `insert into dispositivos (nombre, token_hash) values ('Kiosco pendientes', 'hash-pendientes') returning id`);
  /** Marca en el dia `n` despues del lunes pasado, a la hora local `hhmm`. */
  const marcar = async (emp, tipo, n, hhmm, banderas = '{}') => (await bd.query(
    `insert into marcas (id, empleado_id, dispositivo_id, tipo, hora_dispositivo, hora_estimada, monotonico_ms, arranque_id, banderas)
     values (gen_random_uuid(), $1, $2, $3,
             (${diaN(n)} + $4::time) at time zone 'America/Matamoros',
             (${diaN(n)} + $4::time) at time zone 'America/Matamoros', 0, gen_random_uuid(), $5) returning id`,
    [emp, k.id, tipo, hhmm, banderas])).rows[0].id;
  const idTurno = async (nombre) => (await bd.query('select id from turnos where nombre = $1', [nombre])).rows[0].id;
  const todos = '[{"dia":0},{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5},{"dia":6}]';

  // Matutino (06:00-14:00) toda la semana pasada, y nada mas: el horario se
  // cierra el lunes de esta semana para que esta semana no salgan faltas.
  const paco = await crear('ppendiente');
  await entrarComo(ID_ADMIN);
  await bd.query(`select asignar_horario($1, $2, '${lunes}', '${todos}', 'Horario de prueba 0029')`,
    [paco, await idTurno('Matutino')]);
  await bd.query('reset role');
  await bd.query(`update asignaciones_turno set vigente_hasta = ${diaN(7)} where empleado_id = $1`, [paco]);

  // lun, mar, mie: 12 min tarde (dentro de la regla del dia: 15) -> 36 en la semana
  for (const n of [0, 1, 2]) { await marcar(paco, 'entrada', n, '06:12'); await marcar(paco, 'salida', n, '14:00'); }
  await marcar(paco, 'entrada', 3, '06:20'); await marcar(paco, 'salida', 3, '14:00'); // jue: 20 min
  // vie: no vino
  await marcar(paco, 'entrada', 5, '06:00');                                          // sab: sin salida
  await marcar(paco, 'entrada', 6, '06:00', '{foto_obstruida}');                      // dom: camara tapada
  await marcar(paco, 'salida', 6, '14:00', '{foto_obstruida}');

  const revisar = async (quien = ID_ADMIN) => {
    await entrarComo(quien);
    const { rows: [{ n }] } = await bd.query('select revisar_pendientes() as n');
    await bd.query('reset role');
    return n;
  };
  const casosDe = async (emp) => (await bd.query(
    `select * from pendientes where empleado_id = $1 order by tipo, desde`, [emp])).rows;
  const delTipo = (casos, tipo) => casos.filter((c) => c.tipo === tipo);

  const abiertos = await revisar();
  let casos = await casosDe(paco);
  comprobar('(a) devuelve cuántos quedan abiertos (el número del menú)', abiertos >= casos.length, `${abiertos}`);
  const semana = delTipo(casos, 'retardos_semana')[0];
  comprobar('(a) la semana suma los minutos DESDE LA HORA DE ENTRADA: 12+12+12+20 = 56, en 4 días',
    semana?.detalle?.minutos === 56 && semana?.detalle?.dias === 4 && semana?.desde?.toISOString().slice(0, 10) === lunes,
    JSON.stringify(semana?.detalle));
  const retardosDia = delTipo(casos, 'retardo_dia');
  comprobar('(a) retardo de UN día: sólo el jueves (20 min); los de 12 no llegan a 15',
    retardosDia.length === 1 && retardosDia[0].detalle.minutos === 20, JSON.stringify(retardosDia.map((c) => c.detalle)));
  comprobar('(a) la falta del viernes', delTipo(casos, 'falta').length === 1);
  comprobar('(a) la salida no registrada del sábado', delTipo(casos, 'salida_no_registrada').length === 1);
  const foto = delTipo(casos, 'foto_tapada');
  comprobar('(a) cámara tapada el domingo: UN caso con las dos veces',
    foto.length === 1 && foto[0].detalle.veces === 2, JSON.stringify(foto.map((c) => c.detalle)));

  await revisar();
  comprobar('(b) revisar otra vez no duplica nada', (await casosDe(paco)).length === casos.length);

  // (c) Se cierran solos: vacaciones el viernes
  await entrarComo(ID_ADMIN);
  await bd.query(`select registrar_incidencia($1, 'vacaciones', ${diaN(4)}, ${diaN(4)}, 'Vacaciones de prueba 0029')`, [paco]);
  await bd.query('reset role');
  await revisar();
  const falta = delTipo(await casosDe(paco), 'falta')[0];
  comprobar('(c) se registró vacaciones ese día: la falta se cierra sola, diciendo por qué',
    falta?.estado === 'resuelto_solo' && /permiso o vacaciones/.test(falta?.que_se_hizo ?? ''), falta?.que_se_hizo);

  // (d) Atender
  const jueves = retardosDia[0];
  await entrarComo(ID_ADMIN);
  await debeFallar('(d) atender sin decir qué se hizo: no', `select atender_pendiente('${jueves.id}', 'ok')`, 'qué se hizo');
  await bd.query(`select atender_pendiente($1, 'Se habló con él, dice que fue el camión')`, [jueves.id]);
  await debeFallar('(d) atenderlo dos veces: no (lo pudo atender otro)',
    `select atender_pendiente('${jueves.id}', 'Se habló con él otra vez')`, 'ya estaba cerrado');
  await bd.query('reset role');
  const { rows: [atendido] } = await bd.query('select * from pendientes where id = $1', [jueves.id]);
  comprobar('(d) queda atendido, con quién, cuándo y qué se hizo',
    atendido.estado === 'atendido' && atendido.cerrado_por === ID_ADMIN && atendido.cerrado_en !== null
      && atendido.que_se_hizo === 'Se habló con él, dice que fue el camión');
  const { rows: [bit] } = await bd.query(
    `select motivo from bitacora_auditoria where tabla = 'pendientes' and registro_id = $1 order by id desc limit 1`, [jueves.id]);
  comprobar('(d) y en la bitácora', bit?.motivo === 'Se habló con él, dice que fue el camión');
  await revisar();
  comprobar('(d) revisar no reabre lo atendido',
    (await bd.query('select estado from pendientes where id = $1', [jueves.id])).rows[0].estado === 'atendido');

  await entrarComo(ID_ADMIN);
  await bd.query(`select reabrir_pendiente($1, 'Lo cerré por error, falta hablar')`, [jueves.id]);
  await bd.query('reset role');
  comprobar('(d) se puede reabrir (con motivo)',
    (await bd.query('select estado, que_se_hizo from pendientes where id = $1', [jueves.id])).rows[0].estado === 'pendiente');

  // (e) Las reglas son del jefe
  await bd.query(`update configuracion set valor = '0' where clave = 'pendientes_minutos_tarde_semana'`);
  await revisar();
  const semanaApagada = delTipo(await casosDe(paco), 'retardos_semana')[0];
  comprobar('(e) apagar la regla de la semana cierra sus pendientes, diciendo por qué',
    semanaApagada.estado === 'resuelto_solo' && /Se apagó/.test(semanaApagada.que_se_hizo), semanaApagada.que_se_hizo);
  await bd.query(`update configuracion set valor = '60' where clave = 'pendientes_minutos_tarde_semana'`);
  await revisar();
  comprobar('(e) con el límite en 60, una semana de 56 minutos no es pendiente',
    delTipo(await casosDe(paco), 'retardos_semana').every((c) => c.estado !== 'pendiente'));
  await bd.query(`update configuracion set valor = '30' where clave = 'pendientes_minutos_tarde_semana'`);

  // (f) Quien
  comprobar('(f) un supervisor también puede ver y revisar', typeof (await revisar(ID_SUPERVISOR)) === 'number');
  await entrarComo('33333333-3333-3333-3333-333333333333');
  await debeFallar('(f) con sesión pero sin ser administrador: no', 'select revisar_pendientes()', 'administrador');
  comprobar('(f) ...ni ve ninguno', (await bd.query('select count(*)::int n from pendientes')).rows[0].n === 0);
  await entrarComo(ID_ADMIN);
  await debeFallar('(f) nadie escribe pendientes a mano (sólo con las funciones)',
    `insert into pendientes (clave, tipo, empleado_id, desde, hasta) values ('x', 'falta', '${paco}', now(), now())`);
  const { rowCount: cambiados } = await bd.query(`update pendientes set estado = 'atendido' where id = $1`, [jueves.id]);
  comprobar('(f) ni los cambia a mano (la RLS no deja tocar ninguna fila)', cambiados === 0);
  await bd.query('reset role');
  await bd.query('set local role anon');
  await debeFallar('(f) sin sesión ni siquiera se puede llamar', 'select revisar_pendientes()');
  await bd.query('reset role');

  // (h) "Revisar desde": lo de antes no es pendiente, y si el jefe mueve la
  // fecha, lo abierto de antes se cierra solo diciendo por que.
  await bd.query(`update configuracion set valor = to_jsonb(${diaN(5)}::text) where clave = 'pendientes_revisar_desde'`);
  await revisar();
  const juevesDespues = (await bd.query('select estado, que_se_hizo from pendientes where id = $1', [jueves.id])).rows[0];
  comprobar('(h) mover "Revisar desde" al sábado cierra solo el retardo del jueves, diciendo por qué',
    juevesDespues.estado === 'resuelto_solo' && /Revisar desde/.test(juevesDespues.que_se_hizo), juevesDespues.que_se_hizo);
  comprobar('(h) lo del sábado en adelante sigue abierto (la salida no registrada)',
    delTipo(await casosDe(paco), 'salida_no_registrada')[0]?.estado === 'pendiente');
  comprobar('(h) la semana no suma los días de antes: no sale "tarde en la semana"',
    delTipo(await casosDe(paco), 'retardos_semana').every((c) => c.estado !== 'pendiente'));
  await entrarComo(ID_ADMIN);
  await debeFallar('(h) "Revisar desde" no puede ser después de hoy',
    `select actualizar_configuracion('pendientes_revisar_desde', to_jsonb((current_date + 30)::text), 'Prueba de fecha futura')`,
    'después de hoy');
  await debeFallar('(h) ni algo que no es fecha',
    `select actualizar_configuracion('pendientes_revisar_desde', '"mañana"', 'Prueba de fecha mala')`, 'fecha');
  await debeFallar('(h) ni una fecha que no existe',
    `select actualizar_configuracion('pendientes_revisar_desde', '"2026-02-30"', 'Prueba de fecha mala')`, 'no existe');
  await bd.query(`select actualizar_configuracion('pendientes_revisar_desde', '"2000-01-01"', 'Prueba de fecha buena')`);
  await bd.query('reset role');

  // (g) Persona dada de baja: sus pendientes se cierran solos
  await bd.query('update empleados set activo = false where id = $1', [paco]);
  await revisar();
  comprobar('(g) al dar de baja a la persona, sus pendientes abiertos se cierran solos',
    (await casosDe(paco)).every((c) => c.estado !== 'pendiente'));
  await bd.query('update empleados set activo = true where id = $1', [paco]);

  // ==========================================================================
  console.log('\n--- cambios de horario por un día (0029) ---');
  // Paco: matutino (06-14) TODOS los dias; Vero: vespertino (14-22) lun-vie.
  // Se usan dias de la semana QUE VIENE: no tocan los pendientes de arriba.
  const vero = await crear('vpendiente');
  await bd.query(`update asignaciones_turno set vigente_hasta = null where empleado_id = $1`, [paco]);
  await entrarComo(ID_ADMIN);
  await bd.query(`select asignar_horario($1, $2, '${lunes}', '[{"dia":1},{"dia":2},{"dia":3},{"dia":4},{"dia":5}]', 'Horario de prueba 0029')`,
    [vero, await idTurno('Vespertino')]);
  const lunesQueViene = diaN(14);
  const horario = async (emp, n) => (await bd.query(`select * from horario_del_dia($1, ${diaN(n)})`, [emp])).rows[0];
  const filaDe = async (emp, n) => (await bd.query(
    `select * from reporte_asistencia(${diaN(n)}, ${diaN(n)}, $1) where turno is not null`, [emp])).rows;

  await debeFallar('(a) sin motivo, no', `select intercambiar_horario('${paco}', '${vero}', ${lunesQueViene}, 'x')`, 'motivo');
  const grupo = (await bd.query(`select intercambiar_horario($1, $2, ${lunesQueViene}, 'Intercambio de prueba 0029') g`,
    [paco, vero])).rows[0].g;
  const hp = await horario(paco, 14);
  const hv = await horario(vero, 14);
  comprobar('(a) intercambio: ese día Paco trabaja de 14 a 22 y Vero de 6 a 14',
    hp.hora_inicio === '14:00:00' && hp.hora_fin === '22:00:00' && hv.hora_inicio === '06:00:00' && hv.hora_fin === '14:00:00',
    JSON.stringify({ hp, hv }));
  const [filaPaco] = await filaDe(paco, 14);
  const { rows: [{ esperado }] } = await bd.query(
    `select ((${lunesQueViene} + time '14:00') at time zone 'America/Matamoros') as esperado`);
  comprobar('(a) y el reporte lo mide contra ESE horario, diciendo que es intercambio',
    filaPaco?.ajuste === 'intercambio' && filaPaco?.programado_inicio?.getTime() === esperado.getTime(),
    JSON.stringify(filaPaco));
  comprobar('(a) el día siguiente sigue normal', (await horario(paco, 15)).hora_inicio === '06:00:00');
  await debeFallar('(a) no se puede encimar otro cambio ese día',
    `select ajustar_horario_dia('${paco}', ${lunesQueViene}, '07:00', '15:00', 'Cambio de prueba 0029')`, 'intercambio');

  const unoDelGrupo = (await bd.query('select id from ajustes_horario where intercambio_id = $1 limit 1', [grupo])).rows[0].id;
  await bd.query(`select quitar_ajuste_horario($1, 'Ya no se hizo el cambio')`, [unoDelGrupo]);
  comprobar('(b) quitar un intercambio quita a los dos',
    (await bd.query('select count(*)::int n from ajustes_horario where intercambio_id = $1', [grupo])).rows[0].n === 0);

  // Vero descansa el sabado; Paco no: intercambio = Vero cubre, Paco descansa.
  await bd.query(`select intercambiar_horario($1, $2, ${diaN(19)}, 'Vero cubre el sábado de Paco')`, [paco, vero]);
  comprobar('(c) intercambio con alguien que descansaba: ahora descansa Paco...',
    (await horario(paco, 19)).trabaja === false && (await filaDe(paco, 19)).length === 0);
  const [sabVero] = await filaDe(vero, 19);
  comprobar('(c) ...y Vero aparece en el reporte ese día que normalmente no trabaja',
    sabVero?.ajuste === 'intercambio' && sabVero?.estado === 'programado', JSON.stringify(sabVero));

  await bd.query(`select ajustar_horario_dia($1, ${diaN(16)}, '22:00', '06:00', 'Cubre la noche de prueba')`, [paco]);
  const [noche] = await filaDe(paco, 16);
  comprobar('(d) un cambio a turno de noche termina a las 06:00 del día siguiente',
    noche?.ajuste === 'cambio'
      && noche?.programado_fin?.getTime() - noche?.programado_inicio?.getTime() === 8 * 3600 * 1000, JSON.stringify(noche));
  await bd.query(`select ajustar_horario_dia($1, ${diaN(16)}, null, null, 'Mejor que descanse ese día')`, [paco]);
  comprobar('(d) volver a ajustar el mismo día lo reemplaza (ahora descansa)',
    (await filaDe(paco, 16)).length === 0
      && (await bd.query(`select count(*)::int n from ajustes_horario where empleado_id = $1 and fecha = ${diaN(16)}`, [paco])).rows[0].n === 1);
  await debeFallar('(d) un horario de 20 horas: no (más que la "salida no registrada")',
    `select ajustar_horario_dia('${paco}', ${diaN(17)}, '06:00', '02:00', 'Horario demasiado largo')`, 'más largo');
  await debeFallar('(d) entrada sin salida: no',
    `select ajustar_horario_dia('${paco}', ${diaN(17)}, '06:00', null, 'Falta la hora de salida')`, 'Escribe la hora');

  // Un cambio que vuelve descanso un dia que fue falta: la falta se cierra sola.
  await bd.query('reset role');
  await bd.query(`delete from incidencias where empleado_id = $1`, [paco]);
  await bd.query(`delete from pendientes where empleado_id = $1`, [paco]);
  await revisar();
  comprobar('(e) sin las vacaciones, el viernes vuelve a ser falta',
    (await casosDe(paco)).some((c) => c.tipo === 'falta' && c.estado === 'pendiente'));
  await entrarComo(ID_ADMIN);
  await bd.query(`select ajustar_horario_dia($1, ${diaN(4)}, null, null, 'Ese viernes le tocaba descanso')`, [paco]);
  await bd.query('reset role');
  await revisar();
  comprobar('(e) con un cambio de horario (ese día descansaba), la falta se cierra sola',
    delTipo(await casosDe(paco), 'falta').find((c) => c.desde.toISOString().slice(0, 10) === viernes)?.estado === 'resuelto_solo');

  await entrarComo(ID_SUPERVISOR);
  await debeFallar('(f) un supervisor NO cambia horarios',
    `select ajustar_horario_dia('${paco}', ${diaN(18)}, '07:00', '15:00', 'Cambio de prueba 0029')`, 'administrador');
  comprobar('(f) pero sí los ve', (await bd.query('select count(*)::int n from ajustes_horario')).rows[0].n > 0);
  await debeFallar('(f) nadie escribe ajustes a mano',
    `insert into ajustes_horario (empleado_id, fecha, hora_inicio, hora_fin, motivo) values ('${paco}', now(), '07:00', '15:00', 'a mano')`);
  await bd.query('reset role');
  const { rows: [aud] } = await bd.query(
    `select motivo from bitacora_auditoria where tabla = 'ajustes_horario' order by id desc limit 1`);
  comprobar('(f) cada cambio queda en la bitácora con su motivo', aud?.motivo === 'Ese viernes le tocaba descanso', aud?.motivo);

  // ARCO
  await entrarComo(ID_ADMIN);
  const { rows: [{ datos }] } = await bd.query(`select datos_de_empleado($1, 'Solicitud ARCO de prueba') as datos`, [paco]);
  comprobar('(g) ARCO: la exportación incluye sus cambios de horario y sus pendientes',
    datos.cambios_de_horario.length > 0 && datos.pendientes.length > 0);
  await bd.query('reset role');

  // ==========================================================================
  console.log('\n--- notas (0029) ---');
  const nota = async (visibilidad, titulo) => {
    await entrarComo(ID_ADMIN);
    const { rows: [n] } = await bd.query(
      `insert into notas (titulo, texto, tareas, visibilidad) values ($1, 'texto', '[{"texto":"Pedir lista a RH","hecha":false}]', $2) returning id`,
      [titulo, visibilidad]);
    return n.id;
  };
  const veo = async (quien, id) => {
    await entrarComo(quien);
    return (await bd.query('select count(*)::int n from notas where id = $1', [id])).rows[0].n === 1;
  };
  const privada = await nota('privada', 'Mía');
  comprobar('(a) quien la escribe la ve (y crearla devuelve la fila)', await veo(ID_ADMIN, privada));
  comprobar('(a) una nota privada: otro administrador NO la ve', !(await veo(ID_SUPERVISOR, privada)));
  const paraTodos = await nota('todos', 'De todos');
  comprobar('(b) una nota para todos: otro administrador sí la ve', await veo(ID_SUPERVISOR, paraTodos));
  await entrarComo(ID_SUPERVISOR);
  await bd.query(`update notas set tareas = '[{"texto":"Pedir lista a RH","hecha":true}]' where id = $1`, [paraTodos]);
  comprobar('(b) y puede palomear sus casillas',
    (await bd.query('select tareas from notas where id = $1', [paraTodos])).rows[0].tareas[0].hecha === true);
  await debeFallar('(b) pero no cambiar quién la ve', `update notas set visibilidad = 'privada' where id = '${paraTodos}'`, 'Sólo quien escribió');
  const { rowCount: borradas } = await bd.query('delete from notas where id = $1', [paraTodos]);
  comprobar('(b) ni borrarla', borradas === 0);
  const algunos = await nota('algunos', 'Para algunos');
  comprobar('(c) "algunos" sin compartir con nadie: el otro no la ve', !(await veo(ID_SUPERVISOR, algunos)));
  await entrarComo(ID_ADMIN);
  await bd.query('insert into notas_compartidas (nota_id, user_id) values ($1, $2)', [algunos, ID_SUPERVISOR]);
  comprobar('(c) al compartirla con él, sí la ve', await veo(ID_SUPERVISOR, algunos));
  await entrarComo(ID_SUPERVISOR);
  await debeFallar('(c) quien no es el autor no la comparte con nadie más',
    `insert into notas_compartidas (nota_id, user_id) values ('${privada}', '${ID_SUPERVISOR}')`);
  await entrarComo('33333333-3333-3333-3333-333333333333');
  comprobar('(d) con sesión pero sin ser administrador: ninguna nota',
    (await bd.query('select count(*)::int n from notas')).rows[0].n === 0);
  await debeFallar('(d) ...ni puede crear', `insert into notas (titulo) values ('intruso')`);
  await bd.query('reset role');

  console.log('\n--- hora del servidor (0029) ---');
  await entrarComo(ID_ADMIN);
  const { rows: [{ h }] } = await bd.query('select hora_del_servidor() h');
  comprobar('la hora del servidor llega (para corregir el reloj de la PC del panel)',
    Math.abs(h.getTime() - Date.now()) < 5 * 60 * 1000);
  const { rows: [{ v }] } = await bd.query(`select valor v from configuracion where clave = 'identificar_con_numero'`);
  comprobar('el ajuste "checar con número" existe y empieza apagado (lista)', Number(v) === 0);
  await bd.query('reset role');

  // 0030 (21-10-2026): tolerancia para salir antes. Reglas que valen con
  // cualquier dato: en 0 cuenta cualquier minuto; con N, nada de 1 a N.
  console.log('\n--- tolerancia para salir antes (0030) ---');
  const { rows: [{ v: tolSalida }] } = await bd.query(`select valor v from configuracion where clave = 'tolerancia_salida_minutos'`);
  comprobar('el ajuste "tolerancia para salir antes" existe y empieza en 0 (como antes)', Number(tolSalida) === 0);
  const desdeHace = `(now() at time zone 'America/Matamoros')::date - 31`;
  const hoyLocal = `(now() at time zone 'America/Matamoros')::date`;
  const { rows: [{ n: sinContar }] } = await bd.query(
    `select count(*)::int n from reporte_asistencia(${desdeHace}, ${hoyLocal})
      where salida < programado_fin - interval '1 minute' and minutos_salida_anticipada is null`);
  comprobar('con 0, toda salida antes de la hora se cuenta', sinContar === 0, `${sinContar} sin contar`);
  await bd.query(`update configuracion set valor = '120'::jsonb where clave = 'tolerancia_salida_minutos'`);
  const { rows: [{ n: dentro }] } = await bd.query(
    `select count(*)::int n from reporte_asistencia(${desdeHace}, ${hoyLocal})
      where minutos_salida_anticipada between 1 and 120`);
  comprobar('con 120, nadie aparece con 1 a 120 minutos antes', dentro === 0, `${dentro}`);
  await bd.query(`update configuracion set valor = '0'::jsonb where clave = 'tolerancia_salida_minutos'`);
}

// ============================================================================
//  Resultado
// ============================================================================
// Todo corrio dentro de una transaccion que ahora se deshace: la base local
// queda igual que antes de la prueba, asi que se puede correr mil veces.
await bd.query('rollback');
await bd.end();

console.log(
  fallos === 0
    ? `\nTODAS LAS PRUEBAS PASARON  (${pruebas})`
    : `\n${fallos} de ${pruebas} PRUEBA(S) FALLARON`,
);

process.exit(fallos === 0 ? 0 : 1);
