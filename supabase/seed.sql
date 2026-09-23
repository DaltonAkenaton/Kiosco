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

-- El jefe de prueba. Un usuario de Supabase Auth minimo; la contrasena para
-- ENTRAR AL PANEL se le pone en el bloque 7, cuando exista el panel.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'jefe@prueba.local');

insert into administradores (user_id, nombre, rol, usuario_kiosco, contrasena_kiosco_hash)
values ('00000000-0000-4000-8000-00000000a001', 'Jefe de prueba', 'admin', 'jefe',
        extensions.crypt('jefe-de-prueba', extensions.gen_salt('bf', 10)));
