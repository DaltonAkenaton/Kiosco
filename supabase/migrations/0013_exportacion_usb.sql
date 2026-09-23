-- ============================================================================
--  0013 · EXPORTACION A USB DESDE EL KIOSCO  (cierre del bloque 3.b)
-- ============================================================================
--
--  El modo administrador del kiosco ya puede sacar registros y fotos a una
--  memoria USB (CLAUDE.md 5.2). Cada foto exportada llega a `accesos_foto`
--  con la accion 'exportar', que ya existia desde la 0010.
--
--  Lo nuevo es el evento de la exportacion ENTERA. Hace falta aparte porque
--  una exportacion puede no llevar ninguna foto (solo el CSV) y aun asi saca
--  datos personales del kiosco: nombres y horas de entrada y salida.
--
--  detalle: { adminId, registros, fotos, fotosConProblema, destino: 'usb'|'carpeta',
--             completa: false si la memoria se lleno o se quito a la mitad }
--  Nunca la ruta ni el nombre del archivo: pueden llevar el nombre de una
--  carpeta personal.
--
--  Como en la 0011 y la 0012: una migracion aplicada no se edita
--  (CLAUDE.md 16), se reemplaza la restriccion aqui.

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
    'modo_admin_abierto',
    'modo_admin_intento_fallido',
    'modo_admin_bloqueado',
    -- 0013
    'exportacion_usb'
  ));
