-- ============================================================================
--  0005 · MARCAS  (la tabla inmutable)
-- ============================================================================
--
--  El corazon del sistema. Cada entrada y cada salida.
--
--  CLAUDE.md 8: "marcas (INMUTABLE)".
--  CLAUDE.md 3.2: "No existen permisos de UPDATE ni DELETE sobre marcas para
--                  ningun rol."
--
--  ---------------------------------------------------------------------------
--  POR QUE INMUTABLE, SI ES EVIDENTE QUE A VECES HAY QUE CORREGIR
--  ---------------------------------------------------------------------------
--  Porque un registro de asistencia que se puede editar no prueba nada.
--
--  Si el jefe puede cambiar una marca, entonces cualquier marca pudo haber sido
--  cambiada — y en una discusion sobre un descuento, el registro deja de ser
--  evidencia y pasa a ser la palabra de alguien. Eso perjudica a las dos
--  partes: el empleado no puede confiar en el, y el jefe no puede sostenerlo.
--
--  Corregir SI se puede, y de hecho hace falta seguido. Lo que cambia es COMO:
--  se agrega una correccion (tabla `correcciones`, migracion 0008) que dice
--  "esta marca no cuenta" o "falto esta entrada", con motivo obligatorio y
--  firmada. La marca original se queda donde esta.
--
--  Asi la historia completa queda legible: que registro el kiosco, que corrigio
--  el jefe, cuando y por que. Un sistema que edita en el lugar pierde las tres
--  cosas.

create table marcas (
  /*
    EL ID LO GENERA EL KIOSCO, NO EL SERVIDOR.

    Es lo que hace idempotente la sincronizacion: el kiosco puede reintentar la
    subida mil veces —y lo va a hacer, porque el internet de la facultad se cae—
    y el servidor inserta con `ON CONFLICT DO NOTHING` sobre esta llave.
    Repetir el envio no duplica nada (CLAUDE.md 7).

    Si el id lo pusiera el servidor, cada reintento crearia una marca nueva y
    un empleado apareceria con quince entradas a las 06:02.
  */
  id uuid primary key,

  empleado_id    uuid not null references empleados (id),
  dispositivo_id uuid references dispositivos (id),

  tipo   text not null check (tipo in ('entrada', 'salida')),
  origen text not null default 'kiosco' check (origen in ('kiosco', 'manual')),

  -- ========================================================================
  --  LAS CUATRO LECTURAS DE RELOJ  (CLAUDE.md 6)
  -- ========================================================================
  --  El empleado tiene acceso fisico a la PC y puede cambiar la hora de
  --  Windows. No lo podemos impedir; si lo podemos detectar. Por eso no se
  --  guarda "la hora": se guardan cuatro medidas distintas del mismo instante,
  --  y las discrepancias entre ellas son lo que delata una manipulacion.

  -- La hora de Windows en el momento del evento. La que se puede mover.
  hora_dispositivo timestamptz not null,

  -- La anterior, corregida con el desfase conocido contra el servidor. Es la
  -- mejor estimacion que tenemos, y la que se usa para calcular jornadas.
  hora_estimada    timestamptz not null,

  -- El cronometro interno, que solo avanza y no se puede tocar desde Windows.
  -- Por si solo no dice la hora: sirve para comparar cuanto tiempo dice que
  -- paso contra cuanto dice el reloj de pared.
  monotonico_ms    bigint not null,

  -- Identificador de la sesion de la app. El cronometro se reinicia en cada
  -- arranque, asi que dos lecturas solo se pueden comparar si comparten esto.
  arranque_id      uuid not null,

  -- Cuanto se desviaba el reloj de esta PC respecto al servidor.
  desfase_servidor_ms integer not null default 0,

  /*
    LA HORA DEL SERVIDOR AL RECIBIRLA. La unica que el kiosco no controla.

    Con una marca offline, `recibido_en` puede ser horas posterior a
    `hora_estimada`, y eso es normal. Lo que NO es normal es que sea ANTERIOR:
    una marca que dice haber ocurrido despues de haber llegado significa que el
    reloj del kiosco va adelantado.
  */
  recibido_en timestamptz not null default now(),

  -- ========================================================================
  --  Evidencia y revision
  -- ========================================================================

  /*
    ⚠ AQUI NO HAY NINGUNA FOTO, Y ES LA DECISION MAS IMPORTANTE DEL PROYECTO.

    El cliente pidio que las fotografias NO salgan del kiosco (CLAUDE.md 1.1,
    confirmado el 21-09-2026). Viven cifradas en el disco de esa PC y solo se
    ven desde el modo administrador de ese mismo kiosco.

    Lo unico que llega a la nube es el HASH. Con el, el panel puede:

      - saber que SI hubo foto, sin tenerla;
      - detectar despues que la foto falta o que fue alterada, comparando el
        hash del archivo contra este;
      - decirle al jefe a que kiosco tiene que ir para verla.

    Un hash no es un dato personal: no se puede reconstruir una cara a partir
    de el. Es exactamente la mitad de la informacion que hace falta fuera.
  */
  foto_hash text check (foto_hash is null or foto_hash ~ '^[0-9a-f]{64}$'),

  /*
    EN QUE ESTADO ESTA ESA FOTO, VISTO DESDE LA NUBE.

    Sin esto el panel solo podria decir "hay hash" o "no hay hash", y eso no
    distingue los casos que de verdad importan: no es lo mismo que no hubiera
    camara —culpa del sistema— a que la foto se borrara por antiguedad
    —normal— a que falte cuando deberia estar, que es un aviso serio.

    Lo mantiene al dia el kiosco al sincronizar.
  */
  foto_estado text not null default 'sin_camara' check (foto_estado in (
    'con_foto',                  -- esta en el kiosco y su hash cuadra
    'sin_camara',                -- no habia camara cuando se registro
    'obstruida',                 -- se tomo, pero el lente parecia tapado
    'eliminada_por_antiguedad',  -- paso el plazo de retencion
    'conservada',                -- marcada por un admin: no se borra
    'faltante',                  -- deberia estar y no esta        <- revisar
    'alterada'                   -- esta, pero el hash no cuadra   <- revisar
  )),

  /*
    BANDERAS: "esto hay que revisarlo".

    NUNCA impiden registrar (CLAUDE.md 5 y 6). Son etiquetas para que el jefe
    lo mire despues. El kiosco registra siempre; esta columna es como avisa de
    que algo no cuadraba.
  */
  banderas text[] not null default '{}',

  -- Marca de un dispositivo revocado, aceptada para no perder asistencia real
  -- pero apartada para revision (CLAUDE.md 3.3).
  en_cuarentena boolean not null default false,

  constraint marcas_banderas_conocidas check (
    banderas <@ array[
      'sin_camara', 'foto_obstruida', 'reloj_sospechoso',
      'dispositivo_revocado', 'manual', 'cierre_automatico'
    ]::text[]
  )
);

