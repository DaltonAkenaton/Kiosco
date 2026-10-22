-- ============================================================================
--  0030 · TOLERANCIA PARA SALIR ANTES  (21-10-2026)
-- ============================================================================
--
--  Al probar el panel: un dia "A tiempo" traia el boton "Justificar" porque la
--  persona salio 5 minutos antes de su hora. Para llegar tarde hay tolerancia
--  (tolerancia_retardo_minutos); para irse antes no habia ninguna: 1 minuto ya
--  contaba. El autor no esta seguro de cuanto debe ser, asi que es un ajuste
--  de Configuracion: tolerancia_salida_minutos.
--
--  Viene en 0 = como hasta hoy (cualquier minuto antes cuenta). Con 10, quien
--  sale a las 13:52 de un turno que termina a las 14:00 no aparece como
--  "se fue antes"; quien sale a las 13:45, si (con sus 15 minutos).
--
--  Solo cambia minutos_salida_anticipada de reporte_asistencia (lo demas es
--  copia exacta de la 0029). Las horas trabajadas no cambian: se siguen
--  contando con la hora real de salida.
-- ============================================================================

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('tolerancia_salida_minutos', '0'::jsonb,
   'Minutos antes de la hora de salida en que todavia NO se cuenta que se fue antes. 0 = cualquier minuto cuenta.',
   'asistencia', 'entero', 0, 120, 'minutos')
on conflict (clave) do nothing;

create or replace function reporte_asistencia(p_desde date, p_hasta date, p_empleado_id uuid default null)
returns table (
  fecha date, empleado_id uuid, turno text,
  programado_inicio timestamptz, programado_fin timestamptz,
  entrada timestamptz, salida timestamptz,
  minutos_tarde integer, minutos_salida_anticipada integer, horas numeric,
  estado text, estado_salida text, incidencia text,
  banderas text[], en_cuarentena boolean, corregida boolean,
  minutos_repuestos integer,
  horas_acreditadas numeric,
  minutos_extra integer,
  ajuste text
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
           make_interval(mins => config_entero('minutos_anticipacion_entrada', 240)) as antes,
           config_entero('tolerancia_salida_minutos', 0) as tol_salida
  ),
  dias as (select d::date as fecha from generate_series(p_desde, p_hasta, interval '1 day') d),
  -- Los dias con un cambio de horario (0029).
  ajustes as (
    select aj.* from ajustes_horario aj
     where aj.fecha between p_desde and p_hasta
       and (p_empleado_id is null or aj.empleado_id = p_empleado_id)
  ),
  programados as (
    select dias.fecha, a.empleado_id, t.nombre as turno, t.es_libre,
           -- El horario del turno VIGENTE ESE DIA (0019); si no hubiera
           -- historia, el actual.
           coalesce(v.tolerancia_minutos, cfg.tol) as tol,
           coalesce(v.minutos_para_falta, cfg.falta) as falta,
           coalesce(dl.hora_inicio, v.hora_inicio, t.hora_inicio) as hi,
           coalesce(dl.hora_fin, v.hora_fin, t.hora_fin) as hf,
           cfg.zona,
           null::text as ajuste
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
     where (p_empleado_id is null or a.empleado_id = p_empleado_id)
       and not exists (select 1 from ajustes x where x.empleado_id = a.empleado_id and x.fecha = dias.fecha)
    union all
    -- El dia con ajuste: su horario. Tolerancias: las de su turno de ese dia
    -- (aunque ese dia normalmente descanse); sin turno, las generales.
    select aj.fecha, aj.empleado_id, coalesce(t.nombre, 'Cambio de horario'), false,
           coalesce(v.tolerancia_minutos, cfg.tol),
           coalesce(v.minutos_para_falta, cfg.falta),
           aj.hora_inicio, aj.hora_fin, cfg.zona,
           case when aj.intercambio_id is not null then 'intercambio' else 'cambio' end
      from ajustes aj
      cross join cfg
      left join lateral (
        select a.turno_id from asignaciones_turno a
         where a.empleado_id = aj.empleado_id
           and a.vigente_desde <= aj.fecha and (a.vigente_hasta is null or aj.fecha < a.vigente_hasta)
         limit 1
      ) asig on true
      left join turnos t on t.id = asig.turno_id
      left join lateral (
        select tv.* from turno_versiones tv
         where tv.turno_id = t.id and tv.vigente_desde <= aj.fecha
         order by tv.vigente_desde desc
         limit 1
      ) v on true
     where not aj.descansa
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
         -- 0030: dentro de la tolerancia para salir antes, no se cuenta (null).
         case when coalesce(e.salida, e.sola_hora) < e.fin
               and floor(extract(epoch from e.fin - coalesce(e.salida, e.sola_hora)) / 60) > (select tol_salida from cfg)
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
         end,
         -- Tiempo EXTRA (0022): lo que se quedo despues de su hora de salida y
         -- que no fue para reponer un retardo. Un turno doble se ve aqui.
         case when e.salida is not null and e.salida > e.fin
                   -- Salir unos minutos tarde no es tiempo extra: desde el minimo configurado.
                   and floor(extract(epoch from e.salida - e.fin) / 60)
                       - coalesce(case when e.entrada > e.ini + make_interval(mins => e.tol)
                                       then least(greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60)),
                                                  floor(extract(epoch from e.salida - e.fin) / 60)) end, 0)
                       >= config_entero('minutos_minimos_tiempo_extra', 30)
                   and floor(extract(epoch from e.salida - e.fin) / 60)
                       - coalesce(case when e.entrada > e.ini + make_interval(mins => e.tol)
                                       then least(greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60)),
                                                  floor(extract(epoch from e.salida - e.fin) / 60)) end, 0) > 0
              then (floor(extract(epoch from e.salida - e.fin) / 60)
                    - coalesce(case when e.entrada > e.ini + make_interval(mins => e.tol)
                                    then least(greatest(0, floor(extract(epoch from e.entrada - e.ini) / 60)),
                                               floor(extract(epoch from e.salida - e.fin) / 60)) end, 0))::integer
         end,
         e.ajuste
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
         j.banderas, j.en_cuarentena, j.corregida, null, j.horas, null, null
    from j
   where fecha_laboral(coalesce(j.entrada, j.salida)) between p_desde and p_hasta
     and ((j.entrada_id is not null
           and j.entrada_id not in (select x.entrada_id from con_salida_sola x where x.entrada_id is not null))
          or (j.entrada_id is null
           and j.salida_id not in (select x.sola_id from con_salida_sola x where x.sola_id is not null)));
$$;
