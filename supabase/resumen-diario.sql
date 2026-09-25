-- ============================================================================
--  RESUMEN DIARIO PARA EL JEFE  (CLAUDE.md 13.4)
-- ============================================================================
--
--  Lo usa .github/workflows/resumen-diario.yml: cada manana corre esto contra
--  la base de produccion y manda el resultado por correo. Devuelve UN texto,
--  listo para el cuerpo del correo.
--
--  Es del dia de AYER, en hora de Nuevo Laredo (zona_horaria()), porque a las
--  7 de la manana el dia de hoy apenas empieza y un turno nocturno de ayer
--  termina hoy a las 6.
--
--  Solo lee. Se puede correr a mano en el SQL Editor de Supabase para ver
--  como queda.

with
cfg as (
  select zona_horaria() as zona,
         (now() at time zone zona_horaria())::date - 1 as ayer,
         config_entero('minutos_kiosco_sin_conexion_alerta', 60) as min_sin_conexion
),
rep as (
  select r.*, trim(e.nombre || ' ' || e.apellido_paterno) as persona
    from cfg, reporte_asistencia(cfg.ayer, cfg.ayer) r
    join empleados e on e.id = r.empleado_id
),
marcas_ayer as (
  select m.*, trim(e.nombre || ' ' || e.apellido_paterno) as persona
    from cfg, marcas m
    join empleados e on e.id = m.empleado_id
   where (m.hora_estimada at time zone cfg.zona)::date = cfg.ayer
),
lineas as (
  select 1 as orden, 'RESUMEN DE ASISTENCIA DEL ' || to_char((select ayer from cfg), 'DD/MM/YYYY') as texto
  union all select 2, repeat('=', 44)

  union all select 10, '' union all select 11,
    'RETARDOS (' || (select count(*) from rep where estado = 'retardo') || ')'
  union all select 12, '  - ' || persona || ': ' || minutos_tarde || ' min tarde (' || coalesce(turno, '') || ')'
    from rep where estado = 'retardo'

  union all select 20, '' union all select 21,
    'FALTAS (' || (select count(*) from rep where estado = 'falta') || ')'
  union all select 22, '  - ' || persona || ' (' || coalesce(turno, '') || ')'
    from rep where estado = 'falta'

  union all select 30, '' union all select 31,
    'ENTRARON Y NO REGISTRARON SALIDA (' || (select count(*) from rep where estado_salida = 'salida_no_registrada') || ')'
  union all select 32, '  - ' || persona from rep where estado_salida = 'salida_no_registrada'

  union all select 40, '' union all select 41,
    'PARA REVISAR EN EL KIOSCO (' ||
    (select count(*) from marcas_ayer where banderas && array['sin_camara', 'foto_obstruida', 'foto_no_guardada', 'reloj_sospechoso']) || ')'
  union all select 42, '  - ' || persona || ', ' || m.tipo || ' ' ||
         to_char(m.hora_estimada at time zone (select zona from cfg), 'HH24:MI') || ': ' ||
         array_to_string(array(
           select case b when 'sin_camara' then 'sin foto'
                         when 'foto_obstruida' then 'foto tapada'
                         when 'foto_no_guardada' then 'foto no guardada'
                         when 'reloj_sospechoso' then 'hora dudosa'
                         else b end
             from unnest(m.banderas) b
            where b in ('sin_camara', 'foto_obstruida', 'foto_no_guardada', 'reloj_sospechoso')), ', ')
    from marcas_ayer m
   where banderas && array['sin_camara', 'foto_obstruida', 'foto_no_guardada', 'reloj_sospechoso']

  union all select 50, '' union all select 51, 'KIOSCOS'
  union all select 52, '  - ' || d.nombre || ': ' ||
         case when d.ultima_conexion is null or d.ultima_conexion < now() - make_interval(mins => cfg.min_sin_conexion)
                then 'SIN CONEXION desde ' || coalesce(to_char(d.ultima_conexion at time zone cfg.zona, 'DD/MM HH24:MI'), 'nunca')
              when d.camara_ok is false then 'conectado, pero la CAMARA NO FUNCIONA'
              else 'bien' end ||
         case when coalesce(d.pendientes, 0) > 0 then ' (' || d.pendientes || ' registros sin enviar)' else '' end
    from dispositivos d, cfg where d.activo

  union all select 60, ''
  union all select 61, case when (select count(*) from marcas_ayer where en_cuarentena) > 0
                            then 'EN CUARENTENA: ' || (select count(*) from marcas_ayer where en_cuarentena) ||
                                 ' registro(s) de un kiosco dado de baja. Revisalos en el panel.'
                            else null end

  union all select 90, ''
  union all select 91, 'Detalle completo en el panel: Asistencia y Reportes.'
  union all select 92, 'Este correo lo manda el sistema solo. Las fotos nunca salen del kiosco.'
)
select string_agg(texto, E'\n' order by orden, texto) from lineas where texto is not null;
