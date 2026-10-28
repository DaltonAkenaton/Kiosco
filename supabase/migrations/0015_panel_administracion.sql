-- ============================================================================
--  0015 · LO QUE HACE EL PANEL DEL JEFE  (bloque 8)
-- ============================================================================
--
--  ARQUITECTURA.md 10: "Acciones (todas quedan en bitacora y requieren motivo)".
--
--  Cada accion del panel es una funcion de la base que:
--    1. comprueba el rol (admin o supervisor, segun la accion);
--    2. exige un MOTIVO;
--    3. hace el cambio;
--    4. y el trigger de auditoria lo anota CON ese motivo.
--
--  El panel nunca escribe directo en las tablas para estas acciones: un
--  UPDATE suelto se saltaria el motivo.
--
--  Ademas, dos arreglos a la bitacora de la 0009:
--    - ocultar tambien el hash de la contrasena del kiosco (columna de la
--      0014, que la bitacora copiaba tal cual);
--    - no anotar el LATIDO de cada kiosco: actualiza `dispositivos` cada
--      minuto, y cada latido dejaba un renglon (1440 al dia por kiosco).


-- ============================================================================
--  1. LA BITACORA GUARDA EL MOTIVO
-- ============================================================================
--  Las funciones de abajo ponen el motivo en `app.motivo` (solo para su
--  transaccion) y el trigger lo copia al renglon de la bitacora.

alter table bitacora_auditoria add column motivo text;

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
  ocultas constant text[] := array['pin_hash', 'token_hash', 'codigo_hash', 'contrasena_kiosco_hash'];
  columna      text;
begin
  if tg_op = 'INSERT' then
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', fila_despues ->> 'user_id', '?');
  elsif tg_op = 'UPDATE' then
    fila_antes   := to_jsonb(old);
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', fila_despues ->> 'user_id', '?');

    -- El latido de un kiosco no es un "cambio" que alguien hizo: solo
    -- refresca su estado. Si SOLO cambiaron esas columnas, no se anota.
    if tg_table_name = 'dispositivos'
       and (fila_antes - array['ultima_conexion', 'version_app', 'camara_ok', 'pendientes',
                               'desfase_reloj_ms', 'actualizado_en'])
         = (fila_despues - array['ultima_conexion', 'version_app', 'camara_ok', 'pendientes',
                                 'desfase_reloj_ms', 'actualizado_en']) then
      return new;
    end if;
  else
    fila_antes  := to_jsonb(old);
    id_registro := coalesce(fila_antes ->> 'id', fila_antes ->> 'clave', fila_antes ->> 'user_id', '?');
  end if;

  -- Ningun secreto (ni su hash) llega a la bitacora, que leen los administradores.
  foreach columna in array ocultas loop
    if fila_antes ? columna and fila_antes ->> columna is not null then
      fila_antes := jsonb_set(fila_antes, array[columna], '"[oculto]"'::jsonb);
    end if;
    if fila_despues ? columna and fila_despues ->> columna is not null then
      fila_despues := jsonb_set(fila_despues, array[columna], '"[oculto]"'::jsonb);
    end if;
  end loop;

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  values (tg_table_name, id_registro, tg_op, fila_antes, fila_despues, actor_actual(),
          nullif(current_setting('app.motivo', true), ''));

  return coalesce(new, old);
end;
$$;

-- Las marcas tambien: la captura manual y los cambios de estado de su foto.
-- (Editarlas o borrarlas sigue siendo imposible, por el trigger de la 0005.)
create trigger auditar_marcas
  after insert or update on marcas
  for each row execute function auditar_cambio();

