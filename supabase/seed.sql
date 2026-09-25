-- ============================================================================
--  DATOS DE PRUEBA PARA EL SUPABASE LOCAL  (solo desarrollo)
-- ============================================================================
--
--  `npx supabase db reset` aplica las migraciones y DESPUES este archivo.
--  Nunca llega a la nube real: `db reset` solo existe en local, y las
--  migraciones de produccion no lo incluyen.
--
--  Son los MISMOS 20 empleados que el kiosco siembra en desarrollo
--  (apps/kiosco-main/src/datos/semilla.ts), con los mismos usuarios, numeros
--  y PIN 1234. Asi, al dar de alta un kiosco de desarrollo contra esta base,
--  todo cuadra: la nube reconoce a los empleados de las marcas que suben.
--
--  Los ids son fijos ("...1001" a "...1020") para que las pruebas y quien
--  depure sepa de quien es cada uno sin buscar.
--
--  Y un jefe de prueba, con credenciales para el modo administrador del
--  kiosco:  usuario "jefe" / contrasena "jefe-de-prueba".

insert into empleados (id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno, pin_hash)
select
  ('00000000-0000-4000-8000-00000000' || numero)::uuid,
  usuario, numero, nombre, paterno, materno,
  extensions.crypt('1234', extensions.gen_salt('bf', 10))
from (values
  ('1001', 'dgomez',     'Dalton Akenaton',  'Gomez',     'Arellano'),
  ('1002', 'mibanez',    'Maria Jose',       'Ibanez',    'Ruiz'),
  ('1003', 'jdelacruz',  'Juan',             'De la Cruz','Mendez'),
  ('1004', 'rmunoz',     'Rosa',             'Munoz',     'Salinas'),
  ('1005', 'psanchez',   'Pedro',            'Sanchez',   'Lopez'),
  ('1006', 'atrevino',   'Ana Laura',        'Treviño',   'Garza'),
  ('1007', 'chernandez', 'Carlos Alberto',   'Hernandez', 'Rios'),
  ('1008', 'gmartinez',  'Guadalupe',        'Martinez',  'Olvera'),
  ('1009', 'jramirez',   'Jose Luis',        'Ramirez',   'Cantu'),
  ('1010', 'lflores',    'Leticia',          'Flores',    'Villarreal'),
  ('1011', 'mtorres',    'Miguel Angel',     'Torres',    'Salazar'),
  ('1012', 'ncastillo',  'Norma Alicia',     'Castillo',  'Peña'),
  ('1013', 'orodriguez', 'Oscar',            'Rodriguez', 'Lara'),
  ('1014', 'pvazquez',   'Patricia',         'Vazquez',   'Medina'),
  ('1015', 'rgonzalez',  'Raul',             'Gonzalez',  'Ochoa'),
  ('1016', 'smoreno',    'Silvia',           'Moreno',    'Aguilar'),
  ('1017', 'treyes',     'Tomas',            'Reyes',     'Cavazos'),
  ('1018', 'vluna',      'Veronica',         'Luna',      'Estrada'),
  ('1019', 'yperez',     'Yolanda',          'Perez',     'Zamora'),
  ('1020', 'fortiz',     'Francisco Javier', 'Ortiz',     'Barrera')
) as personal (numero, usuario, nombre, paterno, materno);

-- El jefe de prueba, como usuario de Supabase Auth que puede ENTRAR AL PANEL:
--   correo "jefe@prueba.local" / contrasena "panel-de-prueba".
-- Es DISTINTA de la del modo administrador del kiosco (D-031).
--
-- Las columnas de texto vacias ('') no son decoracion: Supabase Auth las lee
-- como texto, y un NULL ahi hace fallar el inicio de sesion con un error
-- interno. Y sin la fila de `auth.identities`, el usuario existe pero no
-- puede entrar con correo y contrasena.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values (
  '00000000-0000-4000-8000-00000000a001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'jefe@prueba.local',
  extensions.crypt('panel-de-prueba', extensions.gen_salt('bf', 10)), now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', ''
);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (
  gen_random_uuid(),
  '00000000-0000-4000-8000-00000000a001',
  '00000000-0000-4000-8000-00000000a001',
  'email',
  '{"sub": "00000000-0000-4000-8000-00000000a001", "email": "jefe@prueba.local", "email_verified": true}',
  now(), now(), now()
);

insert into administradores (user_id, nombre, rol, usuario_kiosco, contrasena_kiosco_hash)
values ('00000000-0000-4000-8000-00000000a001', 'Jefe de prueba', 'admin', 'jefe',
        extensions.crypt('jefe-de-prueba', extensions.gen_salt('bf', 10)));


-- ============================================================================
--  DATOS DE DEMOSTRACION PARA EL PANEL
-- ============================================================================
--  Dos kioscos de ejemplo y los registros de los ultimos 5 dias, para que el
--  panel tenga algo que mostrar al abrirlo. Las fechas se calculan desde HOY,
--  asi que siempre se ven recientes.
--
--  Los tokens de estos kioscos son basura aleatoria: ningun kiosco de verdad
--  puede hacerse pasar por ellos. Son solo para mirar.

