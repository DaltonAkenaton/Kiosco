-- ============================================================================
--  0025 · EVENTO NUEVO DEL KIOSCO: registros_descartados  (29-09-2026)
-- ============================================================================
--
--  En el modo administrador del kiosco se pueden DESCARTAR los registros que
--  la oficina no acepto (por ejemplo, pruebas hechas con el kiosco dado de
--  baja). En el kiosco no se borran: dejan de mostrarse y de reenviarse.
--
--  Para que eso no sea "desaparecer asistencia en silencio" (ARQUITECTURA.md 3.3),
--  el kiosco manda este evento con quien lo hizo (adminId), cuantos fueron y
--  el motivo que escribio. El panel lo muestra en la pagina Kioscos, en "Lo
--  que se hizo en los kioscos".
--
--  La lista de tipos de evento es CERRADA (0006): cada tipo nuevo necesita
--  una migracion como esta. Se copia la lista completa de 0017 y se agrega.

alter table eventos_dispositivo drop constraint eventos_dispositivo_tipo_check;
alter table eventos_dispositivo add constraint eventos_dispositivo_tipo_check
  check (tipo in (
    'camara_desconectada', 'camara_reconectada', 'kiosco_pausado', 'kiosco_reanudado',
    'reloj_sospechoso', 'arranque', 'error_sincronizacion',
    'llave_fotos_creada', 'llave_fotos_reemplazada', 'recuperacion_fotos_definida',
    'cifrado_no_disponible', 'fotos_depuradas', 'fotos_heredadas_cifradas',
    'modo_admin_abierto', 'modo_admin_intento_fallido', 'modo_admin_bloqueado',
    'exportacion_usb',
    -- 0017
    'fotos_recuperadas',
    -- 0025
    'registros_descartados'
  ));
