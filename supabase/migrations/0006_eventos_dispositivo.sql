-- ============================================================================
--  0006 · EVENTOS DE DISPOSITIVO
-- ============================================================================
--
--  Lo que le pasa a un kiosco y no es una marca: la camara se desconecto,
--  alguien lo pauso para usar la computadora, el reloj dio un salto raro.
--
--  ---------------------------------------------------------------------------
--  POR QUE MERECEN UNA TABLA
--  ---------------------------------------------------------------------------
--  Porque son la mitad que EXPLICA a la otra.
--
--  Una marca dice "Rosa entro a las 06:02, sin foto". Por si sola parece
--  sospechosa. Un evento que dice "la camara llevaba dos horas desconectada"
--  la convierte en lo que de verdad es: una consecuencia esperable de un cable
--  flojo, y un aviso de que hay que ir a apretarlo.
--
--  El caso mas claro es la pausa. Si alguien aparta el kiosco de 10:15 a 10:32
--  para usar la computadora, en esa franja NADIE PUDO CHECAR. Sin este registro
--  seria un hueco inexplicable en la asistencia de la manana; con el, tiene
--  explicacion y fecha.

create table eventos_dispositivo (
  -- El id tambien lo genera el kiosco, por lo mismo que las marcas: para que
  -- reintentar el envio no duplique nada.
  id uuid primary key,

  dispositivo_id uuid references dispositivos (id),

  tipo text not null check (tipo in (
    'camara_desconectada',
    'camara_reconectada',
    'kiosco_pausado',
    'kiosco_reanudado',
    'reloj_sospechoso',
    'arranque',
    'error_sincronizacion'
  )),

  /*
    `jsonb` libre porque cada tipo necesita cosas distintas: la pausa guarda
    cuantos minutos y como termino, la camara guarda el mensaje del navegador,
    el reloj guarda de cuanto fue el salto.

    Una columna por dato habria significado veinte columnas casi siempre nulas,
    y una migracion cada vez que aparezca un tipo de evento nuevo.

    ⚠ LO PROHIBIDO AQUI: nombres, PINes, rutas de fotos. Un evento describe la
    MAQUINA, no a las personas (ARQUITECTURA.md 14). La prueba automatizada del
    kiosco lo verifica.
  */
  detalle jsonb not null default '{}'::jsonb,

  -- Cuando paso, segun el kiosco.
  ocurrido_en timestamptz not null,

  -- Cuando llego, segun el servidor. La diferencia entre las dos dice cuanto
  -- tiempo estuvo ese kiosco sin poder hablar con la nube.
  recibido_en timestamptz not null default now()
);

comment on table eventos_dispositivo is
  'Lo que le pasa a un kiosco. Es lo que explica las marcas raras y los huecos '
  'en la asistencia.';

create index eventos_dispositivo_idx on eventos_dispositivo (dispositivo_id, ocurrido_en desc);
create index eventos_tipo_idx on eventos_dispositivo (tipo, ocurrido_en desc);

alter table eventos_dispositivo enable row level security;

-- El panel los lee para armar la pantalla de alertas. Insertarlos es trabajo
-- de la Edge Function que recibe la bandeja de salida del kiosco.
create policy eventos_leer on eventos_dispositivo
  for select to authenticated
  using (es_administrador());
