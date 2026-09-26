-- ============================================================================
--  0020 · INCIDENCIAS: "SE DA POR BUENO" Y A VARIOS A LA VEZ
-- ============================================================================
--
--  Observacion del autor (26-09-2026), de su experiencia en el trabajo: una
--  "incidencia" no es solo faltar con permiso. Tambien es:
--
--    - el empleado llego a su hora y creyo que checo, pero la huella / el
--      kiosco no lo tomo: no hay entrada, pero SI vino;
--    - el sistema se cayo y volvio a las 4: todos checaron 30 min despues de
--      su hora sin tener la culpa.
--
--  En esos casos el dia "se da por bueno": cuenta como un dia normal,
--  completo, con las horas de su turno. Tres tipos nuevos:
--
--      olvido_registro      no se registro (olvido, huella, kiosco)
--      falla_sistema        fallo el kiosco, el sistema o la luz
--      retardo_justificado  llego tarde por una razon aceptada
--
--  Frente a las AUSENCIAS justificadas (vacaciones, incapacidad...), que
--  evitan la falta pero NO suman horas trabajadas.
--
--  El reporte agrega `horas_acreditadas`: las horas que cuentan (trabajadas,
--  o las del turno si se dio por bueno). Las marcas nunca se tocan.
--
--  Y `registrar_incidencia_grupal`: la misma incidencia para todos los que
--  tenian turno esos dias (o solo los de un turno): "se cayo el sistema".


-- ============================================================================
--  1. TIPOS NUEVOS
-- ============================================================================

alter table incidencias drop constraint incidencias_tipo_check;
alter table incidencias add constraint incidencias_tipo_check check (tipo in (
  -- ausencias justificadas: no vino
  'vacaciones', 'incapacidad', 'permiso', 'comision', 'falta_justificada',
  -- se da por bueno: el problema no fue suyo (0020)
  'olvido_registro', 'falla_sistema', 'retardo_justificado'
));


-- ============================================================================
--  2. LA MISMA INCIDENCIA PARA VARIOS
-- ============================================================================

/**
 * Registra la incidencia para cada persona ACTIVA que tenia turno en esas
 * fechas (o solo las de `p_turno_id`). Devuelve a cuantas se les registro.
 * Las notas son el motivo, como en `registrar_incidencia`.
 */
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
     and (a.vigente_hasta is null or a.vigente_hasta > p_inicio);
  get diagnostics v_cuantos = row_count;

  if v_cuantos = 0 then
    raise exception 'Nadie tenía turno en esas fechas';
  end if;
  return v_cuantos;
exception
  when check_violation then
    raise exception 'Tipo de incidencia desconocido';
end;
$$;

revoke all on function registrar_incidencia_grupal(uuid, text, date, date, text) from public, anon;
grant execute on function registrar_incidencia_grupal(uuid, text, date, date, text) to authenticated;


-- ============================================================================
--  3. EL REPORTE: "justificado" y horas acreditadas
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
  )
  select e.fecha, e.empleado_id, e.turno, e.ini, e.fin, e.entrada, e.salida,
         case when e.entrada is not null
              then greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60))::integer end,
         case when e.salida is not null and e.salida < e.fin
              then floor(extract(epoch from e.fin - e.salida) / 60)::integer end,
         e.horas,
         case
           -- "Se da por bueno" (0020): el dia cuenta como normal, completo.
           when inc.tipo in ('olvido_registro', 'falla_sistema', 'retardo_justificado') then 'justificado'
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
                         floor(extract(epoch from e.salida - e.fin) / 60))::integer end,
         -- Horas que cuentan: las trabajadas; si el dia "se da por bueno", las
         -- del turno completo; si fue ausencia justificada, ninguna.
         case
           when inc.tipo in ('olvido_registro', 'falla_sistema', 'retardo_justificado')
             then round((extract(epoch from e.fin - e.ini) / 3600)::numeric, 2)
           when inc.tipo is not null then null
           else e.horas
         end
    from emparejados e
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
     and (j.entrada_id is null
          or j.entrada_id not in (select x.entrada_id from emparejados x where x.entrada_id is not null));
$$;


revoke all on function reporte_asistencia(date, date, uuid) from public, anon;
grant execute on function reporte_asistencia(date, date, uuid) to authenticated;
