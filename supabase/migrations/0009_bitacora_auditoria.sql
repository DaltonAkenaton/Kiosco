-- ============================================================================
--  0009 · BITACORA DE AUDITORIA
-- ============================================================================
--
--  Quien cambio que, cuando, y como estaba antes.
--
--  CLAUDE.md 8: "bitacora_auditoria: llenada por TRIGGERS."
--
--  Esa palabra —triggers— es toda la decision. Podria llenarla la aplicacion,
--  y seria mas facil de leer. Pero entonces la bitacora registraria solo lo que
--  la aplicacion se acordo de registrar, y justo lo que uno quiere auditar es
--  lo que pasa FUERA del camino previsto: una consulta corrida a mano, una Edge
--  Function con un error, alguien con acceso directo a la base.
--
--  Un trigger no se puede saltar desde la aplicacion. Si la fila cambio, quedo
--  escrito.
--
--  ---------------------------------------------------------------------------
--  QUE SE AUDITA Y QUE NO
--  ---------------------------------------------------------------------------
--  Se auditan las tablas donde una persona toma una DECISION: cambiar una
--  regla, dar de alta a alguien, autorizar unas vacaciones, revocar un kiosco.
--
--  NO se auditan `marcas` ni `eventos_dispositivo`. No por descuido: es que ahi
--  la propia tabla ya es la bitacora. Las marcas son inmutables (migracion
--  0005), asi que nunca hay un "antes" que guardar, y duplicar cada insercion
--  doblaria el tamano de la base para no decir nada nuevo.

create table bitacora_auditoria (
  id bigint generated always as identity primary key,

  tabla       text not null,
  registro_id text not null,   -- text y no uuid: sirve para cualquier llave

  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),

  -- La fila completa, antes y despues. En un INSERT no hay antes; en un
  -- DELETE no hay despues.
  datos_antes   jsonb,
  datos_despues jsonb,

  /*
    Quien lo hizo. Puede ser NULL, y eso significa algo concreto: lo hizo el
    sistema, no una persona — una Edge Function o una tarea programada que no
    declaro actor. Ver `actor_actual()` en la migracion 0001.
  */
  actor     uuid references auth.users (id),
  creado_en timestamptz not null default now()
);

comment on table bitacora_auditoria is
  'Quien cambio que y como estaba antes. La llenan triggers, no la aplicacion: '
  'asi tambien registra lo que ocurre fuera del camino previsto.';

create index bitacora_tabla_registro_idx on bitacora_auditoria (tabla, registro_id, creado_en desc);
create index bitacora_actor_idx on bitacora_auditoria (actor, creado_en desc);
create index bitacora_fecha_idx on bitacora_auditoria (creado_en desc);

alter table bitacora_auditoria enable row level security;

/*
  Solo lectura, y solo para el rol admin.

  No hay politica de INSERT y no hace falta: el trigger corre como `security
  definer`, con los permisos de quien lo creo, asi que escribe aunque la RLS le
  niegue todo a quien disparo el cambio.

  Y no hay UPDATE ni DELETE para NADIE. Una bitacora que se puede editar no es
  una bitacora. Si algun dia hubiera que purgarla por tamano, seria con una
  migracion revisada, no con una consulta suelta desde el panel.
*/
create policy bitacora_leer on bitacora_auditoria
  for select to authenticated
  using (puede_administrar());

revoke insert, update, delete on bitacora_auditoria from authenticated;


-- ============================================================================
--  EL TRIGGER GENERICO
-- ============================================================================
--
--  Uno solo para todas las tablas. `TG_TABLE_NAME` y `TG_OP` le dicen a la
--  funcion donde y por que se disparo, asi que no hace falta una version por
--  tabla.
--
--  Eso importa mas de lo que parece: con una funcion por tabla, agregar una
--  columna sensible a `empleados` obligaria a acordarse de actualizar SU
--  auditoria. Con una generica, queda cubierta sola.

