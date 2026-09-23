-- ============================================================================
--  0010 · FOTOS  (lo poco que de ellas llega a la nube)
-- ============================================================================
--
--  ⚠ ESTA MIGRACION NO CREA NINGUN ALMACENAMIENTO DE FOTOS, Y ESO ES EL PUNTO.
--
--  El cliente pidio que las fotografias NO salgan del kiosco (CLAUDE.md 1.1,
--  confirmado el 21-09-2026). Viven cifradas con AES-256-GCM en el disco de la
--  PC y solo se ven desde el modo administrador de ese mismo kiosco.
--
--  La primera version de este archivo creaba un bucket privado de Supabase
--  Storage. Se eliminó por completo: un bucket vacio "por si acaso" es una
--  puerta abierta esperando que alguien la use, y la decision de que las fotos
--  no salgan solo vale si no hay a donde subirlas.
--
--  ---------------------------------------------------------------------------
--  ENTONCES, ¿QUE SI LLEGA?
--  ---------------------------------------------------------------------------
--  Dos cosas, las dos en la tabla `marcas` (migracion 0005):
--
--      foto_hash     el SHA-256 del JPEG. Permite saber que HUBO foto, y
--                    detectar despues que falta o que fue alterada.
--      foto_estado   en que situacion esta: en el kiosco, borrada por
--                    antiguedad, conservada, faltante...
--
--  Con eso el panel puede decirle al jefe "esta marca tiene foto, ve al kiosco
--  de la entrada principal a verla" o "esta foto deberia estar y no esta,
--  revisala". Lo que no puede es ensenarsela, porque no la tiene.
--
--  ---------------------------------------------------------------------------
--  LO QUE SIGUE SIENDO OBLIGACION AUNQUE LAS FOTOS SEAN LOCALES
--  ---------------------------------------------------------------------------
--  Que las fotos no viajen a un proveedor externo quita la transferencia a un
--  encargado (y el posible almacenamiento fuera de Mexico). NO quita nada mas:
--  el aviso de privacidad, el plazo de retencion, la bitacora de accesos y los
--  derechos ARCO siguen siendo obligacion de la UAT exactamente igual.
--
--  Local no significa sin reglas. De ahi la tabla de abajo.

-- ============================================================================
--  QUIEN MIRO QUE FOTO
-- ============================================================================
--
--  CLAUDE.md 12: "bitacora de quien consulta fotos (tabla accesos_foto)".
--
--  Es la parte del deber de seguridad que mas se olvida. Guardar bien las
--  fotos es solo la mitad; la otra es poder responderle a un empleado que
--  pregunte quien ha estado viendo las suyas.
--
--  ---------------------------------------------------------------------------
--  LA CONSULTA OCURRE EN EL KIOSCO, PERO EL REGISTRO VIVE AQUI
--  ---------------------------------------------------------------------------
--  Esta tabla se llena desde el kiosco: es ahi donde estan las fotos y donde
--  alguien entra al modo administrador a mirarlas. El kiosco anota cada
--  consulta en su base local y la sincroniza como un evento mas.
--
--  ¿Por que no dejarla solo en el kiosco, si ahi ocurre todo? Porque entonces
--  la bitacora viviria en la misma maquina que quien la genera. Cualquiera con
--  acceso al kiosco podria mirar fotos y despues borrar el rastro, y nadie lo
--  sabria. Sincronizarla la pone fuera del alcance de quien la produce, que es
--  justo lo que hace que una bitacora sirva de algo.
--
--  Y tiene un efecto util antes incluso de que alguien la lea: quien sabe que
--  sus consultas quedan registradas mira las fotos que necesita, no las que le
--  dan curiosidad.

create table accesos_foto (
  -- El id lo genera el kiosco, igual que las marcas y los eventos: para que
  -- reintentar el envio no duplique nada.
  id uuid primary key,

  marca_id       uuid not null references marcas (id),
  dispositivo_id uuid references dispositivos (id),

  /*
    Quien miro. Es el administrador que entro al modo administrador DEL KIOSCO.

    Es `uuid` sin `references auth.users` a proposito: el kiosco valida las
    credenciales contra los hashes que bajo en la sincronizacion, sin internet.
    Si esto exigiera que el usuario exista ya en `auth.users`, una consulta
    hecha offline por alguien dado de alta hace cinco minutos se rechazaria al
    sincronizar — y se perderia justo el registro que hay que conservar.
  */
  admin_id uuid not null,

  accion text not null default 'ver' check (accion in (
    'ver',        -- la abrio en la pantalla de auditoria del kiosco
    'exportar'    -- salio en un ZIP a USB
  )),

  -- Cuando la miro, segun el kiosco, y cuando llego aqui.
  consultado_en timestamptz not null,
  recibido_en   timestamptz not null default now()
);

