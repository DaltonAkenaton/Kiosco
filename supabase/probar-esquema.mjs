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
  comprobar('llego 45 min tarde (mas que los 30 para falta): cuenta como falta, pero se ve a que hora llego',
    dia(semana, '2026-09-18')?.estado === 'falta' && dia(semana, '2026-09-18')?.minutos_tarde === 45);
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

// --- Correcciones: la marca original no se toca ---
await bd.query(`select corregir_marca($1, 'cambiar_tipo', 'Se equivoco de boton al salir')`, [salidaComoEntrada]);
await bd.query(`select corregir_marca($1, 'anular', 'Registro duplicado por error del kiosco')`, [entradaViernes]);
{
  const semana = await reporte(empMatutino, '2026-09-10', '2026-09-22');
  const viernes11 = dia(semana, '2026-09-11');
  comprobar('corregida a salida: jornada completa de 8 horas, marcada como corregida',
    viernes11?.estado_salida === 'completa' && Number(viernes11?.horas) === 8 && viernes11?.corregida === true);
  comprobar('anulada la entrada del 18: ese dia queda como falta SIN entrada',
    dia(semana, '2026-09-18')?.estado === 'falta' && dia(semana, '2026-09-18')?.entrada === null);
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