create or replace function auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fila_antes   jsonb;
  fila_despues jsonb;
  id_registro  text;
begin
  if tg_op = 'INSERT' then
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', '?');
  elsif tg_op = 'UPDATE' then
    fila_antes   := to_jsonb(old);
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', '?');
  else
    fila_antes  := to_jsonb(old);
    id_registro := coalesce(fila_antes ->> 'id', fila_antes ->> 'clave', '?');
  end if;

  /*
    ⚠ EL HASH DEL PIN NUNCA ENTRA A LA BITACORA.

    Sin esto, cada reseteo de PIN dejaria el hash anterior guardado aqui para
    siempre. Y la bitacora es la tabla que MENOS se borra de todo el sistema:
    tendriamos un historial completo de todos los hashes de PIN que ha tenido
    cada empleado, acumulandose durante anos, en una tabla que nadie revisa.

    Se reemplaza por una marca de que existia, que es lo unico que importa para
    auditar: se puede ver QUE se cambio el PIN y CUANDO, sin guardar nada
    reversible. Lo mismo con el token de un dispositivo.

    (CLAUDE.md 16: "Nunca registrar PINes, tokens ni fotos en logs." Una
    bitacora es un log, aunque viva en una tabla.)
  */
  if fila_antes ? 'pin_hash' then
    fila_antes := jsonb_set(fila_antes, '{pin_hash}', '"[oculto]"'::jsonb);
  end if;
  if fila_despues ? 'pin_hash' then
    fila_despues := jsonb_set(fila_despues, '{pin_hash}', '"[oculto]"'::jsonb);
  end if;

  if fila_antes ? 'token_hash' then
    fila_antes := jsonb_set(fila_antes, '{token_hash}', '"[oculto]"'::jsonb);
  end if;
  if fila_despues ? 'token_hash' then
    fila_despues := jsonb_set(fila_despues, '{token_hash}', '"[oculto]"'::jsonb);
  end if;

  if fila_antes ? 'codigo_hash' then
    fila_antes := jsonb_set(fila_antes, '{codigo_hash}', '"[oculto]"'::jsonb);
  end if;
  if fila_despues ? 'codigo_hash' then
    fila_despues := jsonb_set(fila_despues, '{codigo_hash}', '"[oculto]"'::jsonb);
  end if;

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor)
  values (tg_table_name, id_registro, tg_op, fila_antes, fila_despues, actor_actual());

  -- En un trigger AFTER el valor de retorno se ignora, pero devolver algo
  -- coherente evita sorpresas si alguien lo convierte en BEFORE.
  return coalesce(new, old);
end;
$$;


-- ============================================================================
--  A QUE TABLAS SE LE PONE
-- ============================================================================
--
--  `AFTER` y no `BEFORE`: asi solo se audita lo que de verdad quedo guardado.
--  Un BEFORE registraria tambien los cambios que despues fallan por una
--  restriccion, y la bitacora mostraria cosas que nunca pasaron.

create trigger auditar_configuracion
  after insert or update or delete on configuracion
  for each row execute function auditar_cambio();

create trigger auditar_administradores
  after insert or update or delete on administradores
  for each row execute function auditar_cambio();

create trigger auditar_empleados
  after insert or update or delete on empleados
  for each row execute function auditar_cambio();

create trigger auditar_dispositivos
  after insert or update or delete on dispositivos
  for each row execute function auditar_cambio();

create trigger auditar_turnos
  after insert or update or delete on turnos
  for each row execute function auditar_cambio();

create trigger auditar_asignaciones
  after insert or update or delete on asignaciones_turno
  for each row execute function auditar_cambio();

create trigger auditar_dias_festivos
  after insert or update or delete on dias_festivos
  for each row execute function auditar_cambio();

create trigger auditar_correcciones
  after insert or update or delete on correcciones
  for each row execute function auditar_cambio();

create trigger auditar_incidencias
  after insert or update or delete on incidencias
  for each row execute function auditar_cambio();
