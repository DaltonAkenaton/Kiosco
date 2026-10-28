-- ============================================================================
--  0012 · MODO ADMINISTRADOR DEL KIOSCO  (bloque 3.b)
-- ============================================================================
--
--  El kiosco ya tiene modo administrador (ARQUITECTURA.md 5.2), y deja rastro de dos
--  cosas que la nube todavia no sabia recibir:
--
--  1. "Conservar" una foto (y quitarselo). Es una decision sobre la evidencia
--     de un caso en disputa: quien la tomo y cuando tiene que quedar igual de
--     registrado que quien miro la foto. Va a `accesos_foto`, junto a 'ver' y
--     'exportar', porque responde la misma pregunta: quien toco esta foto.
--
--  2. Entradas al modo administrador, cada intento fallido (el kiosco le dice
--     a quien falla "quedo registrado", y aqui es donde queda) y las esperas
--     por muchos fallos seguidos. Van a `eventos_dispositivo`: describen la
--     maquina, no a un empleado. Nunca el usuario tecleado ni la contrasena.
--
--  Como en la 0011: una migracion aplicada no se edita (ARQUITECTURA.md 14), se
--  reemplazan las restricciones aqui.

alter table accesos_foto drop constraint accesos_foto_accion_check;

alter table accesos_foto add constraint accesos_foto_accion_check
  check (accion in (
    'ver',               -- la abrio en la pantalla de auditoria del kiosco
    'exportar',          -- salio en un ZIP a USB
    -- 0012
    'conservar',         -- se marco "Conservar": no se borra a los 30 dias
    'quitar_conservar'   -- se le quito: vuelve al plazo normal
  ));

alter table eventos_dispositivo drop constraint eventos_dispositivo_tipo_check;

alter table eventos_dispositivo add constraint eventos_dispositivo_tipo_check
  check (tipo in (
    'camara_desconectada',
    'camara_reconectada',
    'kiosco_pausado',
    'kiosco_reanudado',
    'reloj_sospechoso',
    'arranque',
    'error_sincronizacion',
    -- 0011
    'llave_fotos_creada',
    'llave_fotos_reemplazada',
    'recuperacion_fotos_definida',
    'cifrado_no_disponible',
    'fotos_depuradas',
    'fotos_heredadas_cifradas',
    -- 0012
    'modo_admin_abierto',          -- detalle: { adminId }
    'modo_admin_intento_fallido',  -- detalle: { fallidosSeguidos }
    'modo_admin_bloqueado'         -- muchos fallos seguidos: espera  <- revisar
  ));
