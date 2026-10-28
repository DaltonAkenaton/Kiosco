-- ============================================================================
--  0003 · EMPLEADOS
-- ============================================================================
--
--  El personal de limpieza. Es la tabla que el kiosco baja en cada
--  sincronizacion para poder validar PINes sin internet (ARQUITECTURA.md 7).

create table empleados (
  id  uuid primary key default gen_random_uuid(),

  /*
    CON QUE SE IDENTIFICA EN EL KIOSCO: "dgomez".

    Primera letra del nombre + apellido paterno. Es lo que se teclea, asi que
    es unico y siempre en minusculas — el CHECK lo garantiza en vez de confiar
    en que todas las consultas se acuerden.

    ¿Por que no el numero de empleado? Porque en la practica nadie se lo sabe,
    y pedirselo a las 6 de la manana garantiza que no pueda checar
    (ARQUITECTURA.md 3.4). El numero se conserva abajo, pero como referencia
    administrativa.
  */
  usuario  text not null unique
             check (usuario = lower(usuario) and usuario ~ '^[a-z][a-z.]{2,19}$'),

  -- El del gafete. NULLABLE a proposito: si la facultad no lo tiene
  -- registrado, el empleado igual existe y igual puede checar.
  numero_empleado  text unique,

  nombre           text not null,
  apellido_paterno text not null,
  apellido_materno text not null default '',

  /*
    EL PIN, COMO HASH BCRYPT. NUNCA EN CLARO.

    El formato es el de `crypt(pin, gen_salt('bf'))` de pgcrypto, que es el
    mismo que produce `bcryptjs` en el kiosco. Esa compatibilidad es lo que
    permite que un PIN puesto desde el panel se verifique sin internet en el
    kiosco (ARQUITECTURA.md 3.4).

    El CHECK exige que empiece con `$2`, la firma de bcrypt. Es una red contra
    el peor error posible de todos: que alguien guarde aqui el PIN tal cual.
    Si eso pasara, todo seguiria funcionando —el kiosco compararia texto con
    texto y nadie notaria nada— y tendriamos los PINes de todo el personal en
    claro dentro de la base.
  */
  pin_hash  text not null check (pin_hash like '$2%'),

  -- El jefe reseteo el PIN: conviene avisarle al empleado que lo cambie.
  pin_temporal  boolean not null default false,

  /*
    Dar de baja NO borra. El empleado se desactiva, y en la siguiente
    sincronizacion los kioscos lo desactivan tambien (ARQUITECTURA.md 7).

    Borrarlo dejaria sus marcas apuntando a nadie, y esas marcas son el
    registro de asistencia de los meses que si trabajo.
  */
  activo  boolean not null default true,

  /*
    FASE 2 (ARQUITECTURA.md 13.3): foto de referencia para que quien revise pueda
    comparar contra la foto del checado.

    La columna existe DESDE AHORA aunque la funcion no. Es a proposito: agregar
    una columna despues obliga a una migracion en produccion, y este sistema lo
    va a mantener alguien que no es programador. Una columna nula no cuesta
    nada; una migracion a destiempo, si.
  */
  foto_referencia_path  text,

  creado_en      timestamptz not null default now(),

  /*
    DE ESTA COLUMNA DEPENDE LA SINCRONIZACION.

    El kiosco baja solo lo que cambio desde su ultima consulta
    (ARQUITECTURA.md 7: "sincronizacion incremental por actualizado_en"). La mantiene
    un trigger, no la aplicacion: ver `tocar_actualizado_en()` en 0001.
  */
  actualizado_en timestamptz not null default now()
);

comment on table empleados is
  'El personal. Se identifica con `usuario` + PIN. El hash del PIN baja a los '
  'kioscos para poder validar sin internet.';

-- El kiosco pide "los empleados activos que cambiaron desde X". Este indice
-- es exactamente esa consulta.
create index empleados_sincronizacion_idx on empleados (actualizado_en)
  where activo;

create trigger empleados_tocar_actualizado
  before update on empleados
  for each row execute function tocar_actualizado_en();

alter table empleados enable row level security;


