-- ============================================================================
--  0007 · TURNOS, ASIGNACIONES Y DIAS FESTIVOS
-- ============================================================================
--
--  CLAUDE.md 8: "Horarios, tolerancias y turnos van en TABLAS, nunca en codigo."
--
--  Las tablas se crean AHORA aunque los calculos que las usan sean de la fase
--  3. El motivo es practico: asi el jefe puede capturar sus horarios desde el
--  panel en cuanto lo tenga, y cuando llegue la fase 3 los datos ya estan. Al
--  reves —calculos listos y tablas vacias— no sirve de nada.
--
--  ---------------------------------------------------------------------------
--  LO QUE EL KIOSCO NO SABE, Y NO LE HACE FALTA
--  ---------------------------------------------------------------------------
--  El kiosco no sabe que es un retardo. Solo registra marcas.
--
--  Retardos, faltas y horas se calculan AQUI, con la configuracion vigente
--  (CLAUDE.md 8). La consecuencia es la parte buena: cambiar la tolerancia de
--  10 a 15 minutos recalcula tambien el historico, sin tocar ni una marca y
--  sin actualizar ningun kiosco.

create table turnos (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique,

  /*
    HORA LOCAL, SIN FECHA Y SIN ZONA. Es `time`, no `timestamptz`.

    Un turno no ocurre en un instante: es una regla. "Se entra a las 06:00"
    quiere decir a las 06:00 del reloj de la pared, todos los dias, tenga o no
    horario de verano ese dia.

    Guardarlo como `timestamptz` seria el error clasico: quedaria atado a la
    fecha en que se capturo, y en marzo —cuando el reloj se adelanta una hora—
    el turno de las 06:00 pasaria a empezar a las 05:00 o a las 07:00 segun
    como se hubiera guardado.

    El instante concreto se arma al calcular: fecha laboral + esta hora + la
    zona horaria. Asi cada dia se resuelve con las reglas de horario de verano
    que le tocaban a ESE dia.
  */
  hora_inicio time not null,
  hora_fin    time not null,

  /*
    ¿CRUZA LA MEDIANOCHE?

    Columna GENERADA: Postgres la calcula sola y no se puede escribir a mano.
    Es imposible que quede mal, porque no hay forma de equivocarse al llenarla.

    El turno nocturno de 22:00 a 06:00 esta incluido A PROPOSITO desde el
    principio (CLAUDE.md 8), aunque hoy no haya veladores. La razon: si el
    cruce de medianoche se deja para el final, no se resuelve, se PARCHEA — y
    el parche se nota justo la noche del cambio de horario, cuando el turno
    dura 7 u 9 horas de reloj en vez de 8.

    Las horas trabajadas siempre se calculan restando instantes absolutos, que
    es lo unico que da el numero correcto esas dos noches del ano.
  */
  cruza_medianoche boolean generated always as (hora_fin < hora_inicio) stored,

  /*
    Tolerancia y falta POR TURNO, no globales.

    El turno de la madrugada puede merecer mas gracia que el de la tarde: a las
    6 de la manana el transporte publico no ayuda igual. Estos valores pisan a
    los de la tabla `configuracion`, que quedan como el valor por defecto.
  */
  tolerancia_minutos  integer not null default 10 check (tolerancia_minutos >= 0),
  minutos_para_falta  integer not null default 30 check (minutos_para_falta >= 0),

  /*
    TURNO LIBRE (CLAUDE.md 8): no hay hora de entrada, hay horas que cumplir a
    la semana. Se evalua por total, no por puntualidad.

    Se asume que no se usa (supuestos.md), pero la columna existe porque el
    modelo no cuesta nada ahora y una migracion despues, si.
  */
  es_libre boolean not null default false,
  horas_semanales_requeridas numeric(5,2),

  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Un turno libre necesita horas semanales; uno normal, no.
  constraint turnos_libre_coherente check (
    (not es_libre and horas_semanales_requeridas is null)
    or (es_libre and horas_semanales_requeridas is not null)
  ),

  constraint turnos_falta_despues_de_tolerancia
    check (minutos_para_falta >= tolerancia_minutos)
);

comment on table turnos is
  'Los horarios. hora_inicio y hora_fin son hora LOCAL sin fecha: el instante '
  'se arma con la fecha laboral y la zona, para que el horario de verano salga '
  'bien.';

create trigger turnos_tocar_actualizado
  before update on turnos
  for each row execute function tocar_actualizado_en();

alter table turnos enable row level security;


-- ----------------------------------------------------------------------------
--  Turnos iniciales  (supuestos de CLAUDE.md 1.2)
-- ----------------------------------------------------------------------------
--  Tres turnos de 8 horas, incluido el nocturno que cruza la medianoche.
insert into turnos (nombre, hora_inicio, hora_fin) values
  ('Matutino',   '06:00', '14:00'),
  ('Vespertino', '14:00', '22:00'),
  ('Nocturno',   '22:00', '06:00');


