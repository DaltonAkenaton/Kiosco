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
//  El turno que cruza medianoche es obligatorio desde la v1 (CLAUDE.md 1.1).
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
comprobar('el reseteo de PIN queda en la bitacora, con el hash oculto',
  bitPin?.datos_despues?.pin_hash === '[oculto]' &&
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

const { rows: empSinPermiso } = await bd.query('select * from empleados');
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
  const { rows: [ok] } = await bd.query(
    `select pin_hash = extensions.crypt($1, pin_hash) as cuadra from empleados where id = $2`, [alta.pin, alta.id]);
  comprobar('y ese PIN es el que quedo guardado (como hash)', ok.cuadra === true);
}

await debeFallar('sin motivo no hay alta',
  `select * from alta_empleado('Otra', 'Persona', '', '', 'opersona', '')`, 'motivo');
await debeFallar('un usuario repetido se rechaza con mensaje claro',
  `select * from alta_empleado('Otra', 'Persona', '', '', 'npersona', 'Alta repetida de prueba')`, 'Ya hay alguien');

const pinNuevo = (await bd.query(`select restablecer_pin($1, 'Olvido su PIN en la prueba') as pin`, [alta.id])).rows[0].pin;
{
  const { rows: [e] } = await bd.query(
    `select pin_temporal, pin_hash = extensions.crypt($1, pin_hash) as cuadra from empleados where id = $2`, [pinNuevo, alta.id]);
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
  comprobar('la bitacora tampoco guarda el hash de la contrasena del kiosco', cred?.h === '[oculto]', cred?.h);
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
