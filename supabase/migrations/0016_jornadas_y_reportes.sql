-- ============================================================================
--  0016 · JORNADAS, RETARDOS, FALTAS Y REPORTES  (bloque 9, ARQUITECTURA.md 8)
-- ============================================================================
--
--  "El kiosco no sabe que es un retardo ni le hace falta. Solo registra
--  marcas. Retardos, faltas y horas se calculan en el servidor con la
--  configuracion vigente, asi que cambiar la tolerancia recalcula tambien el
--  historico sin tocar ni una marca." (ARQUITECTURA.md 8)
--
--  Por eso aqui NO hay tablas de resultados: todo son FUNCIONES que calculan
--  al momento de preguntar.
--
--      marcas + correcciones  ──►  marcas_validas()
--                                        │
--                                        ▼
--                                  jornadas()          entrada ↔ salida
--                                        │
--      turnos + asignaciones  ──►  reporte_asistencia()  a tiempo / retardo /
--      + dias_laborales                                   falta / horas...
--      + incidencias + festivos
--
--  EL HORARIO DE VERANO. Un turno 22:00–06:00 empieza a las 22:00 de la fecha
--  laboral y termina a las 06:00 del dia siguiente, las dos en HORA LOCAL de
--  la zona configurada, y cada una se convierte a instante por su cuenta.
--  Asi, la noche en que se repite una hora el turno dura 9 horas reales, y la
--  noche en que se pierde, 7. Las horas trabajadas son siempre la RESTA de
--  dos instantes: nunca se suman horas de reloj.


-- ============================================================================
--  1. AJUSTES AL MODELO DE LA 0007
-- ============================================================================

/*
  TOLERANCIA: UNA SOLA FUENTE, CON EXCEPCIONES.

  La 0007 dejo `tolerancia_minutos = 10` fijo en cada turno, y la pantalla de
  Configuracion tiene su propia `tolerancia_retardo_minutos`. Con las dos, el
  jefe cambiaria la tolerancia en Configuracion y no pasaria nada.

  Ahora: vacio (NULL) en el turno = usar la de Configuracion. Solo se llena
  si ESE turno necesita otra regla.
*/
alter table turnos
  alter column tolerancia_minutos drop not null,
  alter column tolerancia_minutos drop default,
  alter column minutos_para_falta drop not null,
  alter column minutos_para_falta drop default;
update turnos set tolerancia_minutos = null, minutos_para_falta = null;

/*
  HORARIO POR PERSONA Y POR DIA (confirmado por el cliente, ARQUITECTURA.md 8).

  Cada dia de una asignacion puede tener su propia hora de entrada y salida
  ("los sabados entra a las 7"). Vacio = la del turno.
*/
alter table dias_laborales
  add column hora_inicio time,
  add column hora_fin    time,
  add constraint dias_laborales_horario_completo check ((hora_inicio is null) = (hora_fin is null));

-- El motivo de una correccion: el mismo minimo que las demas acciones del
-- panel (exigir_motivo, 0015). La 0008 pedia 20; dos reglas distintas para lo
-- mismo solo confunden.
alter table correcciones drop constraint correcciones_motivo_check;
alter table correcciones add constraint correcciones_motivo_check check (length(trim(motivo)) >= 10);

-- Una marca se anula una sola vez.
create unique index correcciones_una_anulacion on correcciones (marca_id) where accion = 'anular';

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('minutos_anticipacion_entrada', '240'::jsonb,
   'Cuanto antes de la hora de entrada cuenta un registro para ese turno.',
   'asistencia', 'entero', 0, 720, 'minutos');

