-- ============================================================================
--  0027 · RESPALDO DESDE EL PANEL  (01-10-2026)
-- ============================================================================
--
--  El respaldo automatico vive en GitHub (Actions, lunes y jueves). Pero el
--  jefe nunca va a entrar a GitHub, y ese respaldo depende de un token que
--  vence y de tareas que GitHub apaga a los 60 dias sin cambios. Por eso el
--  panel tiene ademas un boton: Configuracion -> Respaldo -> Descargar
--  respaldo, que baja el mismo Excel (una hoja por tabla) en el momento.
--
--  El panel lee las tablas con los permisos que ya tiene (RLS: un
--  administrador ve todo; los hashes estan fuera desde 0024). Lo unico que
--  falta en la base es DEJAR CONSTANCIA: son datos personales de todo el
--  personal, y quien se los lleva tiene que quedar en la bitacora, igual que
--  quien exporta los datos de una persona (ARCO, 0017).
--
--  El panel llama a esta funcion ANTES de bajar nada: si no se pudo anotar,
--  no hay respaldo.

create or replace function registrar_descarga_respaldo(p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not puede_administrar() then
    raise exception 'Sólo un administrador puede descargar el respaldo';
  end if;
  perform exigir_motivo(p_motivo);

  insert into bitacora_auditoria (tabla, registro_id, accion, datos_antes, datos_despues, actor, motivo)
  values ('respaldo', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'INSERT', null,
          jsonb_build_object('respaldo', 'descarga_desde_el_panel'), actor_actual(), trim(p_motivo));
end;
$$;

comment on function registrar_descarga_respaldo(text) is
  'Deja en la bitacora quien descargo el respaldo completo desde el panel, '
  'cuando y por que. Solo administradores. El panel la llama antes de bajar '
  'las tablas.';

revoke all on function registrar_descarga_respaldo(text) from public, anon;
grant execute on function registrar_descarga_respaldo(text) to authenticated;
