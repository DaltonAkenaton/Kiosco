-- ============================================================================
--  0023 · PIN PROPIO  (D-042: "como en el cajero")
-- ============================================================================
--
--  Hasta ahora el PIN lo inventaba el sistema y el jefe se lo daba a cada
--  quien. Ese PIN lo vio el jefe (y quien estuviera cerca de la hoja): no es
--  secreto de nadie. Ahora:
--
--    1. Todo PIN que da el sistema (alta o "PIN nuevo") es TEMPORAL.
--    2. La primera vez que la persona checa con el, el kiosco guarda su
--       registro y LUEGO le ofrece elegir uno propio (puede decir "ahora no").
--    3. El kiosco manda aqui el HASH del PIN nuevo (nunca el PIN) y esta
--       funcion lo aplica, para que los demas kioscos lo reciban.
--
--  Si el PIN cambio entre medias (el jefe dio otro "PIN nuevo" antes de que
--  el cambio llegara), gana el del jefe: el cambio del kiosco se anota como
--  'descartado' y el kiosco recibe el PIN del jefe en la siguiente vuelta.

-- ------------------------------------------------------------------ 1. alta
-- Todo empleado nuevo nace con PIN temporal (alta_empleado no lo dice, toma
-- el valor por defecto). restablecer_pin ya lo marcaba asi desde la 0015.
alter table empleados alter column pin_temporal set default true;

-- Los que ya existen tienen un PIN que tambien invento el sistema: pasan a
-- temporales para que cada quien elija el suyo la proxima vez que cheque.
select set_config('app.motivo',
  'Migracion 0023: los PIN que dio el sistema pasan a temporales para que cada quien elija el suyo', true);
update empleados
   set pin_temporal = true
 where not pin_temporal
   and anonimizado_en is null;

-- -------------------------------------------------------------- 2. rastro
-- Cada cambio que llega de un kiosco. NO guarda el hash (ese vive en
-- empleados): solo quien, cuando, desde donde y si se aplico.
create table cambios_pin (
  -- Lo genera el kiosco, igual que las marcas: reintentar no duplica nada.
  id             uuid primary key,
  empleado_id    uuid not null references empleados (id),
  dispositivo_id uuid references dispositivos (id),
  cambiado_en    timestamptz not null,
  recibido_en    timestamptz not null default now(),
  resultado      text not null check (resultado in (
    'aplicado',    -- ya es su PIN en todos los kioscos
    'descartado'   -- el PIN habia cambiado entre medias (gano el del jefe)
  ))
);

create index cambios_pin_empleado_idx on cambios_pin (empleado_id, recibido_en desc);

alter table cambios_pin enable row level security;

create policy cambios_pin_leer on cambios_pin
  for select to authenticated
  using (puede_administrar());

-- Nadie lo escribe desde el panel: llega por la Edge Function del kiosco.
revoke insert, update, delete on cambios_pin from authenticated;

-- ------------------------------------------------------------ 3. recibir
/**
 * Los cambios de PIN de un lote del kiosco. La llama la Edge Function
 * `recibir-registros` (con service_role), junto con `recibir_registros`.
 * Devuelve { aceptados: [id...], rechazados: [{id, motivo}...] }, como aquella.
 */
create or replace function recibir_cambios_de_pin(
  p_dispositivo_id uuid,
  p_revocado_en    timestamptz,
  p_cambios        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aceptados  jsonb := '[]'::jsonb;
  v_rechazados jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_id         uuid;
  v_cuando     timestamptz;
  v_resultado  text;
  v_kiosco     text;
begin
  select d.nombre into v_kiosco from dispositivos d where d.id = p_dispositivo_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_cambios, '[]'::jsonb)) loop
    begin
      v_id     := (v_item ->> 'id')::uuid;
      v_cuando := (v_item ->> 'cambiadoEn')::timestamptz;

      -- Ya habia llegado (un reintento tras un corte): se confirma y ya.
      if exists (select 1 from cambios_pin c where c.id = v_id) then
        v_aceptados := v_aceptados || to_jsonb(v_id);
        continue;
      end if;

      if p_revocado_en is not null and v_cuando >= p_revocado_en then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'dispositivo_revocado');
        continue;
      end if;

      -- Solo hashes bcrypt: nunca un PIN en claro ni cualquier otra cosa.
      if coalesce(v_item ->> 'pinHash', '') !~ '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$'
         or coalesce(v_item ->> 'pinAnteriorHash', '') !~ '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$' then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_id, 'motivo', 'datos_invalidos');
        continue;
      end if;

      perform set_config('app.motivo',
        format('Eligió su PIN propio en el kiosco "%s"', coalesce(v_kiosco, '?')), true);

      -- Solo si su PIN sigue siendo el temporal con el que se identifico.
      update empleados
         set pin_hash = v_item ->> 'pinHash', pin_temporal = false
       where id = (v_item ->> 'empleadoId')::uuid
         and pin_temporal
         and pin_hash = v_item ->> 'pinAnteriorHash'
         and activo
         and anonimizado_en is null;
      v_resultado := case when found then 'aplicado' else 'descartado' end;

      insert into cambios_pin (id, empleado_id, dispositivo_id, cambiado_en, resultado)
      values (v_id, (v_item ->> 'empleadoId')::uuid, p_dispositivo_id, v_cuando, v_resultado);

      v_aceptados := v_aceptados || to_jsonb(v_id);
    exception
      when foreign_key_violation then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'empleado_desconocido');
      when others then
        v_rechazados := v_rechazados || jsonb_build_object('id', v_item ->> 'id', 'motivo', 'datos_invalidos');
    end;
  end loop;

  return jsonb_build_object('aceptados', v_aceptados, 'rechazados', v_rechazados);
end;
$$;

revoke all on function recibir_cambios_de_pin(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function recibir_cambios_de_pin(uuid, timestamptz, jsonb) to service_role;