/** Un valor entero de la configuracion, con respaldo. */
create or replace function config_entero(p_clave text, p_respaldo integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (valor #>> '{}')::integer from configuracion where clave = p_clave), p_respaldo);
$$;


-- ============================================================================
--  2. MARCAS VALIDAS: las marcas, con sus correcciones aplicadas
-- ============================================================================
--  - una marca ANULADA no cuenta (pero sigue en la tabla: es inmutable);
--  - una con CAMBIO DE TIPO cuenta con el tipo corregido;
--  - una correccion "agregar" cuenta como una marca mas.
--  La marca original nunca se toca (ARQUITECTURA.md 8).

create or replace function marcas_validas(p_desde timestamptz, p_hasta timestamptz)
returns table (
  id uuid, empleado_id uuid, tipo text, hora timestamptz, origen text,
  dispositivo_id uuid, banderas text[], en_cuarentena boolean, corregida boolean
)
language sql
stable
set search_path = public
as $$
  select m.id, m.empleado_id, coalesce(ct.tipo, m.tipo), m.hora_estimada, m.origen,
         m.dispositivo_id, m.banderas, m.en_cuarentena, ct.tipo is not null
    from marcas m
    left join lateral (
      select c.datos ->> 'tipo' as tipo
        from correcciones c
       where c.marca_id = m.id and c.accion = 'cambiar_tipo'
       order by c.creado_en desc
       limit 1
    ) ct on true
   where m.hora_estimada >= p_desde and m.hora_estimada < p_hasta
     and not exists (select 1 from correcciones c where c.marca_id = m.id and c.accion = 'anular')
  union all
  select c.id, c.empleado_id, c.datos ->> 'tipo', (c.datos ->> 'hora')::timestamptz, 'manual',
         null::uuid, array['manual']::text[], false, true
    from correcciones c
   where c.accion = 'agregar'
     and (c.datos ->> 'hora')::timestamptz >= p_desde
     and (c.datos ->> 'hora')::timestamptz < p_hasta;
$$;


-- ============================================================================
--  3. JORNADAS: emparejar entradas con salidas
-- ============================================================================
--  En el servidor y no en el kiosco, porque alguien puede entrar por un
--  kiosco y salir por otro (ARQUITECTURA.md 8).
--
--  Reglas, en orden:
--    1. TOQUES REPETIDOS: de varias entradas seguidas cuenta la primera (la
--       hora a la que llego); de varias salidas seguidas, la ultima (la hora
--       a la que se fue). Quien checa dos veces "por si no quedo" no debe
--       aparecer con una jornada sin salida.
--    2. Una entrada con su salida a menos de `horas_para_cierre_automatico`
--       es una jornada COMPLETA; las horas son la resta de los dos instantes.
--    3. Una entrada sin salida: EN CURSO mientras no pasen esas horas;
--       despues, SALIDA NO REGISTRADA. No se inventa la hora de salida.
--    4. Una salida sin entrada antes: SALIDA SIN ENTRADA.
--
--  Devuelve las jornadas que EMPIEZAN entre p_desde y p_hasta (las marcas se
--  buscan con margen a los dos lados para no partir una jornada en el borde).

create or replace function jornadas(p_desde timestamptz, p_hasta timestamptz)
returns table (
  empleado_id uuid, entrada_id uuid, entrada timestamptz, salida_id uuid, salida timestamptz,
  estado text, horas numeric, banderas text[], en_cuarentena boolean, corregida boolean,
  dispositivo_entrada uuid, dispositivo_salida uuid
)
language sql
stable
set search_path = public
as $$
  with
  limite as (select make_interval(hours => config_entero('horas_para_cierre_automatico', 16)) as l),
  crudas as (
    select v.*,
           lag(v.tipo)  over w as ant_tipo, lag(v.hora)  over w as ant_hora,
           lead(v.tipo) over w as sig_tipo, lead(v.hora) over w as sig_hora
      from marcas_validas(p_desde - (select l from limite), p_hasta + (select l from limite)) v
    window w as (partition by v.empleado_id order by v.hora, v.id)
  ),
  -- Regla 1: fuera los toques repetidos.
  --
  -- El `coalesce` NO es decoracion: la primera marca de cada persona no tiene
  -- anterior, y `ant_tipo = 'entrada'` con NULL da NULL; `not NULL` sigue
  -- siendo NULL, y el WHERE descarta la fila. Sin el, se perdia la jornada de
  -- quien solo tenia una entrada en el periodo (lo encontro la prueba del
  -- turno nocturno en el cambio de horario).
  limpias as (
    select * from crudas c
     where not coalesce(c.tipo = 'entrada' and c.ant_tipo = 'entrada'
                        and c.hora - c.ant_hora <= (select l from limite), false)
       and not coalesce(c.tipo = 'salida' and c.sig_tipo = 'salida'
                        and c.sig_hora - c.hora <= (select l from limite), false)
  ),
  m as (
    select l.*,
           lead(l.tipo) over w as s_tipo, lead(l.hora) over w as s_hora, lead(l.id) over w as s_id,
           lead(l.banderas) over w as s_banderas, lead(l.en_cuarentena) over w as s_cuarentena,
           lead(l.corregida) over w as s_corregida, lead(l.dispositivo_id) over w as s_dispositivo,
           lag(l.tipo) over w as a_tipo, lag(l.hora) over w as a_hora
      from limpias l
    window w as (partition by l.empleado_id order by l.hora, l.id)
  ),
  entradas as (
    select m.*, coalesce(m.s_tipo = 'salida' and m.s_hora - m.hora <= (select l from limite), false) as cerrada
      from m
     where m.tipo = 'entrada' and m.hora >= p_desde and m.hora < p_hasta
  )
  select e.empleado_id, e.id, e.hora,
         case when e.cerrada then e.s_id end,
         case when e.cerrada then e.s_hora end,
         case when e.cerrada then 'completa'
              when now() - e.hora > (select l from limite) then 'salida_no_registrada'
              else 'en_curso' end,
         case when e.cerrada then round((extract(epoch from e.s_hora - e.hora) / 3600)::numeric, 2) end,
         e.banderas || case when e.cerrada then e.s_banderas else '{}'::text[] end,
         e.en_cuarentena or (e.cerrada and e.s_cuarentena),
         e.corregida or (e.cerrada and e.s_corregida),
         e.dispositivo_id,
         case when e.cerrada then e.s_dispositivo end
    from entradas e
  union all
  select m.empleado_id, null, null, m.id, m.hora, 'salida_sin_entrada', null,
         m.banderas, m.en_cuarentena, m.corregida, null, m.dispositivo_id
    from m
   where m.tipo = 'salida' and m.hora >= p_desde and m.hora < p_hasta
     and not coalesce(m.a_tipo = 'entrada' and m.hora - m.a_hora <= (select l from limite), false);
$$;


-- ============================================================================
--  4. EL REPORTE: cada dia programado de cada persona
-- ============================================================================
--
--  Un renglon por (fecha, empleado) que tenia turno ese dia, con su estado:
--
--    a_tiempo    entro antes de inicio + tolerancia
--    retardo     entro antes de inicio + minutos para falta
--    falta       no entro, o entro despues de eso
--    pendiente   todavia no es la hora (o no ha pasado el margen)
--    incidencia  vacaciones, incapacidad, permiso... (no es falta)
--    festivo     dia festivo (no se esperaba a nadie)
--    sin_turno   trabajo un dia u hora que no tenia programado
--
--  y aparte, como le fue a la SALIDA: completa, salida_no_registrada,
--  en_curso o salida_sin_entrada.
--
--  Una entrada cuenta para un turno si cae entre (inicio - anticipacion) y el
--  fin del turno. La fecha de un turno nocturno es la del dia en que EMPIEZA.
--
--  SECURITY INVOKER (lo normal): corre con los permisos de quien pregunta, asi
--  que la RLS de cada tabla sigue mandando.

create or replace function reporte_asistencia(p_desde date, p_hasta date, p_empleado_id uuid default null)
returns table (
  fecha date, empleado_id uuid, turno text,
  programado_inicio timestamptz, programado_fin timestamptz,
  entrada timestamptz, salida timestamptz,
  minutos_tarde integer, minutos_salida_anticipada integer, horas numeric,
  estado text, estado_salida text, incidencia text,
  banderas text[], en_cuarentena boolean, corregida boolean
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
           make_interval(mins => config_entero('minutos_anticipacion_entrada', 240)) as antes
  ),
  dias as (select d::date as fecha from generate_series(p_desde, p_hasta, interval '1 day') d),
  programados as (
    select dias.fecha, a.empleado_id, t.nombre as turno, t.es_libre,
           coalesce(t.tolerancia_minutos, cfg.tol) as tol,
           coalesce(t.minutos_para_falta, cfg.falta) as falta,
           coalesce(dl.hora_inicio, t.hora_inicio) as hi,
           coalesce(dl.hora_fin, t.hora_fin) as hf,
           cfg.zona
      from dias
      join asignaciones_turno a
        on a.vigente_desde <= dias.fecha and (a.vigente_hasta is null or dias.fecha < a.vigente_hasta)
      join turnos t on t.id = a.turno_id
      join dias_laborales dl on dl.asignacion_id = a.id and dl.dia_semana = extract(dow from dias.fecha)
      cross join cfg
     where p_empleado_id is null or a.empleado_id = p_empleado_id
  ),
  -- Cada hora local se convierte a instante POR SEPARADO: asi el horario de
  -- verano sale bien (ver el encabezado).
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
  )
  select e.fecha, e.empleado_id, e.turno, e.ini, e.fin, e.entrada, e.salida,
         case when e.entrada is not null
              then greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60))::integer end,
         case when e.salida is not null and e.salida < e.fin
              then floor(extract(epoch from e.fin - e.salida) / 60)::integer end,
         e.horas,
         case
           when inc.tipo is not null then 'incidencia'
           when fest.fecha is not null then 'festivo'
           when e.entrada is null then
             case when now() > e.ini + make_interval(mins => e.falta) then 'falta' else 'pendiente' end
           when e.es_libre then 'a_tiempo'
           when e.entrada <= e.ini + make_interval(mins => e.tol) then 'a_tiempo'
           when e.entrada <= e.ini + make_interval(mins => e.falta) then 'retardo'
           else 'falta'
         end,
         e.estado_salida, inc.tipo,
         coalesce(e.banderas, '{}'::text[]), coalesce(e.en_cuarentena, false), coalesce(e.corregida, false)
    from emparejados e
    left join lateral (
      select i.tipo from incidencias i
       where i.empleado_id = e.empleado_id and e.fecha between i.fecha_inicio and i.fecha_fin
       limit 1
    ) inc on true
    left join dias_festivos fest on fest.fecha = e.fecha
  union all
  -- Trabajo que no cayo en ningun turno programado: tambien se ve.
  select fecha_laboral(coalesce(j.entrada, j.salida)), j.empleado_id, null, null, null,
         j.entrada, j.salida, null, null, j.horas, 'sin_turno', j.estado, null,
         j.banderas, j.en_cuarentena, j.corregida
    from j
   where fecha_laboral(coalesce(j.entrada, j.salida)) between p_desde and p_hasta
     and (j.entrada_id is null
          or j.entrada_id not in (select x.entrada_id from emparejados x where x.entrada_id is not null));
