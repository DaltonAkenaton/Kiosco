-- ============================================================================
--  0028 · AVISOS DEL PANEL Y REGISTROS DESPUES DE UNA BAJA  (06-10-2026)
-- ============================================================================
--
--  Sale de la instalacion en la facultad (06-10-2026). Tres cosas:
--
--  1. REGISTROS DE ALGUIEN YA DADO DE BAJA.
--     Se dio de baja a una persona en el panel mientras el kiosco estaba sin
--     internet. El kiosco no se entero, la persona registro su entrada, y al
--     volver la red la oficina la acepto como cualquier otra.
--
--     Aceptarla es lo correcto (regla de oro: nunca perder un registro; quiza
--     si trabajo ese dia y la baja se capturo antes de tiempo). Lo que estaba
--     mal es que pasara DESAPERCIBIDA. Ahora sale con la bandera
--     `empleado_de_baja` y aparece en "Revisar". Decide el jefe, no el sistema.
--
--     Para saber si el registro es POSTERIOR a la baja hace falta saber
--     CUANDO fue la baja, y eso no se guardaba: `actualizado_en` cambia con
--     cualquier edicion. Columna nueva: `empleados.dado_de_baja_en`.
--
--     La bandera la pone la BASE (trigger), no el kiosco. Asi funciona
--     tambien con los kioscos que sigan en la version 1.0.1, y con cualquier
--     camino por el que entre una marca.
--
--  2. CAMARA QUE FALLA A RATOS.
--     Una camara que se va a descomponer no se muere de golpe: se desconecta
--     y se reconecta cada vez mas seguido. Cada desconexion ya quedaba en
--     `eventos_dispositivo` ('camara_desconectada'); faltaba contarlas. Dos
--     ajustes nuevos en Configuracion: cuantas desconexiones y en cuantos
--     dias. Sirve para cambiar la camara ANTES de que muera.
--
--  3. LOS AVISOS, EN UN SOLO LUGAR.
--     Las alertas vivian solo dentro de la pagina Kioscos, y habia que entrar
--     a buscarlas. `avisos_del_panel()` las junta todas; el panel las muestra
--     como un numero en el menu y una franja arriba de Asistencia (la pagina
--     donde cae el jefe al entrar). Una sola funcion para que el menu, la
--     franja y la pagina Kioscos digan exactamente lo mismo.


-- ============================================================================
--  1. CUANDO SE DIO DE BAJA A CADA PERSONA
-- ============================================================================

alter table empleados add column dado_de_baja_en timestamptz;

comment on column empleados.dado_de_baja_en is
  'Cuando se dio de baja (activo pasa a false). Vuelve a null si se reactiva. '
  'Lo llena el trigger empleados_anotar_baja; sirve para marcar los registros '
  'que llegan despues de la baja (bandera empleado_de_baja).';

create or replace function empleados_anotar_baja()
returns trigger
language plpgsql
as $$
begin
  if new.activo is distinct from old.activo then
    new.dado_de_baja_en := case when new.activo then null else now() end;
  end if;
  return new;
end;
$$;

create trigger empleados_anotar_baja
  before update of activo on empleados
  for each row execute function empleados_anotar_baja();

-- Los que YA estaban de baja: la fecha sale de la bitacora (el ultimo cambio
-- de activo a false). Si no aparece, la ultima actualizacion: es lo mejor
-- que se sabe. `app.sin_auditar` para que este relleno no llene la bitacora
-- de "cambios" que nadie hizo, y para que pase el candado de los anonimizados.
select set_config('app.sin_auditar', 'on', true);

update empleados e
   set dado_de_baja_en = coalesce(
         (select max(b.creado_en)
            from bitacora_auditoria b
           where b.tabla = 'empleados'
             and b.registro_id = e.id::text
             and b.accion = 'UPDATE'
             and (b.datos_antes ->> 'activo')::boolean is true
             and (b.datos_despues ->> 'activo')::boolean is false),
         e.actualizado_en)
 where not e.activo;

select set_config('app.sin_auditar', 'off', true);

-- El panel la puede leer (0024 da permiso columna por columna).
grant select (dado_de_baja_en) on empleados to authenticated;


-- ============================================================================
--  2. LA BANDERA empleado_de_baja
-- ============================================================================

alter table marcas drop constraint marcas_banderas_conocidas;
alter table marcas add constraint marcas_banderas_conocidas check (
  banderas <@ array[
    'sin_camara', 'foto_obstruida', 'foto_no_guardada', 'reloj_sospechoso',
    'dispositivo_revocado', 'manual', 'cierre_automatico',
    -- 0028
    'empleado_de_baja'
  ]::text[]
);

/*
  Solo para lo que llega de un KIOSCO. Un registro a mano lo captura un
  administrador a proposito (por ejemplo, el ultimo dia de alguien que ya se
  dio de baja): marcarlo seria pedirle que revise lo que el mismo acaba de
  hacer.

  Se compara contra la hora del REGISTRO (hora_estimada), no contra la hora en
  que llego: lo que importa es si la persona checo despues de su baja, no
  cuando hubo internet.
*/
create or replace function marcas_anotar_empleado_de_baja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baja timestamptz;
begin
  if new.origen = 'kiosco' then
    select dado_de_baja_en into v_baja
      from empleados
     where id = new.empleado_id and not activo;
    if v_baja is not null and new.hora_estimada >= v_baja
       and not ('empleado_de_baja' = any (new.banderas)) then
      new.banderas := array_append(new.banderas, 'empleado_de_baja');
    end if;
  end if;
  return new;
end;
$$;

create trigger marcas_anotar_empleado_de_baja
  before insert on marcas
  for each row execute function marcas_anotar_empleado_de_baja();


