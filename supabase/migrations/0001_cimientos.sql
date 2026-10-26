-- ============================================================================
--  0001 · CIMIENTOS
-- ============================================================================
--
--  Lo que necesita existir antes que cualquier tabla: extensiones, las
--  funciones de tiempo y la tabla `configuracion`.
--
--  ---------------------------------------------------------------------------
--  TRES REGLAS QUE GOBIERNAN TODAS LAS MIGRACIONES DE ESTA CARPETA
--  ---------------------------------------------------------------------------
--
--  1. TODO EN UTC.  Cada columna de fecha y hora es `timestamptz`, que Postgres
--     guarda siempre en UTC. La conversion a hora local ocurre SOLO al mostrar
--     o al calcular a que dia pertenece algo. Guardar hora local seria un error
--     que no se nota hasta el cambio de horario de verano, y entonces ya hay
--     meses de datos mal guardados (CLAUDE.md 6).
--
--  2. LA ZONA NUNCA SE ESCRIBE A MANO.  Vive en la tabla `configuracion`. Esta
--     PROHIBIDO escribir 'America/Mexico_City' o un desfase fijo como '-06:00'
--     en cualquier consulta. Nuevo Laredo esta en la franja fronteriza y SI
--     tiene horario de verano; Ciudad de Mexico ya no. Confundirlos da una hora
--     de diferencia media parte del ano.
--
--  3. RLS EN TODAS LAS TABLAS, NEGANDO POR DEFECTO.  Se activa en cuanto la
--     tabla nace, no despues. Una tabla que existe unos minutos sin RLS es una
--     tabla que alguien puede leer entera en esos minutos.
--
--  ---------------------------------------------------------------------------
--  QUIEN HABLA CON ESTA BASE DE DATOS
--  ---------------------------------------------------------------------------
--
--      KIOSCO      nunca, directamente. Solo llama Edge Functions, que usan
--                  `service_role` (CLAUDE.md 3.2). La llave `service_role`
--                  JAMAS viaja dentro del .exe.
--
--      PANEL       con Supabase Auth, como rol `authenticated`. Lo que puede
--                  ver y tocar lo deciden las politicas RLS de cada tabla.
--
--      anon        nadie. Se le quita todo explicitamente.

-- ----------------------------------------------------------------------------
--  Extensiones
-- ----------------------------------------------------------------------------
-- `pgcrypto` da `crypt()` y `gen_salt()`, que generan hashes bcrypt
-- compatibles con los que hace `bcryptjs` en el kiosco. Esa compatibilidad es
-- lo que permite que un PIN creado desde el panel se pueda verificar sin
-- internet en el kiosco (CLAUDE.md 3.4).
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
--  Nadie anonimo toca nada
-- ----------------------------------------------------------------------------
-- Supabase da permisos amplios al rol `anon` por costumbre. Este sistema no
-- tiene ni una sola cosa publica: se los quitamos de entrada y no se los
-- devolvemos en ninguna migracion posterior.
revoke all on schema public from anon;
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;


-- ============================================================================
--  CONFIGURACION
-- ============================================================================
--
--  La tabla que hace que el sistema se adapte sin reinstalar nada.
--
--  CLAUDE.md 1.3: "Cualquier regla de negocio que el cliente pueda querer
--  cambiar se ajusta desde el panel administrativo, sin recompilar ni
--  reinstalar nada."
--
--  Clave y valor, con el valor en `jsonb`. ¿Por que jsonb y no texto?
--  Porque hay valores que son numeros, otros que son booleanos y alguno que
--  sera una lista. Con texto habria que convertir en cada lectura y confiar
--  en que nadie escribio "diez" donde iba un 10.

create table configuracion (
  clave        text primary key,
  valor        jsonb not null,

  -- Para que la pantalla de configuracion del panel pueda explicarle al jefe
  -- que hace cada cosa, sin que nadie tenga que abrir el codigo.
  descripcion  text not null,

  -- Agrupa las claves en la pantalla del panel: 'tiempo', 'camara', 'pin'...
  grupo        text not null default 'general',

  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users (id)
);