insert into dispositivos (id, nombre, ubicacion, token_hash, enrolado_por, ultima_conexion,
                          version_app, camara_ok, pendientes, desfase_reloj_ms)
values
  ('00000000-0000-4000-8000-00000000d001', 'Entrada principal (demostración)', 'Edificio A',
   encode(extensions.gen_random_bytes(32), 'hex'), '00000000-0000-4000-8000-00000000a001',
   now() - interval '2 minutes', '0.1.0', true, 0, 1200),
  ('00000000-0000-4000-8000-00000000d002', 'Edificio B (demostración)', 'Edificio B, planta baja',
   encode(extensions.gen_random_bytes(32), 'hex'), '00000000-0000-4000-8000-00000000a001',
   now() - interval '3 hours', '0.1.0', false, 7, -45000);

/*
  Cada empleado entra a las 06:00 (los ultimos cinco, a las 14:00) con algunos
  minutos de variacion, y sale 8 horas despues. La hora se arma en HORA LOCAL
  de Matamoros y se convierte a timestamptz, como lo haria un kiosco real.

  La "variacion" no es random(): sale del numero de empleado y del dia, para
  que los datos sean los mismos cada vez que se aplica la semilla.

  Algunos casos raros a proposito, para ver como los muestra el panel:
    - cada 9 registros, sin camara;
    - cada 13, camara tapada;
    - cada 17, hora dudosa;
    - uno, con la foto faltante en el kiosco.
*/
with base as (
  select
    e.id as empleado_id,
    e.numero_empleado::int as numero,
    d as dias_atras,
    t.tipo,
    ((now() at time zone 'America/Matamoros')::date - d)
      + (case when e.numero_empleado::int > 1015 then time '14:00' else time '06:00' end)
      + (case when t.tipo = 'salida' then interval '8 hours' else interval '0' end)
      + make_interval(mins => ((e.numero_empleado::int * 7 + d * 13) % 26) - 8)
      as hora_local
  from empleados e
  cross join generate_series(0, 4) as d
  cross join (values ('entrada'), ('salida')) as t (tipo)
  where e.numero_empleado like '10%'
),
marcas_demo as (
  select *,
         hora_local at time zone 'America/Matamoros' as hora,
         row_number() over (order by dias_atras, numero, tipo) as n
    from base
   where hora_local at time zone 'America/Matamoros' < now()
)
insert into marcas (id, empleado_id, dispositivo_id, tipo, origen, hora_dispositivo, hora_estimada,
                    monotonico_ms, arranque_id, desfase_servidor_ms, foto_hash, foto_estado, banderas)
select
  gen_random_uuid(),
  empleado_id,
  case when numero % 3 = 0 then '00000000-0000-4000-8000-00000000d002'::uuid
       else '00000000-0000-4000-8000-00000000d001'::uuid end,
  tipo, 'kiosco', hora, hora,
  n * 1000, gen_random_uuid(), 0,
  case when n % 9 = 0 then null else encode(extensions.digest(n::text, 'sha256'), 'hex') end,
  case when n % 9 = 0 then 'sin_camara'
       when n % 13 = 0 then 'obstruida'
       when n = 20 then 'faltante'
       when dias_atras = 4 then 'eliminada_por_antiguedad'
       else 'con_foto' end,
  array_remove(array[
    case when n % 9 = 0 then 'sin_camara' end,
    case when n % 13 = 0 then 'foto_obstruida' end,
    case when n % 17 = 0 then 'reloj_sospechoso' end
  ], null)
from marcas_demo;

-- Los horarios de los 20 (bloque 9), segun los supuestos (docs/curso/supuestos.md):
-- los primeros 15 en el matutino de lunes a sabado; los ultimos 5, en el
-- vespertino de lunes a viernes. Desde hace un mes, para que el reporte
-- tenga historia.
with asignadas as (
  insert into asignaciones_turno (empleado_id, turno_id, vigente_desde)
  select e.id,
         (select t.id from turnos t where t.nombre = case when e.numero_empleado::int > 1015 then 'Vespertino' else 'Matutino' end),
         (now() at time zone 'America/Matamoros')::date - 30
    from empleados e
   where e.numero_empleado like '10%'
  returning id, empleado_id
)
insert into dias_laborales (asignacion_id, dia_semana)
select a.id, d
  from asignadas a
  join empleados e on e.id = a.empleado_id
  cross join generate_series(1, 6) as d
 where d <= case when e.numero_empleado::int > 1015 then 5 else 6 end;

insert into dias_festivos (fecha, descripcion) values
  ('2026-09-16', 'Día de la Independencia'),
  ('2026-11-16', 'Revolución Mexicana (se recorre al lunes)'),
  ('2026-12-25', 'Navidad');
