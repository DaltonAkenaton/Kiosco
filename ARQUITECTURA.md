# Arquitectura — Sistema de Control de Asistencia (Offline-First)

> Especificación técnica con la que se construyó el sistema: restricciones,
> reglas de seguridad, modelo de datos y convenciones. Las decisiones con sus
> alternativas descartadas están en [`docs/decisiones.md`](docs/decisiones.md).
> El código cita esta especificación por número de sección ("ARQUITECTURA.md 5.1").

## 1. Contexto

- Kiosco de asistencia para el personal de limpieza y los veladores de una facultad universitaria.
- La facultad **no tiene departamento de TI**. El sistema debe poder mantenerse con documentación, sin su autor presente.
- Las computadoras **cambian con frecuencia** y puede haber **varios kioscos** a la vez. Toda PC es reemplazable.
- Internet y luz fallan ocasionalmente. **Regla de oro: nunca crear cuellos de botella ni impedir que alguien registre.**
- El diseño contempla la prevención de marcajes irregulares o inconsistencias de horario. La seguridad debe asumir usuarios con acceso físico al kiosco.
- Prioridad: un MVP sólido y configurable, que se ajusta viéndolo funcionar.

### 1.1 Decisiones de arquitectura
- **Arquitectura híbrida:**
  - **Las fotos NUNCA salen del kiosco.** Se guardan cifradas en la PC y sólo se
    ven desde el modo administrador del propio kiosco (sección 5.2).
  - **Los registros sí van a la nube** (empleado, hora, tipo, banderas y el
    **hash** de la foto), para que el jefe revise desde su oficina.
  - La sincronización es un **módulo separado que se puede apagar**. Si se
    decide que todo sea local, se desactiva sin rehacer nada.
- Escala pequeña: evitar sobreingeniería. Sin firma criptográfica por
  dispositivo y sin fotos de referencia en la v1.
- **Fotos:** cifradas en disco, se borran automáticamente a los 30 días (plazo
  configurable), salvo las marcadas como "Conservar" por un administrador.
- **Veladores incluidos desde la v1.** El turno nocturno que cruza medianoche
  es obligatorio, no opcional.
- **Registros de asistencia:** se conservan (pesan muy poco). Respaldos periódicos fuera de Supabase, en volcado SQL y en CSV/Excel.

### 1.2 Valores por defecto configurables
Lo que no viene definido de antemano se decide con criterio, se documenta y se
deja **configurable desde el panel**:

| Supuesto | Valor por defecto | Dónde se cambia |
|---|---|---|
| Turnos | 06:00–14:00, 14:00–22:00, 22:00–06:00 | panel → Turnos |
| Días laborales | L–V, + sábado matutino | panel → Asignaciones |
| Tolerancia de retardo | 10 min | tabla `configuracion` |
| Minutos para falta | 30 min | tabla `configuracion` |
| Salida a comer | no se registra | opción prevista en el modelo |
| Reportes | informan, no descuentan | decisión de diseño |
| Cierre automático | 16 h | tabla `configuracion` |
| Número de empleado / PIN | número obligatorio, 4 a 12 letras o números; PIN de 4 dígitos | `configuracion.ts` |
| Intentos / bloqueo | 5 intentos / 5 min | tabla `configuracion` |
| Retención de fotos | 30 días | tabla `configuracion` |
| Veladores | incluidos, turno nocturno obligatorio | panel → Turnos |
| Fotos | sólo en el kiosco, cifradas; a la nube va el hash | `SINCRONIZACION.subirFotos` |
| Identificación | número de empleado (o lista numerada) | panel → Configuración (`identificar_con_numero`) |
| PC del kiosco | compartida (se puede apartar un rato) | `CONFIG.pausa.permitida` |

Se incluye un turno que **cruza la medianoche** a propósito, para que el cálculo de jornadas y los cambios de horario queden resueltos desde el inicio y no como un parche al final.

**Regla:** ningún supuesto puede quedar escrito en el código. Si no es configurable, no es un supuesto: es una invención.

