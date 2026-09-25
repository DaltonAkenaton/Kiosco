# La base de datos en la nube (Supabase)

Aquí vive todo lo que corre en el servidor: las tablas, las reglas de quién
puede ver qué, y las funciones que el kiosco y el panel llaman.

> **Si sólo quieres entender qué hace cada cosa**, no hace falta que leas SQL.
> Cada archivo de `migrations/` empieza con una explicación larga de qué
> resuelve y por qué está hecho así.

---

## Qué es una migración

Un archivo `.sql` numerado que **cambia la base de datos un paso**. Se aplican
en orden, del `0001` en adelante, y nunca se modifica uno ya aplicado: si hay
que corregir algo, se agrega el siguiente número.

¿Por qué tan estricto? Porque es lo que hace que la base de pruebas y la de
producción sean idénticas. Sin migraciones, "funciona en mi máquina" se
convierte en "y en el servidor quién sabe", y averiguar la diferencia entre dos
bases de datos a mano es un trabajo horrible.

**Nunca se hacen cambios a mano en producción** (CLAUDE.md 16). Ni uno. El día
que alguien agregue una columna desde el panel de Supabase, la siguiente
migración fallará y nadie sabrá por qué.

---

## Las migraciones, en orden

| # | Archivo | Qué crea |
|---|---|---|
| 0001 | `cimientos` | Extensiones, funciones de tiempo, tabla `configuracion` |
| 0002 | `administradores` | Quién entra al panel, y las dos funciones de permisos |
| 0003 | `empleados` | El personal, sus PINes hasheados |
| 0004 | `dispositivos` | Los kioscos y sus códigos de enrolamiento |
| 0005 | `marcas` | **La tabla inmutable.** Entradas y salidas |
| 0006 | `eventos_dispositivo` | Cámara caída, kiosco pausado: lo que explica los huecos |
| 0007 | `turnos` | Horarios, asignaciones, días festivos |
| 0008 | `correcciones_e_incidencias` | Cómo se arregla algo sin editar una marca |
| 0009 | `bitacora_auditoria` | Quién cambió qué, llenada por triggers |
| 0010 | `fotos` | Hash y estado de la foto, bitácora de consultas |
| 0011 | `eventos_de_fotos` | Eventos de la llave y la retención de fotos |
| 0012 | `modo_admin_kiosco` | "Conservar" y los eventos del modo administrador |
| 0013 | `exportacion_usb` | El evento de cada exportación a USB |
| 0014 | `enrolamiento_y_sincronizacion` | Generar códigos, revocar kioscos, contraseña del kiosco; recibir y bajar datos (lo usan las Edge Functions) |
| 0015 | `panel_administracion` | Las acciones del panel con rol y motivo; motivo en la bitácora; rangos de la configuración |
| 0016 | `jornadas_y_reportes` | Marcas válidas, jornadas y el reporte de asistencia (calculados al momento); horarios, ausencias, festivos y correcciones |
| 0017 | `administradores_arco_y_limites` | Administradores desde el panel, derechos ARCO (exportar y anonimizar), límite de altas de kiosco, bandera `foto_no_guardada` |

---

## Las cinco reglas que gobiernan todo esto

### 1. La llave `service_role` nunca sale de aquí

Supabase tiene dos llaves. La `anon` es pública y puede ir en cualquier lado.
La **`service_role` se salta todas las reglas de seguridad** y sólo puede vivir
dentro de una Edge Function.

Nunca en el `.exe` del kiosco. Nunca en el panel. Nunca en el repositorio
(CLAUDE.md 3.2).

### 2. RLS en todas las tablas, negando por defecto

*Row Level Security* es la función de Postgres que decide, fila por fila, quién
puede ver qué. Se activa en cuanto la tabla nace, y sin políticas significa
**nadie ve nada**. Después se abre sólo lo justo.

Lo importante: **la RLS no aplica a `service_role`**. Las Edge Functions pasan
por encima de todo. Por eso las reglas que no pueden saltarse —la
inmutabilidad de las marcas, por ejemplo— están escritas como *triggers* y no
como políticas.

### 3. Aquí no hay ni una sola fotografía

El cliente pidió que las fotos se queden en el kiosco (CLAUDE.md 1.1). A la
nube llega sólo el **hash SHA-256** y el **estado** de cada foto, que es lo que
permite al panel decir "esta marca tiene foto, ve al kiosco de la entrada" o
"esta foto debería estar y no está".

Por eso **no existe ningún bucket de Storage**. Un bucket vacío "por si acaso"
es una puerta abierta esperando a que alguien la use.

### 4. Las marcas no se editan ni se borran

Ni el panel, ni una Edge Function, ni una consulta corrida a mano. Hay un
trigger que lo impide (migración 0005).

Corregir sí se puede: se agrega una fila en `correcciones`, con motivo
obligatorio y firmada. Las dos versiones quedan.

### 5. Todo en UTC, la zona horaria en la tabla

Cada columna de tiempo es `timestamptz`. La conversión a hora local se hace
sólo al mostrar, y siempre con la función `zona_horaria()`.

