-- ============================================================================
--  0021 · ARREGLOS DEL ANALISIS A FONDO (26-09-2026)
-- ============================================================================
--
--  Cada arreglo corresponde a un "¿que pasaria si...?" que se comprobo con
--  datos antes de corregirlo:
--
--   a. Un empleado DADO DE BAJA seguia acumulando FALTAS todos los dias: su
--      horario nunca se cerraba. Ahora, al darlo de baja, su horario termina
--      ese dia (tambien al suprimir sus datos).
--   b. Se podia poner "salida no registrada" en 4 horas con turnos de 8: toda
--      jornada normal salia como "no registro salida". Ahora debe ser mayor
--      que el turno mas largo, y no se puede crear un turno mas largo que eso.
--   c. Se podia poner "retardo mayor" por debajo de la tolerancia.
--   d. Los dias FUTUROS del reporte decian "todavia no llega": ahora
--      "programado" (el turno aun no empieza).
--   e. Quien olvido checar la ENTRADA pero si la salida salia como FALTA.
--      Ahora "sin entrada": si vino, y se puede justificar.
--   f. La misma incidencia se podia registrar dos veces.
--   g. "Minutos de camara caida para avisar" no lo usaba nadie. Ahora el
--      kiosco guarda DESDE CUANDO esta caida su camara.
--   h. El kiosco de demostracion salia en las alertas y en el correo diario.
--   j. Se podia asignar horario a alguien dado de baja (y volvian las faltas).
--   k. Si alguien trabajo un dia marcado como ausencia, sus horas no contaban.
--   i. "Minutos antes de la entrada que cuentan" aceptaba 0: quien llegaba a
--      las 5:59 a un turno de las 6:00 salia con FALTA. Ahora al menos 60, y
--      nunca tanto que una entrada cuente para dos dias.


-- ============================================================================
--  1. DURACION DE UN TURNO (ayuda para las validaciones)
-- ============================================================================

/** Minutos entre dos horas del dia; si la salida es "antes", cruza la medianoche. */
create or replace function duracion_minutos(p_inicio time, p_fin time)
returns integer
language sql
immutable
as $$
  select ((extract(epoch from p_fin)::integer - extract(epoch from p_inicio)::integer) / 60 + 1440) % 1440;
$$;

/** El turno (o el horario propio de un dia) mas largo que existe, en minutos. */
create or replace function turno_mas_largo_minutos()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(m), 0) from (
    select duracion_minutos(hora_inicio, hora_fin) as m from turnos where activo
    union all
    select duracion_minutos(dl.hora_inicio, dl.hora_fin)
      from dias_laborales dl
      join asignaciones_turno a on a.id = dl.asignacion_id
     where dl.hora_inicio is not null and a.vigente_hasta is null
  ) x;
$$;


-- ============================================================================
--  2. CONFIGURACION QUE NO SE CONTRADICE  (b, c)
-- ============================================================================

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

    -- Reglas que dependen unas de otras (0021): que no se contradigan.
    if p_clave = 'tolerancia_retardo_minutos' and v_numero >= config_entero('minutos_para_falta', 30) then
      raise exception 'La tolerancia debe ser menor que los minutos para "retardo mayor" (%). Sube primero esos minutos.',
        config_entero('minutos_para_falta', 30);
    end if;
    if p_clave = 'minutos_para_falta' and v_numero <= config_entero('tolerancia_retardo_minutos', 10) then
      raise exception 'Los minutos para "retardo mayor" deben ser más que la tolerancia (%).',
        config_entero('tolerancia_retardo_minutos', 10);
    end if;
    if p_clave = 'minutos_anticipacion_entrada' and v_numero + turno_mas_largo_minutos() >= 1440 then
      raise exception 'Con el turno más largo (% horas), la anticipación no puede pasar de % minutos: una entrada contaría para dos días.',
        round(turno_mas_largo_minutos() / 60.0, 1), 1439 - turno_mas_largo_minutos();
    end if;
    if p_clave = 'horas_para_cierre_automatico' and v_numero * 60 <= turno_mas_largo_minutos() then
      raise exception 'Debe ser más que el turno más largo (% horas). Si no, las jornadas normales saldrían como "no registró salida".',
        round(turno_mas_largo_minutos() / 60.0, 1);
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