comment on table configuracion is
  'Valores operativos que el jefe cambia desde el panel. El kiosco los recibe '
  'al sincronizar y los guarda en configuracion_cache para seguir funcionando '
  'sin internet.';

alter table configuracion enable row level security;


-- ----------------------------------------------------------------------------
--  Valores iniciales
-- ----------------------------------------------------------------------------
--  Son los supuestos de CLAUDE.md 1.2.
--  NO son invenciones: son decisiones tomadas por el equipo, escritas donde el
--  cliente pueda cambiarlas al ver el sistema funcionando.
insert into configuracion (clave, valor, descripcion, grupo) values
  ('zona_horaria', '"America/Matamoros"'::jsonb,
   'Zona horaria oficial del sistema. Nuevo Laredo esta en la franja fronteriza y SI tiene horario de verano.',
   'tiempo'),

  ('tolerancia_retardo_minutos', '10'::jsonb,
   'Minutos de gracia despues de la hora de entrada antes de contar retardo.',
   'asistencia'),

  ('minutos_para_falta', '30'::jsonb,
   'A partir de cuantos minutos tarde se cuenta como falta en vez de retardo.',
   'asistencia'),

  ('horas_para_cierre_automatico', '16'::jsonb,
   'Tras cuantas horas una entrada sin salida se marca como salida_no_registrada. NO se inventa la hora de salida.',
   'asistencia'),

  ('dias_retencion_fotos', '30'::jsonb,
   'Dias que se conservan las fotos antes de borrarse. Los datos de asistencia NO se borran.',
   'privacidad'),

  ('intentos_pin_maximos', '4'::jsonb,
   'Intentos fallidos seguidos antes de bloquear temporalmente a un empleado.',
   'pin'),

  ('segundos_bloqueo_pin', '300'::jsonb,
   'Cuanto dura el bloqueo por intentos fallidos.',
   'pin'),

  ('minutos_olvidar_intentos', '15'::jsonb,
   'Tras cuantos minutos sin fallos se reinicia el contador de intentos.',
   'pin'),

  ('umbral_brillo_minimo', '45'::jsonb,
   'Debajo de este brillo promedio la foto se marca como obstruida.',
   'camara'),

  ('umbral_varianza_minima', '250'::jsonb,
   'Debajo de esta varianza (textura) la foto se marca como obstruida.',
   'camara'),

  ('minutos_camara_caida_alerta', '15'::jsonb,
   'Tras cuantos minutos sin camara el panel levanta una alerta.',
   'camara'),

  ('umbral_desfase_reloj_ms', '60000'::jsonb,
   'Diferencia maxima tolerada entre el reloj de Windows y el cronometro interno antes de marcar reloj_sospechoso.',
   'tiempo'),

  ('minutos_kiosco_sin_conexion_alerta', '60'::jsonb,
   'Tras cuantos minutos sin heartbeat el panel marca un kiosco como caido.',
   'dispositivos');


-- ============================================================================
--  FUNCIONES DE TIEMPO
-- ============================================================================

-- ----------------------------------------------------------------------------
--  zona_horaria()
-- ----------------------------------------------------------------------------
--  La unica fuente de verdad sobre la zona. Todo calculo de hora local pasa
--  por aqui.
--
--  `stable` le dice a Postgres que dentro de una misma consulta el resultado
--  no cambia, asi que puede llamarla una vez en vez de una por fila. En una
--  consulta de mil marcas, eso es mil lecturas menos.
--
--  El `coalesce` es la red de seguridad: si alguien borrara la fila de
--  configuracion, el sistema seguiria calculando bien en vez de fallar o, peor,
--  caer en UTC en silencio y correr todas las horas.
create or replace function zona_horaria()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select valor #>> '{}' from configuracion where clave = 'zona_horaria'),
    'America/Matamoros'
  );
$$;

comment on function zona_horaria() is
  'La zona horaria configurada. PROHIBIDO escribir la zona a mano en una '
  'consulta: siempre llamar a esta funcion.';


