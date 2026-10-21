-- ============================================================================
--  0029 · PENDIENTES, NOTAS Y CAMBIOS DE HORARIO POR UN DIA  (20-10-2026)
-- ============================================================================
--
--  Sale de la junta con el jefe (20-10-2026). Cinco cosas:
--
--  1. CAMBIO DE HORARIO POR UN DIA (e intercambio entre dos personas).
--     "Hoy Juan cubre el turno de Pedro y Pedro el de Juan." Sin esto, el
--     reporte veria a Juan FALTAR a su turno y a Pedro llegar a una hora
--     rara: dos casos falsos de dos personas que si trabajaron. Un ajuste
--     manda sobre el horario normal SOLO ese dia; no toca ninguna marca.
--
--  2. PENDIENTES. El jefe tiene muchas cosas que hacer: lo que ve el viernes
--     ya se le olvido el lunes. Un pendiente es un CASO que se queda abierto
--     hasta que alguien lo atiende y escribe que hizo ("se hablo con el",
--     "se levanto acta"). Asi queda tambien la historia de cada persona.
--     Lo que ya no aplica (se registro un permiso, se corrigio la salida) se
--     cierra solo, diciendo por que.
--
--     Las reglas son del jefe (tabla configuracion): minutos tarde en un dia,
--     minutos sumados en la semana (lunes a domingo, contados DESDE LA HORA
--     DE ENTRADA, aunque esten dentro de la tolerancia), faltas, salidas no
--     registradas, registros de personas dadas de baja y fotos tapadas. Cada
--     una se puede apagar.
--
--     NO hay tarea programada: los casos se buscan cada vez que alguien abre
--     el panel (`revisar_pendientes()`). Con ~20 personas tarda nada, y una
--     tarea programada es una pieza mas que se puede caer sin que nadie lo
--     note.
--
--  3. NOTAS con casillas (lista de pendientes personales). Cada nota es de
--     quien la escribe; se puede dejar para uno mismo, para todos los
--     administradores o para algunos.
--
--  4. LA HORA DEL SERVIDOR para el panel: una PC de oficina con la zona
--     horaria mal puesta mostraba "actualizado a las 13:01" a las 12:01.
--
--  5. Ajuste nuevo: los empleados checan con su NUMERO de empleado en vez de
--     elegir su nombre de una lista. Baja al kiosco con la configuracion.


-- ============================================================================
--  1. CAMBIOS DE HORARIO POR UN DIA
-- ============================================================================

create table ajustes_horario (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid not null references empleados (id),

  -- La FECHA LABORAL: un ajuste del velador el dia 24 es su noche del 24 al 25.
  fecha           date not null,

  -- Ese dia descansa (por ejemplo, porque cambio su dia con otra persona).
  descansa        boolean not null default false,
  hora_inicio     time,
  hora_fin        time,

  -- Un intercambio son DOS ajustes con el mismo `intercambio_id`; se crean y
  -- se quitan juntos.
  intercambio_id  uuid,
  intercambio_con uuid references empleados (id),

  motivo          text not null,
  creado_por      uuid references auth.users (id) default auth.uid(),
  creado_en       timestamptz not null default now(),

  unique (empleado_id, fecha),
  constraint ajustes_horario_horas check (
    (descansa and hora_inicio is null and hora_fin is null)
    or (not descansa and hora_inicio is not null and hora_fin is not null and hora_inicio <> hora_fin)
  )
);

comment on table ajustes_horario is
  'Horario de UNA persona en UN dia, que manda sobre su horario normal. Un '
  'intercambio son dos filas con el mismo intercambio_id. No toca ninguna marca: '
  'solo cambia contra que horario se miden retardos y faltas ese dia (0029).';

create index ajustes_horario_fecha_idx on ajustes_horario (fecha);

alter table ajustes_horario enable row level security;

-- Todos los administradores lo ven. Escribir: solo con las funciones de abajo
-- (piden motivo y rol admin); por eso no hay politica de escritura.
create policy ajustes_horario_leer on ajustes_horario
  for select to authenticated using (es_administrador());

create trigger auditar_ajustes_horario
  after insert or update or delete on ajustes_horario
  for each row execute function auditar_cambio();


/**
 * El horario de una persona en un dia: el ajuste si lo hay; si no, el de su
 * asignacion vigente (con el horario propio de ese dia de la semana y la
 * version del turno de esa fecha, igual que `reporte_asistencia`).
 */
create or replace function horario_del_dia(p_empleado_id uuid, p_fecha date)
returns table (trabaja boolean, hora_inicio time, hora_fin time)
language sql
stable
set search_path = public
as $$
  select not aj.descansa, aj.hora_inicio, aj.hora_fin
    from ajustes_horario aj
   where aj.empleado_id = p_empleado_id and aj.fecha = p_fecha
  union all
  select true,
         coalesce(dl.hora_inicio, v.hora_inicio, t.hora_inicio),
         coalesce(dl.hora_fin, v.hora_fin, t.hora_fin)
    from asignaciones_turno a
    join turnos t on t.id = a.turno_id
    join dias_laborales dl on dl.asignacion_id = a.id and dl.dia_semana = extract(dow from p_fecha)
    left join lateral (
      select tv.* from turno_versiones tv
       where tv.turno_id = t.id and tv.vigente_desde <= p_fecha
       order by tv.vigente_desde desc
       limit 1
    ) v on true
   where a.empleado_id = p_empleado_id
     and a.vigente_desde <= p_fecha and (a.vigente_hasta is null or p_fecha < a.vigente_hasta)
     and not exists (select 1 from ajustes_horario aj
                      where aj.empleado_id = p_empleado_id and aj.fecha = p_fecha)
  limit 1;