/** El motivo, obligatorio y con sustancia. Lo usan todas las funciones de abajo. */
create or replace function exigir_motivo(p_motivo text)
returns void
language plpgsql
as $$
begin
  if length(trim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Escribe el motivo (al menos 10 letras): queda anotado en la bitácora';
  end if;
  perform set_config('app.motivo', trim(p_motivo), true);
end;
$$;


-- ============================================================================
--  2. EMPLEADOS
-- ============================================================================

-- El usuario puede llevar NUMEROS. Si ya hay un "dgomez", el segundo es
-- "dgomez2" (compartido/usuarios.ts, `desempatarUsuario`), y la regla de la
-- 0003 solo aceptaba letras: el alta del homonimo habria fallado.
alter table empleados drop constraint empleados_usuario_check;
alter table empleados add constraint empleados_usuario_check
  check (usuario = lower(usuario) and usuario ~ '^[a-z][a-z0-9.]{2,19}$');

/**
 * Un PIN de 4 digitos al azar, sin los que cualquiera adivinaria (0000, 1234,
 * 1111...). Lo genera el sistema para que nadie tenga que inventarlo: el jefe
 * lo anota y se lo da al empleado.
 */
create or replace function pin_al_azar()
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_pin text;
begin
  loop
    v_pin := lpad(((get_byte(extensions.gen_random_bytes(1), 0) * 256
                   + get_byte(extensions.gen_random_bytes(1), 0)) % 10000)::text, 4, '0');
    exit when v_pin !~ '^(\d)\1{3}$'                         -- 0000, 1111...
          and v_pin not in ('1234', '2345', '3456', '4567', '5678', '6789',
                            '9876', '8765', '7654', '6543', '5432', '4321', '0123', '3210');
  end loop;
  return v_pin;
end;
$$;

/** Da de alta a un empleado y devuelve su PIN (solo esta vez). Solo el rol admin. */
create or replace function alta_empleado(
  p_nombre   text,
  p_paterno  text,
  p_materno  text,
  p_numero   text,
  p_usuario  text,
  p_motivo   text
)
returns table (id uuid, pin text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id  uuid;
  v_pin text := pin_al_azar();
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede dar de alta empleados';
  end if;
  perform exigir_motivo(p_motivo);

  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_paterno), '') = '' then
    raise exception 'Falta el nombre o el apellido paterno';
  end if;
  if exists (select 1 from empleados e where e.usuario = lower(trim(p_usuario))) then
    raise exception 'Ya hay alguien con el usuario "%". Elige otro.', lower(trim(p_usuario));
  end if;
  if nullif(trim(p_numero), '') is not null
     and exists (select 1 from empleados e where e.numero_empleado = trim(p_numero)) then
    raise exception 'Ya hay alguien con el número de empleado %', trim(p_numero);
  end if;

  insert into empleados (usuario, numero_empleado, nombre, apellido_paterno, apellido_materno, pin_hash)
  values (lower(trim(p_usuario)), nullif(trim(p_numero), ''), trim(p_nombre), trim(p_paterno),
          coalesce(trim(p_materno), ''), extensions.crypt(v_pin, extensions.gen_salt('bf', 10)))
  returning empleados.id into v_id;

  return query select v_id, v_pin;
end;
$$;

