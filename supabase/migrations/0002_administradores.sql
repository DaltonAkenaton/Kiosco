-- ============================================================================
--  0002 · ADMINISTRADORES  (quien puede entrar al panel)
-- ============================================================================
--
--  Esta migracion va temprano a proposito: define QUIEN es admin, y todas las
--  politicas RLS de las demas tablas se apoyan en eso. Sin ella, cualquier
--  otra tabla tendria que inventarse su propia idea de "usuario autorizado".
--
--  ---------------------------------------------------------------------------
--  POR QUE HAY UNA TABLA APARTE SI SUPABASE YA TIENE `auth.users`
--  ---------------------------------------------------------------------------
--  Porque `auth.users` responde "¿esta persona puede iniciar sesion?", que no
--  es la pregunta que importa. La que importa es "¿esta persona puede ver la
--  asistencia del personal?".
--
--  Tener las dos juntas seria un problema real: bastaria que alguien se
--  registrara con correo y contrasena para quedar dentro. Con esta tabla,
--  registrarse no sirve de nada hasta que un administrador da de alta a esa
--  persona aqui.
--
--  Dar de baja tambien es mas limpio: se pone `activo = false` y se acabo, sin
--  borrar el usuario de autenticacion ni perder su rastro en la bitacora.

create table administradores (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,

  /*
    ROLES.  Se
    asume lo minimo que hace falta para empezar y queda facil de ampliar:

      'admin'       puede todo: cambiar configuracion, dar de alta empleados,
                    corregir marcas, revocar dispositivos.
      'supervisor'  puede VER todo y registrar asistencia manual, pero no
                    cambiar reglas ni dar de alta a nadie.

    La division no es caprichosa: separa "consultar la asistencia" —que puede
    querer hacer un jefe de area— de "cambiar como funciona el sistema", que
    deberia hacer una sola persona. Si el cliente pide otra cosa, se agregan
    valores a este CHECK y se ajustan las dos funciones de abajo.
  */
  rol         text not null default 'supervisor'
                check (rol in ('admin', 'supervisor')),

  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table administradores is
  'Quien puede usar el panel. Estar en auth.users NO basta: hay que estar aqui '
  'y con activo = true.';

create index administradores_activos_idx on administradores (activo)
  where activo;

create trigger administradores_tocar_actualizado
  before update on administradores
  for each row execute function tocar_actualizado_en();

alter table administradores enable row level security;


-- ============================================================================
--  LAS DOS FUNCIONES DE LAS QUE CUELGA TODA LA SEGURIDAD DEL PANEL
-- ============================================================================
--
--  ⚠ EL DETALLE MAS IMPORTANTE DE ESTE ARCHIVO: `security definer`.
--
--  Sin eso, esto no funcionaria — y no por un permiso, sino por una RECURSION
--  INFINITA:
--
--      para saber si puedes leer `administradores`
--        hay que ejecutar su politica RLS
--          que llama a esta funcion
--            que lee `administradores`
--              que ejecuta su politica RLS
--                que llama a esta funcion...
--
--  `security definer` hace que la funcion corra con los permisos de QUIEN LA
--  CREO (el dueno de la base), no de quien la llama. Asi salta la RLS de la
--  tabla y el ciclo se rompe.
--
--  Y como una funcion con `security definer` es poderosa, lleva
--  `set search_path = public` obligatorio: sin eso, alguien podria crear un
--  esquema propio con una tabla llamada `administradores`, ponerlo delante en
--  su search_path, y hacer que esta funcion lea SU tabla en vez de la de
--  verdad. Es un ataque conocido y la defensa cabe en una linea.

-- ----------------------------------------------------------------------------
--  es_administrador() — ¿puede VER?
-- ----------------------------------------------------------------------------
create or replace function es_administrador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from administradores
    where user_id = auth.uid()
      and activo
  );
$$;

comment on function es_administrador() is
  'true si quien llama es un administrador o supervisor ACTIVO. Es la base de '
  'todas las politicas de lectura del panel.';


-- ----------------------------------------------------------------------------
--  puede_administrar() — ¿puede CAMBIAR?
-- ----------------------------------------------------------------------------
--  Separada de la anterior a proposito. Ver la asistencia y cambiar las reglas
--  del sistema son cosas de distinto peso, y mezclarlas en un solo permiso
--  obliga a dar de mas para poder dar algo.
create or replace function puede_administrar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from administradores
    where user_id = auth.uid()
      and activo
      and rol = 'admin'
  );
$$;

comment on function puede_administrar() is
  'true solo para el rol admin. Los supervisores ven todo pero no cambian '
  'reglas ni dan de alta a nadie.';


-- ============================================================================
--  POLITICAS
-- ============================================================================

-- Cualquier administrador activo ve la lista completa. Es informacion util y
-- poco sensible: saber quien mas administra el sistema ayuda a pedir ayuda.
create policy administradores_leer on administradores
  for select to authenticated
  using (es_administrador());

/*
  Y ademas: cada quien puede leer SU PROPIA fila aunque no sea admin activo.

  Esta politica parece redundante y no lo es. Resuelve el arranque: alguien
  recien dado de alta que entra al panel necesita poder preguntar "¿estoy en la
  lista?". Sin esto, la respuesta a esa pregunta seria "no tienes permiso para
  saberlo", y el panel no tendria forma de distinguir entre "no eres admin" y
  "hubo un error de red".

  Tambien es lo que permite mostrar un mensaje decente a quien fue dado de baja:
  puede ver su fila con `activo = false` y entender por que no puede entrar.
*/
create policy administradores_leer_propio on administradores
  for select to authenticated
  using (user_id = auth.uid());

-- Dar de alta, cambiar el rol o dar de baja: solo un admin.
create policy administradores_insertar on administradores
  for insert to authenticated
  with check (puede_administrar());

create policy administradores_actualizar on administradores
  for update to authenticated
  using (puede_administrar())
  with check (puede_administrar());

/*
  NO hay politica de DELETE, y es deliberado.

  Borrar un administrador dejaria huerfanas sus entradas en la bitacora de
  auditoria: correcciones y registros manuales firmados por un uuid que ya no
  existe. Dar de baja es `activo = false`, que conserva el rastro y es
  reversible.

  Sin politica de DELETE, la operacion simplemente no existe para nadie que
  entre por el panel.
*/


-- ============================================================================
--  CONFIGURACION: sus politicas, ahora que ya se sabe quien es admin
-- ============================================================================
--
--  La tabla nacio en 0001 con RLS activada y sin ninguna politica, o sea
--  negando todo. Aqui se abre lo justo.

-- Todos los administradores la leen: el panel necesita mostrar los valores
-- vigentes aunque quien mire no pueda cambiarlos.
create policy configuracion_leer on configuracion
  for select to authenticated
  using (es_administrador());

-- Cambiarla, solo el rol admin. Es la pantalla que altera como se comporta
-- todo el sistema (ARQUITECTURA.md 10).
create policy configuracion_actualizar on configuracion
  for update to authenticated
  using (puede_administrar())
  with check (puede_administrar());

/*
  Sin INSERT ni DELETE para nadie.

  Las claves de configuracion no son datos que el jefe cree: son las opciones
  que el sistema sabe interpretar. Una clave nueva no sirve de nada si ningun
  codigo la lee, y una borrada dejaria al kiosco sin un valor que espera.

  Agregar o quitar claves es cosa de una migracion, que es donde tambien se
  escribe el codigo que las usa.
*/