$$;

/** Que un horario de un dia no sea mas largo que las horas para "salida no registrada". */
create or replace function validar_horario_de_un_dia(p_inicio time, p_fin time)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_inicio = p_fin then
    raise exception 'La hora de entrada y la de salida no pueden ser iguales';
  end if;
  if duracion_minutos(p_inicio, p_fin) >= config_entero('horas_para_cierre_automatico', 16) * 60 then
    raise exception 'Ese horario es más largo que las horas para "salida no registrada" (%).',
      config_entero('horas_para_cierre_automatico', 16);
  end if;
end;
$$;

/**
 * Cambia el horario de UNA persona en UN dia. Sin horas (las dos null): ese
 * dia descansa. Si ya tenia un cambio ese dia, se reemplaza. Solo rol admin.
 */
create or replace function ajustar_horario_dia(
  p_empleado_id uuid,
  p_fecha       date,
  p_inicio      time,
  p_fin         time,
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
    raise exception 'Sólo un administrador puede cambiar horarios';
  end if;
  perform exigir_motivo(p_motivo);

  if p_fecha is null then
    raise exception 'Elige el día';
  end if;
  if not exists (select 1 from empleados where id = p_empleado_id and activo) then
    raise exception 'Esa persona no existe o está dada de baja';
  end if;
  if (p_inicio is null) <> (p_fin is null) then
    raise exception 'Escribe la hora de entrada y la de salida (o ninguna, si ese día descansa)';
  end if;
  if p_inicio is not null then
    perform validar_horario_de_un_dia(p_inicio, p_fin);
  end if;
  if exists (select 1 from ajustes_horario
              where empleado_id = p_empleado_id and fecha = p_fecha and intercambio_id is not null) then
    raise exception 'Ese día ya es parte de un intercambio. Quita el intercambio primero.';
  end if;

  insert into ajustes_horario (empleado_id, fecha, descansa, hora_inicio, hora_fin, motivo)
  values (p_empleado_id, p_fecha, p_inicio is null, p_inicio, p_fin, trim(p_motivo))
  on conflict (empleado_id, fecha) do update
     set descansa = excluded.descansa, hora_inicio = excluded.hora_inicio,
         hora_fin = excluded.hora_fin, motivo = excluded.motivo,
         creado_por = auth.uid(), creado_en = now()
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Intercambio: ese dia, A trabaja el horario de B y B el de A. Si uno de los
 * dos descansaba ese dia, el otro descansa en su lugar. Solo rol admin.
 */
create or replace function intercambiar_horario(
  p_empleado_a uuid,
  p_empleado_b uuid,
  p_fecha      date,
  p_motivo     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grupo uuid := gen_random_uuid();
  v_a     record;
  v_b     record;
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar horarios';
  end if;
  perform exigir_motivo(p_motivo);

  if p_fecha is null then
    raise exception 'Elige el día';
  end if;
  if p_empleado_a = p_empleado_b then
    raise exception 'Elige a dos personas distintas';
  end if;
  if (select count(*) from empleados where id in (p_empleado_a, p_empleado_b) and activo) <> 2 then
    raise exception 'Alguna de las dos personas no existe o está dada de baja';
  end if;
  if exists (select 1 from ajustes_horario
              where empleado_id in (p_empleado_a, p_empleado_b) and fecha = p_fecha) then
    raise exception 'Alguna de las dos personas ya tiene un cambio ese día. Quítalo primero.';
  end if;

  select * into v_a from horario_del_dia(p_empleado_a, p_fecha);
  select * into v_b from horario_del_dia(p_empleado_b, p_fecha);
  if not coalesce(v_a.trabaja, false) and not coalesce(v_b.trabaja, false) then
    raise exception 'Ninguna de las dos personas trabaja ese día: no hay nada que intercambiar';
  end if;
  if coalesce(v_a.trabaja, false) and coalesce(v_b.trabaja, false)
     and v_a.hora_inicio = v_b.hora_inicio and v_a.hora_fin = v_b.hora_fin then
    raise exception 'Las dos personas tienen el mismo horario ese día';
  end if;

  insert into ajustes_horario (empleado_id, fecha, descansa, hora_inicio, hora_fin,
                               intercambio_id, intercambio_con, motivo)
  values
    (p_empleado_a, p_fecha, not coalesce(v_b.trabaja, false), v_b.hora_inicio, v_b.hora_fin,
     v_grupo, p_empleado_b, trim(p_motivo)),
    (p_empleado_b, p_fecha, not coalesce(v_a.trabaja, false), v_a.hora_inicio, v_a.hora_fin,
     v_grupo, p_empleado_a, trim(p_motivo));
  return v_grupo;
end;
$$;

/** Quita un cambio de horario. Si es parte de un intercambio, se quitan los dos. */
create or replace function quitar_ajuste_horario(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grupo uuid;
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede cambiar horarios';
  end if;
  perform exigir_motivo(p_motivo);

  select intercambio_id into v_grupo from ajustes_horario where id = p_id;
  if not found then
    raise exception 'Ese cambio de horario ya no existe';
  end if;
  delete from ajustes_horario
   where id = p_id or (v_grupo is not null and intercambio_id = v_grupo);
end;
$$;


-- ----------------------------------------------------------------------------
--  El reporte usa los ajustes
-- ----------------------------------------------------------------------------
--  Igual que el de la 0022, con dos cambios:
--    - `programados`: el dia con ajuste usa el horario del ajuste (y el dia
--      que la persona normalmente descansa, pero cubre a alguien, tambien
--      aparece);
--    - columna nueva `ajuste`: 'cambio' | 'intercambio' | null, para que el
--      panel diga por que esa hora es la buena.

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
           make_interval(mins => config_entero('minutos_anticipacion_entrada', 240)) as antes
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


-- ============================================================================
--  2. PENDIENTES
-- ============================================================================

create table pendientes (
  id           uuid primary key default gen_random_uuid(),

  -- Que caso es, escrito de forma que el MISMO caso siempre de la misma
  -- clave: 'falta:<empleado>:2026-10-24', 'retardos_semana:<empleado>:2026-10-19'.
  -- Por eso buscar dos veces no lo duplica.
  clave        text not null unique,

  tipo         text not null check (tipo in (
                 'retardo_dia', 'retardos_semana', 'falta', 'salida_no_registrada',
                 'registro_de_baja', 'foto_tapada')),
  empleado_id  uuid not null references empleados (id),

  -- El dia (desde = hasta) o la semana (lunes a domingo).
  desde        date not null,
  hasta        date not null,

  -- Los hechos: minutos, dias, hora de entrada... El texto lo arma el panel.
  detalle      jsonb not null default '{}'::jsonb,

  estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'atendido', 'resuelto_solo')),
  detectado_en timestamptz not null default now(),
  cerrado_en   timestamptz,
  cerrado_por  uuid references auth.users (id),
  -- Que se hizo ("se hablo con el", "tenia permiso"), o por que se cerro solo.
  que_se_hizo  text,

  constraint pendientes_cerrado check (
    (estado = 'pendiente' and cerrado_en is null)
    or (estado <> 'pendiente' and cerrado_en is not null and que_se_hizo is not null)
  )
);

comment on table pendientes is
  'Casos que el jefe tiene que atender (retardos, faltas, salidas no registradas, '
  'registros tras la baja, fotos tapadas). Los crea revisar_pendientes() con las '
  'reglas de configuracion; se cierran con atender_pendiente() o solos cuando ya '
  'no aplican (0029).';

create index pendientes_abiertos_idx on pendientes (estado, desde desc);
create index pendientes_empleado_idx on pendientes (empleado_id, desde desc);

alter table pendientes enable row level security;

-- Todos los administradores los ven. Escribir: solo con las funciones.
create policy pendientes_leer on pendientes
  for select to authenticated using (es_administrador());


-- ----------------------------------------------------------------------------
--  Configuracion (Configuracion -> Pendientes)
-- ----------------------------------------------------------------------------
-- Una opcion nueva es una FECHA ("Revisar desde"): el tipo 'fecha' se guarda
-- como texto AAAA-MM-DD.
alter table configuracion drop constraint configuracion_tipo_check;
alter table configuracion add constraint configuracion_tipo_check check (tipo in ('entero', 'texto', 'fecha'));

/** Una opcion de tipo fecha, o la de respaldo si no existe o no es fecha. */
create or replace function config_fecha(p_clave text, p_respaldo date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_texto text := (select valor #>> '{}' from configuracion where clave = p_clave);
begin
  if v_texto ~ '^\d{4}-\d{2}-\d{2}$' then
    return v_texto::date;
  end if;
  return p_respaldo;
exception when others then
  return p_respaldo;
end;
$$;

-- Igual que la 0021, mas el tipo 'fecha'.
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
  elsif v_config.tipo = 'fecha' then
    -- 0029: "Revisar desde" de Pendientes. Una fecha real, y no en el futuro
    -- (con una futura no saldria ningun pendiente hasta ese dia).
    if jsonb_typeof(p_valor) <> 'string' or (p_valor #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Escribe una fecha';
    end if;
    begin
      perform (p_valor #>> '{}')::date;
    exception when others then
      raise exception 'Esa fecha no existe';
    end;
    if (p_valor #>> '{}')::date > (now() at time zone zona_horaria())::date then
      raise exception 'La fecha no puede ser después de hoy';
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

-- "Revisar desde" = el dia en que se aplica esta migracion (en produccion: el
-- dia que se publica la 1.0.4). Asi lo que paso ANTES no se vuelve pendiente
-- de golpe: con los datos de prueba eran ~230 casos de una vez. (Pedido del
-- autor al probar, 20-10-2026.)
insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('pendientes_revisar_desde', to_jsonb(to_char((now() at time zone zona_horaria())::date, 'YYYY-MM-DD')),
   'Lo que paso antes de esta fecha no se vuelve pendiente. Se puso sola el dia que se instalo esta version.',
   'pendientes', 'fecha', null, null, '')
on conflict (clave) do nothing;

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('pendientes_minutos_tarde_dia', '15'::jsonb,
   'Si alguien llega esta cantidad de minutos tarde (o mas) en un dia, se crea un pendiente. 0 = apagado.',
   'pendientes', 'entero', 0, 480, 'minutos'),
  ('pendientes_minutos_tarde_semana', '30'::jsonb,
   'Si los minutos tarde de alguien suman esta cantidad (o mas) en una semana, de lunes a domingo, se crea un pendiente. Se cuentan desde la hora de entrada, aunque esten dentro de la tolerancia. 0 = apagado.',
   'pendientes', 'entero', 0, 2400, 'minutos'),
  ('pendientes_faltas', '1'::jsonb,
   'Si vale 1, cada falta (le tocaba trabajar, no vino y no tiene permiso) crea un pendiente.',
   'pendientes', 'entero', 0, 1, ''),
  ('pendientes_salidas_no_registradas', '1'::jsonb,
   'Si vale 1, cada salida no registrada crea un pendiente.',
   'pendientes', 'entero', 0, 1, ''),
  ('pendientes_registros_de_baja', '1'::jsonb,
   'Si vale 1, cada registro de una persona ya dada de baja crea un pendiente. Con 0, se avisa en la franja de Asistencia, como antes.',
   'pendientes', 'entero', 0, 1, ''),
  ('pendientes_fotos_tapadas', '1'::jsonb,
   'Si vale 1, cada dia que alguien registra con la camara tapada crea un pendiente.',
   'pendientes', 'entero', 0, 1, ''),
  ('pendientes_dias_revision', '14'::jsonb,
   'Cuantos dias hacia atras se buscan casos nuevos. Lo que ya es pendiente no se pierde aunque sea mas viejo.',
   'pendientes', 'entero', 1, 90, 'dias'),
  -- 5. El kiosco: checar con el numero de empleado (baja al kiosco con la configuracion).
  ('identificar_con_numero', '0'::jsonb,
   'Si vale 1, en el kiosco cada empleado escribe su numero de empleado y su PIN. Con 0, elige su nombre de una lista. Antes de encenderlo, todos los empleados activos deben tener numero.',
   'dispositivos', 'entero', 0, 1, '')
on conflict (clave) do nothing;

update configuracion
   set descripcion = 'Cuantos dias hacia atras se buscan registros en cuarentena (y de personas dadas de baja, si no se llevan a Pendientes) para los avisos del panel.'
 where clave = 'dias_avisos_registros';


-- ----------------------------------------------------------------------------
--  revisar_pendientes(): busca casos nuevos y cierra los que ya no aplican
-- ----------------------------------------------------------------------------
/*
  La llama el panel al abrir. Devuelve cuantos pendientes quedan abiertos (el
  numero del menu).

  SECURITY DEFINER porque escribe en `pendientes`, que no tiene politica de
  escritura: nadie la llena a mano. Pero solo un administrador puede llamarla.

  Ventana: los ultimos `pendientes_dias_revision` dias, pero nunca antes de
  `pendientes_revisar_desde` (la fecha en que se instalo; el jefe la mueve).
  Para la regla de la semana se lee desde el LUNES de la semana donde empieza
  la ventana, para sumar semanas completas, sin contar dias antes de
  "Revisar desde".

  Un caso que ya existe NO se duplica (clave unica). Si sigue abierto, se
  actualizan sus numeros (la semana sigue sumando). Uno atendido no se
  reabre: el jefe ya lo vio.

  Lo que estaba abierto, cae dentro de la ventana y YA NO se detecta, se
  cierra como `resuelto_solo` con la razon. Lo abierto mas viejo que la
  ventana se queda abierto: no se puede revisar sin leer meses, y un pendiente
  no se pierde por viejo.
*/
create or replace function revisar_pendientes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zona         text := zona_horaria();
  v_hoy          date := (now() at time zone zona_horaria())::date;
  -- Desde cuando cuenta: la mas reciente entre "N dias hacia atras" y
  -- "Revisar desde". Lo de antes de "Revisar desde" nunca se vuelve pendiente,
  -- ni siquiera sumado en la semana.
  v_inicio       date := config_fecha('pendientes_revisar_desde', date '2000-01-01');
  v_desde        date := greatest(v_hoy - config_entero('pendientes_dias_revision', 14),
                                  config_fecha('pendientes_revisar_desde', date '2000-01-01'));
  v_lunes        date := date_trunc('week', v_desde)::date;
  v_tarde_dia    integer := config_entero('pendientes_minutos_tarde_dia', 15);
  v_tarde_semana integer := config_entero('pendientes_minutos_tarde_semana', 30);
  v_faltas       boolean := config_entero('pendientes_faltas', 1) = 1;
  v_salidas      boolean := config_entero('pendientes_salidas_no_registradas', 1) = 1;
  v_bajas        boolean := config_entero('pendientes_registros_de_baja', 1) = 1;
  v_fotos        boolean := config_entero('pendientes_fotos_tapadas', 1) = 1;
  v_abiertos     integer;
begin
  if not es_administrador() then
    raise exception 'Sólo un administrador puede ver los pendientes';
  end if;

  -- Un solo panel revisa a la vez: dos ventanas abiertas al mismo tiempo no
  -- se pisan. (Se suelta solo al terminar la transaccion.)
  perform pg_advisory_xact_lock(hashtext('revisar_pendientes'));

  -- Por si se llama dos veces en la misma transaccion (las pruebas lo hacen).
  drop table if exists casos;
  drop table if exists rep;

  create temporary table casos (
    clave text primary key, tipo text, empleado_id uuid, desde date, hasta date, detalle jsonb
  ) on commit drop;

  create temporary table rep on commit drop as
    select r.* from reporte_asistencia(v_lunes, v_hoy) r
      join empleados e on e.id = r.empleado_id
     where e.activo;

  -- Retardo de UN dia
  if v_tarde_dia > 0 then
    insert into casos
    select 'retardo_dia:' || r.empleado_id || ':' || r.fecha, 'retardo_dia', r.empleado_id, r.fecha, r.fecha,
           jsonb_build_object('minutos', r.minutos_tarde, 'entrada', r.entrada,
                              'programado', r.programado_inicio, 'turno', r.turno)
      from rep r
     where r.fecha >= v_desde
       and r.estado in ('a_tiempo', 'retardo', 'retardo_mayor')
       and r.minutos_tarde >= v_tarde_dia;
  end if;

  -- Minutos tarde SUMADOS en la semana (lunes a domingo), desde la hora de
  -- entrada: 12 minutos todos los dias tambien cuentan.
  if v_tarde_semana > 0 then
    insert into casos
    select 'retardos_semana:' || s.empleado_id || ':' || s.lunes, 'retardos_semana', s.empleado_id,
           s.lunes, s.lunes + 6,
           jsonb_build_object('minutos', s.minutos, 'dias', s.dias)
      from (
        select r.empleado_id, date_trunc('week', r.fecha)::date as lunes,
               sum(r.minutos_tarde)::integer as minutos,
               count(*) filter (where r.minutos_tarde > 0)::integer as dias
          from rep r
         where r.estado in ('a_tiempo', 'retardo', 'retardo_mayor')
           and r.fecha >= v_inicio
         group by 1, 2
      ) s
     where s.minutos >= v_tarde_semana
       and s.lunes + 6 >= v_desde;
  end if;

  if v_faltas then
    insert into casos
    select 'falta:' || r.empleado_id || ':' || r.fecha, 'falta', r.empleado_id, r.fecha, r.fecha,
           jsonb_build_object('turno', r.turno, 'programado', r.programado_inicio)
      from rep r
     where r.fecha >= v_desde and r.estado = 'falta'
    on conflict (clave) do nothing;
  end if;

  if v_salidas then
    insert into casos
    select 'salida_no_registrada:' || r.empleado_id || ':' || r.fecha, 'salida_no_registrada',
           r.empleado_id, r.fecha, r.fecha,
           jsonb_build_object('entrada', r.entrada, 'turno', r.turno)
      from rep r
     where r.fecha >= v_desde and r.estado_salida = 'salida_no_registrada'
    on conflict (clave) do nothing;
  end if;

  -- Registros de alguien ya dado de baja (bandera de la 0028), sin anular.
  -- Uno por registro: cada uno puede tener su propia explicacion.
  if v_bajas then
    insert into casos
    select 'registro_de_baja:' || m.id, 'registro_de_baja', m.empleado_id,
           fecha_laboral(m.hora_estimada), fecha_laboral(m.hora_estimada),
           jsonb_build_object('marca_id', m.id, 'hora', m.hora_estimada, 'tipo', m.tipo)
      from marcas m
     where 'empleado_de_baja' = any (m.banderas)
       and m.hora_estimada >= (v_desde + time '00:00') at time zone v_zona
       and not exists (select 1 from correcciones c where c.marca_id = m.id and c.accion = 'anular');
  end if;

  -- Camara tapada: uno por persona y por dia, con cuantas veces.
  if v_fotos then
    insert into casos
    select 'foto_tapada:' || f.empleado_id || ':' || f.fecha, 'foto_tapada', f.empleado_id, f.fecha, f.fecha,
           jsonb_build_object('veces', f.veces, 'marcas', f.marcas)
      from (
        select m.empleado_id, fecha_laboral(m.hora_estimada) as fecha, count(*)::integer as veces,
               jsonb_agg(m.id order by m.hora_estimada) as marcas
          from marcas m
          join empleados e on e.id = m.empleado_id and e.activo
         where 'foto_obstruida' = any (m.banderas)
           and m.hora_estimada >= (v_desde + time '00:00') at time zone v_zona
           and not exists (select 1 from correcciones c where c.marca_id = m.id and c.accion = 'anular')
         group by 1, 2
      ) f;
  end if;

  -- Nuevos, o con numeros al dia si siguen abiertos.
  insert into pendientes (clave, tipo, empleado_id, desde, hasta, detalle)
  select clave, tipo, empleado_id, desde, hasta, detalle from casos
  on conflict (clave) do update
     set detalle = excluded.detalle
   where pendientes.estado = 'pendiente' and pendientes.detalle is distinct from excluded.detalle;

  -- Abiertos que ya no aplican: se cierran solos, diciendo por que.
  update pendientes p
     set estado = 'resuelto_solo', cerrado_en = now(),
         que_se_hizo = case
           when p.hasta < v_inicio
             then 'Es de antes de la fecha "Revisar desde" de Configuración.'
           when p.tipo = 'retardo_dia' and v_tarde_dia = 0
             or p.tipo = 'retardos_semana' and v_tarde_semana = 0
             or p.tipo = 'falta' and not v_faltas
             or p.tipo = 'salida_no_registrada' and not v_salidas
             or p.tipo = 'registro_de_baja' and not v_bajas
             or p.tipo = 'foto_tapada' and not v_fotos
             then 'Se apagó este tipo de pendiente en Configuración.'
           when not exists (select 1 from empleados e where e.id = p.empleado_id and e.activo)
             then 'La persona fue dada de baja.'
           when p.tipo = 'retardo_dia'
             then 'Ya no cuenta como retardo de ese día (se justificó, se corrigió o cambió la configuración).'
           when p.tipo = 'retardos_semana'
             then 'La semana ya no suma los minutos del límite (se justificó, se corrigió o cambió la configuración).'
           when p.tipo = 'falta'
             then 'Ya no aparece como falta (se registró un permiso o vacaciones, se corrigió o se cambió el horario).'
           when p.tipo = 'salida_no_registrada'
             then 'Ya tiene su salida (se corrigió o se registró a mano).'
           when p.tipo = 'registro_de_baja'
             then 'El registro se anuló.'
           else 'Los registros con la cámara tapada se anularon.'
         end
   where p.estado = 'pendiente'
     and not exists (select 1 from casos c where c.clave = p.clave)
     and (
       -- Dentro de la ventana: se reviso y ya no esta.
       (p.tipo <> 'registro_de_baja' and p.hasta >= v_desde)
       or (p.tipo = 'registro_de_baja' and p.desde >= v_desde)
       -- Quedo antes de "Revisar desde" (el jefe movio la fecha).
       or p.hasta < v_inicio
       -- Su regla se apago, o la persona se dio de baja: a cualquier edad.
       or (p.tipo = 'retardo_dia' and v_tarde_dia = 0)
       or (p.tipo = 'retardos_semana' and v_tarde_semana = 0)
       or (p.tipo = 'falta' and not v_faltas)
       or (p.tipo = 'salida_no_registrada' and not v_salidas)
       or (p.tipo = 'registro_de_baja' and not v_bajas)
       or (p.tipo = 'foto_tapada' and not v_fotos)
       -- Ojo: los registros DE una persona dada de baja son justo el caso
       -- 'registro_de_baja'; esos no se cierran por la baja.
       or (p.tipo <> 'registro_de_baja'
           and not exists (select 1 from empleados e where e.id = p.empleado_id and e.activo))
     );

  select count(*)::integer into v_abiertos from pendientes where estado = 'pendiente';
  return v_abiertos;
end;
$$;

comment on function revisar_pendientes() is
  'Busca casos nuevos con las reglas de configuracion (grupo pendientes), cierra '
  'solos los que ya no aplican y devuelve cuantos quedan abiertos. La llama el '
  'panel al abrir (0029).';


/** Cerrar un pendiente diciendo que se hizo. Lo puede hacer cualquier administrador. */
create or replace function atender_pendiente(p_id uuid, p_que_se_hizo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_administrador() then
    raise exception 'Sólo un administrador puede atender pendientes';
  end if;
  if length(trim(coalesce(p_que_se_hizo, ''))) < 10 then
    raise exception 'Escribe qué se hizo (al menos 10 letras): queda en la historia de la persona';
  end if;

  update pendientes
     set estado = 'atendido', cerrado_en = now(), cerrado_por = auth.uid(), que_se_hizo = trim(p_que_se_hizo)
   where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'Ese pendiente ya estaba cerrado (quizá lo atendió alguien más). Actualiza la página.';
  end if;

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  select 'pendientes', p.id::text, 'UPDATE', jsonb_build_object('estado', 'pendiente'),
         jsonb_build_object('estado', 'atendido', 'tipo', p.tipo, 'empleado_id', p.empleado_id,
                            'desde', p.desde, 'hasta', p.hasta),
         actor_actual(), trim(p_que_se_hizo)
    from pendientes p where p.id = p_id;
end;
$$;

/** Volver a abrir un pendiente cerrado por error. */
create or replace function reabrir_pendiente(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes pendientes%rowtype;
begin
  if not es_administrador() then
    raise exception 'Sólo un administrador puede reabrir pendientes';
  end if;
  perform exigir_motivo(p_motivo);

  select * into v_antes from pendientes where id = p_id and estado <> 'pendiente' for update;
  if not found then
    raise exception 'Ese pendiente no existe o ya está abierto';
  end if;
  update pendientes
     set estado = 'pendiente', cerrado_en = null, cerrado_por = null, que_se_hizo = null
   where id = p_id;

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  values ('pendientes', p_id::text, 'UPDATE',
          jsonb_build_object('estado', v_antes.estado, 'que_se_hizo', v_antes.que_se_hizo),
          jsonb_build_object('estado', 'pendiente'), actor_actual(), trim(p_motivo));
end;
$$;


-- ----------------------------------------------------------------------------
--  Los avisos: "registros de baja" se va a Pendientes (si esta encendido)
-- ----------------------------------------------------------------------------
--  Igual que la 0028, salvo ese aviso: con `pendientes_registros_de_baja` = 1
--  esos registros son pendientes, y avisarlos en los dos lados seria doble.
create or replace function avisos_del_panel()
returns table (tipo text, dispositivo_id uuid, dispositivo text, cantidad integer, desde timestamptz)
language sql
stable
set search_path = public
as $$
  with cfg as (
    select config_entero('minutos_kiosco_sin_conexion_alerta', 60) as min_sin_conexion,
           config_entero('minutos_camara_caida_alerta', 15)         as min_camara,
           config_entero('camara_desconexiones_alerta', 3)          as desconexiones,
           config_entero('camara_dias_desconexiones', 7)            as dias_camara,
           config_entero('dias_avisos_registros', 7)                as dias_registros,
           config_entero('kiosco_pc_compartida', 1) = 1             as pc_compartida,
           config_entero('pendientes_registros_de_baja', 1) = 1     as bajas_en_pendientes
  )
  -- Kiosco que no se reporta. Con PC compartida, cerrado es lo normal (0026).
  select 'kiosco_sin_conexion', d.id, d.nombre, null::integer, d.ultima_conexion
    from dispositivos d, cfg
   where d.activo and not cfg.pc_compartida
     and (d.ultima_conexion is null
          or d.ultima_conexion < now() - make_interval(mins => cfg.min_sin_conexion))

  union all
  -- Camara caida hace mas de X minutos.
  select 'camara_caida', d.id, d.nombre, null, d.camara_caida_desde
    from dispositivos d, cfg
   where d.activo and d.camara_ok is false
     and d.camara_caida_desde < now() - make_interval(mins => cfg.min_camara)

  union all
  -- Camara que falla a ratos: N desconexiones en los ultimos D dias.
  select 'camara_inestable', d.id, d.nombre, count(*)::integer, min(e.ocurrido_en)
    from dispositivos d
    join eventos_dispositivo e on e.dispositivo_id = d.id and e.tipo = 'camara_desconectada'
    cross join cfg
   where d.activo
     and e.ocurrido_en >= now() - make_interval(days => cfg.dias_camara)
   group by d.id, d.nombre, cfg.desconexiones
  having count(*) >= cfg.desconexiones

  union all
  -- Fotos que faltan o se alteraron en el kiosco.
  select 'fotos_por_revisar', f.dispositivo_id, f.dispositivo, f.casos::integer, f.mas_antiguo
    from fotos_por_revisar f

  union all
  -- Registros de personas dadas de baja, sin anular, de los ultimos dias.
  -- Solo si NO se llevan a Pendientes (0029).
  select 'registros_de_baja', null, null, count(*)::integer, min(m.hora_estimada)
    from marcas m, cfg
   where not cfg.bajas_en_pendientes
     and 'empleado_de_baja' = any (m.banderas)
     and m.hora_estimada >= now() - make_interval(days => cfg.dias_registros)
     and not exists (select 1 from correcciones c where c.marca_id = m.id and c.accion = 'anular')
  having count(*) > 0

  union all
  -- Registros en cuarentena (de un kiosco dado de baja), sin anular.
  select 'cuarentena', null, null, count(*)::integer, min(m.hora_estimada)
    from marcas m, cfg
   where m.en_cuarentena
     and m.hora_estimada >= now() - make_interval(days => cfg.dias_registros)
     and not exists (select 1 from correcciones c where c.marca_id = m.id and c.accion = 'anular')
  having count(*) > 0;
$$;


-- ============================================================================
--  3. NOTAS
-- ============================================================================

create table notas (
  id             uuid primary key default gen_random_uuid(),
  autor          uuid not null references auth.users (id) default auth.uid(),
  titulo         text not null default '' check (length(titulo) <= 200),
  texto          text not null default '' check (length(texto) <= 20000),

  -- La lista de casillas: [{"texto": "Pedir lista a RH", "hecha": false}, ...]
  tareas         jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(tareas) = 'array' and jsonb_array_length(tareas) <= 200),

  -- 'privada': solo el autor. 'todos': todos los administradores.
  -- 'algunos': el autor y los de `notas_compartidas`.
  visibilidad    text not null default 'privada'
                   check (visibilidad in ('privada', 'todos', 'algunos')),

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users (id) default auth.uid()
);

comment on table notas is
  'Notas y listas de pendientes de los administradores (0029). Cada nota es de '
  'su autor; puede ser privada, para todos o para algunos (notas_compartidas). '
  'OJO: si mencionan a un empleado son datos personales: escribir hechos.';

create table notas_compartidas (
  nota_id uuid not null references notas (id) on delete cascade,
  user_id uuid not null references administradores (user_id) on delete cascade,
  primary key (nota_id, user_id)
);

create index notas_autor_idx on notas (autor);
create index notas_compartidas_usuario_idx on notas_compartidas (user_id);

create trigger notas_tocar_actualizado
  before update on notas
  for each row execute function tocar_actualizado_en();

alter table notas enable row level security;
alter table notas_compartidas enable row level security;

/*
  ¿Quien puede ver una nota? La politica de `notas` necesita leer
  `notas_compartidas`, y la de `notas_compartidas` necesita leer `notas`.
  Escritas directo, cada una llamaria a la otra sin fin; por eso cada consulta
  "cruzada" va en una funcion SECURITY DEFINER, como `es_administrador()`
  (0002).

  Lo que se decide con la fila misma (autor, visibilidad) va DIRECTO en la
  politica, no en una funcion: una funcion STABLE no ve la fila que se esta
  insertando en ese momento, y `insert ... returning` fallaria.
*/
create or replace function nota_compartida_conmigo(p_nota_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from notas_compartidas where nota_id = p_nota_id and user_id = auth.uid());
$$;

create or replace function es_autor_de_nota(p_nota_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select es_administrador() and exists (select 1 from notas where id = p_nota_id and autor = auth.uid());
$$;

create policy notas_leer on notas
  for select to authenticated
  using (es_administrador()
         and (autor = auth.uid()
              or visibilidad = 'todos'
              or (visibilidad = 'algunos' and nota_compartida_conmigo(id))));
create policy notas_crear on notas
  for insert to authenticated with check (es_administrador() and autor = auth.uid());
-- Quien la ve, la puede editar (palomear una casilla de una lista compartida).
-- Cambiar quien la ve: solo el autor (lo cuida el trigger de abajo).
create policy notas_editar on notas
  for update to authenticated
  using (es_administrador()
         and (autor = auth.uid()
              or visibilidad = 'todos'
              or (visibilidad = 'algunos' and nota_compartida_conmigo(id))));
create policy notas_borrar on notas
  for delete to authenticated using (es_administrador() and autor = auth.uid());

create policy notas_compartidas_leer on notas_compartidas
  for select to authenticated using (es_administrador() and (user_id = auth.uid() or es_autor_de_nota(nota_id)));
create policy notas_compartidas_crear on notas_compartidas
  for insert to authenticated with check (es_autor_de_nota(nota_id));
create policy notas_compartidas_borrar on notas_compartidas
  for delete to authenticated using (es_autor_de_nota(nota_id));

/** Solo el autor cambia quien ve la nota; nadie cambia el autor. */
create or replace function notas_proteger_autor()
returns trigger
language plpgsql
as $$
begin
  if new.autor is distinct from old.autor then
    raise exception 'El autor de una nota no se puede cambiar';
  end if;
  if new.visibilidad is distinct from old.visibilidad and old.autor is distinct from auth.uid()
     and auth.uid() is not null then
    raise exception 'Sólo quien escribió la nota puede cambiar quién la ve';
  end if;
  new.actualizado_por := coalesce(auth.uid(), new.actualizado_por);
  return new;
end;
$$;

create trigger notas_proteger_autor
  before update on notas
  for each row execute function notas_proteger_autor();


-- ============================================================================
--  4. LA HORA DEL SERVIDOR
-- ============================================================================
--  El panel la pide al entrar y guarda la diferencia con el reloj de la PC.
--  Asi "actualizado a las..." y "hoy" salen bien aunque la PC tenga la zona
--  horaria mal puesta.
create or replace function hora_del_servidor()
returns timestamptz
language sql
stable
as $$
  select now();
$$;


-- ============================================================================
--  DERECHOS ARCO: los datos nuevos tambien son de la persona
-- ============================================================================
--  Igual que en la 0017, mas sus cambios de horario y sus pendientes.

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
    'cambios_de_horario', coalesce((
        select jsonb_agg(jsonb_build_object('fecha', aj.fecha, 'descansa', aj.descansa,
                                            'entrada', aj.hora_inicio, 'salida', aj.hora_fin,
                                            'intercambio', aj.intercambio_id is not null,
                                            'motivo', aj.motivo)
               order by aj.fecha)
          from ajustes_horario aj where aj.empleado_id = p_id), '[]'::jsonb),
    'pendientes', coalesce((
        select jsonb_agg(jsonb_build_object('tipo', pe.tipo, 'desde', pe.desde, 'hasta', pe.hasta,
                                            'detalle', pe.detalle, 'estado', pe.estado,
                                            'que_se_hizo', pe.que_se_hizo, 'cerrado_en', pe.cerrado_en)
               order by pe.desde)
          from pendientes pe where pe.empleado_id = p_id), '[]'::jsonb),
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
 * Supresion: igual que en la 0017. Ademas, lo que se escribio a mano sobre la
 * persona en sus pendientes ("se hablo con el...") se tacha, igual que las
 * notas de sus ausencias.
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
  -- y el trigger se salta este UPDATE (ver `app.sin_auditar` en la 0017).
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
  -- 0029: lo escrito al atender sus pendientes.
  update pendientes set que_se_hizo = '[suprimido]'
   where empleado_id = p_id and estado = 'atendido';
  update bitacora_auditoria set motivo = '[suprimido]'
   where tabla = 'pendientes'
     and registro_id in (select id::text from pendientes where empleado_id = p_id);

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  values ('empleados', p_id::text, 'UPDATE', null,
          jsonb_build_object('arco', 'supresion_de_datos', 'anonimizado_en', now()),
          actor_actual(), trim(p_motivo));
end;
$$;


-- ============================================================================
--  PERMISOS DE LAS FUNCIONES
-- ============================================================================
--  Lo de siempre: nadie sin sesion; con sesion, cada funcion revisa el rol.

revoke all on function horario_del_dia(uuid, date) from public, anon;
grant execute on function horario_del_dia(uuid, date) to authenticated;
revoke all on function validar_horario_de_un_dia(time, time) from public, anon;
revoke all on function ajustar_horario_dia(uuid, date, time, time, text) from public, anon;
grant execute on function ajustar_horario_dia(uuid, date, time, time, text) to authenticated;
revoke all on function intercambiar_horario(uuid, uuid, date, text) from public, anon;
grant execute on function intercambiar_horario(uuid, uuid, date, text) to authenticated;
revoke all on function quitar_ajuste_horario(uuid, text) from public, anon;
grant execute on function quitar_ajuste_horario(uuid, text) to authenticated;
revoke all on function reporte_asistencia(date, date, uuid) from public, anon;
grant execute on function reporte_asistencia(date, date, uuid) to authenticated;
revoke all on function config_fecha(text, date) from public, anon;
grant execute on function config_fecha(text, date) to authenticated;
revoke all on function revisar_pendientes() from public, anon;
grant execute on function revisar_pendientes() to authenticated;
revoke all on function atender_pendiente(uuid, text) from public, anon;
grant execute on function atender_pendiente(uuid, text) to authenticated;
revoke all on function reabrir_pendiente(uuid, text) from public, anon;
grant execute on function reabrir_pendiente(uuid, text) to authenticated;
revoke all on function avisos_del_panel() from public, anon;
grant execute on function avisos_del_panel() to authenticated;
revoke all on function nota_compartida_conmigo(uuid) from public, anon;
grant execute on function nota_compartida_conmigo(uuid) to authenticated;
revoke all on function es_autor_de_nota(uuid) from public, anon;
grant execute on function es_autor_de_nota(uuid) to authenticated;
revoke all on function hora_del_servidor() from public, anon;
grant execute on function hora_del_servidor() to authenticated;
revoke all on function datos_de_empleado(uuid, text) from public, anon;
grant execute on function datos_de_empleado(uuid, text) to authenticated;
revoke all on function anonimizar_empleado(uuid, text, text) from public, anon;
grant execute on function anonimizar_empleado(uuid, text, text) to authenticated;