/** Corrige nombre, apellidos, numero o usuario. Solo el rol admin. */
create or replace function editar_empleado(
  p_id       uuid,
  p_nombre   text,
  p_paterno  text,
  p_materno  text,
  p_numero   text,
  p_usuario  text,
  p_motivo   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar los datos de un empleado';
  end if;
  perform exigir_motivo(p_motivo);

  update empleados
     set nombre = trim(p_nombre), apellido_paterno = trim(p_paterno),
         apellido_materno = coalesce(trim(p_materno), ''),
         numero_empleado = nullif(trim(p_numero), ''), usuario = lower(trim(p_usuario))
   where id = p_id;
  if not found then
    raise exception 'No existe ese empleado';
  end if;
exception
  when unique_violation then
    raise exception 'Ese usuario o número de empleado ya lo tiene otra persona';
end;
$$;

/** Baja (o reactivacion). Baja NO borra: sus marcas se conservan (ARQUITECTURA.md 7). */
create or replace function cambiar_estado_empleado(p_id uuid, p_activo boolean, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede dar de baja o reactivar empleados';
  end if;
  perform exigir_motivo(p_motivo);

  update empleados set activo = p_activo where id = p_id;
  if not found then
    raise exception 'No existe ese empleado';
  end if;
end;
$$;

/**
 * PIN nuevo para quien lo olvido (ARQUITECTURA.md 11). Se genera al azar y se
 * devuelve UNA vez. Queda marcado como temporal: el jefe lo dio, no el
 * empleado lo eligio.
 */
create or replace function restablecer_pin(p_id uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin text := pin_al_azar();
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede dar un PIN nuevo';
  end if;
  perform exigir_motivo(p_motivo);

  update empleados
     set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf', 10)), pin_temporal = true
   where id = p_id and activo;
  if not found then
    raise exception 'No existe ese empleado o está dado de baja';
  end if;
  return v_pin;
end;
$$;


-- ============================================================================
--  3. REGISTRO MANUAL DE ASISTENCIA  (ARQUITECTURA.md 11: sin luz, olvido de PIN)
-- ============================================================================
--  Una marca con origen 'manual', la bandera 'manual' y sin kiosco. Tambien
--  la puede hacer un supervisor (0002: "puede registrar asistencia manual").

create or replace function registrar_marca_manual(
  p_empleado_id uuid,
  p_tipo        text,
  p_hora        timestamptz,
  p_motivo      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if not es_administrador() then
    raise exception 'Sólo un administrador o supervisor puede registrar asistencia a mano';
  end if;
  perform exigir_motivo(p_motivo);

  if p_tipo not in ('entrada', 'salida') then
    raise exception 'El tipo debe ser entrada o salida';
  end if;
  -- Unos minutos de gracia por relojes desfasados; mas alla, es un error de dedo.
  if p_hora > now() + interval '5 minutes' then
    raise exception 'La hora no puede ser en el futuro';
  end if;
  if not exists (select 1 from empleados where id = p_empleado_id) then
    raise exception 'No existe ese empleado';
  end if;

  insert into marcas (id, empleado_id, dispositivo_id, tipo, origen, hora_dispositivo, hora_estimada,
                      monotonico_ms, arranque_id, foto_estado, banderas)
  values (v_id, p_empleado_id, null, p_tipo, 'manual', p_hora, p_hora,
          0, gen_random_uuid(), 'sin_camara', array['manual']);
  return v_id;
end;
$$;


-- ============================================================================
--  4. CONFIGURACION CON RANGOS  (la pantalla que vuelve moldeable el sistema)
-- ============================================================================
--  Cada clave dice que tipo de valor acepta y entre que limites. El panel lo
--  usa para ayudar a escribir; la base, para no aceptar un absurdo aunque
--  alguien se salte el panel. Son los MISMOS rangos que obedece el kiosco
--  (configuracion-vigente.ts): un valor que el kiosco ignoraria, aqui ni entra.

alter table configuracion
  add column tipo   text not null default 'entero' check (tipo in ('entero', 'texto')),
  add column minimo numeric,
  add column maximo numeric,
  add column unidad text not null default '';

update configuracion set tipo = 'texto' where clave = 'zona_horaria';
update configuracion c set minimo = r.minimo, maximo = r.maximo, unidad = r.unidad
from (values
  ('tolerancia_retardo_minutos',            0,     120, 'minutos'),
  ('minutos_para_falta',                    1,     480, 'minutos'),
  ('horas_para_cierre_automatico',          4,      48, 'horas'),
  ('dias_retencion_fotos',                  1,     365, 'dias'),
  ('intentos_pin_maximos',                  2,      20, 'intentos'),
  ('segundos_bloqueo_pin',                 10,    3600, 'segundos'),
  ('minutos_olvidar_intentos',              1,    1440, 'minutos'),
  ('umbral_brillo_minimo',                  0,     255, ''),
  ('umbral_varianza_minima',                0,  100000, ''),
  ('minutos_camara_caida_alerta',           1,    1440, 'minutos'),
  ('umbral_desfase_reloj_ms',            5000, 86400000, 'milisegundos'),
  ('minutos_kiosco_sin_conexion_alerta',    5,    1440, 'minutos'),
  ('minutos_vigencia_codigo_enrolamiento',  5,     120, 'minutos')
) as r (clave, minimo, maximo, unidad)
where c.clave = r.clave;

create or replace function actualizar_configuracion(p_clave text, p_valor jsonb, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config configuracion%rowtype;
  v_numero numeric;
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar la configuración';
  end if;
  perform exigir_motivo(p_motivo);

  select * into v_config from configuracion where clave = p_clave;
  if not found then
    raise exception 'No existe la opción "%"', p_clave;
  end if;

  if v_config.tipo = 'entero' then
    if jsonb_typeof(p_valor) <> 'number' then
      raise exception 'Escribe un número';
    end if;
    v_numero := (p_valor #>> '{}')::numeric;
    if v_numero <> trunc(v_numero) then
      raise exception 'Escribe un número entero, sin decimales';
    end if;
    if v_numero < v_config.minimo or v_numero > v_config.maximo then
      raise exception 'Debe estar entre % y %', v_config.minimo, v_config.maximo;
    end if;
  elsif p_clave = 'zona_horaria' then
    if jsonb_typeof(p_valor) <> 'string'
       or not exists (select 1 from pg_timezone_names where name = p_valor #>> '{}') then
      raise exception 'Esa zona horaria no existe';
    end if;
  end if;

  update configuracion
     set valor = p_valor, actualizado_en = now(), actualizado_por = auth.uid()
   where clave = p_clave;
end;
$$;


-- ============================================================================
--  5. REVOCAR UN KIOSCO, AHORA CON MOTIVO
-- ============================================================================
--  La version de la 0014 (sin motivo) se queda para no romper a quien la use;
--  el panel usa esta.

create or replace function revocar_dispositivo(p_dispositivo_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede dar de baja un kiosco';
  end if;
  perform exigir_motivo(p_motivo);
  perform revocar_dispositivo(p_dispositivo_id);
end;
$$;


-- ============================================================================
--  6. PERMISOS: el panel (authenticated) llama; adentro cada una revisa el rol
-- ============================================================================

revoke all on function alta_empleado(text, text, text, text, text, text) from public, anon;
revoke all on function editar_empleado(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function cambiar_estado_empleado(uuid, boolean, text) from public, anon;
revoke all on function restablecer_pin(uuid, text) from public, anon;
revoke all on function registrar_marca_manual(uuid, text, timestamptz, text) from public, anon;
revoke all on function actualizar_configuracion(text, jsonb, text) from public, anon;
revoke all on function revocar_dispositivo(uuid, text) from public, anon;
revoke all on function pin_al_azar() from public, anon, authenticated;
revoke all on function exigir_motivo(text) from public, anon, authenticated;

grant execute on function alta_empleado(text, text, text, text, text, text) to authenticated;
grant execute on function editar_empleado(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function cambiar_estado_empleado(uuid, boolean, text) to authenticated;
grant execute on function restablecer_pin(uuid, text) to authenticated;
grant execute on function registrar_marca_manual(uuid, text, timestamptz, text) to authenticated;
grant execute on function actualizar_configuracion(text, jsonb, text) to authenticated;
grant execute on function revocar_dispositivo(uuid, text) to authenticated;