comment on table marcas is
  'INMUTABLE. Solo se insertan. Las correcciones van en la tabla correcciones, '
  'nunca editando aqui. La foto no vive aqui: solo su hash.';

-- ----------------------------------------------------------------------------
--  Indices: las consultas que el panel hace todo el tiempo
-- ----------------------------------------------------------------------------

-- "las marcas de este empleado, mas recientes primero" — tambien es la que usa
-- el emparejamiento de jornadas de la fase 3.
create index marcas_empleado_hora_idx on marcas (empleado_id, hora_estimada desc);

/*
  "todo lo del dia X" (la pantalla principal del panel).

  ⚠ AQUI HABIA UN ERROR DE DISENO, Y ES INSTRUCTIVO. La primera version era:

      create index ... on marcas (fecha_laboral(hora_estimada));

  Parecia mejor: indexar la fecha ya convertida evita convertir la zona horaria
  de cada fila en cada consulta. Postgres lo rechazo, y tiene toda la razon.

  Un indice guarda valores YA CALCULADOS. Para eso, la funcion tiene que ser
  IMMUTABLE: dar siempre el mismo resultado para la misma entrada, hasta el fin
  de los tiempos. Y `fecha_laboral()` no lo es — lee la zona horaria de la tabla
  `configuracion`.

  Si Postgres lo hubiera permitido, el dia que alguien cambiara la zona horaria
  el indice quedaria lleno de fechas calculadas con la zona vieja. Las consultas
  seguirian funcionando, rapidas y en silencio, devolviendo el dia equivocado.
  Un indice mentiroso es peor que no tener indice.

  La forma correcta es indexar el dato crudo —el instante— y que la consulta
  pida un RANGO:

      where hora_estimada >= '2026-09-21 00:00-05' and hora_estimada < '...'

  Eso usa este indice a toda velocidad, y la conversion de zona ocurre una vez
  al armar el rango, no una por fila.
*/
create index marcas_hora_idx on marcas (hora_estimada desc);