-- ============================================================================
--  ASIGNACIONES: que turno le toca a quien, y desde cuando
-- ============================================================================
--
--  No es una columna en `empleados` porque los turnos CAMBIAN, y el historico
--  tiene que seguir siendo correcto. Si el turno viviera en `empleados`, al
--  pasar a alguien del matutino al vespertino todos sus registros anteriores
--  se recalcularian contra el turno nuevo: meses de asistencia puntual
--  convertidos en retardos de ocho horas.
--
--  Con vigencias, cada marca se evalua contra el turno que esa persona tenia
--  ESE dia.

create table asignaciones_turno (
  id          uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references empleados (id) on delete cascade,
  turno_id    uuid not null references turnos (id),

  vigente_desde date not null,
  -- NULL = sigue vigente. Es el turno actual de esa persona.
  vigente_hasta date,

  creado_en timestamptz not null default now(),

  constraint asignaciones_vigencia_coherente
    check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

comment on table asignaciones_turno is
  'Que turno tenia cada empleado en cada periodo. Con vigencias para que el '
  'historico no se recalcule al cambiar a alguien de turno.';

/*
  QUE NADIE TENGA DOS TURNOS EL MISMO DIA.

  `daterange` convierte las dos fechas en un intervalo, y `EXCLUDE` le dice a
  Postgres: "para un mismo empleado, no permitas dos intervalos que se
  encimen". `'[)'` incluye el inicio y excluye el fin, que es lo que hace que
  un turno que termina el dia 15 y otro que empieza el 15 no choquen.

  Se resuelve en la base y no en la aplicacion porque es la unica forma de que
  no dependa de que todas las pantallas se acuerden de comprobarlo. Un empleado
  con dos turnos encimados haria que el calculo de jornadas no supiera cual
  aplicar, y eso no falla: da un numero equivocado, que es peor.

  `gist` con `WITH =` necesita btree_gist para comparar uuid dentro de un
  indice de rangos.
*/
create extension if not exists btree_gist with schema extensions;

alter table asignaciones_turno
  add constraint asignaciones_sin_encimar
  exclude using gist (
    empleado_id with =,
    daterange(vigente_desde, vigente_hasta, '[)') with &&
  );

create index asignaciones_vigentes_idx on asignaciones_turno (empleado_id)
  where vigente_hasta is null;

alter table asignaciones_turno enable row level security;


-- ============================================================================
--  DIAS LABORALES: que dias de la semana aplica cada asignacion
-- ============================================================================
create table dias_laborales (
  asignacion_id uuid not null references asignaciones_turno (id) on delete cascade,

  -- 0 = domingo, 6 = sabado. Es la convencion de `extract(dow)` de Postgres y
  -- la de JavaScript, asi que no hay que convertir en ningun lado.
  dia_semana smallint not null check (dia_semana between 0 and 6),

  primary key (asignacion_id, dia_semana)
);

comment on table dias_laborales is
  'Dias de la semana de cada asignacion. 0 = domingo. [PENDIENTE] confirmar '
  'con el cliente si existen rotaciones mas complejas (CLAUDE.md 8).';

alter table dias_laborales enable row level security;


-- ============================================================================
--  DIAS FESTIVOS
-- ============================================================================
--
--  Sin esto, cada dia festivo apareceria como falta de todo el personal. El
--  jefe tendria que justificar cinco faltas a mano en cada dia de asueto, o
--  aprenderia a ignorar el reporte de faltas — que es peor, porque entonces
--  tampoco ve las de verdad.
create table dias_festivos (
  fecha       date primary key,
  descripcion text not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id)
);

alter table dias_festivos enable row level security;


-- ============================================================================
--  POLITICAS  (las mismas para las cuatro tablas)
-- ============================================================================
--  Todos los administradores ven los horarios; solo el rol admin los cambia.
--  Un supervisor que consulta asistencia necesita saber contra que horario se
--  esta midiendo, pero cambiar el horario de alguien es otra cosa.

create policy turnos_leer on turnos
  for select to authenticated using (es_administrador());
create policy turnos_escribir on turnos
  for all to authenticated using (puede_administrar()) with check (puede_administrar());

create policy asignaciones_leer on asignaciones_turno
  for select to authenticated using (es_administrador());
create policy asignaciones_escribir on asignaciones_turno
  for all to authenticated using (puede_administrar()) with check (puede_administrar());

create policy dias_laborales_leer on dias_laborales
  for select to authenticated using (es_administrador());
create policy dias_laborales_escribir on dias_laborales
  for all to authenticated using (puede_administrar()) with check (puede_administrar());

create policy dias_festivos_leer on dias_festivos
  for select to authenticated using (es_administrador());
create policy dias_festivos_escribir on dias_festivos
  for all to authenticated using (puede_administrar()) with check (puede_administrar());
