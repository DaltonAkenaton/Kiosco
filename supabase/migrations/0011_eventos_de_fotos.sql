-- ============================================================================
--  0011 · EVENTOS DE FOTOS  (bloque 3.b)
-- ============================================================================
--
--  El kiosco ahora cifra sus fotos, las borra a los 30 dias y maneja una llave
--  con contrasena de recuperacion (CLAUDE.md 5.1). Todo eso deja constancia en
--  `eventos_dispositivo`, y la lista de tipos es CERRADA (0006): un tipo que
--  la nube no conoce seria rechazado al sincronizar, y el kiosco lo
--  reintentaria para siempre.
--
--  Por que no se edita la 0006: una migracion aplicada no se toca nunca
--  (CLAUDE.md 16). Se reemplaza la restriccion aqui.
--
--  Lo que dicen los tipos nuevos, para quien lea el panel:
--
--    llave_fotos_creada           primera llave de cifrado de ese kiosco.
--    llave_fotos_reemplazada      Windows ya no abria la llave (otra PC u otro
--                                 perfil). Las fotos anteriores solo se leen
--                                 con la contrasena de recuperacion.  <- revisar
--    recuperacion_fotos_definida  se definio o cambio la contrasena de
--                                 recuperacion.
--    cifrado_no_disponible        Windows no ofrece cifrado: se registra, pero
--                                 SIN foto.                           <- revisar
--    fotos_depuradas              se borraron fotos por antiguedad (cuantas).
--    fotos_heredadas_cifradas     se cifraron fotos que una version anterior
--                                 dejo en claro.
--
--  Igual que en la 0006: el detalle describe la MAQUINA. Ningun evento lleva
--  rutas de fotos, nombres ni la llave.

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
    'fotos_heredadas_cifradas'
  ));