-- ============================================================================
--  3. AJUSTES NUEVOS (Configuracion -> Camara / Este panel)
-- ============================================================================

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('camara_desconexiones_alerta', '3'::jsonb,
   'Si la camara de un kiosco se desconecta esta cantidad de veces (o mas) en los ultimos dias de "camara_dias_desconexiones", el panel avisa que conviene revisarla o cambiarla.',
   'camara', 'entero', 2, 100, 'veces'),
  ('camara_dias_desconexiones', '7'::jsonb,
   'En cuantos dias hacia atras se cuentan las desconexiones de la camara para el aviso de camara que falla a ratos.',
   'camara', 'entero', 1, 60, 'dias'),
  ('dias_avisos_registros', '7'::jsonb,
   'Cuantos dias hacia atras se buscan registros por revisar (de personas dadas de baja, o en cuarentena) para los avisos del panel.',
   'panel', 'entero', 1, 90, 'dias')
on conflict (clave) do nothing;


-- ============================================================================
--  4. avisos_del_panel(): todo lo que hay que atender, en un solo lugar
-- ============================================================================
/*
  Un renglon por aviso:

    tipo            'kiosco_sin_conexion' | 'camara_caida' | 'camara_inestable'
                    | 'fotos_por_revisar' | 'registros_de_baja' | 'cuarentena'
    dispositivo_id  el kiosco (null en los avisos de registros)
    dispositivo     su nombre
    cantidad        cuantas desconexiones, fotos o registros (null si no aplica)
    desde           desde cuando (para "desde hace 20 min")

  Los TEXTOS los arma el panel: aqui solo los hechos.

  SECURITY INVOKER (lo normal): corre con los permisos de quien la llama, asi
  que la RLS de cada tabla sigue mandando. Alguien que no es administrador
  recibe cero avisos, no un error.
*/
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
           config_entero('kiosco_pc_compartida', 1) = 1             as pc_compartida
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
  select 'registros_de_baja', null, null, count(*)::integer, min(m.hora_estimada)
    from marcas m, cfg
   where 'empleado_de_baja' = any (m.banderas)
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

comment on function avisos_del_panel() is
  'Todo lo que el jefe deberia atender: kioscos sin conexion, camaras caidas o '
  'que fallan a ratos, fotos faltantes, registros de personas dadas de baja y '
  'en cuarentena. La usan el menu del panel, la franja de Asistencia y Kioscos.';

revoke all on function avisos_del_panel() from public, anon;
grant execute on function avisos_del_panel() to authenticated;


-- ============================================================================
--  5. BITACORA: que se note cuando cambia un PIN (y menos ruido de camaras)
-- ============================================================================
/*
  Para los filtros nuevos de la Bitacora ("Cambios de PIN"):

  El hash del PIN se guarda como "[oculto]" antes Y despues (bien: nunca debe
  quedar en la bitacora). Pero eso hacia que un cambio de PIN fuera
  INVISIBLE: "[oculto] -> [oculto]" no es diferencia. Solo se notaba si de
  paso cambiaba "PIN temporal", y no siempre cambia (dos reseteos seguidos).
  Ahora, si el hash cambio, el de despues se anota "[nuevo]". Sigue sin
  quedar el hash; solo queda el HECHO de que cambio.

  Y un arreglo de paso: cada vez que la camara de un kiosco caia o volvia,
  `camara_caida_desde` (0021) cambiaba y eso dejaba un renglon en la
  bitacora, como si alguien hubiera editado el kiosco. Ahora se ignora junto
  con las demas columnas del latido.

  Es la misma funcion de la 0017 con esos dos cambios.
*/
create or replace function auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fila_antes   jsonb;
  fila_despues jsonb;
  id_registro  text;
  ocultas constant text[] := array['pin_hash', 'token_hash', 'codigo_hash', 'contrasena_kiosco_hash'];
  del_latido constant text[] := array['ultima_conexion', 'version_app', 'camara_ok', 'pendientes',
                                      'desfase_reloj_ms', 'actualizado_en', 'camara_caida_desde'];
  columna      text;
begin
  if tg_table_name = 'empleados' and current_setting('app.sin_auditar', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', fila_despues ->> 'user_id', '?');
  elsif tg_op = 'UPDATE' then
    fila_antes   := to_jsonb(old);
    fila_despues := to_jsonb(new);
    id_registro  := coalesce(fila_despues ->> 'id', fila_despues ->> 'clave', fila_despues ->> 'user_id', '?');

    if tg_table_name = 'dispositivos' and (fila_antes - del_latido) = (fila_despues - del_latido) then
      return new;
    end if;
  else
    fila_antes  := to_jsonb(old);
    id_registro := coalesce(fila_antes ->> 'id', fila_antes ->> 'clave', fila_antes ->> 'user_id', '?');
  end if;

  foreach columna in array ocultas loop
    if fila_antes ? columna and fila_antes ->> columna is not null then
      fila_antes := jsonb_set(fila_antes, array[columna], '"[oculto]"'::jsonb);
    end if;
    if fila_despues ? columna and fila_despues ->> columna is not null then
      fila_despues := jsonb_set(fila_despues, array[columna],
        case when tg_op = 'UPDATE' and (to_jsonb(old) ->> columna) is distinct from (to_jsonb(new) ->> columna)
             then '"[nuevo]"'::jsonb else '"[oculto]"'::jsonb end);
    end if;
  end loop;

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  values (tg_table_name, id_registro, tg_op, fila_antes, fila_despues, actor_actual(),
          nullif(current_setting('app.motivo', true), ''));

  return coalesce(new, old);
end;
$$;
