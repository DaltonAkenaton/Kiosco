-- ============================================================================
--  0004 · DISPOSITIVOS  (los kioscos) Y SU ENROLAMIENTO
-- ============================================================================
--
--  ARQUITECTURA.md 3.3. El problema que resuelve esta migracion:
--
--      ¿como sabe el servidor que quien le manda marcas es un kiosco de
--      verdad, y no cualquiera con la URL?
--
--  No se puede resolver metiendo una contrasena dentro del .exe: "todo lo
--  empaquetado en el .exe se considera publico" (ARQUITECTURA.md 3.2). Una contrasena
--  igual para todos los kioscos es una contrasena que el primero que abra el
--  instalador con un editor de texto puede leer.
--
--  La solucion es que cada kiosco tenga la SUYA, y que se la gane al
--  instalarse:
--
--      1. El jefe genera un codigo de 8 caracteres en el panel. Dura 15 min.
--      2. Lo teclea en el kiosco recien instalado.
--      3. El servidor lo canjea por un token largo y aleatorio, y se queda
--         solo con su HASH.
--      4. El kiosco guarda su token cifrado con DPAPI de Windows. Copiado a
--         otra PC no se puede descifrar: eso es intencional.
--
--  Es el mismo patron del "pase" de la pantalla de confirmacion, un escalon
--  mas arriba: algo de un solo uso se canjea por algo duradero, y el servidor
--  nunca guarda el secreto, solo su huella.

create table dispositivos (
  id         uuid primary key default gen_random_uuid(),

  -- Como lo va a llamar el jefe en el panel: "Entrada principal",
  -- "Edificio B". Tiene que ser reconocible desde una oficina, por alguien
  -- que no estuvo cuando se instalo.
  nombre     text not null,
  ubicacion  text not null default '',

  /*
    EL HASH DEL TOKEN, NUNCA EL TOKEN.

    Si la base se filtrara, con esto nadie puede hacerse pasar por un kiosco.
    Es la misma razon por la que no se guardan los PINes en claro.

    Aqui basta SHA-256 y no hace falta bcrypt: el token son 32 bytes
    aleatorios, no una palabra que alguien eligio. Bcrypt existe para hacer
    lento el probar millones de contrasenas humanas, y contra 2^256
    posibilidades ningun numero de intentos alcanza. Poner bcrypt aqui seria
    pagar lentitud en cada peticion del kiosco a cambio de nada.
  */
  token_hash text not null unique,

  activo     boolean not null default true,

  enrolado_en  timestamptz not null default now(),
  enrolado_por uuid references auth.users (id),

  /*
    REVOCAR NO ES BORRAR, Y LA FECHA ES EL MOTIVO.

    Cuando se cambia la PC de un kiosco, la anterior se revoca. Pero esa PC
    pudo haber registrado marcas ANTES de la revocacion que todavia no habia
    subido — justo el caso de "la PC se retiro sin aviso" del ARQUITECTURA.md 7.

    Con esta fecha se puede distinguir:
      evento ANTES de revocado_en  -> se acepta, en cuarentena para revisar
      evento DESPUES               -> se rechaza

    Descartar en silencio las marcas de un dispositivo revocado seria perder
    asistencia real de gente que si trabajo (ARQUITECTURA.md 3.3).
  */
  revocado_en  timestamptz,
  revocado_por uuid references auth.users (id),

  -- Lo que reporta el heartbeat (ARQUITECTURA.md 7). Es lo que el panel muestra
  -- como "ultima conexion" y lo que permite alertar de un kiosco caido.
  ultima_conexion timestamptz,
  version_app     text,
  camara_ok       boolean,
  pendientes      integer not null default 0,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Un dispositivo revocado tiene fecha; uno activo no. El CHECK impide los
  -- dos estados imposibles: "activo pero revocado" y "revocado sin cuando".
  constraint dispositivos_revocacion_coherente
    check ((activo and revocado_en is null) or (not activo and revocado_en is not null))
);

comment on table dispositivos is
  'Los kioscos autorizados. Cada uno tiene su propio token; el servidor guarda '
  'solo el hash.';

create index dispositivos_activos_idx on dispositivos (activo) where activo;

