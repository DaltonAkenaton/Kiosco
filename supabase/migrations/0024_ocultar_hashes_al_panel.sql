-- ============================================================================
--  0024 · EL PANEL NO PUEDE LEER LOS HASHES  (auditoria del panel, 27-09-2026)
-- ============================================================================
--
--  RLS decide QUE RENGLONES ve cada quien, pero no QUE COLUMNAS. Hasta ahora
--  cualquier cuenta del panel (tambien un supervisor) podia pedir, desde la
--  consola del navegador:
--
--      bd.from('empleados').select('usuario, pin_hash')
--
--  y recibir el hash de cada PIN. Un PIN de 4 digitos tiene 10 000
--  posibilidades: con el hash en la mano se prueba cada una en segundos, sin
--  que nadie se entere. Resultado: el supervisor sabria el PIN de todos y
--  podria checar por cualquiera. Lo mismo, mas lento, con la contrasena del
--  modo administrador del kiosco de los demas administradores.
--
--  El panel nunca necesito esas columnas: el PIN lo genera y lo compara la
--  base (funciones `security definer`) y los kioscos lo reciben por la Edge
--  Function (service_role). Asi que el rol `authenticated` deja de poder
--  leerlas. Las funciones, los triggers y service_role no cambian.
--
--  COMO: en PostgreSQL no basta con quitar una columna si el rol tiene
--  permiso sobre la tabla entera. Se quita el permiso de leer la tabla y se
--  da columna por columna, todas menos la del hash.
--
--  SI UN DIA SE AGREGA UNA COLUMNA a estas tablas y el panel la necesita,
--  hay que darle permiso aqui abajo (grant select (columna)...). Si no, el
--  panel recibe "permission denied" al pedirla.

revoke select on empleados from authenticated, anon;
grant select (id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno,
              pin_temporal, activo, foto_referencia_path, creado_en, actualizado_en, anonimizado_en)
  on empleados to authenticated;

revoke select on administradores from authenticated, anon;
grant select (user_id, nombre, rol, activo, creado_en, actualizado_en, usuario_kiosco,
              correo, debe_cambiar_contrasena)
  on administradores to authenticated;
