-- ============================================================================
--  0019 · LLEGAR TARDE NO ES FALTA, "REPUSO EL TIEMPO" Y TURNOS CON HISTORIA
-- ============================================================================
--
--  Decisiones del autor en la fase de pruebas (26-09-2026):
--
--  1. FALTA = NO VINO. Quien llega tarde (aunque sea una hora: se le poncho
--     una llanta) llego: es RETARDO, con sus minutos. Pasados los "minutos
--     para falta" (30) se llama RETARDO MAYOR, pero no falta. La regla vieja
--     (muy tarde = falta) queda como opcion en Configuracion
--     (`llegar_muy_tarde_es_falta`, apagada).
--
--     Y a quien no ha llegado no se le pone falta a los 30 minutos: mientras
--     dure su turno es "todavia no llega" (puede llegar tarde); al terminar
--     el turno sin entrada, falta.
--
--  2. REPUSO EL TIEMPO. Si llego tarde y se quedo despues de su hora de
--     salida, el reporte dice cuanto repuso ("llego 50 min tarde, repuso 40").
--     El sistema informa; lo que se haga con eso lo decide el jefe.
--
--  3. CAMBIAR EL HORARIO DE UN TURNO NO CAMBIA EL PASADO. Antes, editar el
--     Matutino de 6:00 a 5:00 recalculaba tambien las semanas pasadas: todos
--     los de la semana anterior salian con retardo. Ahora cada turno guarda la
--     historia de sus horarios (`turno_versiones`) y cada dia se califica con
--     el horario que tenia ESE dia. El cambio se aplica "a partir de" una fecha.


-- ============================================================================
--  1. CONFIGURACION
-- ============================================================================

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('llegar_muy_tarde_es_falta', '0'::jsonb,
   'Si vale 1, llegar más tarde que los "minutos para retardo mayor" cuenta como FALTA aunque la persona sí haya venido. Con 0 (lo normal), falta es sólo no venir.',
   'asistencia', 'entero', 0, 1, '');

update configuracion
   set descripcion = 'Minutos tarde a partir de los cuales el retardo es "retardo mayor".'
 where clave = 'minutos_para_falta';


-- ============================================================================
--  2. LA HISTORIA DE HORARIOS DE CADA TURNO
-- ============================================================================

create table turno_versiones (
  turno_id           uuid not null references turnos (id) on delete cascade,
  vigente_desde      date not null,
  hora_inicio        time not null,
  hora_fin           time not null,
  tolerancia_minutos integer,
  minutos_para_falta integer,
  creado_en          timestamptz not null default now(),
  primary key (turno_id, vigente_desde)
);

comment on table turno_versiones is
  'El horario de cada turno a partir de cada fecha. El reporte califica cada dia con el horario '
  'vigente ESE dia: cambiar un turno no reescribe el pasado.';

alter table turno_versiones enable row level security;
create policy turno_versiones_leer on turno_versiones
  for select to authenticated using (es_administrador());

create trigger auditar_turno_versiones
  after insert or update or delete on turno_versiones
  for each row execute function auditar_cambio();

-- Los turnos que ya existen: su horario actual vale "desde siempre".
insert into turno_versiones (turno_id, vigente_desde, hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta)
select id, date '2000-01-01', hora_inicio, hora_fin, tolerancia_minutos, minutos_para_falta from turnos;


-- ============================================================================
--  3. GUARDAR UN TURNO: los cambios de horario van "a partir de"
-- ============================================================================

drop function if exists guardar_turno(uuid, text, time, time, integer, integer, text);

/**
 * Crear o cambiar un turno.
 *
 * p_desde: a partir de que dia vale el horario nuevo. Los dias anteriores se
 * siguen calculando con el horario que tenian. Si es nulo (o es un turno
 * nuevo), el horario vale desde siempre.
 */
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

revoke all on function guardar_turno(uuid, text, time, time, integer, integer, text, date) from public, anon;
grant execute on function guardar_turno(uuid, text, time, time, integer, integer, text, date) to authenticated;


-- ============================================================================
--  4. EL REPORTE, CON LAS REGLAS NUEVAS
-- ============================================================================
--  Cambia su forma (columna nueva `minutos_repuestos`), asi que se borra y se
--  vuelve a crear.

drop function if exists reporte_asistencia(date, date, uuid);

create or replace function reporte_asistencia(p_desde date, p_hasta date, p_empleado_id uuid default null)
returns table (
  fecha date, empleado_id uuid, turno text,
  programado_inicio timestamptz, programado_fin timestamptz,
  entrada timestamptz, salida timestamptz,
  minutos_tarde integer, minutos_salida_anticipada integer, horas numeric,
  estado text, estado_salida text, incidencia text,
  banderas text[], en_cuarentena boolean, corregida boolean,
  minutos_repuestos integer
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
             case
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
         e.estado_salida, inc.tipo,
         coalesce(e.banderas, '{}'::text[]), coalesce(e.en_cuarentena, false), coalesce(e.corregida, false),
         -- Repuso: llego despues de la tolerancia y salio despues de su hora.
         -- Nunca mas de lo que llego tarde.
         case when e.entrada > e.ini + make_interval(mins => e.tol)
                   and e.salida is not null and e.salida > e.fin
              then least(greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60)),
                         floor(extract(epoch from e.salida - e.fin) / 60))::integer end
    from emparejados e
    left join lateral (
      select i.tipo from incidencias i
       where i.empleado_id = e.empleado_id and e.fecha between i.fecha_inicio and i.fecha_fin
       limit 1
    ) inc on true
    left join dias_festivos fest on fest.fecha = e.fecha
  union all
  select fecha_laboral(coalesce(j.entrada, j.salida)), j.empleado_id, null, null, null,
         j.entrada, j.salida, null, null, j.horas, 'sin_turno', j.estado, null,
         j.banderas, j.en_cuarentena, j.corregida, null
    from j
   where fecha_laboral(coalesce(j.entrada, j.salida)) between p_desde and p_hasta
     and (j.entrada_id is null
          or j.entrada_id not in (select x.entrada_id from emparejados x where x.entrada_id is not null));
$$;

revoke all on function reporte_asistencia(date, date, uuid) from public, anon;
grant execute on function reporte_asistencia(date, date, uuid) to authenticated;


