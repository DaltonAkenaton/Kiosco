# Manual técnico

> Para quien instala, mantiene o repara el sistema. Supone saber usar Windows y
> una terminal, no programar. Para el **por qué** de cada decisión, ver el
> [curso interno](curso/README.md). Para la puesta en marcha inicial (cuentas y
> credenciales), ver [PASOS-FINALES.md](PASOS-FINALES.md).

## Índice

1. [Las piezas](#1-las-piezas)
2. [Instalar un kiosco](#instalar-un-kiosco)
3. [Dar de alta el kiosco y la contraseña de recuperación](#3-dar-de-alta-el-kiosco-y-la-contraseña-de-recuperación)
4. [Dónde guarda sus datos el kiosco](#4-dónde-guarda-sus-datos-el-kiosco)
5. [Cambiar o retirar una PC](#5-cambiar-o-retirar-una-pc)
6. [Recuperar fotos de una PC muerta](#6-recuperar-fotos-de-una-pc-muerta)
7. [Respaldos y cómo restaurar](#7-respaldos-y-cómo-restaurar)
8. [Publicar una versión nueva del kiosco](#publicar-una-versión-nueva-del-kiosco)
9. [Supabase: pausas, contraseñas, cambios a la base](#9-supabase)
10. [Problemas comunes](#10-problemas-comunes)
11. [Trabajar en el código](#11-trabajar-en-el-código)

---

## 1. Las piezas

| Pieza | Qué es | Dónde vive | Se actualiza con |
|---|---|---|---|
| **Kiosco** | App de escritorio (Electron + Angular) | PC del pasillo, `.exe` | Instalador nuevo o actualización automática |
| **Panel** | Página web (Angular) | Netlify | `git push` a `main` (Netlify recompila solo) |
| **Nube** | Base de datos, reglas y Edge Functions | Supabase | Actions → "Publicar en Supabase" |
| **Automatizaciones** | Pruebas, respaldos, resumen diario, instalador | GitHub Actions | Solas |

Las fotos **nunca** salen del kiosco. A la nube sólo llega su huella (hash).

---

## Instalar un kiosco

### Requisitos de la PC

- Windows 10 u 11, 64 bits. 4 GB de RAM bastan.
- Cámara USB (fija, a la altura de la cara, **sin ventana detrás**).
- Teclado numérico USB (recomendado: funciona con guantes o manos húmedas).
- Bocinas (sonidos distintos para entrada, salida y error).
- Internet (puede fallar: el kiosco sigue funcionando sin él).
- **No-break (UPS)** recomendado.

### Preparar Windows

1. **Cuenta estándar** (no administrador) para el kiosco, por ejemplo
   `kiosco`. El instalador no pide permisos de administrador.
2. **Energía**: Configuración → Sistema → Inicio/apagado y suspensión →
   pantalla y suspensión en **Nunca**.
3. **Windows Update → Horas activas**: de 5:00 a 23:00 (o las que cubran los
   turnos), para que no se reinicie a la hora de checar. El turno nocturno
   (22–06) hace que no haya hueco perfecto: elegir la hora con menos gente.
4. **Inicio de sesión automático** en la cuenta `kiosco` (con `netplwiz`,
   desmarcar "Los usuarios deben escribir su nombre y contraseña").
5. **Opcional — modo kiosco de Windows**: con Windows Pro/Enterprise/Education,
   Configuración → Cuentas → Otros usuarios → **Configurar un quiosco**
   (Assigned Access) para que la cuenta sólo abra esta app. Con Windows Home no
   existe; la app ya se protege sola (pantalla completa, no se deja cerrar con
   Alt+F4, vuelve a abrirse si se cierra). Si la PC es **compartida**, no usar
   Assigned Access: el botón **Usar esta PC** de la app permite apartarla 15
   minutos.

### Instalar

1. Copiar `ControlDeAsistencia-Instalador-X.Y.Z.exe` a la PC (USB o descarga
   desde GitHub → Releases).
2. Doble clic. Windows SmartScreen puede avisar "Windows protegió su PC"
   (el `.exe` no está firmado con certificado de pago): **Más información →
   Ejecutar de todas formas**.
3. Se instala en el perfil del usuario, crea accesos directos, y **se abre sola
   al encender** la PC.
4. Probar: la cámara se ve, el reloj marca la hora de Nuevo Laredo.

**Cerrar la app para mantenimiento:** `Ctrl + Alt + Shift + Q`. Se vuelve a
abrir con el acceso directo o reiniciando.

**Desinstalar** (Panel de control → Programas) **no borra los datos**: la
base y las fotos se quedan en la carpeta de datos (sección 4), a propósito.

---

## 3. Dar de alta el kiosco y la contraseña de recuperación

1. Panel → **Kioscos → + Dar de alta un kiosco** → nombre ("Entrada edificio
   A") y ubicación → da un código de 8 letras que vale **15 minutos**.
2. En el kiosco, barra de abajo → **Dar de alta** → escribir el código (hace
   falta un teclado con letras) → **Dar de alta**.
3. En segundos: el kiosco baja la lista del personal y aparece en el panel.
4. En el kiosco → **⚙ Administrador** → entrar con el usuario **del kiosco**
   del jefe (se pone en el panel, **Mi cuenta**; tarda unos minutos en llegar).
5. El kiosco avisa en amarillo que falta la **contraseña de recuperación de las
   fotos**. Definirla y **anotarla en la hoja de credenciales**. Sugerencia:
   usar la misma para todos los kioscos.

> **Sin contraseña de recuperación, reinstalar Windows = perder las fotos.**
> La llave que cifra las fotos está protegida por Windows (DPAPI) y por esa
> contraseña. Windows la pierde si se reinstala o se recrea el perfil; la
> contraseña no.

Si el código "no sirve": se escribió mal, ya se usó o pasaron los 15 minutos.
Generar otro. Tras 10 códigos equivocados en una hora, el servidor pide esperar.

---

## 4. Dónde guarda sus datos el kiosco

```
C:\Users\<usuario>\AppData\Roaming\Control de Asistencia\
├── kiosco.db (+ -wal, -shm)   registros, lista del personal, bandeja de salida
├── fotos\AAAA\MM\<uuid>.jpg.enc   fotos CIFRADAS (el nombre no dice de quién son)
├── llave-fotos.json            la llave de las fotos, envuelta (no sirve sola)
├── llave-fotos.<fecha>.ilegible.json   llaves anteriores apartadas (NO borrar)
└── credencial-kiosco.json      el "gafete" del kiosco ante la nube, cifrado
```

(Para llegar: tecla Windows + R → `%APPDATA%\Control de Asistencia` → Enter.)

- Las fotos se borran solas a los **30 días** (Configuración del panel), salvo
  las marcadas "Conservar".
- Los registros se envían a la nube en cuanto hay internet; en la PC se quedan
  como respaldo.
- **Nunca** borrar esta carpeta sin haber hecho antes lo de la sección 5.

---

## 5. Cambiar o retirar una PC

**Antes de retirar una PC que funciona** (CLAUDE.md 5.1):

1. Conectarla a internet y esperar a que la barra diga **0 pendientes**
   (así todos los registros ya están en la nube).
2. **⚙ Administrador → 💾 Guardar en memoria USB** con el rango de fechas de
   los últimos 30 días (y todas las marcadas "Conservar"). Guardar la USB con
   la hoja de credenciales.
3. Para conservar las fotos en la PC nueva, además: cerrar la app
   (`Ctrl+Alt+Shift+Q`) y copiar **toda** la carpeta de datos (sección 4) a la
   USB.
4. Panel → Kioscos → **Dar de baja este kiosco** (la PC vieja).

**En la PC nueva:**

1. Instalar (sección 2). **Si se copió la carpeta de datos**: antes de abrir la
   app por primera vez, pegarla en `%APPDATA%\` (reemplazando si ya existía).
2. Abrir la app. Como es otra PC, Windows no puede abrir ni el gafete ni la
   llave: el kiosco pide **alta** (código nuevo del panel) y aparta la llave
   vieja sin borrarla.
3. Dar de alta con un código nuevo.
4. **⚙ Administrador** → aparece "N fotos guardadas con un candado anterior" →
   escribir la **contraseña de recuperación** → **Recuperar las fotos**.

## 6. Recuperar fotos de una PC muerta

Si la PC ya no arranca pero el disco sirve:

1. Sacar el disco y conectarlo a otra PC (adaptador USB), o arrancar con una USB
   de Windows.
2. Copiar `\Users\<usuario>\AppData\Roaming\Control de Asistencia\` completo.
3. Seguir "En la PC nueva" de la sección 5.

Los **registros** no se pierden aunque el disco muera: los que ya habían
llegado a la nube están en el panel. Sólo se pierde lo que estaba "pendiente"
sin internet. Por eso el kiosco sincroniza cada pocos segundos.

---

## 7. Respaldos y cómo restaurar

### Qué se respalda solo

GitHub → Actions → **"Respaldo de la base de datos"** corre lunes y jueves y
guarda (90 días) un ZIP con:

- `excel/` — una hoja por tabla (marcas, empleados, correcciones…), se abre en Excel.
- `sql/` — `1-roles.sql`, `2-estructura.sql`, `3-datos.sql` para restaurar.

**Tarea semanal (manual, 2 minutos):** cada lunes, Actions → la última
corrida verde → Artifacts → descargar y subir al Drive de la facultad (carpeta
con acceso restringido: son datos personales).

Si una corrida sale en rojo: casi siempre el secreto `SUPABASE_DB_URL` cambió
(por ejemplo, se cambió la contraseña de la base). Actualizarlo.

### Restaurar en un proyecto nuevo

1. Crear un proyecto de Supabase nuevo (PASOS-FINALES paso 3).
2. En la PC, con [PostgreSQL](https://www.postgresql.org/download/) instalado
   (sólo hace falta `psql`), desde la carpeta `sql/` del respaldo:
   ```
   psql --single-transaction -v ON_ERROR_STOP=1 ^
     --file 1-roles.sql --file 2-estructura.sql ^
     --command "SET session_replication_role = replica" --file 3-datos.sql ^
     --dbname "<cadena de conexión del proyecto NUEVO>"
   ```
3. Las **cuentas del panel** (Supabase Auth) no van en el respaldo: crear el
   primer administrador con `npm run supabase:primer-admin` y los demás desde
   **Accesos**. Las filas de `administradores` sí se restauran; si el correo
   coincide, el script las reutiliza.
4. Subir las Edge Functions: Actions → "Publicar en Supabase" (con los secretos
   del proyecto nuevo).
5. El proyecto nuevo tiene **otra dirección**: actualizar Netlify
   (`SUPABASE_URL`, `SUPABASE_LLAVE_PUBLICA`) y el kiosco
   (`urlFuncionesProduccion`, generar versión nueva). Los kioscos conservan su
   gafete: la tabla `dispositivos` se restauró con sus huellas.

---

## Publicar una versión nueva del kiosco

El repositorio es **privado**, así que los kioscos no se actualizan solos: una
versión nueva se instala a mano, encima de la anterior. No se pierde ningún dato.

1. Cambiar `"version"` en `apps/kiosco-main/package.json` (ej. `0.2.0`).
2. ```
   git commit -am "Version 0.2.0"
   git tag v0.2.0
   git push && git push --tags
   ```
3. GitHub arma el instalador (Actions → "Instalador del kiosco", ~10 min) y lo
   deja en **Releases**. (Sin internet: `npm run empaquetar` en la PC de
   desarrollo hace lo mismo.)
4. Descargar el `.exe` de Releases (con la sesión de GitHub), copiarlo a cada
   kiosco con una USB e instalarlo, cuando nadie esté checando.

**Si algún día el repositorio se vuelve público**, se pueden encender las
actualizaciones automáticas: en `.github/workflows/instalador-kiosco.yml`,
cambiar `--publish never` por
`--publish always -c.publish.provider=github -c.publish.releaseType=release`.
Cada kiosco descargará solo las versiones nuevas y el jefe las instalará desde
**⚙ Administrador → Instalar la versión nueva** (el botón ya existe; aparece
sólo cuando hay una versión descargada). Ver D-037.

---

## 9. Supabase

- **Pausa por inactividad**: el plan gratuito pausa un proyecto tras 7 días sin
  uso. No debería pasar (los kioscos reportan cada minuto y el respaldo corre
  dos veces por semana). Si pasa: supabase.com → el proyecto → **Restore**.
  Los kioscos siguen registrando sin conexión y envían al volver.
- **Cambiar la contraseña de la base**: Project Settings → Database. Después
  actualizar en GitHub los secretos `SUPABASE_PASSWORD_*` y `SUPABASE_DB_URL`.
- **Cambios a la base**: **nunca a mano** en el tablero de producción
  (CLAUDE.md 16). Se escribe una migración nueva en `supabase/migrations/`,
  se prueba en local, y se publica con Actions → "Publicar en Supabase":
  primero **pruebas**, luego **produccion**.
- **La llave `service_role`** no se guarda en ningún lado. Si se filtró:
  Project Settings → API → regenerarla (las Edge Functions toman la nueva solas).

---

## 10. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| El kiosco dice "sin conexión" | Sin internet, o Supabase pausado | Revisar la red; ver sección 9 |
| Kiosco "dado de baja" / pide alta | Se revocó en el panel, o se copió a otra PC | Generar código nuevo y dar de alta |
| "Cámara no disponible" | Cable suelto, otra app usa la cámara | Reconectar; cerrar otras apps. Se sigue registrando |
| Muchos "Foto no guardada" | Disco lleno o Windows sin cifrado | Liberar espacio; revisar el perfil de Windows |
| "Hora dudosa" en todos | Pila del BIOS agotada o zona horaria mal | Cambiar la pila; hora automática en Windows |
| El panel no carga tras publicar | Variables de Netlify mal | Netlify → Deploys → leer el error; revisar variables |
| El jefe no puede entrar al modo administrador del kiosco | No ha puesto su usuario del kiosco, o el kiosco no ha sincronizado | Panel → Mi cuenta; esperar unos minutos con internet |
| "Registros que la oficina no aceptó" | Persona inexistente en el panel, kiosco revocado | Arreglar en el panel y "Volver a enviarlos" |
| Una corrida de Actions en rojo | Secreto vencido o mal copiado | Abrir la corrida, leer el primer error |

Registro de la app (para soporte): el kiosco escribe en la consola de Electron;
en desarrollo se ve en la terminal de `npm run kiosco:dev`.

---

## 11. Trabajar en el código

Requisitos: Node 24, Docker Desktop, Git.

```
npm install                    # una vez
npx supabase start             # base local (Docker)
npm run supabase:aplicar       # migraciones + datos de prueba
npm run panel:servir           # panel en http://localhost:4300
npm run ui:servir              # pantalla del kiosco (puerto 4200)
npm run kiosco:dev             # el kiosco (en otra terminal)
```

Datos de prueba (sólo existen en local): 20 empleados con PIN `1234`; panel
`jefe@prueba.local` / `panel-de-prueba`; modo administrador del kiosco
`jefe` / `jefe-de-prueba` (conectado) o `admin` / `admin-de-prueba` (sin nube).

Pruebas (todas deben pasar antes de publicar):

```
npm run probar                    # kiosco (188+)
npm run probar:sincronizacion     # kiosco <-> nube local
npm run supabase:probar           # esquema, RLS, reportes, ARCO
npm run supabase:funciones:probar # Edge Functions
npm run panel:probar              # el panel usado como el jefe (con panel:servir corriendo)
```

Antes de `npm run probar`, correr `node --check apps/kiosco-main/probar-autenticacion.cjs`:
si el archivo no carga, Electron deja ventanas de error en pantalla.

Si el servidor local de Edge Functions no toma un cambio:
`docker restart supabase_edge_runtime_kiosko-asistencia`.

Lo que hay que saber antes de cambiar algo: [docs/curso/estado-actual.md](curso/estado-actual.md)
y [docs/decisiones.md](curso/decisiones.md).