-- ----------------------------------------------------------------------------
--  Politicas
-- ----------------------------------------------------------------------------

create policy empleados_leer on empleados
  for select to authenticated
  using (es_administrador());

create policy empleados_insertar on empleados
  for insert to authenticated
  with check (puede_administrar());

create policy empleados_actualizar on empleados
  for update to authenticated
  using (puede_administrar())
  with check (puede_administrar());

/*
  Sin DELETE para nadie, por lo mismo que en administradores: borrar a alguien
  dejaria sus marcas apuntando a un empleado inexistente. La baja es
  `activo = false`.

  El unico caso en que un empleado debe desaparecer de verdad es un derecho de
  supresion de datos personales (ARQUITECTURA.md 12), y eso NO es un DELETE: es una
  anonimizacion registrada en bitacora, que conserva las marcas —porque la
  asistencia es un registro laboral— y borra lo que identifica a la persona.
  Se construye en la fase 4, como una funcion dedicada.
*/


-- ============================================================================
--  PONER Y VERIFICAR PINES
-- ============================================================================
--
--  Van como funciones y no como consultas sueltas por una razon concreta: para
--  que el PIN en claro NUNCA llegue a una columna, ni a un log, ni al historial
--  de consultas del panel.
--
--  El panel llama `establecer_pin(empleado, '1234')` y lo que viaja a la tabla
--  es ya el hash.

-- ----------------------------------------------------------------------------
--  establecer_pin()
-- ----------------------------------------------------------------------------
--  El costo 10 de bcrypt es el mismo que usa el kiosco
--  (SEGURIDAD_PIN.costoBcrypt). Tienen que coincidir: no por seguridad —un
--  hash de costo 10 se verifica igual desde cualquier lado— sino porque asi
--  hay UN solo numero que revisar el dia que se decida subirlo.
create or replace function establecer_pin(
  p_empleado_id uuid,
  p_pin         text,
  p_temporal    boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- El permiso se comprueba AQUI dentro, no fuera. Una funcion
  -- `security definer` salta la RLS, asi que si no preguntara, cualquier
  -- usuario autenticado podria cambiarle el PIN a quien quisiera.
  if not puede_administrar() then
    raise exception 'Solo un administrador puede cambiar un PIN';
  end if;

  -- El largo lo decide el sistema, no quien llama. Cuatro digitos exactos
  -- (IDENTIFICACION.largoPinMinimo/Maximo en el kiosco).
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'El PIN debe ser de 4 digitos';
  end if;

  update empleados
     set pin_hash     = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
         pin_temporal = p_temporal
   where id = p_empleado_id;

  if not found then
    raise exception 'No existe ese empleado';
  end if;
end;
$$;

comment on function establecer_pin(uuid, text, boolean) is
  'Guarda el PIN ya hasheado. El PIN en claro nunca toca una columna. Solo lo '
  'puede llamar el rol admin.';


-- ----------------------------------------------------------------------------
--  verificar_pin()
-- ----------------------------------------------------------------------------
--  La usan las Edge Functions (bloque 5) cuando un kiosco recien enrolado
--  todavia no ha bajado el catalogo.
--
--  OJO: el camino normal NO pasa por aqui. Lo normal es que el kiosco valide
--  el PIN contra su copia local, sin red, que es lo que hace que el sistema
--  funcione sin internet (ARQUITECTURA.md 7). Esta funcion es el respaldo.
create or replace function verificar_pin(p_usuario text, p_pin text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select id
    from empleados
   where usuario = lower(p_usuario)
     and activo
     -- `crypt(pin, hash)` re-aplica la sal que ya viene dentro del hash. Si el
     -- resultado es igual al hash, el PIN es correcto. Nunca se "des-hashea"
     -- nada: los hashes no se pueden revertir, esa es la idea.
     and pin_hash = extensions.crypt(p_pin, pin_hash);
$$;

comment on function verificar_pin(text, text) is
  'Devuelve el id del empleado si el PIN es correcto, o NULL. Respaldo para '
  'kioscos sin catalogo: el camino normal valida sin red, en el kiosco.';
