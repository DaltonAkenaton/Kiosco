/**
 * ============================================================================
 *  MIGRACIONES DE LA BASE DE DATOS LOCAL
 * ============================================================================
 *
 *  ¿Que es una migracion?
 *  ----------------------
 *  Un cambio en la ESTRUCTURA de la base de datos (crear una tabla, agregar
 *  una columna), numerado y guardado para siempre.
 *
 *  ¿Por que no simplemente crear las tablas al arrancar?
 *  -----------------------------------------------------
 *  Porque el kiosco ya instalado tiene datos. Cuando saques la version 2 con
 *  una columna nueva, no puedes borrar la base y crearla de nuevo: te
 *  llevarias por delante las marcas que todavia no se han sincronizado.
 *
 *  Con migraciones, cada kiosco aplica SOLO lo que le falta:
 *
 *      kiosco A (recien instalado)  -> aplica 1, 2, 3
 *      kiosco B (venia de la v1)    -> aplica solo 3
 *      kiosco C (ya al dia)         -> no aplica nada
 *
 *  ---------------------------------------------------------------------------
 *  LAS DOS REGLAS DE ORO DE LAS MIGRACIONES
 *  ---------------------------------------------------------------------------
 *
 *  1. UNA MIGRACION YA PUBLICADA NUNCA SE EDITA.
 *     Si te equivocaste, agregas otra migracion que lo corrige.
 *     ¿Por que? Porque los kioscos que ya la aplicaron no la van a volver a
 *     aplicar. Editarla significa que cada maquina tendra una estructura
 *     distinta segun cuando se instalo, y eso es imposible de depurar.
 *
 *  2. EL ORDEN NUNCA CAMBIA Y LOS NUMEROS NO SE REUTILIZAN.
 *     El numero es la identidad de la migracion.
 *
 *  Estas mismas reglas aplican a las migraciones de Supabase (CLAUDE.md 16).
 */

export interface Migracion {
  /** Numero consecutivo. Nunca se reutiliza ni se reordena. */
  version: number;
  /** Para que sirve, en una linea. Aparece en el log al aplicarse. */
  descripcion: string;
  /** El SQL. Puede tener varias sentencias separadas por punto y coma. */
  sql: string;
}

/**
 * La lista completa, en orden.
 *
 * Cuando necesites cambiar la estructura: agrega un objeto NUEVO al final.
 * Nunca toques los de arriba.
 */