-- ----------------------------------------------------------------------------
--  hora_local(timestamptz)
-- ----------------------------------------------------------------------------
--  Convierte un instante a la hora de pared de Nuevo Laredo.
--
--  `AT TIME ZONE` con un `timestamptz` devuelve un `timestamp` SIN zona: es
--  literalmente "que hora marcaba el reloj de la pared ahi en ese momento".
--  Es lo correcto para mostrar y para decidir a que dia pertenece algo.
create or replace function hora_local(momento timestamptz)
returns timestamp
language sql
stable
as $$
  select momento at time zone zona_horaria();
$$;


-- ----------------------------------------------------------------------------
--  fecha_laboral(timestamptz)
-- ----------------------------------------------------------------------------
--  A que DIA pertenece una marca.
--
--  Parece obvio y no lo es. La fecha se calcula en hora LOCAL, no en UTC: una
--  salida a las 22:30 del martes en Nuevo Laredo es el 03:30 UTC del miercoles.
--  Si la fecha se sacara de UTC, esa salida apareceria un dia despues de su
--  entrada y la jornada quedaria partida en dos.
--
--  ⚠ TURNO NOCTURNO: para el turno de 22:00 a 06:00, la salida de las 06:00
--  cae en el dia siguiente por hora local, y aun asi pertenece a la jornada
--  que empezo la noche anterior. Resolverlo necesita saber el turno del
--  empleado, asi que se hace en la fase 3, al emparejar entradas con salidas.
--  Esta funcion da la fecha de calendario local, que es la base correcta sobre
--  la que ese calculo se apoya — no el calculo completo.
create or replace function fecha_laboral(momento timestamptz)
returns date
language sql
stable
as $$
  select (momento at time zone zona_horaria())::date;
$$;

comment on function fecha_laboral(timestamptz) is
  'Dia de calendario LOCAL al que pertenece un instante. Para el turno '
  'nocturno, la jornada se arma en la fase 3 usando el turno del empleado.';


-- ============================================================================
--  UTILIDADES COMUNES
-- ============================================================================

-- ----------------------------------------------------------------------------
--  tocar_actualizado_en()
-- ----------------------------------------------------------------------------
--  Trigger que mantiene al dia la columna `actualizado_en`.
--
--  ¿Por que no dejarlo a la aplicacion? Porque `actualizado_en` es la columna
--  de la que depende la sincronizacion incremental del kiosco (CLAUDE.md 7:
--  "sincronizacion incremental por actualizado_en"). Si una sola consulta se
--  olvidara de actualizarla, ese registro dejaria de bajar a los kioscos y
--  nadie lo notaria: el empleado con el PIN nuevo simplemente no podria entrar,
--  sin ningun error que lo explicara.
--
--  En la base de datos, en cambio, es imposible olvidarlo.
create or replace function tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
--  actor_actual()
-- ----------------------------------------------------------------------------
--  Quien esta haciendo el cambio, para la bitacora de auditoria.
--
--  Hay dos formas de llegar a esta base y cada una identifica distinto:
--
--    PANEL          entra con Supabase Auth  ->  `auth.uid()` tiene el usuario.
--    EDGE FUNCTION  entra con service_role   ->  `auth.uid()` es NULL, porque
--                   no hay ninguna persona conectada: es el kiosco.
--
--  Para el segundo caso, la Edge Function declara a nombre de quien actua con:
--      select set_config('app.actor', '<uuid del admin>', true);
--
--  El `true` final lo limita a la transaccion en curso, asi que no se puede
--  filtrar a la siguiente peticion.
--
--  Si no hay ninguno de los dos, devuelve NULL, y eso en la bitacora se lee
--  como "lo hizo el sistema" — que es exactamente lo que paso.
create or replace function actor_actual()
returns uuid
language plpgsql
stable
as $$
declare
  declarado text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;

  -- `true` en current_setting = "si no existe, devuelve NULL en vez de fallar".
  declarado := current_setting('app.actor', true);

  if declarado is null or declarado = '' then
    return null;
  end if;

  return declarado::uuid;
exception
  -- Un texto que no sea un UUID no debe tumbar la operacion: la bitacora es
  -- importante, pero no mas que el registro que se esta guardando.
  when others then
    return null;
end;
$$;