### 1.3 Principio rector: configurable por el jefe, no por el programador
Cualquier regla de negocio que pueda cambiar (tolerancias, horarios, minutos para falta, días de retención, textos) se ajusta **desde el panel administrativo**, sin recompilar ni reinstalar nada.

Regla para decidir dónde vive un valor:

| Tipo | Dónde vive | Quién lo cambia | Ejemplos |
|---|---|---|---|
| Regla de negocio | Tabla `configuracion` / `turnos` en Supabase | El jefe, desde el panel | tolerancia, minutos para falta, retención de fotos, horarios |
| Identidad visual | `packages/compartido/src/tema.json` | El programador | colores institucionales, logo |
| Estructural | `packages/compartido/src/configuracion.ts` | El programador | largo del PIN, costo de bcrypt, intervalos de sincronización |

El kiosco recibe la configuración operativa en la sincronización y la guarda en
`configuracion_cache` para seguir funcionando sin internet.

## 2. Stack

| Capa | Tecnología |
|---|---|
| Kiosco (UI) | Angular (standalone components, signals) + Tailwind CSS |
| Escritorio | Electron + electron-builder (instalador NSIS) + electron-updater |
| BD local | SQLite con `node:sqlite` (incluido en Node/Electron; sin compilación nativa — ver decisión D-013) |
| Nube | Supabase: PostgreSQL, Auth (solo administradores), Edge Functions. **Sin Storage: las fotos no salen del kiosco** |
| Panel admin | App Angular separada, armada en GitHub Actions y publicada en Cloudflare (Workers con archivos estáticos), conectada a Supabase |

Estructura del monorepo:

```
/apps/kiosco-ui        Angular del kiosco (renderer)
/apps/kiosco-main      Proceso principal de Electron + preload
/apps/panel            Angular del panel administrativo
/packages/compartido   Configuración, tema y tipos usados por todos
/supabase              migraciones SQL, políticas RLS, Edge Functions
/docs                  manuales (jefe, técnico, empleados) y registro de decisiones
```

## 3. Reglas de seguridad OBLIGATORIAS