export const MIGRACIONES: Migracion[] = [
  {
    version: 1,
    descripcion: 'Estructura inicial: empleados, marcas, outbox y estado local',
    sql: `
      -- ====================================================================
      --  empleados_cache
      -- ====================================================================
      --  Copia local de los empleados, para poder validar SIN INTERNET.
      --  Se llama "cache" porque la verdad vive en Supabase: esto es un
      --  reflejo que se refresca al sincronizar.
      CREATE TABLE empleados_cache (
        id                TEXT PRIMARY KEY,      -- UUID que viene del servidor
        usuario           TEXT NOT NULL UNIQUE,  -- "dgomez"
        numero_empleado   TEXT,                  -- del gafete; puede no existir
        nombre            TEXT NOT NULL,
        apellido_paterno  TEXT NOT NULL,
        apellido_materno  TEXT NOT NULL DEFAULT '',
        pin_hash          TEXT NOT NULL,         -- bcrypt. NUNCA el PIN.
        pin_temporal      INTEGER NOT NULL DEFAULT 0,  -- SQLite no tiene boolean
        activo            INTEGER NOT NULL DEFAULT 1,
        actualizado_en    TEXT NOT NULL
      );

      -- El indice hace que buscar por usuario sea instantaneo.
      -- Con 5 empleados da igual, pero cuesta nada y el dia que sean 200
      -- la diferencia se nota en el tiempo de respuesta del kiosco.
      CREATE INDEX idx_empleados_usuario ON empleados_cache (usuario);
      CREATE INDEX idx_empleados_activo  ON empleados_cache (activo);

      -- ====================================================================
      --  marcas
      -- ====================================================================
      --  Los registros de entrada y salida. INMUTABLES (CLAUDE.md 8):
      --  una vez escrita, una marca no se modifica ni se borra jamas.
      --  Las correcciones se guardan aparte, sin tocar el original.
      CREATE TABLE marcas (
        -- UUID generado AQUI, en el kiosco. Es lo que permite reintentar la
        -- subida mil veces sin duplicar (insercion idempotente en el servidor).
        id                    TEXT PRIMARY KEY,
        empleado_id           TEXT NOT NULL,
        usuario               TEXT NOT NULL,
        tipo                  TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
        origen                TEXT NOT NULL DEFAULT 'kiosco',

        -- --- Lecturas de reloj (CLAUDE.md 6) ---
        -- Se guardan varias mediciones distintas para poder detectar despues
        -- si alguien movio la hora de Windows.
        hora_dispositivo_ms   INTEGER NOT NULL,  -- Date.now() del momento
        monotonico_ms         INTEGER NOT NULL,  -- cronometro que no se puede tocar
        arranque_id           TEXT NOT NULL,     -- sesion de la app
        desfase_servidor_ms   INTEGER NOT NULL DEFAULT 0,
        hora_estimada_ms      INTEGER NOT NULL,  -- la mejor estimacion que tenemos

        -- Banderas separadas por coma. SQLite no tiene arreglos; en Postgres
        -- esto sera un text[] de verdad.
        banderas              TEXT NOT NULL DEFAULT '',

        foto_ruta_local       TEXT,              -- NULL si no hubo camara
        foto_subida           INTEGER NOT NULL DEFAULT 0,
        creado_en             TEXT NOT NULL
      );

      CREATE INDEX idx_marcas_empleado ON marcas (empleado_id, hora_estimada_ms);

      -- ====================================================================
      --  ultimas_marcas_cache
      -- ====================================================================
      --  La ultima marca conocida de cada empleado, para SUGERIR la accion
      --  (si la ultima fue entrada, lo siguiente probablemente es salida).
      --
      --  Se guarda aparte en vez de consultarla de la tabla marcas, porque
      --  tiene que reflejar las marcas hechas en OTRO kiosco, que llegan al
      --  sincronizar y nunca estuvieron en esta tabla local.
      CREATE TABLE ultimas_marcas_cache (
        empleado_id      TEXT PRIMARY KEY,
        tipo             TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
        hora_estimada_ms INTEGER NOT NULL
      );

      -- ====================================================================
      --  outbox  (bandeja de salida)
      -- ====================================================================
      --  Lo que falta subir a la nube. Es el corazon del funcionamiento sin
      --  internet: la marca se guarda aqui y el empleado ya se puede ir.
      --  Que la red funcione o no deja de ser su problema.
      CREATE TABLE outbox (
        id              TEXT PRIMARY KEY,   -- mismo UUID que la marca
        tipo_registro   TEXT NOT NULL,      -- 'marca' | 'evento'
        payload         TEXT NOT NULL,      -- JSON
        intentos        INTEGER NOT NULL DEFAULT 0,
        ultimo_error    TEXT,
        creado_en       TEXT NOT NULL,
        sincronizado_en TEXT                -- NULL = todavia pendiente
      );

      -- Indice parcial: solo las filas pendientes. El sincronizador pregunta
      -- "que falta subir" cada 30 segundos, y con esto no recorre el historico.
      CREATE INDEX idx_outbox_pendientes
        ON outbox (creado_en) WHERE sincronizado_en IS NULL;

      -- ====================================================================
      --  intentos_pin
      -- ====================================================================
      --  Intentos fallidos por empleado, para el bloqueo temporal.
      CREATE TABLE intentos_pin (
        empleado_id         TEXT PRIMARY KEY,
        fallidos            INTEGER NOT NULL DEFAULT 0,
        ultimo_intento_ms   INTEGER NOT NULL,
        bloqueado_hasta_ms  INTEGER
      );

      -- ====================================================================
      --  configuracion_cache y estado_local
      -- ====================================================================
      --  Almacen simple de clave/valor. Se usa para la configuracion que baja
      --  de Supabase y para el estado interno del kiosco.
      CREATE TABLE configuracion_cache (
        clave  TEXT PRIMARY KEY,
        valor  TEXT NOT NULL
      );

      CREATE TABLE estado_local (
        clave  TEXT PRIMARY KEY,
        valor  TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    descripcion: 'Fotos cifradas: hash en la marca y ciclo de vida en su propia tabla',
    sql: `
      -- ====================================================================
      --  marcas.foto_hash
      -- ====================================================================
      --  El SHA-256 del JPEG. Es EVIDENCIA, igual que la hora: se escribe al
      --  crear la marca y no cambia nunca. Es lo unico de la foto que viaja a
      --  la nube (CLAUDE.md 5.1).
      --
      --  La vieja columna foto_ruta_local queda, pero ya no se escribe: la
      --  usan solo las marcas anteriores a esta version, hasta que
      --  migrarFotosHeredadas() cifra sus fotos.
      ALTER TABLE marcas ADD COLUMN foto_hash TEXT;

      -- ====================================================================
      --  fotos: el CICLO DE VIDA de cada foto
      -- ====================================================================
      --  ¿Por que aparte y no en columnas de marcas? Porque la marca es
      --  inmutable y la foto no: se borra a los 30 dias, un administrador la
      --  marca "Conservar", se le quita la marca... Todo eso cambia; lo que
      --  la marca dice (quien, cuando, y la huella de la foto) no.
      CREATE TABLE fotos (
        marca_id          TEXT PRIMARY KEY REFERENCES marcas (id),
        -- Relativa a la carpeta de datos: "fotos/2026/09/<uuid>.jpg.enc".
        -- Relativa para que el disco se pueda leer desde otra PC, donde la
        -- carpeta de datos no esta en la misma ruta.
        ruta_relativa     TEXT NOT NULL,
        llave_id          TEXT NOT NULL,
        creado_en         TEXT NOT NULL,

        -- "Conservar" (casos en disputa): no se borra hasta que se quite.
        conservar         INTEGER NOT NULL DEFAULT 0,
        conservar_motivo  TEXT,
        conservar_por     TEXT,
        conservar_en      TEXT,

        -- Cuando se borro por antiguedad. NULL = sigue en disco.
        eliminada_en      TEXT
      );
    `,
  },
  {
    version: 3,
    descripcion: 'Modo administrador: credenciales para validar sin internet y bitacora de fotos',
    sql: `
      -- ====================================================================
      --  administradores_cache
      -- ====================================================================
      --  Igual que los PINes: los hashes bajan en la sincronizacion para
      --  poder validar SIN INTERNET (CLAUDE.md 5.2). Nunca la contrasena.
      CREATE TABLE administradores_cache (
        id               TEXT PRIMARY KEY,     -- el user_id de la nube
        usuario          TEXT NOT NULL UNIQUE,
        nombre           TEXT NOT NULL,
        contrasena_hash  TEXT NOT NULL,        -- bcrypt
        rol              TEXT NOT NULL CHECK (rol IN ('admin', 'supervisor')),
        activo           INTEGER NOT NULL DEFAULT 1,
        actualizado_en   TEXT NOT NULL
      );

      -- ====================================================================
      --  accesos_foto: QUIEN miro o toco QUE foto, y CUANDO
      -- ====================================================================
      --  Espejo de la tabla de la nube (0010). Cada fila entra tambien a la
      --  bandeja de salida: el rastro no debe vivir solo en la maquina que
      --  lo produce (CLAUDE.md 12). Nunca se borra ni se edita.
      CREATE TABLE accesos_foto (
        id             TEXT PRIMARY KEY,
        marca_id       TEXT NOT NULL,
        admin_id       TEXT NOT NULL,
        accion         TEXT NOT NULL
                         CHECK (accion IN ('ver', 'exportar', 'conservar', 'quitar_conservar')),
        consultado_en  TEXT NOT NULL
      );

      CREATE INDEX idx_accesos_foto_marca ON accesos_foto (marca_id);
    `,
  },
  {
    version: 4,
    descripcion: 'Sincronizacion: lo que la nube rechaza sale de la cola sin borrarse',
    sql: `
      -- ====================================================================
      --  outbox.rechazado_en
      -- ====================================================================
      --  La nube puede rechazar algo PARA SIEMPRE: la marca de un empleado
      --  que alla no existe, o una marca hecha despues de que el kiosco se
      --  dio de baja. Reintentarlo cada 30 segundos no lo arregla nunca.
      --
      --  Esos renglones salen de la cola (ya no cuentan como "por enviar")
      --  pero NO se borran: quedan con la fecha y el motivo en ultimo_error,
      --  para que alguien los revise. Borrarlos seria perder asistencia en
      --  silencio (CLAUDE.md 3.3).
      ALTER TABLE outbox ADD COLUMN rechazado_en TEXT;
    `,
  },
  {
    version: 5,
    descripcion: 'Descartar rechazados: se ocultan con motivo, nunca se borran',
    sql: `
      -- ====================================================================
      --  outbox.descartado_en / descartado_motivo  (29-09-2026)
      -- ====================================================================
      --  Un administrador puede DESCARTAR lo que la nube rechazo (por ejemplo,
      --  pruebas hechas con el kiosco dado de baja). Descartar NO borra: el
      --  renglon se queda, con fecha y motivo, y deja de mostrarse y de
      --  poder reenviarse. Ademas se avisa a la oficina (evento
      --  'registros_descartados'), para que el jefe sepa quien, cuando,
      --  cuantos y por que. Nada se descarta en silencio (CLAUDE.md 3.3).
      ALTER TABLE outbox ADD COLUMN descartado_en TEXT;
      ALTER TABLE outbox ADD COLUMN descartado_motivo TEXT;
    `,
  },
];