$$;


-- ============================================================================
--  5. LO QUE HACE EL PANEL (con rol y motivo, como en la 0015)
-- ============================================================================

/** Anular una marca o cambiarle el tipo. La marca original NO se toca. */
create or replace function corregir_marca(p_marca_id uuid, p_accion text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marca marcas%rowtype;
  v_tipo  text;
begin
  if not es_administrador() then
    raise exception 'Sólo un administrador o supervisor puede corregir registros';
  end if;
  perform exigir_motivo(p_motivo);

  select * into v_marca from marcas where id = p_marca_id;
  if not found then
    raise exception 'No existe ese registro';
  end if;
  if exists (select 1 from correcciones where marca_id = p_marca_id and accion = 'anular') then
    raise exception 'Ese registro ya está anulado';
  end if;

  if p_accion = 'anular' then
    insert into correcciones (marca_id, empleado_id, accion, motivo, admin_id)
    values (p_marca_id, v_marca.empleado_id, 'anular', trim(p_motivo), auth.uid());
  elsif p_accion = 'cambiar_tipo' then
    -- El contrario del tipo VIGENTE (puede que ya se hubiera cambiado antes).
    select coalesce(
             (select c.datos ->> 'tipo' from correcciones c
               where c.marca_id = p_marca_id and c.accion = 'cambiar_tipo'
               order by c.creado_en desc limit 1),
             v_marca.tipo)
      into v_tipo;
    insert into correcciones (marca_id, empleado_id, accion, datos, motivo, admin_id)
    values (p_marca_id, v_marca.empleado_id, 'cambiar_tipo',
            jsonb_build_object('tipo', case when v_tipo = 'entrada' then 'salida' else 'entrada' end),
            trim(p_motivo), auth.uid());
  else
    raise exception 'La corrección debe ser anular o cambiar el tipo';
  end if;
end;
$$;

/**
 * El horario de una persona a partir de una fecha: turno, dias y, si hace
 * falta, horas propias por dia. El horario anterior se cierra un dia antes
 * (queda en el historico: los dias pasados se siguen calculando con el).
 *
 * p_dias: [{"dia": 1, "inicio": "07:00", "fin": "15:00"}, {"dia": 2}, ...]
 * (0 = domingo; sin "inicio"/"fin" = las del turno)
 */
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
    insert into dias_laborales (asignacion_id, dia_semana, hora_inicio, hora_fin)
    values (v_id, (v_dia ->> 'dia')::smallint,
            nullif(v_dia ->> 'inicio', '')::time, nullif(v_dia ->> 'fin', '')::time);
  end loop;
  return v_id;
end;
$$;

/** Crear o cambiar un turno (plantilla de horario). */
create or replace function guardar_turno(
  p_id          uuid,
  p_nombre      text,
  p_inicio      time,
  p_fin         time,
  p_tolerancia  integer,
  p_falta       integer,
  p_motivo      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
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

  if p_id is null then
    insert into turnos (nombre, hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta)
    values (trim(p_nombre), p_inicio, p_fin, p_tolerancia, p_falta)
    returning id into v_id;
  else
    update turnos
       set nombre = trim(p_nombre), hora_inicio = p_inicio, hora_fin = p_fin,
           tolerancia_minutos = p_tolerancia, minutos_para_falta = p_falta
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'No existe ese turno';
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya hay un turno con ese nombre';
  when check_violation then
    raise exception 'Los minutos para falta deben ser más que la tolerancia';
end;
$$;

/** Vacaciones, incapacidad, permiso...: esos dias no son falta. Las notas son el motivo. */
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
  insert into incidencias (empleado_id, tipo, fecha_inicio, fecha_fin, notas, admin_id)
  values (p_empleado_id, p_tipo, p_inicio, p_fin, trim(p_notas), auth.uid())
  returning id into v_id;
  return v_id;
exception
  when check_violation then
    raise exception 'Tipo de ausencia desconocido';
end;
$$;

create or replace function borrar_incidencia(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede borrar una ausencia';
  end if;
  perform exigir_motivo(p_motivo);
  delete from incidencias where id = p_id;
  if not found then
    raise exception 'No existe esa ausencia';
  end if;
end;
$$;

create or replace function guardar_dia_festivo(p_fecha date, p_descripcion text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar los días festivos';
  end if;
  if length(trim(coalesce(p_descripcion, ''))) < 3 then
    raise exception 'Escribe qué se celebra ese día';
  end if;
  perform set_config('app.motivo', 'Día festivo: ' || trim(p_descripcion), true);
  insert into dias_festivos (fecha, descripcion, creado_por)
  values (p_fecha, trim(p_descripcion), auth.uid())
  on conflict (fecha) do update set descripcion = excluded.descripcion;
end;
$$;

create or replace function borrar_dia_festivo(p_fecha date, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar los días festivos';
  end if;
  perform exigir_motivo(p_motivo);
  delete from dias_festivos where fecha = p_fecha;
end;
$$;


-- ============================================================================
--  6. PERMISOS
-- ============================================================================
--  Las de calculo: cualquiera con sesion las puede llamar; la RLS de cada
--  tabla decide que ve (security invoker). Las de accion revisan el rol.

revoke all on function marcas_validas(timestamptz, timestamptz) from public, anon;
revoke all on function jornadas(timestamptz, timestamptz) from public, anon;
revoke all on function reporte_asistencia(date, date, uuid) from public, anon;
revoke all on function config_entero(text, integer) from public, anon;
grant execute on function marcas_validas(timestamptz, timestamptz) to authenticated;
grant execute on function jornadas(timestamptz, timestamptz) to authenticated;
grant execute on function reporte_asistencia(date, date, uuid) to authenticated;
grant execute on function config_entero(text, integer) to authenticated;

revoke all on function corregir_marca(uuid, text, text) from public, anon;
revoke all on function asignar_horario(uuid, uuid, date, jsonb, text) from public, anon;
revoke all on function guardar_turno(uuid, text, time, time, integer, integer, text) from public, anon;
revoke all on function registrar_incidencia(uuid, text, date, date, text) from public, anon;
revoke all on function borrar_incidencia(uuid, text) from public, anon;
revoke all on function guardar_dia_festivo(date, text) from public, anon;
revoke all on function borrar_dia_festivo(date, text) from public, anon;
grant execute on function corregir_marca(uuid, text, text) to authenticated;
grant execute on function asignar_horario(uuid, uuid, date, jsonb, text) to authenticated;
grant execute on function guardar_turno(uuid, text, time, time, integer, integer, text) to authenticated;
grant execute on function registrar_incidencia(uuid, text, date, date, text) to authenticated;
grant execute on function borrar_incidencia(uuid, text) to authenticated;
grant execute on function guardar_dia_festivo(date, text) to authenticated;
grant execute on function borrar_dia_festivo(date, text) to authenticated;