create trigger dispositivos_tocar_actualizado
  before update on dispositivos
  for each row execute function tocar_actualizado_en();

alter table dispositivos enable row level security;


-- ----------------------------------------------------------------------------
--  Politicas
-- ----------------------------------------------------------------------------
--  El panel LEE (para mostrar el estado de cada kiosco) pero no escribe.
--
--  Enrolar, revocar y recibir heartbeats pasa todo por Edge Functions con
--  service_role. ¿Por que? Porque enrolar implica generar un token y guardar su
--  hash, y revocar implica poner tres columnas coherentes entre si. Dejar eso
--  como un UPDATE suelto desde el panel es invitar a que un dia quede un
--  dispositivo con `activo = false` y `revocado_en = null`, o a que el token se
--  genere en el navegador — donde no hay un generador criptografico confiable
--  ni forma de evitar que quede en la memoria del cliente.

create policy dispositivos_leer on dispositivos
  for select to authenticated
  using (es_administrador());


-- ============================================================================
--  CODIGOS DE ENROLAMIENTO
-- ============================================================================
--
--  El papelito de un solo uso con el que un kiosco nuevo se presenta.

create table codigos_enrolamiento (
  id  uuid primary key default gen_random_uuid(),

  /*
    TAMBIEN HASHEADO.

    Parece exagerado para un codigo que dura 15 minutos. No lo es: durante esos
    15 minutos, ese codigo VALE UN KIOSCO. Quien lo lea puede enrolar un
    dispositivo propio y empezar a mandar marcas.

    Y el panel no es el unico que ve la base: quien tenga acceso de lectura
    —hoy cualquier administrador— podria leer los codigos pendientes de otros.
    Guardando el hash, el codigo existe en claro solo en la pantalla de quien
    lo genero y en el papelito donde lo anoto.
  */
  codigo_hash text not null unique,

  creado_por  uuid not null references auth.users (id),
  creado_en   timestamptz not null default now(),

  -- 15 minutos (ARQUITECTURA.md 3.3). Suficiente para caminar del escritorio al
  -- kiosco y teclearlo; poco para que sirva de algo si se queda en un papel.
  expira_en   timestamptz not null,

  -- Cuando se uso y por quien. Un codigo con `usado_en` lleno ya no vale:
  -- es lo que lo hace de un solo uso.
  usado_en       timestamptz,
  dispositivo_id uuid references dispositivos (id),

  constraint codigos_uso_coherente
    check ((usado_en is null and dispositivo_id is null)
        or (usado_en is not null and dispositivo_id is not null))
);

comment on table codigos_enrolamiento is
  'Codigos de un solo uso para dar de alta un kiosco. 8 caracteres, 15 minutos.';

-- Para buscar rapido los que todavia sirven.
create index codigos_vigentes_idx on codigos_enrolamiento (expira_en)
  where usado_en is null;

alter table codigos_enrolamiento enable row level security;

/*
  NINGUNA POLITICA. Ni siquiera de lectura.

  Esta es la unica tabla del sistema que ni los administradores pueden
  consultar, y es a proposito: aunque solo guarde hashes, no hay ninguna razon
  legitima para que el panel lea codigos ajenos. Generarlos y canjearlos es
  trabajo de Edge Functions, que entran con service_role y saltan la RLS.

  Quien genera un codigo lo ve UNA vez, en la respuesta de la Edge Function.
  Si lo pierde, genera otro: cuestan nada y expiran solos.
*/


-- ----------------------------------------------------------------------------
--  Limpieza de codigos vencidos
-- ----------------------------------------------------------------------------
--  Se llamara desde la tarea programada de la fase 4, junto con el borrado de
--  fotos vencidas.
--
--  Los usados SI se conservan: son el rastro de cuando y por quien se enrolo
--  cada kiosco, que es justo lo que uno quiere poder consultar el dia que
--  aparezca un dispositivo que nadie recuerda haber dado de alta.
create or replace function limpiar_codigos_vencidos()
returns integer
language sql
security definer
set search_path = public
as $$
  with borrados as (
    delete from codigos_enrolamiento
     where usado_en is null
       and expira_en < now()
    returning 1
  )
  select count(*)::integer from borrados;
$$;
