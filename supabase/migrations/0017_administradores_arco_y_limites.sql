-- ============================================================================
--  0017 · ADMINISTRADORES DESDE EL PANEL, DERECHOS ARCO Y LIMITE DE ALTAS
-- ============================================================================
--
--  Tres cosas que estaban anotadas como deuda:
--
--    1. Dar de alta ADMINISTRADORES desde el panel. Crear la cuenta de
--       Supabase Auth necesita la llave service_role, asi que lo hace la Edge
--       Function `administradores`. Aqui van las funciones que ella llama
--       (solo service_role) y las que el panel llama directo (cambiar rol,
--       dar de baja).
--
--    2. DERECHOS ARCO (ARQUITECTURA.md 12): exportar todo lo que el sistema sabe de
--       un empleado y, cuando proceda, SUPRIMIR sus datos. Suprimir NO borra
--       sus marcas (son registro laboral y son inmutables, ARQUITECTURA.md 8): se
--       ANONIMIZA lo que lo identifica, y la anonimizacion queda en bitacora.
--
--    3. Limite de intentos para dar de alta un kiosco (`enrolar-kiosco`), que
--       antes aceptaba probar codigos sin freno.


-- ============================================================================
--  1. ADMINISTRADORES
-- ============================================================================

alter table administradores
  -- Para mostrarlo en la lista del panel sin tener que leer auth.users (que
  -- el panel no puede leer, y esta bien que no pueda).
  add column correo text,
  -- La contrasena la invento el sistema: al entrar la primera vez, el panel
  -- lo manda a "Mi cuenta" a ponerse una propia.
  add column debe_cambiar_contrasena boolean not null default false;

-- Los que ya existen: su correo, desde auth.users.
update administradores a
   set correo = u.email
  from auth.users u
 where u.id = a.user_id and a.correo is null;

/**
 * ¿Es este usuario un administrador (rol admin) activo? Igual que
 * `puede_administrar()`, pero para las funciones que llama una Edge Function
 * con service_role, donde `auth.uid()` es nulo y quien actua llega como dato.
 */
create or replace function es_admin_activo(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from administradores
                  where user_id = p_user_id and activo and rol = 'admin');
$$;

/**
 * El id de una cuenta de Supabase Auth por su correo. Para la Edge Function,
 * cuando la cuenta ya existia (creada a mano en el tablero, por ejemplo).
 * Mas directo y confiable que recorrer la lista de usuarios de Auth.
 */
create or replace function buscar_cuenta_por_correo(p_correo text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(p_correo)) limit 1;
$$;

/**
 * Anota a alguien como administrador o supervisor. La llama la Edge Function
 * `administradores` DESPUES de crear su cuenta en Supabase Auth.
 */