comment on table accesos_foto is
  'Quien consulto o exporto la foto de que marca. Se genera en el kiosco y se '
  'sincroniza: asi el rastro no vive en la misma maquina que lo produce.';

create index accesos_foto_marca_idx on accesos_foto (marca_id, consultado_en desc);
create index accesos_foto_admin_idx on accesos_foto (admin_id, consultado_en desc);

alter table accesos_foto enable row level security;

-- Solo el rol admin la lee: es informacion sobre la conducta de los propios
-- administradores. Un supervisor no tiene por que ver que fotos consulto otro.
create policy accesos_foto_leer on accesos_foto
  for select to authenticated
  using (puede_administrar());

-- Y nadie la escribe desde el panel: llega por la sincronizacion del kiosco,
-- via Edge Function con service_role.
revoke insert, update, delete on accesos_foto from authenticated;


-- ============================================================================
--  ESTADO DE LA FOTO: LO QUE EL KIOSCO REPORTA
-- ============================================================================
--
--  La retencion OCURRE EN EL KIOSCO: es ahi donde esta el archivo y ahi donde
--  se borra a los 30 dias. Lo unico que pasa en la nube es enterarse.
--
--  Por eso aqui no hay ninguna tarea que borre nada. Hay una funcion para que
--  el kiosco diga "esta ya no esta", y nada mas.

-- ----------------------------------------------------------------------------
--  actualizar_estado_de_foto()
-- ----------------------------------------------------------------------------
--  Es el unico UPDATE que la tabla `marcas` acepta (ver el trigger de
--  inmutabilidad en la migracion 0005). Cualquier intento de cambiar otra cosa
--  desde aqui haria fallar la operacion, que es exactamente lo que queremos.
create or replace function actualizar_estado_de_foto(
  p_marca_id uuid,
  p_estado   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- El CHECK de la tabla ya limita los valores, pero fallar aqui da un mensaje
  -- que se entiende; fallar alla da un error de restriccion que hay que ir a
  -- descifrar a la definicion de la tabla.
  if p_estado not in (
    'con_foto', 'sin_camara', 'obstruida',
    'eliminada_por_antiguedad', 'conservada', 'faltante', 'alterada'
  ) then
    raise exception 'Estado de foto desconocido: %', p_estado;
  end if;

  update marcas
     set foto_estado = p_estado
   where id = p_marca_id;
end;
$$;

comment on function actualizar_estado_de_foto(uuid, text) is
  'Lo llama el kiosco al sincronizar: la foto se borro por antiguedad, falta, '
  'o un admin la marco para conservar.';


-- ----------------------------------------------------------------------------
--  dias_retencion_fotos()
-- ----------------------------------------------------------------------------
--  El plazo lo decide el jefe desde el panel y lo aplica el kiosco. Esta
--  funcion es de donde el catalogo lo lee al sincronizar.
--
--  Que el valor viva en la nube y se aplique en el kiosco es lo que permite
--  cambiar el plazo en todos los kioscos a la vez sin ir a ninguno
--  (CLAUDE.md 1.3).
create or replace function dias_retencion_fotos()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (valor #>> '{}')::integer from configuracion where clave = 'dias_retencion_fotos'),
    30
  );
$$;


-- ============================================================================
--  MARCAS CON FOTO POR REVISAR
-- ============================================================================
--
--  Alimenta el filtro "Revisar en kiosco" del panel (CLAUDE.md 10).
--
--  El problema practico que resuelve: con las fotos en el kiosco, cada
--  revision es un viaje fisico. Si el jefe tiene que ir una vez por caso, deja
--  de revisar — y entonces la foto, que es la evidencia de todo el sistema, no
--  la mira nadie.
--
--  Esta vista agrupa lo pendiente POR KIOSCO, para que sea un solo viaje.
create or replace view fotos_por_revisar as
  select
    m.dispositivo_id,
    d.nombre    as dispositivo,
    d.ubicacion,
    count(*)                          as casos,
    min(m.hora_estimada)              as mas_antiguo,
    max(m.hora_estimada)              as mas_reciente
  from marcas m
  left join dispositivos d on d.id = m.dispositivo_id
  where m.foto_estado in ('faltante', 'alterada')
  group by m.dispositivo_id, d.nombre, d.ubicacion;

comment on view fotos_por_revisar is
  'Cuantos casos con foto problematica hay en cada kiosco. Para que el jefe '
  'haga un viaje y revise varios, en vez de un viaje por caso.';

/*
  Una vista hereda la RLS de las tablas que lee, asi que `marcas` ya la
  protege: quien no pueda leer marcas no vera nada aqui.

  `security_invoker = on` lo hace explicito — sin el, en algunas versiones de
  Postgres la vista correria con los permisos de quien la creo (el dueno de la
  base), y se saltaria la RLS sin que nadie se diera cuenta.
*/
alter view fotos_por_revisar set (security_invoker = on);