-- "que hay que revisar" — la pantalla de alertas. Es un indice PARCIAL: solo
-- incluye las filas con bandera o en cuarentena, que en un sistema sano son
-- poquisimas. Ocupa casi nada y responde al instante.
create index marcas_para_revisar_idx on marcas (hora_estimada desc)
  where en_cuarentena or array_length(banderas, 1) > 0;

-- Las marcas cuya foto hay que ir a revisar AL KIOSCO. Es lo que alimenta el
-- filtro "Revisar en kiosco" del panel (CLAUDE.md 10): va por dispositivo para
-- que el jefe haga un solo viaje en vez de uno por caso.
create index marcas_foto_problema_idx on marcas (dispositivo_id, hora_estimada desc)
  where foto_estado in ('faltante', 'alterada');

alter table marcas enable row level security;


-- ============================================================================
--  LA INMUTABILIDAD, APLICADA DE VERDAD
-- ============================================================================
--
--  ⚠ AQUI ESTA LA PARTE QUE IMPORTA, Y ES SUTIL.
--
--  No basta con no crear politicas RLS de UPDATE y DELETE. La RLS **no aplica
--  a `service_role`**, y `service_role` es justamente lo que usan las Edge
--  Functions — o sea, el camino por el que entra todo lo del kiosco.
--
--  Dicho de otro modo: confiar solo en RLS dejaria las marcas protegidas contra
--  el panel, que casi no las toca, y desprotegidas contra el codigo que las
--  escribe todo el dia. Al reves de lo que hace falta.
--
--  Un TRIGGER si aplica a todos, service_role incluido. Por eso la regla vive
--  aqui y no en una politica.

create or replace function marcas_son_inmutables()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Las marcas no se borran. Para anular una, agrega una correccion (CLAUDE.md 8).'
      using errcode = 'restrict_violation';
  end if;

  /*
    LA UNICA EXCEPCION: EL ESTADO DE LA FOTO.

    La foto no vive aqui (vive en el kiosco), pero su ESTADO cambia con el
    tiempo, y ese cambio tiene que poder llegar: una foto que hoy esta se borra
    a los 30 dias, o un dia resulta que falta.

    Eso es tecnicamente un UPDATE sobre una tabla que declaramos inmutable. La
    contradiccion es aparente: lo inmutable es EL REGISTRO DE ASISTENCIA
    —quien, cuando, entrada o salida, con que banderas—. Que la fotografia siga
    existiendo o no es informacion sobre otra cosa.

    En vez de abrir el UPDATE y confiar en que nadie lo use para algo mas, se
    permite exactamente esa columna y ninguna otra: se comparan las dos
    versiones de la fila ignorando `foto_estado`, y si difieren en cualquier
    cosa mas, se rechaza.

    Comparar el registro completo, en vez de ir columna por columna, tiene una
    ventaja concreta: el dia que alguien agregue una columna nueva a `marcas`,
    queda protegida sola. Una lista escrita a mano habria que acordarse de
    actualizarla, y nadie se acuerda.

    Fijate en que `foto_hash` NO esta en la excepcion. El hash es la huella de
    la evidencia: si se pudiera cambiar, una foto sustituida pasaria la
    verificacion sin problema. Se escribe una vez, al insertar, y ya.
  */
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'foto_estado' is distinct from to_jsonb(old) - 'foto_estado' then
      raise exception
        'Las marcas no se editan. Solo puede cambiar foto_estado. '
        'Para corregir una marca, agrega una correccion (CLAUDE.md 8).'
        using errcode = 'restrict_violation';
    end if;

    return new;
  end if;

  return new;
end;
$$;

create trigger marcas_inmutables
  before update or delete on marcas
  for each row execute function marcas_son_inmutables();

-- Y ademas se quitan los permisos a nivel de tabla. Es redundante con el
-- trigger, y la redundancia es el punto: si un dia alguien desactiva el
-- trigger para "arreglar" algo, esto sigue de pie.
revoke update, delete on marcas from authenticated;


-- ----------------------------------------------------------------------------
--  Politicas
-- ----------------------------------------------------------------------------
--  El panel LEE. Nada mas.
--
--  Insertar marcas es trabajo de Edge Functions: las del kiosco llegan por
--  `recibir-marcas` (bloque 5) y las manuales del jefe pasan por una funcion
--  que ademas exige motivo y deja constancia en la bitacora. Un INSERT suelto
--  desde el panel se saltaria las dos cosas.

create policy marcas_leer on marcas
  for select to authenticated
  using (es_administrador());
