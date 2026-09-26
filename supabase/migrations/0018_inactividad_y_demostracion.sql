-- ============================================================================
--  0018 · CIERRE DE SESION POR INACTIVIDAD Y DATOS DE DEMOSTRACION
-- ============================================================================
--
--  Dos peticiones de la fase de pruebas (26-09-2026):
--
--    1. El panel se quedaba con la sesion abierta toda la noche. Ahora se
--       cierra solo tras N minutos sin uso. N lo decide el jefe (Configuracion).
--
--    2. Un boton para GENERAR empleados y registros de demostracion, para ver
--       el sistema con datos sin tener que capturar semanas a mano.
--
--       Datos falsos en la base de PRODUCCION serian registros de asistencia
--       inventados de personas "reales" a ojos del reporte. Por eso:
--         - el generador solo funciona si un administrador ENCIENDE
--           `permitir_datos_demostracion` en Configuracion (viene apagado);
--         - los empleados generados llevan numero "DEMO-xxxx", y el panel los
--           marca como demostracion;
--         - sus registros vienen de un "Kiosco de demostracion" que no es un
--           kiosco real (su token es basura aleatoria: nadie puede usarlo).


-- ============================================================================
--  1. CONFIGURACION NUEVA
-- ============================================================================

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('minutos_inactividad_panel', '30'::jsonb,
   'Minutos sin usar el panel antes de que la sesión se cierre sola. Protege una computadora que se queda abierta.',
   'panel', 'entero', 5, 480, 'minutos'),
  ('permitir_datos_demostracion', '0'::jsonb,
   'Si vale 1, el panel deja generar empleados y registros FALSOS para probar. Debe quedar en 0 en el sistema real.',
   'panel', 'entero', 0, 1, '');


-- ============================================================================
--  2. EL GENERADOR
-- ============================================================================

/**
 * Crea 5 empleados de demostracion con horario (matutino, vespertino y un
 * velador nocturno) y sus registros de los ultimos `p_dias` dias: la mayoria a
 * tiempo, y a proposito algunos retardos, faltas, salidas sin registrar, fotos
 * tapadas, registros sin camara y horas dudosas.
 *
 * Devuelve usuario, nombre y PIN de cada uno (para poder checar con ellos en
 * un kiosco de pruebas).
 */
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
    insert into dispositivos (nombre, ubicacion, token_hash, enrolado_por, ultima_conexion,
                              version_app, camara_ok, pendientes)
    values ('Kiosco de demostración', 'No existe: sólo para datos de prueba',
            encode(gen_random_bytes(32), 'hex'), auth.uid(), now(), 'demo', true, 0)
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

revoke all on function generar_datos_demostracion(integer, text) from public, anon;
grant execute on function generar_datos_demostracion(integer, text) to authenticated;