### 3.1 Electron
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` en toda ventana.
- El renderer (Angular) **nunca** accede a Node, SQLite ni al sistema de archivos.
- Comunicación solo vía `preload` + `contextBridge` + `ipcRenderer.invoke`.
- Exponer **operaciones específicas** (ej. `registrarMarca`, `obtenerEstado`), jamás genéricas (`ejecutarSQL`, `leerArchivo`).
- Todo handler `ipcMain.handle` valida tipos y rangos de entrada (usar zod o validación equivalente).
- Content-Security-Policy estricta. Bloquear navegación externa (`will-navigate`) y nuevas ventanas (`setWindowOpenHandler` → deny).
- `session.setPermissionRequestHandler`: permitir solo `media` (cámara) y denegar todo lo demás.
- Menú y DevTools deshabilitados en producción.

### 3.2 Supabase
- **La `service_role` key NUNCA va en el kiosco ni en el panel.** Solo en Edge Functions.
- Todo lo empaquetado en el `.exe` se considera público.
- RLS activado en **todas** las tablas. Por defecto: sin acceso.
- El kiosco **no usa Supabase Auth** ni consulta tablas directamente. Solo llama Edge Functions enviando su token de dispositivo en un header. La Edge Function valida el token contra `dispositivos` (comparando hash) y opera con service_role.
- El panel usa Supabase Auth (correo + contraseña) y RLS basado en la tabla `administradores`.
- No existen permisos de `UPDATE` ni `DELETE` sobre `marcas` para ningún rol.

### 3.3 Dispositivos (kioscos)
- Alta mediante **código de enrolamiento de un solo uso** generado en el panel (8 caracteres, expira en 15 min).
- Al enrolar, el servidor entrega un token aleatorio largo. Se guarda en el servidor **solo su hash**.
- En el kiosco el token se guarda cifrado con `safeStorage` de Electron (DPAPI de Windows). Si se copia a otra PC no se puede descifrar: esto es intencional.
- Baja/revocación desde el panel. Tokens revocados son rechazados.
- Marcas de un dispositivo revocado cuyo evento sea anterior a la revocación: se aceptan **en cuarentena** con bandera para revisión, nunca se descartan en silencio.
- Dispositivos no registrados: **rechazados** (la disponibilidad la cubre el registro manual del jefe).

### 3.4 PIN
- El modo de identificación es configurable: `'numero'` (número de empleado),
  `'lista'` (elige su nombre de una lista numerada, con selección de dos
  dígitos) o `'usuario'` (primera letra del nombre + apellido paterno:
  "dgomez", requiere teclado completo). La pantalla se adapta sola a los tres.
  El jefe lo elige en el panel (`identificar_con_numero`: 1 = `'numero'`,
  0 = `'lista'`); el de `configuracion.ts` es sólo el de arranque.
- Modo en uso: **número de empleado**. Puede llevar letras ("A12345"): largo
  variable + Enter, comparado en mayúsculas (`normalizarNumeroEmpleado`).
- El número se revisa **antes** del PIN (`revisarNumeroEmpleado`). Uno que no
  existe no pasa al PIN ("No hay nadie con el número…"). Se acepta revelar si un
  número existe: lo que protege es el PIN (bloqueo y retardo). Nunca se muestra
  el **nombre** antes del PIN; después, sólo nombre e inicial ("Dalton G."),
  nunca el nombre completo.
- PIN almacenado solo como hash bcrypt (compatible entre `pgcrypto crypt()/gen_salt('bf')` y `bcryptjs` en el main).
- Los hashes bajan al kiosco en la sincronización para validar offline. La verificación ocurre en el proceso main.
- Bloqueo temporal por empleado tras N intentos fallidos (configurable) y retardo creciente.
- El PIN identifica; **la foto es la evidencia**. No sobreinvertir en proteger el PIN.

## 4. Flujo del kiosco (UX)

1. Pantalla principal: video en vivo de la cámara (espejo), reloj grande y captura del número de empleado. El estado de conexión y los registros pendientes se ven en el modo administrador.
2. Empleado teclea número de empleado + PIN.
3. Al validar, **en ese instante**: se captura timestamp, lecturas de reloj y foto.
4. Pantalla de confirmación: "Hola, [Nombre] — Registrando **ENTRADA** 06:02".
   - La acción (entrada/salida) se **sugiere** según la última marca conocida del empleado.
   - Botón visible para cambiar la acción y botón para cancelar.
   - Si no toca nada, se confirma automáticamente a los 5 segundos
     (configurable; empezó en 3 y se subió al probarlo: con 3 daba tiempo de
     leer, pero no de leer, notar el error y alcanzar a corregirlo).
5. Mensaje de éxito breve y regreso a la pantalla principal.

Requisitos:
- Todo el flujo debe funcionar 100% offline y responder en menos de 1 segundo. La red nunca bloquea la UI.
- Foto: **640×480**, JPEG calidad ~0.7 (60–80 KB). Ver sección 5 para todo lo
  que pasa con ella después.
- Botones y textos grandes, alto contraste, pensados para uso rápido a las 6 AM.
- La app arranca sola con Windows y se recupera si se cierra.
- Usar la mayor distinción visual posible entre ENTRADA y SALIDA (color + texto + ícono).

## 5. Cámara (nunca bloquea)

- Si la cámara no está disponible, **el registro se permite** con bandera `sin_camara`.
- Verificación periódica del estado de la cámara (cada pocos segundos). Cada cambio genera un evento en `eventos_dispositivo` (`camara_desconectada`, `camara_reconectada`).
- Detección de lente obstruido: si brillo medio o varianza del frame están bajo un umbral configurable, bandera `foto_obstruida`.
- Con cámara caída, mostrar aviso grande: "Cámara no disponible: tu registro quedará marcado para revisión".
- El panel muestra: alerta si una cámara lleva caída más de X minutos, y reporte de registros sin foto u obstruidos por empleado.

### 5.1 Ciclo de vida de la foto

> **LA FOTO NUNCA SALE DEL KIOSCO.** A la nube viaja sólo su **hash**.

| Paso | Qué pasa |
|---|---|
| Captura | En el instante en que el PIN es correcto. 640×480, JPEG 0.7. |
| Medición | Brillo y varianza → bandera `foto_obstruida` si el lente está tapado. |
| Hash | SHA-256 del JPEG **antes de cifrar**. Se guarda con el registro y se sincroniza. |
| Cifrado | AES-256-GCM. Abierta fuera de la app debe ser ilegible. |
| Guardado | `userData/fotos/AAAA/MM/<uuid-de-la-marca>.jpg.enc` |
| Retención | Borrado automático a los 30 días (configurable), **salvo** las marcadas "Conservar". |

**El nombre del archivo es el UUID de la marca, nunca el del empleado.** Una
carpeta de fotos no debe decir quién es quién.

**La marca de agua se aplica AL EXPORTAR, no al capturar.** Razón: quemar el
número de empleado en los píxeles no agrega seguridad —el JPEG se edita y la
integridad ya la cubre el hash— y sí vuelve la imagen más identificable, justo
después de haber decidido nombrar los archivos por UUID. Donde sí hace falta es
en el ZIP a USB, porque ahí los archivos viajan sueltos: ahí se les pone fecha,
hora, número de empleado, tipo y nombre del kiosco.

#### Llave de cifrado y recuperación

- La llave se protege con `safeStorage` de Electron (DPAPI de Windows).
- **⚠ RIESGO REAL:** DPAPI está atado al perfil de Windows de esa máquina. Si se
  reinstala Windows o se recrea el perfil, las fotos quedan **ilegibles para
  siempre**. Eso choca con la sección 1: "las computadoras cambian con
  frecuencia; toda PC es reemplazable".
- Por eso la llave se envuelve **también** con una **contraseña de recuperación**
  que define el administrador al instalar. Con ella, el disco de una PC muerta
  se puede leer desde otra.
- Esa contraseña **nunca** vive en el repositorio ni en la nube.
- El manual técnico obliga a **exportar a USB antes de retirar una PC**.

#### Verificación de integridad

El hash viaja a la nube con el registro. Si al abrirla la foto falta o su hash
no coincide, se marca como `foto_faltante` o `foto_alterada`. El panel lo
muestra sin necesidad de tener la foto.

---

### 5.2 Modo administrador en el kiosco

Es la **única** forma de ver las fotos.

- Se entra con un **atajo oculto** (mantener presionado 3 s el letrero de
  arriba) + usuario y contraseña de administrador **del sistema** (no de
  Windows). No hay botón ni barra de estado a la vista del empleado: conexión,
  pendientes, cámara y versión se ven dentro del modo administrador.
  Documentado en el manual técnico, no escondido: un acceso que nadie puede
  descubrir es un acceso que no existe.
- Las credenciales se validan **sin internet**: sus hashes bajan en la
  sincronización, igual que los PINes. **[NOTA]** esto amplía la sección 3.2:
  el kiosco sigue sin usar Supabase Auth, pero sí guarda hashes de
  credenciales de administrador para poder validarlas offline.
- Las fotos se descifran **sólo en memoria**. Nunca se escribe una copia legible
  en disco.
- Pantalla de auditoría con filtros por fecha, empleado y banderas; cada
  registro junto a su foto.
- Bloqueo tras varios intentos fallidos y **cierre automático a los 2 minutos**
  de inactividad.
- Exportación a USB: ZIP con las fotos descifradas **y con marca de agua**, más
  un CSV de los registros.
- **Cada consulta y cada exportación quedan en bitácora** (quién, qué, cuándo) y
  se sincronizan a la nube. Ver `accesos_foto` en la sección 12.

---

## 6. Tiempo y anti-manipulación de reloj

- Todo se guarda en UTC (`timestamptz`). Conversión a hora local solo al mostrar.
- Zona horaria: **`America/Matamoros`** (Nuevo Laredo, franja fronteriza con horario de verano). Guardada en `configuracion`, nunca hardcodeada en cálculos. **Prohibido** usar `America/Mexico_City` u offsets fijos como `-06:00`.
- En PostgreSQL: columnas `timestamptz`; conversiones con `AT TIME ZONE 'America/Matamoros'`. No depender de la zona de la sesión ni del servidor de Supabase (está en UTC).
- La "fecha laboral" de una marca (a qué día pertenece) se calcula en hora local de `America/Matamoros`, no en UTC.
- En Electron/Angular: usar `Intl`/`Temporal` o una librería con base IANA (ej. `date-fns-tz` o `luxon`) con la zona explícita; nunca asumir que Windows tiene la zona correcta.
- Mantener tzdata actualizada (Electron y Postgres); México ya cambió sus reglas de horario antes.
- Pruebas obligatorias en las noches de cambio: segundo domingo de marzo (se pierde 1 hora) y primer domingo de noviembre (se repite 1 hora), incluyendo un turno 22:00–06:00.
- Cada marca guarda:
  - `hora_dispositivo`: `Date.now()` al momento del evento.
  - `monotonico_ms` y `arranque_id`: lectura del reloj monotónico y el identificador de la sesión de la app.
  - `desfase_servidor_ms`: último desfase conocido entre Windows y el servidor.
  - `hora_estimada`: hora del dispositivo corregida con el desfase.
  - `recibido_en`: hora del servidor al sincronizar (la asigna el servidor).
- Detección:
  - Al arrancar la app se registra par (hora de pared, monotónico). Si en una marca la diferencia de pared vs. monotónico supera un umbral → bandera `reloj_sospechoso`.
  - Con cada conexión se recalcula el desfase contra el servidor. Un cambio grande de desfase marca las marcas offline de ese periodo.
  - Una marca anterior a la última marca local también se marca.
- Las banderas nunca bloquean el registro.

## 7. Sincronización (bidireccional)

### Push (kiosco → nube)
- Tabla local `outbox` con marcas y eventos pendientes.
- Cada marca tiene UUID generado en el kiosco → inserción **idempotente** en el servidor (`ON CONFLICT DO NOTHING`).
- Proceso en el main: reintento con backoff exponencial; se dispara también al recuperar conexión.
- **Las fotos NO se suben.** A la nube va sólo el `foto_hash` (SHA-256), dentro
  del propio registro. La foto vive y muere en el kiosco (sección 5.1).
- `SINCRONIZACION.subirFotos` existe y está en `false`. Si algún día se decide
  subirlas, se enciende: el resto del diseño ya lo contempla.
- Sincronizar con alta frecuencia: una PC puede ser retirada sin aviso.

### Pull (nube → kiosco)
- Catálogo: empleados activos (id, número, nombre, hash de PIN, estado), últimas marcas por empleado (para sugerir acción), configuración.
- Sincronización incremental por `actualizado_en`.
- Empleados dados de baja se desactivan localmente en la siguiente sincronización.
- Si hay conexión, reflejar cambios de PIN en minutos.

### El módulo se puede apagar entero

Toda la sincronización vive detrás de un interruptor (`SINCRONIZACION.activa`).
Con él en `false`, el kiosco funciona 100% local y no intenta hablar con nadie.

### Heartbeat
- El kiosco reporta periódicamente: versión de la app, estado de cámara, registros pendientes, desfase de reloj. El panel muestra "última conexión" por dispositivo.

## 8. Modelo de datos (Supabase)

> Horarios, tolerancias y turnos van en **tablas**, nunca en código.

- `empleados`: id (uuid), numero_empleado (único), nombre, apellido_paterno, apellido_materno, pin_hash, pin_temporal (bool), activo, creado_en, actualizado_en.
- `turnos`: id, nombre, hora_inicio (time, hora local), hora_fin (time, hora local), cruza_medianoche (bool, derivable de hora_fin < hora_inicio), tolerancia_minutos, minutos_para_falta, es_libre (bool), horas_semanales_requeridas (nullable). Inicio y fin programados se convierten a `timestamptz` combinando fecha laboral + hora local + `America/Matamoros`, así un turno 22:00–06:00 termina a las 06:00 reales aunque esa noche haya cambio de horario (7 u 9 horas de reloj). Las horas trabajadas siempre se calculan restando timestamps absolutos.
- `asignaciones_turno`: id, empleado_id, turno_id, vigente_desde (date), vigente_hasta (date, nullable).
  Los turnos son **plantillas** para asignar rápido; el horario real puede
  ajustarse **por persona y por día de la semana**.
- `dias_laborales`: asignacion_id, dia_semana (0–6).
- `dispositivos`: id, nombre, ubicacion, token_hash, activo, enrolado_en, enrolado_por, revocado_en, revocado_por, ultima_conexion, version_app, camara_ok, pendientes.
- `codigos_enrolamiento`: codigo_hash, creado_por, expira_en, usado_en, dispositivo_id.
- `marcas` (**inmutable**): id (uuid del kiosco), empleado_id, dispositivo_id, tipo (`entrada`|`salida`), origen (`kiosco`|`manual`), hora_dispositivo, hora_estimada, monotonico_ms, arranque_id, desfase_servidor_ms, recibido_en, **foto_hash** (SHA-256 de la foto que se quedó en el kiosco; `null` si no hubo), **foto_estado** (`con_foto`|`sin_camara`|`obstruida`|`eliminada_por_antiguedad`|`faltante`|`alterada`|`conservada`), banderas (text[]: `sin_camara`, `foto_obstruida`, `reloj_sospechoso`, `dispositivo_revocado`, `manual`, `cierre_automatico`), en_cuarentena (bool).
  **No hay `foto_path` en la nube**: la nube nunca sabe dónde está el archivo,
  porque el archivo no es suyo.
- `correcciones`: id, marca_id (nullable), empleado_id, accion (`anular`|`agregar`|`cambiar_tipo`), datos (jsonb), motivo (obligatorio), admin_id, creado_en. Las correcciones nunca modifican la marca original.
- `incidencias`: empleado_id, tipo (vacaciones, incapacidad, permiso), fecha_inicio, fecha_fin, notas, admin_id.
- `dias_festivos`: fecha, descripcion.
- `eventos_dispositivo`: dispositivo_id, tipo, detalle (jsonb), ocurrido_en, recibido_en.
- `administradores`: user_id (auth.users), nombre, rol (`admin`|`supervisor`), activo.
- `bitacora_auditoria`: tabla, registro_id, accion, datos_antes, datos_despues, actor, creado_en. Llenada por triggers.
- `configuracion`: clave/valor (zona horaria, umbrales de reloj y cámara, intentos de PIN, días de retención de fotos, horas para cierre automático).
- `ajustes_horario` (0029): horario de una persona en un día (o descanso); un intercambio son dos filas con el mismo `intercambio_id`. Manda sobre el horario normal sólo ese día.
- `pendientes` (0029): casos que el jefe atiende (retardo del día, retardos de la semana, falta, salida no registrada, registro de baja, cámara tapada). Los crea `revisar_pendientes()` al abrir el panel; se cierran con "qué se hizo" o solos si ya no aplican.
- `notas` y `notas_compartidas` (0029): notas con casillas de los administradores; privadas, para todos o para algunos.

### Jornadas (calculadas, no almacenadas al insertar)
- El emparejamiento entrada/salida se calcula **en el servidor** (vista o función) a partir de todas las marcas válidas + correcciones, porque un empleado puede entrar por un kiosco y salir por otro.
- Horas trabajadas = diferencia de timestamps completos.
- Entrada sin salida tras N horas (configurable, 16 por defecto): estado `salida_no_registrada`. **No se inventa hora de salida ni se calculan horas**; lo resuelve el jefe.
- **Consecuencia importante:** el kiosco no sabe qué es un retardo ni le hace falta. Solo registra marcas. Retardos, faltas y horas se calculan en el servidor con la configuración vigente, así que cambiar la tolerancia recalcula también el histórico sin tocar ni una marca.

## 9. BD local (SQLite en el kiosco)

- `empleados_cache`, `ultimas_marcas_cache`, `configuracion_cache`.
- `outbox`: uuid, tipo_registro, payload (json), foto_ruta_local, intentos, ultimo_error, creado_en, sincronizado_en.
- `estado_local`: desfase_servidor_ms, ultima_sync, arranque actual, intentos fallidos de PIN por empleado.
- Modo WAL. Migraciones versionadas.
- (v2) Cifrado con SQLCipher con llave protegida por `safeStorage`.

## 10. Panel administrativo

- Login con Supabase Auth.
- Tabla de asistencia con filtros: fecha, empleado, dispositivo, estado (a tiempo, retardo, falta, salida no registrada) y banderas.
- **Estado de la foto** en cada registro: disponible en el kiosco, sin foto,
  obstruida, eliminada por antigüedad, faltante o alterada. El panel **no
  muestra la foto**: no la tiene (sección 5.1).
- Filtro **"Revisar en kiosco"**, para que el jefe vaya una sola vez y revise
  varios casos juntos en lugar de un viaje por cada uno.
- Alertas: sin cámara, foto obstruida, reloj sospechoso, cuarentena, cámaras caídas, kioscos sin conexión.
- Acciones (todas quedan en bitácora y requieren motivo): alta/baja de empleados, reseteo de PIN (genera PIN temporal), registro manual de asistencia, anulación/corrección de marcas, incidencias.
- Gestión de dispositivos: generar código de enrolamiento, ver estado, revocar.
- Gestión de turnos y asignaciones.
- **Pendientes**: primera pestaña; el panel abre ahí si hay casos. Sin correo ni WhatsApp: todo dentro del panel. Reglas configurables (minutos tarde por día y por semana —contados desde la hora de entrada—, faltas, salidas no registradas, registros de baja, cámara tapada). **"Revisar desde"** (`pendientes_revisar_desde`): lo anterior a esa fecha no se vuelve pendiente; la migración la pone el día que se aplica. Una tarjeta por persona; si falta varios días seguidos, sólo **pregunta** (enfermo, vacaciones, baja), no decide.
- **Cambios por un día** e **intercambios** de horario (Horarios), y **Notas** con casillas.
- **Pantalla de configuración**: edita la tabla `configuracion` (tolerancia, minutos para falta, días de retención de fotos, umbrales de cámara y reloj, intentos de PIN, horas para cierre automático). Es lo que hace que el sistema se adapte sin reinstalar nada. Todo cambio queda en `bitacora_auditoria`.

## 11. Contingencias

- **Sin internet:** operación normal en SQLite; sincroniza al volver.
- **Sin luz:** empleados avisan al jefe; el jefe registra asistencia manual con motivo. No hay app móvil para empleados. Se recomienda un no-break (UPS).
- **Cámara falla:** ver sección 5.
- **Olvido de PIN:** el empleado avisa al jefe; el jefe genera PIN temporal o registra manualmente. No hay flujo de recuperación en el kiosco.
- **Cambio de PC:** instalar, capturar código de enrolamiento, revocar la PC anterior desde el panel.

## 12. Datos personales y retención

- Marco: Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados (DOF 20-03-2025) y la Ley de Protección de Datos Personales en Posesión de los Sujetos Obligados del Estado de Tamaulipas (P.O. 10-07-2025).
- Las fotografías son datos personales. **No implementar reconocimiento facial** ni extraer rasgos biométricos: eso las convertiría en datos sensibles con obligaciones mayores.
- El kiosco deja claro que **el video en vivo no se graba** ("En vivo · no se graba"); la foto es **sólo** para control de asistencia y **se borra a los 30 días**.
- Finalidad única: control de asistencia. No usar las fotos para otro fin.
- Supabase actúa como encargado (proveedor): elegir región y documentarla.
- Deber de seguridad, en el modelo híbrido (sección 5.1):
  - las fotos **no salen del kiosco** y están **cifradas en disco** (AES-256-GCM);
  - sólo se ven desde el modo administrador, y **sólo descifradas en memoria**;
  - RLS en todas las tablas de la nube;
  - bitácora de quién consulta cada foto (`accesos_foto`), llevada **en el
    kiosco** y sincronizada a la nube para que el jefe pueda auditarla sin ir.
- Retención de fotos: **30 días por defecto**, configurable en `configuracion`;
  tarea local que las borra del disco del kiosco. **Excepción:** las marcadas
  como "Conservar" por un administrador (casos en disputa) no se borran hasta
  que se les quite la marca. Los datos de asistencia no se borran nunca.
- **Consecuencia del modelo híbrido:** al no salir las fotos a Supabase,
  desaparece la transferencia a un encargado externo (y su posible
  almacenamiento fuera de México). **NO desaparece nada más:** el aviso de
  privacidad, la retención, la bitácora de accesos y los derechos ARCO siguen
  aplicando igual. Local no significa sin reglas.
- Soportar derechos ARCO: el panel debe poder exportar y, cuando proceda, suprimir los datos de un empleado (respetando la inmutabilidad mediante anonimización registrada en bitácora).

## 13. Operación y mantenimiento

- Cuentas de Supabase, GitHub y Cloudflare a nombre de una **cuenta dedicada al sistema**, nunca de una cuenta personal del autor.
- Supabase pausa proyectos gratuitos inactivos: prever tarea periódica de actividad y documentar reactivación.
- Actualizaciones automáticas con electron-updater.
- Windows del kiosco: cuenta estándar sin privilegios, arranque automático de la app y modo kiosco (Assigned Access o Shell Launcher según la edición de Windows; verificar compatibilidad con apps Win32 al instalar).
- Documentar en `/docs`: manual del jefe (panel) y manual técnico (instalación, enrolamiento, recuperación).

### 13.1 Hardware y entorno físico
- Entrada preferente con **teclado numérico USB físico** (la PC no es táctil; funciona con guantes o manos húmedas). La UI también debe aceptar clic en el teclado en pantalla.
- Retroalimentación con **sonidos distintos** para entrada, salida y error.
- Cámara fija, con cable asegurado, a la altura de la cara y sin ventana detrás (evitar contraluz).
- Se recomienda no-break (UPS).

### 13.2 Robustez del sistema operativo
- Configurar horas activas de Windows Update y reinicios fuera de horarios de turno.
- **Fecha absurda** (ej. año < 2025 o muy lejos del último registro, típico por pila del BIOS agotada): mostrar aviso en pantalla, seguir registrando con bandera `reloj_sospechoso` y usar el reloj monotónico + última hora conocida para estimar.

### 13.3 Datos y ambientes
- Dos proyectos de Supabase: **pruebas** y **producción**. Variables de entorno separadas; nunca probar contra producción.
- Respaldo de la base de datos dos veces por semana, exportado fuera de Supabase. Documentar cómo restaurar.
- Importación masiva de empleados desde Excel/CSV en el panel.
- Exportación de reportes a Excel desde el panel.
- Fotos de referencia opcionales por empleado (`empleados.foto_referencia_path`) para que el revisor compare contra la foto del checado. **Fase 2**: la sección 1.1 las excluye de la v1; la columna se deja prevista en el esquema desde el inicio para no migrar después.

### 13.4 Resumen diario
- Resumen diario por correo al jefe (retardos, faltas, registros sin foto, kioscos sin conexión, cámaras caídas), con un workflow programado.

## 14. Convenciones

- TypeScript estricto en todo el proyecto.
- Nombres de dominio en español (tablas, columnas, entidades); código técnico puede usar inglés.
- Migraciones SQL versionadas en `/supabase/migrations`; nunca cambios manuales en producción.
- Toda política RLS y Edge Function con pruebas.
- Pruebas unitarias para: verificación de PIN, detección de reloj, cálculo de jornadas (incluye cruce de medianoche y cambio de horario de verano), idempotencia de sincronización.
- Nunca registrar PINs, tokens ni fotos en logs.
- Ningún número mágico en el código: todo valor ajustable vive en la tabla `configuracion`, en `tema.json` o en `configuracion.ts`, según la regla de la sección 1.3.