create or replace function registrar_administrador(
  p_actor   uuid,
  p_user_id uuid,
  p_nombre  text,
  p_correo  text,
  p_rol     text,
  p_motivo  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin_activo(p_actor) then
    raise exception 'Sólo un administrador puede dar acceso al panel';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then
    raise exception 'Escribe el nombre completo de la persona';
  end if;
  if p_rol not in ('admin', 'supervisor') then
    raise exception 'El rol debe ser administrador o supervisor';
  end if;
  perform set_config('app.actor', p_actor::text, true);
  perform exigir_motivo(p_motivo);

  insert into administradores (user_id, nombre, correo, rol, activo, debe_cambiar_contrasena)
  values (p_user_id, trim(p_nombre), lower(trim(p_correo)), p_rol, true, true)
  on conflict (user_id) do update
     set nombre = excluded.nombre, correo = excluded.correo, rol = excluded.rol,
         activo = true, debe_cambiar_contrasena = true;
end;
$$;

/**
 * Deja constancia de que se le puso una contrasena temporal nueva (la pone la
 * Edge Function en Supabase Auth). Al entrar, tendra que cambiarla.
 */
create or replace function marcar_contrasena_temporal(p_actor uuid, p_user_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin_activo(p_actor) then
    raise exception 'Sólo un administrador puede restablecer contraseñas';
  end if;
  perform set_config('app.actor', p_actor::text, true);
  perform exigir_motivo(p_motivo);

  update administradores set debe_cambiar_contrasena = true where user_id = p_user_id;
  if not found then
    raise exception 'Esa persona no tiene acceso al panel';
  end if;
end;
$$;

/**
 * Cambia el rol o da de baja / reactiva. La llama el panel directo.
 *
 * Dos frenos, porque son los dos errores que dejan el sistema sin dueño:
 *   - nadie puede cambiarse a si mismo (ni quitarse el rol, ni darse de baja);
 *   - siempre queda al menos un administrador activo.
 */
create or replace function cambiar_administrador(
  p_user_id uuid,
  p_rol     text,
  p_activo  boolean,
  p_motivo  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar permisos';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'No puedes cambiar tu propio acceso. Pídeselo a otro administrador';
  end if;
  if p_rol not in ('admin', 'supervisor') then
    raise exception 'El rol debe ser administrador o supervisor';
  end if;
  perform exigir_motivo(p_motivo);

  update administradores set rol = p_rol, activo = p_activo where user_id = p_user_id;
  if not found then
    raise exception 'Esa persona no tiene acceso al panel';
  end if;

  if not exists (select 1 from administradores where activo and rol = 'admin') then
    raise exception 'Tiene que quedar al menos un administrador activo';
  end if;
end;
$$;

/** El propio jefe avisa que ya cambio su contrasena temporal por una suya. */
create or replace function contrasena_panel_cambiada()
returns void
language sql
security definer
set search_path = public
as $$
  update administradores set debe_cambiar_contrasena = false
   where user_id = auth.uid() and debe_cambiar_contrasena;
$$;


-- ============================================================================
--  2. DERECHOS ARCO  (ARQUITECTURA.md 12)
-- ============================================================================

alter table empleados add column anonimizado_en timestamptz;

comment on column empleados.anonimizado_en is
  'Si tiene fecha, sus datos personales se suprimieron (derecho ARCO). Sus '
  'marcas se conservan, sin nada que diga quien era.';

/**
 * ACCESO: todo lo que el sistema guarda de un empleado, en un solo documento.
 *
 * Sin el hash del PIN (no es un dato de la persona, es un candado). Sin fotos:
 * esas viven solo en el kiosco (ARQUITECTURA.md 5.1) y se exportan desde alla.
 *
 * La consulta queda en la bitacora: pedir los datos de alguien tambien es
 * tratar sus datos.
 */
create or replace function datos_de_empleado(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede exportar los datos de una persona';
  end if;
  perform exigir_motivo(p_motivo);

  select jsonb_build_object(
    'generado_en', now(),
    'aviso', 'Datos personales tratados por el sistema de control de asistencia. '
             'Las fotografías no están aquí: se guardan cifradas sólo en el kiosco '
             'y se borran solas a los 30 días (o el plazo configurado).',
    'empleado', (select to_jsonb(e) - 'pin_hash' - 'foto_referencia_path' from empleados e where e.id = p_id),
    'marcas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', m.id, 'tipo', m.tipo, 'origen', m.origen,
                 'hora', m.hora_estimada, 'kiosco', d.nombre,
                 'foto_estado', m.foto_estado, 'banderas', m.banderas)
               order by m.hora_estimada)
          from marcas m left join dispositivos d on d.id = m.dispositivo_id
         where m.empleado_id = p_id), '[]'::jsonb),
    'correcciones', coalesce((
        select jsonb_agg(jsonb_build_object('accion', c.accion, 'motivo', c.motivo,
                                            'datos', c.datos, 'creado_en', c.creado_en)
               order by c.creado_en)
          from correcciones c where c.empleado_id = p_id), '[]'::jsonb),
    'ausencias', coalesce((
        select jsonb_agg(jsonb_build_object('tipo', i.tipo, 'desde', i.fecha_inicio,
                                            'hasta', i.fecha_fin, 'notas', i.notas)
               order by i.fecha_inicio)
          from incidencias i where i.empleado_id = p_id), '[]'::jsonb),
    'horarios', coalesce((
        select jsonb_agg(jsonb_build_object('turno', t.nombre, 'desde', a.vigente_desde,
                                            'hasta', a.vigente_hasta)
               order by a.vigente_desde)
          from asignaciones_turno a join turnos t on t.id = a.turno_id
         where a.empleado_id = p_id), '[]'::jsonb),
    'consultas_de_sus_fotos', coalesce((
        select jsonb_agg(jsonb_build_object('accion', af.accion, 'cuando', af.consultado_en)
               order by af.consultado_en)
          from accesos_foto af join marcas m on m.id = af.marca_id
         where m.empleado_id = p_id), '[]'::jsonb)
  ) into v_resultado;

  if v_resultado -> 'empleado' = 'null'::jsonb then
    raise exception 'No existe ese empleado';
  end if;

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  values ('empleados', p_id::text, 'UPDATE', null,
          jsonb_build_object('arco', 'exportacion_de_datos'), actor_actual(), trim(p_motivo));

  return v_resultado;
end;
$$;

/**
 * SUPRESION (anonimizacion): la persona deja de ser identificable.
 *
 *   - nombre, apellidos, usuario y numero de empleado se reemplazan;
 *   - el PIN se vuelve inservible y queda dado de baja;
 *   - las notas de sus ausencias se borran;
 *   - en la BITACORA, las copias viejas de su nombre tambien se tachan
 *     (si no, "suprimir" seria solo cambiar la etiqueta de la puerta).
 *
 *   Lo que NO se toca: sus marcas (horas de entrada y salida), porque son el
 *   registro laboral y son inmutables (ARQUITECTURA.md 8). Ya no dicen de quien son.
 *
 *   Las fotos del kiosco se borran solas a los 30 dias; si alguna esta
 *   marcada "Conservar", hay que quitarle la marca en el kiosco (lo dice el
 *   manual del jefe).
 *
 *   No se puede deshacer, y por eso pide escribir el usuario de la persona.
 */