**Prohibido** escribir `America/Mexico_City` o `-06:00` en cualquier consulta:
Nuevo Laredo está en la franja fronteriza y sí tiene horario de verano.

---

## Cómo probar los cambios en tu máquina

Necesitas **Docker Desktop corriendo**. La primera vez descarga varios
gigabytes; después arranca en menos de un minuto.

```bash
npx supabase start          # levanta Postgres y Auth locales (necesita Docker)
npm run supabase:aplicar    # borra todo y aplica las migraciones desde cero
npm run supabase:probar     # 127 pruebas: RLS, triggers, acciones del panel, jornadas, horario de verano, ARCO
npm run supabase:funciones:probar  # 67 pruebas de las Edge Functions, por HTTP
npm run probar:sincronizacion      # un kiosco de verdad contra esta base
npm run supabase:codigo            # un codigo de alta para el kiosco de desarrollo
npx supabase stop           # cuando termines
```

Y sin Docker, para cazar lo tonto en dos segundos:

```bash
npm run supabase:revisar    # sintaxis de las migraciones
```

> **`supabase:revisar` NO prueba que funcionen.** Las 10 migraciones pasaban esa
> revisión y la quinta reventó al aplicarla de verdad (E-018). La sintaxis es el
> primer filtro, no el último.

`db reset` es el comando que importa: **aplica las migraciones en orden, desde
la nada**, que es exactamente lo que va a pasar en el servidor de verdad. Si
funciona ahí, funciona allá.

Cuando termina, `supabase start` imprime la URL local y las llaves. El panel de
Supabase local queda en <http://localhost:54323>.

---

## Los dos proyectos: pruebas y producción

CLAUDE.md 13.3 pide **dos proyectos de Supabase separados**, con variables de
entorno distintas. Nunca se prueba contra producción.

No es exageración: una prueba de sincronización manda marcas inventadas, y una
marca inventada en producción es un registro de asistencia falso de una persona
real. No hay forma limpia de deshacerlo, porque las marcas no se borran.

Cómo se crean y se conectan: [docs/PASOS-FINALES.md](../docs/PASOS-FINALES.md),
paso 3. Las migraciones y las funciones se publican con GitHub → Actions →
**"Publicar en Supabase"** (primero pruebas, luego producción). `db push` nunca
aplica `seed.sql`.

El primer administrador de un proyecto nuevo:

```bash
npm run supabase:primer-admin   # pide la URL, la llave secreta (no la guarda), correo y nombre
```

Las llaves van en variables de entorno o secretos de GitHub, **nunca en el repositorio**.

---

## Las Edge Functions del kiosco

Están en `functions/`. Son el **único** camino por el que el kiosco habla con
la nube. El kiosco no tiene sesión de Supabase: se identifica con su token en el
encabezado `x-kiosco-token`. Por eso `config.toml` les pone `verify_jwt = false`.

| Función | Para qué |
|---|---|
| `enrolar-kiosco` | canjea el código de 8 caracteres por el token del kiosco |
| `recibir-registros` | marcas, eventos, accesos a fotos y estados de foto. Idempotente; un kiosco revocado deja lo anterior a su baja en cuarentena |
| `catalogo` | empleados (con hash de PIN), administradores con contraseña de kiosco, configuración y última marca de cada quien. Incremental |
| `latido` | versión, cámara, pendientes y desfase de reloj del kiosco |

Y una más, la única que llama el **panel**:

| Función | Para qué |
|---|---|
| `administradores` | dar acceso al panel (crea la cuenta de Supabase Auth con contraseña temporal) y restablecer contraseñas. Necesita service_role; exige la sesión del panel (`verify_jwt = true`) y que quien llama sea administrador |

Generar un código y revocar un kiosco **no** son Edge Functions: son funciones
de la base (`generar_codigo_enrolamiento`, `revocar_dispositivo`) que el panel
llama con su sesión. Ver D-031.

*(No hay función de fotos: **las fotos nunca salen del kiosco**. A la nube
sólo llega su hash. Ver CLAUDE.md 5.1.)*

## Datos de prueba (`seed.sql`)

`db reset` carga, sólo en local, los mismos 20 empleados que el kiosco siembra
en desarrollo (PIN 1234); un jefe que entra al panel con `jefe@prueba.local` /
`panel-de-prueba` y al modo administrador del kiosco con `jefe` /
`jefe-de-prueba`; y datos de demostración (dos kioscos y cinco días de
registros, calculados desde hoy). Nunca llegan a la nube real.

## Otros archivos

| Archivo | Qué es |
|---|---|
| `primer-administrador.mjs` | Crea el primer administrador de un proyecto nuevo |
| `resumen-diario.sql` | El texto del correo diario al jefe (lo usa GitHub Actions) |
| `codigo-de-prueba.mjs` | Un código de alta para el kiosco de desarrollo |

## Qué falta

- Turnos rotativos complejos, si el cliente los define (CLAUDE.md 14).
