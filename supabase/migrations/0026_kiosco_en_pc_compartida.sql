-- ============================================================================
--  0026 · EL KIOSCO EN UNA PC COMPARTIDA  (29-09-2026)
-- ============================================================================
--
--  El maestro aclaro como se va a usar: la PC NO es solo para checar. El
--  personal abre el kiosco, registra y lo cierra; en el resto del dia la
--  computadora se usa para otras cosas. Eso cambia el comportamiento:
--
--    kiosco_pc_compartida = 1  (por defecto)
--      - el kiosco NO se abre solo al prender Windows (se abre con el icono);
--      - tiene un boton "Cerrar kiosco" (no "Usar esta PC" por 15 minutos);
--      - antes de cerrarse manda lo pendiente;
--      - las versiones nuevas se instalan al cerrarlo (no de madrugada);
--      - en el panel, un kiosco cerrado NO es alerta: es lo normal.
--
--    kiosco_pc_compartida = 0
--      - PC solo para checar: se abre sola, pantalla completa todo el dia,
--        no se deja cerrar, alertas si deja de reportarse.
--
--  Es un ajuste del jefe (tabla configuracion), no del programador: si algun
--  dia ponen una PC solo para checar, se cambia desde el panel.

insert into configuracion (clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad) values
  ('kiosco_pc_compartida', '1'::jsonb,
   'Si vale 1, la PC del kiosco se usa tambien para otras cosas: el kiosco se abre con su icono, se cierra al terminar y un kiosco cerrado no es alerta. Con 0, la PC es solo para checar y el kiosco se queda abierto todo el dia.',
   'dispositivos', 'entero', 0, 1, '')
on conflict (clave) do nothing;
