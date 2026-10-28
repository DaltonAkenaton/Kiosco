-- ============================================================================
--  0008 · CORRECCIONES E INCIDENCIAS
-- ============================================================================
--
--  Como se arregla la realidad sin tocar el registro.

-- ============================================================================
--  CORRECCIONES
-- ============================================================================
--
--  ARQUITECTURA.md 8: "Las correcciones nunca modifican la marca original."
--
--  Esta tabla es la contraparte necesaria de la inmutabilidad de `marcas`. Sin
--  ella, "no se puede editar" seria simplemente "no se puede arreglar", y el
--  primer dia que alguien olvidara checar el sistema seria inservible.
--
--  Lo que cambia no es SI se puede corregir, sino COMO: en vez de reescribir el
--  pasado, se agrega algo que dice que hacer con el. Las dos versiones quedan:
--  lo que el kiosco registro, y lo que el jefe determino. Cuando alguien
--  pregunte "¿por que aqui dice que entre a las 8?", la respuesta completa
--  esta escrita, con fecha y con nombre.

create table correcciones (
  id uuid primary key default gen_random_uuid(),

  -- La marca afectada. NULL cuando la correccion AGREGA una marca que nunca
  -- existio — el caso de "se me olvido checar la entrada".
  marca_id    uuid references marcas (id),
  empleado_id uuid not null references empleados (id),

  accion text not null check (accion in (
    'anular',        -- esta marca no cuenta (se checo dos veces, fue un error)
    'agregar',       -- falto esta marca (olvido checar, se fue la luz)
    'cambiar_tipo'   -- era salida y quedo como entrada
  )),

  /*
    Los datos que la accion necesita, en `jsonb`.

    'agregar'       -> { "tipo": "entrada", "hora": "2026-09-21T12:00:00Z" }
    'cambiar_tipo'  -> { "tipo": "salida" }
    'anular'        -> {}

    Es jsonb y no columnas fijas porque cada accion pide cosas distintas, y
    porque van a aparecer mas acciones. Con columnas, la mitad estarian
    siempre nulas y cada accion nueva seria una migracion.
  */
  datos jsonb not null default '{}'::jsonb,

  /*
    ⚠ EL MOTIVO ES OBLIGATORIO. NOT NULL, Y ADEMAS NO PUEDE ESTAR VACIO.

    El CHECK del largo minimo no es burocracia. Sin el, el campo se llenaria
    con "." o "ok" —eso pasa siempre— y la bitacora quedaria llena de
    correcciones sin explicacion, que es igual de inutil que no tenerla.

    Veinte caracteres obligan a escribir una frase de verdad: "olvido checar
    salida, confirmado por el supervisor". Ese texto es lo que va a defender la
    correccion el dia que alguien la cuestione.
  */
  motivo text not null check (length(trim(motivo)) >= 20),

  -- Quien la hizo. NOT NULL: una correccion sin firma no vale nada.
  admin_id  uuid not null references auth.users (id),
  creado_en timestamptz not null default now(),

  -- 'anular' y 'cambiar_tipo' necesitan una marca sobre la que actuar;
  -- 'agregar' necesita que no la haya.
  constraint correcciones_marca_coherente check (
    (accion = 'agregar' and marca_id is null)
    or (accion in ('anular', 'cambiar_tipo') and marca_id is not null)
  )
);

comment on table correcciones is
  'Como se arregla una marca sin tocarla. La marca original se queda; esto '
  'dice que hacer con ella. Motivo obligatorio y firmado.';

create index correcciones_marca_idx on correcciones (marca_id);
create index correcciones_empleado_idx on correcciones (empleado_id, creado_en desc);

alter table correcciones enable row level security;

-- Los dos roles pueden corregir: un supervisor que revisa la asistencia diaria
-- es justamente quien detecta los olvidos. Lo que un supervisor NO puede es
-- cambiar las reglas del sistema ni dar de alta a nadie.
create policy correcciones_leer on correcciones
  for select to authenticated
  using (es_administrador());

create policy correcciones_insertar on correcciones
  for insert to authenticated
  -- `admin_id = auth.uid()` impide firmar a nombre de otro. Sin esto, alguien
  -- podria registrar una correccion atribuida a un companero.
  with check (es_administrador() and admin_id = auth.uid());

/*
  Sin UPDATE ni DELETE, por la misma razon que las marcas: una correccion es
  una declaracion fechada y firmada. Si se equivoco, se agrega otra que la
  corrija. Editarla la volveria tan poco confiable como la marca que pretende
  arreglar.
*/


-- ============================================================================
--  INCIDENCIAS  (vacaciones, incapacidad, permiso)
-- ============================================================================
--
--  Sin esto, dos semanas de vacaciones se ven en el reporte como diez faltas.
--  El jefe tendria que recordar quien estaba de vacaciones al leer cada
--  reporte — y despues de tres meses, ya no se acuerda nadie.

create table incidencias (
  id          uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references empleados (id) on delete cascade,

  tipo text not null check (tipo in (
    'vacaciones',
    'incapacidad',
    'permiso',
    'comision',        -- trabajando, pero en otro lado
    'falta_justificada'
  )),

  fecha_inicio date not null,
  fecha_fin    date not null,
  notas        text not null default '',

  admin_id  uuid not null references auth.users (id),
  creado_en timestamptz not null default now(),

  constraint incidencias_rango_coherente check (fecha_fin >= fecha_inicio)
);

comment on table incidencias is
  'Ausencias justificadas. Es lo que evita que unas vacaciones aparezcan como '
  'una racha de faltas.';

create index incidencias_empleado_idx on incidencias (empleado_id, fecha_inicio);

/*
  Aqui NO se prohiben los rangos encimados, al reves que en las asignaciones de
  turno. Es deliberado: una incapacidad puede caer en medio de unas vacaciones
  ya autorizadas, y eso pasa en la vida real. Que el sistema lo impida
  obligaria al jefe a borrar y recapturar las vacaciones para poder registrar
  la incapacidad — y a perder el rastro de lo que habia autorizado antes.

  Cuando dos incidencias se encimen, el calculo de la fase 3 tomara la mas
  especifica. Es una regla de negocio, no una restriccion de integridad.
*/

alter table incidencias enable row level security;

create policy incidencias_leer on incidencias
  for select to authenticated
  using (es_administrador());

create policy incidencias_insertar on incidencias
  for insert to authenticated
  with check (es_administrador() and admin_id = auth.uid());

-- Estas SI se pueden corregir y borrar: una incidencia no es un registro de lo
-- que paso, es una autorizacion sobre lo que va a pasar. Unas vacaciones se
-- cancelan o se mueven, y eso es normal.
--
-- La bitacora de auditoria (migracion 0009) guarda el antes y el despues de
-- cada cambio, asi que nada se pierde.
create policy incidencias_actualizar on incidencias
  for update to authenticated
  using (es_administrador())
  with check (es_administrador());

create policy incidencias_borrar on incidencias
  for delete to authenticated
  using (puede_administrar());