create or replace function anonimizar_empleado(p_id uuid, p_confirmar_usuario text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_empleado empleados%rowtype;
  v_personales constant text[] := array['nombre', 'apellido_paterno', 'apellido_materno',
                                        'usuario', 'numero_empleado'];
  v_campo text;
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede suprimir los datos de una persona';
  end if;

  select * into v_empleado from empleados where id = p_id for update;
  if not found then
    raise exception 'No existe ese empleado';
  end if;
  if v_empleado.anonimizado_en is not null then
    raise exception 'Los datos de esta persona ya estaban suprimidos';
  end if;
  if lower(trim(coalesce(p_confirmar_usuario, ''))) <> v_empleado.usuario then
    raise exception 'Para confirmar, escribe exactamente el usuario de la persona (%)', v_empleado.usuario;
  end if;
  perform exigir_motivo(p_motivo);

  -- Tachar las copias de su nombre en la bitacora ANTES de cambiar la fila:
  -- el cambio de abajo genera su propio renglon, que ya nace tachado.
  foreach v_campo in array v_personales loop
    update bitacora_auditoria
       set datos_antes = case when datos_antes ? v_campo
                              then jsonb_set(datos_antes, array[v_campo], '"[suprimido]"') else datos_antes end,
           datos_despues = case when datos_despues ? v_campo
                                then jsonb_set(datos_despues, array[v_campo], '"[suprimido]"') else datos_despues end
     where tabla = 'empleados' and registro_id = p_id::text;
  end loop;

  -- Que el renglon de ESTE cambio tampoco guarde el nombre: se anota a mano
  -- y el trigger se salta este UPDATE (ver `app.sin_auditar` abajo).
  perform set_config('app.sin_auditar', 'on', true);
  update empleados
     set nombre           = 'Persona',
         apellido_paterno = 'suprimida',
         apellido_materno = '',
         usuario          = 'anon' || substr(replace(p_id::text, '-', ''), 1, 12),
         numero_empleado  = null,
         pin_hash         = crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf', 10)),
         pin_temporal     = false,
         activo           = false,
         foto_referencia_path = null,
         anonimizado_en   = now()
   where id = p_id;
  perform set_config('app.sin_auditar', '', true);

  update incidencias set notas = '' where empleado_id = p_id and notas <> '';

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  values ('empleados', p_id::text, 'UPDATE', null,
          jsonb_build_object('arco', 'supresion_de_datos', 'anonimizado_en', now()),
          actor_actual(), trim(p_motivo));
end;
$$;

-- El trigger de auditoria respeta `app.sin_auditar` SOLO para la supresion de
-- arriba (que deja su propio renglon, sin datos personales). Es la misma
-- funcion de la 0015 con esa unica linea agregada al principio.
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
  if tg_table_name = 'empleados' and current_setting('app.sin_auditar', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', fila_despues ->> 'user_id', '?');
  elsif tg_op = 'UPDATE' then
    fila_antes   := to_jsonb(old);
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', fila_despues ->> 'user_id', '?');

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

-- Una persona suprimida no se edita ni se reactiva: ya no hay a quien.
create or replace function impedir_editar_anonimizado()
returns trigger
language plpgsql
as $$
begin
  if old.anonimizado_en is not null and current_setting('app.sin_auditar', true) is distinct from 'on' then
    raise exception 'Los datos de esta persona fueron suprimidos (derecho ARCO): ya no se pueden editar';
  end if;
  return new;
end;
$$;

create trigger empleados_no_editar_anonimizado
  before update on empleados
  for each row execute function impedir_editar_anonimizado();


-- ============================================================================
--  3. LIMITE DE INTENTOS PARA DAR DE ALTA UN KIOSCO
-- ============================================================================
--  Los codigos son de 8 caracteres y viven 15 minutos: adivinar uno a ciegas
--  es imposible en la practica. Aun asi, una ventanilla que acepta intentos
--  sin freno es una invitacion. Se cuentan los intentos por origen (la IP que
--  ve el servidor) y, globalmente, para que cambiar de IP no sirva.

create table intentos_enrolamiento (
  id          bigint generated always as identity primary key,
  origen      text not null,
  exitoso     boolean not null,
  ocurrido_en timestamptz not null default now()
);

create index intentos_enrolamiento_recientes_idx on intentos_enrolamiento (ocurrido_en);

alter table intentos_enrolamiento enable row level security;
-- Sin politicas: nadie lo lee desde fuera. Solo las funciones de abajo.

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('intentos_enrolamiento_por_hora', '10'::jsonb,
   'Cuántos códigos equivocados se aceptan por hora desde un mismo lugar al dar de alta un kiosco.',
   'dispositivos', 'entero', 3, 100, 'intentos');

/** ¿Puede este origen intentar otro codigo? Cuenta los fallidos de la ultima hora. */
create or replace function enrolamiento_permitido(p_origen text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from intentos_enrolamiento
           where not exitoso and origen = p_origen
             and ocurrido_en > now() - interval '1 hour')
           < config_entero('intentos_enrolamiento_por_hora', 10)
     and (select count(*) from intentos_enrolamiento
           where not exitoso and ocurrido_en > now() - interval '1 hour')
           < config_entero('intentos_enrolamiento_por_hora', 10) * 10;
$$;

create or replace function anotar_intento_enrolamiento(p_origen text, p_exitoso boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into intentos_enrolamiento (origen, exitoso) values (left(p_origen, 100), p_exitoso);
  -- Lo de hace mas de un dia ya no sirve para nada: se limpia solo.
  delete from intentos_enrolamiento where ocurrido_en < now() - interval '1 day';
$$;


-- ============================================================================
--  4. BANDERA NUEVA: foto_no_guardada
-- ============================================================================
--  Antes, si la camara funcionaba pero la foto no se podia guardar cifrada
--  (disco lleno, Windows sin cifrado), la marca salia con `sin_camara`. Eso
--  mandaba al jefe a revisar la camara cuando el problema era la computadora.
--  El estado de su foto sigue siendo 'sin_camara' (= no hay foto).

alter table marcas drop constraint marcas_banderas_conocidas;
alter table marcas add constraint marcas_banderas_conocidas check (
  banderas <@ array[
    'sin_camara', 'foto_obstruida', 'foto_no_guardada', 'reloj_sospechoso',
    'dispositivo_revocado', 'manual', 'cierre_automatico'
  ]::text[]
);


-- ============================================================================
--  5. EVENTO NUEVO DEL KIOSCO: fotos_recuperadas
-- ============================================================================
--  El modo administrador del kiosco ya puede recuperar las fotos de una llave
--  anterior con la contrasena de recuperacion (ARQUITECTURA.md 5.1). Queda anotado.

alter table eventos_dispositivo drop constraint eventos_dispositivo_tipo_check;
alter table eventos_dispositivo add constraint eventos_dispositivo_tipo_check
  check (tipo in (
    'camara_desconectada', 'camara_reconectada', 'kiosco_pausado', 'kiosco_reanudado',
    'reloj_sospechoso', 'arranque', 'error_sincronizacion',
    'llave_fotos_creada', 'llave_fotos_reemplazada', 'recuperacion_fotos_definida',
    'cifrado_no_disponible', 'fotos_depuradas', 'fotos_heredadas_cifradas',
    'modo_admin_abierto', 'modo_admin_intento_fallido', 'modo_admin_bloqueado',
    'exportacion_usb',
    -- 0017
    'fotos_recuperadas'
  ));


-- ============================================================================
--  6. QUIEN PUEDE LLAMAR QUE
-- ============================================================================

revoke all on function es_admin_activo(uuid) from public, anon, authenticated;
revoke all on function buscar_cuenta_por_correo(text) from public, anon, authenticated;
grant execute on function buscar_cuenta_por_correo(text) to service_role;
revoke all on function registrar_administrador(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function marcar_contrasena_temporal(uuid, uuid, text) from public, anon, authenticated;
revoke all on function enrolamiento_permitido(text) from public, anon, authenticated;
revoke all on function anotar_intento_enrolamiento(text, boolean) from public, anon, authenticated;
grant execute on function es_admin_activo(uuid) to service_role;
grant execute on function registrar_administrador(uuid, uuid, text, text, text, text) to service_role;
grant execute on function marcar_contrasena_temporal(uuid, uuid, text) to service_role;
grant execute on function enrolamiento_permitido(text) to service_role;
grant execute on function anotar_intento_enrolamiento(text, boolean) to service_role;

revoke all on function cambiar_administrador(uuid, text, boolean, text) from public, anon;
revoke all on function contrasena_panel_cambiada() from public, anon;
revoke all on function datos_de_empleado(uuid, text) from public, anon;
revoke all on function anonimizar_empleado(uuid, text, text) from public, anon;
grant execute on function cambiar_administrador(uuid, text, boolean, text) to authenticated;
grant execute on function contrasena_panel_cambiada() to authenticated;
grant execute on function datos_de_empleado(uuid, text) to authenticated;
grant execute on function anonimizar_empleado(uuid, text, text) to authenticated;