create or replace function guardar_turno(
  p_id          uuid,
  p_nombre      text,
  p_inicio      time,
  p_fin         time,
  p_tolerancia  integer,
  p_falta       integer,
  p_motivo      text,
  p_desde       date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_desde date := coalesce(p_desde, date '2000-01-01');
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar los turnos';
  end if;
  perform exigir_motivo(p_motivo);
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Ponle nombre al turno';
  end if;
  if p_inicio = p_fin then
    raise exception 'La hora de entrada y la de salida no pueden ser la misma';
  end if;
  if duracion_minutos(p_inicio, p_fin) >= config_entero('horas_para_cierre_automatico', 16) * 60 then
    raise exception 'Un turno de % horas es más largo que las horas para "salida no registrada" (%). Súbelas primero en Configuración.',
      round(duracion_minutos(p_inicio, p_fin) / 60.0, 1), config_entero('horas_para_cierre_automatico', 16);
  end if;

  if p_id is null then
    insert into turnos (nombre, hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta)
    values (trim(p_nombre), p_inicio, p_fin, p_tolerancia, p_falta)
    returning id into v_id;
    v_desde := date '2000-01-01';
  else
    -- La tabla `turnos` guarda el horario MAS RECIENTE (el que se muestra).
    update turnos
       set nombre = trim(p_nombre), hora_inicio = p_inicio, hora_fin = p_fin,
           tolerancia_minutos = p_tolerancia, minutos_para_falta = p_falta
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'No existe ese turno';
    end if;
  end if;

  -- Lo que estaba programado a partir de esa fecha se reemplaza.
  delete from turno_versiones where turno_id = v_id and vigente_desde >= v_desde;
  insert into turno_versiones (turno_id, vigente_desde, hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta)
  values (v_id, v_desde, p_inicio, p_fin, p_tolerancia, p_falta);
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya hay un turno con ese nombre';
  when check_violation then
    raise exception 'Los minutos para retardo mayor deben ser más que la tolerancia';
end;
$$;


create or replace function asignar_horario(
  p_empleado_id uuid,
  p_turno_id    uuid,
  p_desde       date,
  p_dias        jsonb,
  p_motivo      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_dia jsonb;
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar horarios';
  end if;
  perform exigir_motivo(p_motivo);

  if jsonb_typeof(p_dias) <> 'array' or jsonb_array_length(p_dias) = 0 then
    raise exception 'Elige al menos un día de la semana';
  end if;
  if not exists (select 1 from empleados where id = p_empleado_id and activo) then
    raise exception 'Esa persona está dada de baja: reactívala primero en Empleados';
  end if;
  if not exists (select 1 from turnos where id = p_turno_id and activo) then
    raise exception 'Ese turno no existe o está desactivado';
  end if;

  -- Los horarios que empezaban desde esa fecha en adelante se reemplazan;
  -- el vigente se cierra en esa fecha.
  delete from asignaciones_turno where empleado_id = p_empleado_id and vigente_desde >= p_desde;
  update asignaciones_turno
     set vigente_hasta = p_desde
   where empleado_id = p_empleado_id
     and vigente_desde < p_desde
     and (vigente_hasta is null or vigente_hasta > p_desde);

  insert into asignaciones_turno (empleado_id, turno_id, vigente_desde)
  values (p_empleado_id, p_turno_id, p_desde)
  returning id into v_id;

  for v_dia in select * from jsonb_array_elements(p_dias) loop
    if nullif(v_dia ->> 'inicio', '') is not null and nullif(v_dia ->> 'fin', '') is not null
       and duracion_minutos((v_dia ->> 'inicio')::time, (v_dia ->> 'fin')::time)
           >= config_entero('horas_para_cierre_automatico', 16) * 60 then
      raise exception 'Un horario de ese día es más largo que las horas para "salida no registrada" (%).',
        config_entero('horas_para_cierre_automatico', 16);
    end if;
    insert into dias_laborales (asignacion_id, dia_semana, hora_inicio, hora_fin)
    values (v_id, (v_dia ->> 'dia')::smallint,
            nullif(v_dia ->> 'inicio', '')::time, nullif(v_dia ->> 'fin', '')::time);
  end loop;
  return v_id;
end;
$$;



-- Con 0 minutos de anticipacion, quien llega a las 5:59 a un turno de las
-- 6:00 no contaba para su turno: salia FALTA. Al menos una hora antes cuenta.
update configuracion set minimo = 60 where clave = 'minutos_anticipacion_entrada';
update configuracion set valor = '60'::jsonb where clave = 'minutos_anticipacion_entrada' and (valor #>> '{}')::int < 60;

-- ============================================================================
--  3. DAR DE BAJA CIERRA EL HORARIO  (a)
-- ============================================================================

create or replace function cerrar_horario_al_dar_de_baja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone zona_horaria())::date;
begin
  if old.activo and not new.activo then
    -- Lo programado desde mañana se quita; lo vigente termina hoy (el dia de
    -- hoy todavia se califica, por si trabajo antes de la baja).
    delete from asignaciones_turno where empleado_id = new.id and vigente_desde > v_hoy;
    update asignaciones_turno
       set vigente_hasta = v_hoy + 1
     where empleado_id = new.id
       and (vigente_hasta is null or vigente_hasta > v_hoy + 1);
  end if;
  return new;
end;
$$;

create trigger empleados_cerrar_horario_al_dar_de_baja
  after update of activo on empleados
  for each row execute function cerrar_horario_al_dar_de_baja();

-- Los que YA estaban dados de baja: su horario termina el dia de su ultimo
-- cambio (el mejor dato que hay de cuando se dieron de baja).
update asignaciones_turno a
   set vigente_hasta = greatest(a.vigente_desde + 1, (e.actualizado_en at time zone zona_horaria())::date + 1)
  from empleados e
 where e.id = a.empleado_id and not e.activo
   and (a.vigente_hasta is null or a.vigente_hasta > (e.actualizado_en at time zone zona_horaria())::date + 1);


-- ============================================================================
--  4. INCIDENCIAS SIN DUPLICADOS  (f)
-- ============================================================================

create or replace function registrar_incidencia(
  p_empleado_id uuid,
  p_tipo        text,
  p_inicio      date,
  p_fin         date,
  p_notas       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not es_administrador() then
    raise exception 'Sólo un administrador o supervisor puede registrar ausencias';
  end if;
  perform exigir_motivo(p_notas);
  if p_fin < p_inicio then
    raise exception 'La fecha final no puede ser antes de la inicial';
  end if;
  -- La misma incidencia dos veces no suma nada y ensucia la lista (0021).
  if exists (select 1 from incidencias
              where empleado_id = p_empleado_id and tipo = p_tipo
                and fecha_inicio <= p_fin and fecha_fin >= p_inicio) then
    raise exception 'Esa persona ya tiene registrada esa misma incidencia en esas fechas';
  end if;
  insert into incidencias (empleado_id, tipo, fecha_inicio, fecha_fin, notas, admin_id)
  values (p_empleado_id, p_tipo, p_inicio, p_fin, trim(p_notas), auth.uid())
  returning id into v_id;
  return v_id;
exception
  when check_violation then
    raise exception 'Tipo de ausencia desconocido';
end;
$$;


create or replace function registrar_incidencia_grupal(
  p_turno_id uuid,
  p_tipo     text,
  p_inicio   date,
  p_fin      date,
  p_notas    text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuantos integer;
begin
  if not es_administrador() then
    raise exception 'Sólo un administrador o supervisor puede registrar incidencias';
  end if;
  perform exigir_motivo(p_notas);
  if p_fin < p_inicio then
    raise exception 'La fecha final no puede ser antes de la inicial';
  end if;
  if p_fin - p_inicio > 31 then
    raise exception 'Para varias personas a la vez, como máximo un mes';
  end if;

  insert into incidencias (empleado_id, tipo, fecha_inicio, fecha_fin, notas, admin_id)
  select distinct a.empleado_id, p_tipo, p_inicio, p_fin, trim(p_notas), auth.uid()
    from asignaciones_turno a
    join empleados e on e.id = a.empleado_id and e.activo
   where (p_turno_id is null or a.turno_id = p_turno_id)
     and a.vigente_desde <= p_fin
     and (a.vigente_hasta is null or a.vigente_hasta > p_inicio)
     -- A quien ya la tiene registrada no se le duplica (0021).
     and not exists (select 1 from incidencias i
                      where i.empleado_id = a.empleado_id and i.tipo = p_tipo
                        and i.fecha_inicio <= p_fin and i.fecha_fin >= p_inicio);
  get diagnostics v_cuantos = row_count;

  if v_cuantos = 0 then
    raise exception 'No se registró a nadie: nadie tenía turno en esas fechas, o todos ya la tenían registrada';
  end if;
  return v_cuantos;
exception
  when check_violation then
    raise exception 'Tipo de incidencia desconocido';
end;
$$;



-- ============================================================================
--  5. DESDE CUANDO ESTA CAIDA LA CAMARA  (g)
-- ============================================================================

alter table dispositivos add column camara_caida_desde timestamptz;

comment on column dispositivos.camara_caida_desde is
  'Desde cuando el kiosco reporta la camara caida. Nulo si funciona. El panel avisa pasados '
  '"minutos_camara_caida_alerta".';

create or replace function anotar_camara_caida()
returns trigger
language plpgsql
as $$
begin
  if new.camara_ok is false then
    new.camara_caida_desde := coalesce(old.camara_caida_desde, now());
  else
    new.camara_caida_desde := null;
  end if;
  return new;
end;
$$;

create trigger dispositivos_anotar_camara_caida
  before update of camara_ok on dispositivos
  for each row execute function anotar_camara_caida();

update dispositivos set camara_caida_desde = coalesce(ultima_conexion, now()) where camara_ok is false;


-- ============================================================================
--  6. EL KIOSCO DE DEMOSTRACION NO ES UN KIOSCO  (h)
-- ============================================================================

create or replace function generar_datos_demostracion(p_dias integer, p_motivo text)
returns table (usuario text, nombre text, pin text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_zona        text := zona_horaria();
  v_hoy         date := (now() at time zone zona_horaria())::date;
  v_kiosco      uuid;
  v_personas    constant text[][] := array[
    ['Maria Elena', 'Garza',    'Salinas',  'Matutino'],
    ['Jose Luis',   'Treviño',  'Cantu',    'Matutino'],
    ['Rosa Isela',  'Villarreal','Lozano',  'Matutino'],
    ['Juan Carlos', 'Rodriguez','Peña',     'Vespertino'],
    ['Ramiro',      'Cavazos',  'Ibarra',   'Nocturno']
  ];
  v_i           integer;
  v_emp         uuid;
  v_usuario     text;
  v_base        text;
  v_pin         text;
  v_turno       turnos%rowtype;
  v_asig        uuid;
  v_dia         date;
  v_suerte      double precision;
  v_entrada     timestamptz;
  v_salida      timestamptz;
  v_banderas    text[];
  v_foto        text;
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede generar datos de demostración';
  end if;
  if config_entero('permitir_datos_demostracion', 0) <> 1 then
    raise exception 'Los datos de demostración están apagados. Actívalos en Configuración ("permitir datos de demostración" = 1). Nunca en el sistema real';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 31 then
    raise exception 'Elige entre 1 y 31 días';
  end if;
  perform exigir_motivo(p_motivo);

  -- El kiosco de demostracion (uno solo, se reutiliza).
  select d.id into v_kiosco from dispositivos d where d.nombre = 'Kiosco de demostración' limit 1;
  if v_kiosco is null then
    -- Nace DADO DE BAJA (0021): no es un kiosco real, y activo aparecia en
    -- las alertas ("no se reporta desde...") y en el correo diario.
    insert into dispositivos (nombre, ubicacion, token_hash, enrolado_por, ultima_conexion,
                              version_app, camara_ok, pendientes, activo, revocado_en, revocado_por)
    values ('Kiosco de demostración', 'No existe: sólo para datos de prueba',
            encode(gen_random_bytes(32), 'hex'), auth.uid(), now(), 'demo', true, 0,
            false, now(), auth.uid())
    returning id into v_kiosco;
  end if;

  for v_i in 1 .. array_length(v_personas, 1) loop
    -- Usuario como el del kiosco ("mgarza"), sin repetir.
    v_base := lower(left(translate(v_personas[v_i][1], 'ÁÉÍÓÚáéíóúÑñ', 'AEIOUaeiouNn'), 1)
                    || translate(replace(v_personas[v_i][2], ' ', ''), 'ÁÉÍÓÚáéíóúÑñ', 'AEIOUaeiouNn'));
    v_usuario := v_base;
    while exists (select 1 from empleados e where e.usuario = v_usuario) loop
      v_usuario := v_base || (2 + floor(random() * 98))::int;
    end loop;

    v_pin := pin_al_azar();
    insert into empleados (usuario, numero_empleado, nombre, apellido_paterno, apellido_materno, pin_hash, pin_temporal)
    values (v_usuario, 'DEMO-' || upper(encode(gen_random_bytes(2), 'hex')),
            v_personas[v_i][1], v_personas[v_i][2], v_personas[v_i][3],
            crypt(v_pin, gen_salt('bf', 10)), true)
    returning id into v_emp;

    -- Horario: su turno, de lunes a viernes; los matutinos tambien el sabado.
    select * into v_turno from turnos t where t.nombre = v_personas[v_i][4] limit 1;
    insert into asignaciones_turno (empleado_id, turno_id, vigente_desde)
    values (v_emp, v_turno.id, v_hoy - p_dias - 1)
    returning id into v_asig;
    insert into dias_laborales (asignacion_id, dia_semana)
    select v_asig, d from generate_series(1, case when v_personas[v_i][4] = 'Matutino' then 6 else 5 end) d;

    -- Sus registros, dia por dia.
    for v_dia in select g::date from generate_series(v_hoy - p_dias, v_hoy, interval '1 day') g loop
      continue when extract(dow from v_dia) = 0;
      continue when extract(dow from v_dia) = 6 and v_personas[v_i][4] <> 'Matutino';

      v_suerte := random();
      continue when v_suerte < 0.05;                                   -- falta (no vino)

      v_entrada := ((v_dia + v_turno.hora_inicio)::timestamp at time zone v_zona)
                   + make_interval(mins => case
                       when v_suerte < 0.12 then 35 + floor(random() * 30)::int  -- muy tarde: falta
                       when v_suerte < 0.27 then 11 + floor(random() * 18)::int  -- retardo
                       else floor(random() * 14)::int - 8                        -- a tiempo
                     end);
      v_salida := (((case when v_turno.hora_fin < v_turno.hora_inicio then v_dia + 1 else v_dia end)
                    + v_turno.hora_fin)::timestamp at time zone v_zona)
                  + make_interval(mins => floor(random() * 20)::int - 5);

      v_foto := case when random() < 0.08 then 'sin_camara'
                     when random() < 0.06 then 'obstruida'
                     else 'con_foto' end;
      v_banderas := array_remove(array[
        case when v_foto = 'sin_camara' then 'sin_camara' end,
        case when v_foto = 'obstruida' then 'foto_obstruida' end,
        case when random() < 0.04 then 'reloj_sospechoso' end
      ], null);

      if v_entrada < now() then
        insert into marcas (id, empleado_id, dispositivo_id, tipo, origen, hora_dispositivo, hora_estimada,
                            monotonico_ms, arranque_id, desfase_servidor_ms, foto_hash, foto_estado, banderas)
        values (gen_random_uuid(), v_emp, v_kiosco, 'entrada', 'kiosco', v_entrada, v_entrada,
                floor(random() * 1e9)::bigint, gen_random_uuid(), 0,
                case when v_foto = 'sin_camara' then null else encode(gen_random_bytes(32), 'hex') end,
                v_foto, v_banderas);
      end if;

      -- 6% se van sin registrar la salida.
      if v_salida < now() and random() >= 0.06 then
        insert into marcas (id, empleado_id, dispositivo_id, tipo, origen, hora_dispositivo, hora_estimada,
                            monotonico_ms, arranque_id, desfase_servidor_ms, foto_hash, foto_estado, banderas)
        values (gen_random_uuid(), v_emp, v_kiosco, 'salida', 'kiosco', v_salida, v_salida,
                floor(random() * 1e9)::bigint, gen_random_uuid(), 0,
                encode(gen_random_bytes(32), 'hex'), 'con_foto', '{}');
      end if;
    end loop;

    usuario := v_usuario;
    nombre := v_personas[v_i][1] || ' ' || v_personas[v_i][2];
    pin := v_pin;
    return next;
  end loop;
end;
$$;


update dispositivos
   set activo = false, revocado_en = coalesce(revocado_en, now())
 where nombre = 'Kiosco de demostración' and activo;


-- ============================================================================
--  7. EL REPORTE: "sin entrada" y "programado"  (d, e)
-- ============================================================================

drop function if exists reporte_asistencia(date, date, uuid);

create or replace function reporte_asistencia(p_desde date, p_hasta date, p_empleado_id uuid default null)
returns table (
  fecha date, empleado_id uuid, turno text,
  programado_inicio timestamptz, programado_fin timestamptz,
  entrada timestamptz, salida timestamptz,
  minutos_tarde integer, minutos_salida_anticipada integer, horas numeric,
  estado text, estado_salida text, incidencia text,
  banderas text[], en_cuarentena boolean, corregida boolean,
  minutos_repuestos integer,
  horas_acreditadas numeric
)
language sql
stable
set search_path = public
as $$
  with
  cfg as (
    select zona_horaria() as zona,
           config_entero('tolerancia_retardo_minutos', 10) as tol,
           config_entero('minutos_para_falta', 30) as falta,
           config_entero('llegar_muy_tarde_es_falta', 0) = 1 as muy_tarde_es_falta,
           make_interval(mins => config_entero('minutos_anticipacion_entrada', 240)) as antes
  ),
  dias as (select d::date as fecha from generate_series(p_desde, p_hasta, interval '1 day') d),
  programados as (
    select dias.fecha, a.empleado_id, t.nombre as turno, t.es_libre,
           -- El horario del turno VIGENTE ESE DIA (0019); si no hubiera
           -- historia, el actual.
           coalesce(v.tolerancia_minutos, cfg.tol) as tol,
           coalesce(v.minutos_para_falta, cfg.falta) as falta,
           coalesce(dl.hora_inicio, v.hora_inicio, t.hora_inicio) as hi,
           coalesce(dl.hora_fin, v.hora_fin, t.hora_fin) as hf,
           cfg.zona
      from dias
      join asignaciones_turno a
        on a.vigente_desde <= dias.fecha and (a.vigente_hasta is null or dias.fecha < a.vigente_hasta)
      join turnos t on t.id = a.turno_id
      join dias_laborales dl on dl.asignacion_id = a.id and dl.dia_semana = extract(dow from dias.fecha)
      left join lateral (
        select tv.* from turno_versiones tv
         where tv.turno_id = t.id and tv.vigente_desde <= dias.fecha
         order by tv.vigente_desde desc
         limit 1
      ) v on true
      cross join cfg
     where p_empleado_id is null or a.empleado_id = p_empleado_id
  ),
  con_instantes as (
    select p.*,
           (p.fecha + p.hi) at time zone p.zona as ini,
           ((case when p.hf <= p.hi then p.fecha + 1 else p.fecha end) + p.hf) at time zone p.zona as fin
      from programados p
  ),
  j as (
    select jj.*
      from cfg,
           jornadas(((p_desde - 1) + time '00:00') at time zone cfg.zona,
                    ((p_hasta + 2) + time '00:00') at time zone cfg.zona) jj
     where p_empleado_id is null or jj.empleado_id = p_empleado_id
  ),
  emparejados as (
    select distinct on (c.fecha, c.empleado_id)
           c.*, j.entrada_id, j.entrada, j.salida, j.estado as estado_salida, j.horas,
           j.banderas, j.en_cuarentena, j.corregida
      from con_instantes c
      left join j
        on j.empleado_id = c.empleado_id
       and j.entrada is not null
       and j.entrada >= c.ini - (select antes from cfg)
       and j.entrada < c.fin
     order by c.fecha, c.empleado_id, j.entrada
  ),
  -- Olvido checar la ENTRADA pero si checo la salida (0021): esa salida
  -- (sin entrada) dentro de su turno dice que SI vino.
  con_salida_sola as (
    select e.*, ss.salida_id as sola_id, ss.salida as sola_hora, ss.banderas as sola_banderas
      from emparejados e
      left join lateral (
        select jj.salida_id, jj.salida, jj.banderas
          from j jj
         where e.entrada is null
           and jj.empleado_id = e.empleado_id
           and jj.entrada is null
           and jj.salida >= e.ini
           and jj.salida < e.fin + interval '4 hours'
         order by jj.salida desc
         limit 1
      ) ss on true
  )
  select e.fecha, e.empleado_id, e.turno, e.ini, e.fin, e.entrada, coalesce(e.salida, e.sola_hora),
         case when e.entrada is not null
              then greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60))::integer end,
         case when coalesce(e.salida, e.sola_hora) < e.fin
              then floor(extract(epoch from e.fin - coalesce(e.salida, e.sola_hora)) / 60)::integer end,
         e.horas,
         case
           -- "Se da por bueno" (0020): el dia cuenta como normal, completo.
           when inc.tipo in ('olvido_registro', 'falla_sistema', 'retardo_justificado') then 'justificado'
           when inc.tipo is not null then 'incidencia'
           when fest.fecha is not null then 'festivo'
           when e.entrada is null then
             case
               -- Registro su salida pero no su entrada: vino (0021).
               when e.sola_id is not null then 'sin_entrada'
               -- Su turno todavia no empieza (dias futuros del reporte).
               when now() < e.ini then 'programado'
               -- Regla vieja (opcional): a los "minutos para falta" ya es falta.
               when (select muy_tarde_es_falta from cfg)
                 then case when now() > e.ini + make_interval(mins => e.falta) then 'falta' else 'pendiente' end
               -- Regla nueva: mientras dure el turno, puede llegar tarde.
               when now() > e.fin then 'falta'
               else 'pendiente'
             end
           when e.es_libre then 'a_tiempo'
           when e.entrada <= e.ini + make_interval(mins => e.tol) then 'a_tiempo'
           when e.entrada <= e.ini + make_interval(mins => e.falta) then 'retardo'
           when (select muy_tarde_es_falta from cfg) then 'falta'
           else 'retardo_mayor'
         end,
         case when e.sola_id is not null then 'salida_sin_entrada' else e.estado_salida end, inc.tipo,
         coalesce(e.banderas, e.sola_banderas, '{}'::text[]), coalesce(e.en_cuarentena, false), coalesce(e.corregida, false),
         -- Repuso: llego despues de la tolerancia y salio despues de su hora.
         -- Nunca mas de lo que llego tarde.
         case when e.entrada > e.ini + make_interval(mins => e.tol)
                   and e.salida is not null and e.salida > e.fin
              then least(greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60)),
                         floor(extract(epoch from e.salida - e.fin) / 60))::integer end,
         -- Horas que cuentan: las trabajadas; si el dia "se da por bueno", las
         -- del turno completo; si fue ausencia justificada, ninguna.
         case
           when inc.tipo in ('olvido_registro', 'falla_sistema', 'retardo_justificado')
             then round((extract(epoch from e.fin - e.ini) / 3600)::numeric, 2)
           -- Ausencia justificada pero SI trabajo (0021): sus horas cuentan.
           when inc.tipo is not null then e.horas
           else e.horas
         end
    from con_salida_sola e
    left join lateral (
      select i.tipo from incidencias i
       where i.empleado_id = e.empleado_id and e.fecha between i.fecha_inicio and i.fecha_fin
       order by i.creado_en desc
       limit 1
    ) inc on true
    left join dias_festivos fest on fest.fecha = e.fecha
  union all
  select fecha_laboral(coalesce(j.entrada, j.salida)), j.empleado_id, null, null, null,
         j.entrada, j.salida, null, null, j.horas, 'sin_turno', j.estado, null,
         j.banderas, j.en_cuarentena, j.corregida, null, j.horas
    from j
   where fecha_laboral(coalesce(j.entrada, j.salida)) between p_desde and p_hasta
     and ((j.entrada_id is not null
           and j.entrada_id not in (select x.entrada_id from con_salida_sola x where x.entrada_id is not null))
          or (j.entrada_id is null
           and j.salida_id not in (select x.sola_id from con_salida_sola x where x.sola_id is not null)));
$$;


revoke all on function reporte_asistencia(date, date, uuid) from public, anon;
grant execute on function reporte_asistencia(date, date, uuid) to authenticated;
revoke all on function turno_mas_largo_minutos() from public, anon;
grant execute on function turno_mas_largo_minutos() to authenticated;
