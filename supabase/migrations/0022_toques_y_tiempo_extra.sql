-- ============================================================================
--  0022 · TOQUES REPETIDOS, JORNADA INTERRUMPIDA Y TIEMPO EXTRA
-- ============================================================================
--
--  Preguntas del autor (26-09-2026):
--
--   "¿Que pasa si alguien trabaja de 3 a 11, olvida la salida y al dia
--    siguiente entra a las 6?"  -> la entrada de las 6:00 SE PERDIA: la regla
--      de "toque repetido" (quien checa dos veces por si no quedo) usaba el
--      limite de 16 h, y las dos entradas estaban a 15 h. Ahora un toque
--      repetido es a menos de `minutos_toque_repetido` (60, configurable), y
--      si llega una entrada nueva, la anterior sin salida queda de inmediato
--      como "no registro salida".
--
--   "¿Que pasa si alguien dobla turno (14-16 h)?"  -> la jornada se cuenta
--      bien si dura menos que "salida no registrada" (16 h), pero el reporte
--      no decia cuanto fue TIEMPO EXTRA. Ahora `minutos_extra`: lo que se
--      quedo despues de su hora de salida y que no fue para reponer un retardo.

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('minutos_toque_repetido', '60'::jsonb,
   'Dos entradas (o dos salidas) seguidas a menos de estos minutos cuentan como una sola (checó dos veces "por si no quedó").',
   'asistencia', 'entero', 1, 240, 'minutos'),
  ('minutos_minimos_tiempo_extra', '30'::jsonb,
   'Quedarse después de la hora de salida cuenta como TIEMPO EXTRA a partir de estos minutos (salir 5 minutos tarde no es tiempo extra).',
   'asistencia', 'entero', 0, 240, 'minutos');

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
  -- "Toque repetido" (0022): dos entradas (o dos salidas) seguidas a menos de
  -- estos minutos. Antes se usaba el limite de 16 h, y una entrada de las 6:00
  -- se perdia si la persona habia entrado a las 15:00 del dia anterior y
  -- olvidado la salida.
  toque as (select make_interval(mins => config_entero('minutos_toque_repetido', 60)) as t),
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
                        and c.hora - c.ant_hora <= (select t from toque), false)
       and not coalesce(c.tipo = 'salida' and c.sig_tipo = 'salida'
                        and c.sig_hora - c.hora <= (select t from toque), false)
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
              -- Despues vino OTRA entrada: esta jornada ya termino sin salida
              -- (0022), aunque no hayan pasado las horas del limite.
              when e.s_tipo = 'entrada' then 'salida_no_registrada'
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
  horas_acreditadas numeric,
  minutos_extra integer
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
         j.banderas, j.en_cuarentena, j.corregida, null, j.horas, null
    from j
   where fecha_laboral(coalesce(j.entrada, j.salida)) between p_desde and p_hasta
     and ((j.entrada_id is not null
           and j.entrada_id not in (select x.entrada_id from con_salida_sola x where x.entrada_id is not null))
          or (j.entrada_id is null
           and j.salida_id not in (select x.sola_id from con_salida_sola x where x.sola_id is not null)));
$$;


revoke all on function reporte_asistencia(date, date, uuid) from public, anon;
grant execute on function reporte_asistencia(date, date, uuid) to authenticated;
