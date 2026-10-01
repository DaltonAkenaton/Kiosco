# Manual técnico

> **Para quién es:** para quien instala, mantiene o repara el sistema. No hace
> falta saber programar: basta con saber usar Windows, copiar y pegar, y
> seguir pasos con calma. La sección 15 es la única que sí es para
> programadores.
>
> **Cómo leerlo:** no hace falta leerlo de corrido. Busca en el índice lo que
> te pasó y ve directo ahí. Si una palabra no la conoces, está en la sección
> "Palabras que vas a encontrar".
>
> Para el **por qué** de cada decisión, ver el curso interno (`docs/curso/`).
> Para la puesta en marcha desde cero (crear las cuentas), ver
> `docs/PASOS-FINALES.md`.

## Índice

- Palabras que vas a encontrar
1. Las piezas del sistema
2. Instalar un kiosco
3. Dar de alta el kiosco y la contraseña de recuperación
4. Dónde guarda sus datos el kiosco
5. Cambiar o retirar una PC
6. Recuperar fotos de una PC que ya no prende
7. Respaldos y cómo restaurar
8. **Fechas de vencimiento y tareas periódicas** (léela aunque no leas nada más)
9. Publicar una versión nueva del kiosco
10. Publicar el panel
11. Supabase: la base de datos en internet
12. El resumen diario por correo
13. Datos de demostración (sólo en pruebas)
14. Problemas comunes
15. Trabajar en el código (para programadores)

---

## Palabras que vas a encontrar

Muchas pantallas de los servicios que usa el sistema están en inglés. Esta
tabla dice qué significa cada palabra **aquí**, en este sistema.

| Palabra | Qué es, en palabras simples |
|---|---|
| **Kiosco** | La computadora del pasillo donde el personal registra su entrada y salida, y el programa que corre en ella. |
| **Panel** | La página web donde el jefe ve la asistencia y administra todo. Se abre en cualquier navegador. |
| **Supabase** | El servicio de internet donde vive la **base de datos**: el "archivero" central con todos los registros, el personal y la configuración. |
| **Cloudflare** | El servicio que tiene "colgada" la página del panel en internet. |
| **GitHub** | El servicio donde se guarda el **código** del sistema (las instrucciones con las que está hecho) y que hace tareas automáticas. |
| **Repositorio** | Una "carpeta" en GitHub. Hay una con el código (`codigo-del-sistema`, privada) y dos con los instaladores del kiosco (públicas). |
| **Actions** | La pestaña de GitHub con las **tareas automáticas**: probar el sistema, publicar el panel, hacer respaldos, mandar el resumen diario. Cada tarea se puede correr también a mano con el botón **Run workflow** ("correr esta tarea"). |
| **Corrida** (*run*) | Cada vez que una tarea de Actions se ejecuta. Sale con **palomita verde** si salió bien o con **tache rojo** si falló. |
| **Secreto** (*secret*) | Una contraseña que se le da a GitHub para que sus tareas automáticas puedan entrar a Supabase, Cloudflare o al Gmail. Se guarda en GitHub → Settings → Secrets and variables → Actions. Una vez guardado **nadie lo puede volver a ver**, sólo reemplazar. |
| **Token** | Un tipo de contraseña que no es para personas, sino para que un programa entre a otro. Algunos **vencen** (ver sección 8). |
| **Ambiente: pruebas / producción** | Hay dos bases de datos separadas. **Producción** es la de verdad, con el personal real. **Pruebas** es una copia para ensayar sin riesgo. Nunca se ensaya en producción. |
| **Versión / Release** | Cada instalador nuevo del kiosco tiene un número (por ejemplo 1.0.0, 1.0.1). En GitHub, cada versión publicada se llama *Release*. |
| **Migración** | Un archivo con instrucciones para cambiar la forma de la base de datos (por ejemplo, agregar una columna). Se aplican en orden y nunca a mano. |
| **Hash / huella** | Un "código de barras" que se calcula a partir de una foto. Si alguien altera la foto, la huella ya no coincide. A internet sólo viaja la huella, nunca la foto. |
| **Cifrar** | Guardar algo "con candado": aunque alguien copie el archivo, no lo puede abrir sin la llave. |

---

## 1. Las piezas del sistema

```
   PASILLO                                    OFICINA DEL JEFE
┌───────────────┐   internet    ┌───────────┐   internet   ┌──────────────┐
│   KIOSCO      │ ────────────► │ SUPABASE  │ ◄─────────── │ PANEL        │
│ cámara + PIN  │  registros,   │ (base de  │              │ (navegador,  │
│ fotos (aquí)  │  NUNCA fotos  │  datos)   │              │  Cloudflare) │
└───────────────┘               └───────────┘              └──────────────┘
                                      ▲
                                      │ publica, respalda, avisa
                               ┌──────────────┐
                               │ GITHUB       │
                               │ (código y    │
                               │  tareas      │
                               │  automáticas)│
                               └──────────────┘
```

| Pieza | Qué es | Dónde vive | Cómo se actualiza |
|---|---|---|---|
| **Kiosco** | Programa de escritorio | La PC del pasillo | Solo: baja e instala las versiones nuevas (sección 9) |
| **Panel** | Página web | Cloudflare | Solo: GitHub lo vuelve a publicar cada vez que cambia el código (sección 10) |
| **Base de datos** | Registros, personal, reglas | Supabase | Solo: GitHub la actualiza cuando cambia el código (sección 11) |
| **Tareas automáticas** | Pruebas, respaldos, resumen diario, instaladores | GitHub → Actions | Corren solas |

Las fotos **nunca** salen del kiosco. A internet sólo llega su huella.

**Si se va el internet**, el kiosco sigue funcionando normal: guarda todo y lo
manda cuando vuelve. **Si se cae Supabase o GitHub**, igual. El único momento
en que algo se pierde es si la PC se destruye con registros que todavía no
había alcanzado a mandar (por eso manda cada pocos segundos).

---

## 2. Instalar un kiosco

### Lo que necesita la PC

- Windows 10 u 11, de 64 bits. Con 4 GB de memoria RAM basta.
- Cámara USB, fija, a la altura de la cara y **sin ventana detrás** (con luz
  de frente la foto sale bien; con luz atrás, la cara sale negra).
- Teclado numérico USB (recomendado: funciona con guantes o manos húmedas).
- Bocinas: hay un sonido distinto para entrada, salida y error.
- Internet. Puede fallar: el kiosco sigue funcionando sin él.
- **No-break** (UPS) recomendado, para que un apagón corto no la apague.

### Preparar Windows

1. **Una cuenta de Windows sin permisos de administrador** para el kiosco, por
   ejemplo llamada `kiosco`. El instalador no necesita permisos especiales.
2. **Que la pantalla no se apague:** Configuración → Sistema → Inicio/apagado y
   suspensión → pantalla y suspensión en **Nunca**.
3. **Que Windows no se reinicie a la hora de checar:** Configuración → Windows
   Update → **Horas activas** → de 5:00 a 23:00 (o las que cubran los turnos).
   Como hay turno de noche (22:00 a 06:00), no existe una hora perfecta:
   elige la de menos gente.
4. **Que entre solo a la cuenta del kiosco al prender:** tecla Windows + R →
   escribir `netplwiz` → Enter → desmarcar "Los usuarios deben escribir su
   nombre y contraseña".
5. **Opcional, sólo si la PC es exclusiva para checar:** con Windows Pro,
   Enterprise o Education existe el "modo quiosco" de Windows (Configuración →
   Cuentas → Otros usuarios → **Configurar un quiosco**), que hace que esa
   cuenta sólo pueda abrir este programa. Con Windows Home no existe, y no
   pasa nada: el programa ya se protege solo. Si la PC es **compartida** (lo
   normal en esta facultad), **no** se usa: ver lo siguiente.

### ¿La PC es sólo para checar, o la usan para otras cosas?

Se decide en el panel: Configuración → Kioscos → **"La PC del kiosco se usa
para otras cosas"**. Viene en **Sí** (compartida).

| | PC compartida (**Sí**, así viene) | PC sólo para checar (**No**) |
|---|---|---|
| Al prender Windows | No se abre sola: se abre con su **icono** del escritorio | Se abre sola |
| Para usar la PC en otra cosa | **Minimizar** (vuelve desde la barra de tareas o con su icono) o **Cerrar kiosco**. Antes de cerrarse manda lo pendiente | No se deja cerrar. Sólo con `Ctrl + Alt + Shift + Q` |
| Versiones nuevas | Se instalan **al cerrar** el kiosco | Se instalan de madrugada (2:00 a 5:00) |
| En el panel, página Kioscos | "Cerrado" es normal, no es alerta | Si deja de reportarse, es alerta |

Deja el **icono del escritorio** a la vista: es la forma de abrirlo.

### Instalar

1. Conseguir el instalador: GitHub → repositorio
   `versiones-kiosco` → a la derecha, **Releases** (versiones) →
   la más reciente → descargar el archivo
   `ControlDeAsistencia-Instalador-X.Y.Z.exe`. También se puede llevar en USB.
2. Doble clic. Windows puede avisar **"Windows protegió su PC"**: es porque el
   instalador no tiene una firma comprada (cuesta dinero cada año), no porque
   tenga virus. Picar **Más información → Ejecutar de todas formas**.
3. Se instala solo y crea el icono en el escritorio (un reloj con palomita).
4. Comprobar: la cámara se ve y el reloj marca la hora de Nuevo Laredo.
5. Seguir con la sección 3 (darlo de alta).

**Cerrar el programa para darle mantenimiento:** `Ctrl + Alt + Shift + Q`.
Se vuelve a abrir con su icono o reiniciando la PC.

**Desinstalar** (Panel de control → Programas) **no borra los datos**: los
registros y las fotos se quedan en su carpeta (sección 4), a propósito, para
que nadie los pierda por accidente.

---

## 3. Dar de alta el kiosco y la contraseña de recuperación

"Dar de alta" es presentarle el kiosco al sistema, para que la base de datos
acepte lo que mande. Un kiosco sin alta no puede mandar registros.

1. En el panel: **Kioscos → + Dar de alta un kiosco** → nombre (por ejemplo
   "Entrada edificio A") y ubicación. El panel da un **código de 8 letras**
   que sirve **15 minutos** y una sola vez.
2. En el kiosco, en la barra de abajo → **Dar de alta** → escribir el código
   (hace falta un teclado con letras) → **Dar de alta**.
3. En unos segundos, el kiosco baja la lista del personal y aparece en el panel.
4. En el kiosco → **⚙ Administrador** → entrar con el usuario y contraseña
   **del kiosco** del jefe. Esos se ponen en el panel, en **Mi cuenta**, y
   tardan unos minutos en llegar al kiosco.
5. El kiosco avisa en amarillo que falta la **contraseña de recuperación de
   las fotos**. Inventarla, escribirla y **anotarla en la hoja de
   credenciales**. Sugerencia: la misma para todos los kioscos.

> **Por qué importa la contraseña de recuperación:** las fotos se guardan con
> candado. La llave de ese candado la guarda Windows, escondida, atada a esa
> PC y a esa cuenta. Si se reinstala Windows, Windows "olvida" la llave y las
> fotos quedan cerradas para siempre. La contraseña de recuperación es una
> **copia de la llave en papel**: con ella se vuelven a abrir.
> **Sin esa contraseña, reinstalar Windows = perder las fotos.**

**Si el código "no sirve":** se escribió mal, ya se usó o pasaron los 15
minutos. Generar otro. Después de 10 códigos equivocados en una hora, el
sistema pide esperar (para que nadie pueda adivinarlos).

---

## 4. Dónde guarda sus datos el kiosco

Para abrir la carpeta: tecla Windows + R → escribir
`%APPDATA%\Control de Asistencia` → Enter.

```
C:\Users\<usuario>\AppData\Roaming\Control de Asistencia\
├── kiosco.db (+ -wal, -shm)        registros, lista del personal, pendientes
├── fotos\AAAA\MM\<código>.jpg.enc  fotos CON CANDADO (el nombre no dice de quién son)
├── llave-fotos.json                la llave de las fotos, envuelta (no sirve sola)
├── llave-fotos.<fecha>.ilegible.json   llaves anteriores apartadas (NO borrar)
└── credencial-kiosco.json          el "gafete" del kiosco ante la base, con candado
```

- Las fotos se borran solas a los **30 días** (se cambia en el panel,
  Configuración), salvo las marcadas "Conservar".
- Los registros se mandan a internet en cuanto hay conexión. En la PC se
  quedan también, como respaldo.
- **Nunca** borrar esta carpeta sin haber hecho antes lo de la sección 5.

---

## 5. Cambiar o retirar una PC

**Antes de retirar una PC que todavía funciona:**

1. Conectarla a internet y esperar a que la barra de abajo diga
   **0 pendientes** (así todo ya llegó a la base).
2. **⚙ Administrador → Guardar en memoria USB**, con las fechas de los
   últimos 30 días (y todas las marcadas "Conservar"). Guardar esa USB junto
   con la hoja de credenciales.
3. Si además quieres que las fotos sigan viéndose en la PC nueva: cerrar el
   programa (`Ctrl + Alt + Shift + Q`) y copiar **toda** la carpeta de datos
   (sección 4) a la USB.
4. En el panel: Kioscos → **Dar de baja este kiosco** (el de la PC vieja).

**En la PC nueva:**

1. Instalar (sección 2). **Si copiaste la carpeta de datos:** antes de abrir el
   programa por primera vez, pegarla en `%APPDATA%\` (reemplazar si pregunta).
2. Abrir el programa. Como es otra PC, Windows no puede abrir ni el gafete ni
   la llave de las fotos (es a propósito: así nadie se lleva un kiosco
   copiando archivos). El kiosco pide **alta** y aparta la llave vieja sin
   borrarla.
3. Darlo de alta con un código nuevo (sección 3).
4. **⚙ Administrador** → aparece "N fotos guardadas con un candado anterior" →
   escribir la **contraseña de recuperación** → **Recuperar las fotos**.

---

## 6. Recuperar fotos de una PC que ya no prende

Si la PC ya no arranca pero el disco duro sirve:

1. Sacar el disco y conectarlo a otra PC (con un adaptador USB para discos), o
   arrancar la PC con una USB de instalación de Windows.
2. Copiar la carpeta completa
   `\Users\<usuario>\AppData\Roaming\Control de Asistencia\`.
3. Seguir "En la PC nueva" de la sección 5.

Los **registros de asistencia** no se pierden aunque el disco muera: los que
ya habían llegado a la base están en el panel. Sólo se pierde lo que estaba
"pendiente" por falta de internet.

---

## 7. Respaldos y cómo restaurar

### Qué se respalda solo

GitHub hace un respaldo de la base de datos **cada lunes y jueves** (tarea
**"Respaldo de la base de datos"** en Actions) y lo guarda **90 días**. Es un
archivo ZIP con:

- `respaldo-AAAA-MM-DD.xlsx`: **el que se abre**. Un Excel con una hoja por
  tabla (registros, personal, correcciones…). La hoja **marcas** son las
  entradas y salidas, con la hora de Nuevo Laredo.
- carpeta `csv/`: lo mismo en texto separado por comas, para otros programas.
  (Si se abre un `.csv` en Excel y sale todo en una columna, es normal: usar
  el `.xlsx`.)
- carpeta `sql/`: tres archivos para restaurar la base completa en otra
  (`1-roles.sql`, `2-estructura.sql`, `3-datos.sql`).
- `LEEME.txt`: qué es cada cosa.

**Lo único obligatorio (una vez al mes, 2 minutos):** GitHub → Actions →
"Respaldo de la base de datos" y comprobar que las corridas recientes estén en
**verde**. Si arriba aparece un aviso de que la tarea se desactivó, picar
**Enable workflow** (sección 8). Así, el día que se necesite un respaldo, lo
habrá.

**Para descargar un respaldo:** abrir la corrida verde más reciente → abajo,
**Artifacts** → `respaldo-N` → se baja un ZIP. Tiene datos personales: no
dejarlo en Descargas al terminar.

**Opcional, para más seguridad:** de vez en cuando (por ejemplo, cada mes, en
la misma revisión), descargar el ZIP y subirlo al Drive de la facultad, a una
carpeta con acceso restringido. Protege contra perder la cuenta de GitHub y
guarda respaldos de más de 90 días.

**Si una corrida sale en rojo:** abrirla y leer el primer error. Casi siempre
es una de dos: cambió la contraseña de la base y falta actualizar el secreto
`SUPABASE_PASSWORD_PRODUCCION`, o **venció el token de Supabase** (sección 8).

### Restaurar en un proyecto nuevo de Supabase

Esto sólo hace falta si se perdió el proyecto de Supabase completo (lo
borraron, la cuenta se perdió, etc.). Es trabajo de alguien con experiencia;
mejor hacerlo con calma y primero en pruebas.

1. Crear un proyecto de Supabase nuevo (`docs/PASOS-FINALES.md`, paso 3).
2. En GitHub, actualizar los secretos `SUPABASE_REF_PRODUCCION` y
   `SUPABASE_PASSWORD_PRODUCCION` con los datos del proyecto nuevo.
3. En una PC con [PostgreSQL](https://www.postgresql.org/download/) instalado
   (sólo hace falta el programa `psql`), desde la carpeta `sql/` del respaldo:
   ```
   psql --single-transaction -v ON_ERROR_STOP=1 ^
     --file 1-roles.sql --file 2-estructura.sql ^
     --command "SET session_replication_role = replica" --file 3-datos.sql ^
     --dbname "<cadena de conexión del proyecto NUEVO>"
   ```
   (La cadena de conexión está en Supabase → el proyecto → botón **Connect** →
   *Session pooler*.)
4. GitHub → Actions → **Publicar en Supabase** → Run workflow → produccion.
   Esto sube las funciones y configura el acceso y el correo.
5. Las **cuentas para entrar al panel** no van en el respaldo. Crear la
   primera con Actions → **Crear administrador**, y las demás desde el panel,
   en **Accesos**.
6. El proyecto nuevo tiene **otra dirección de internet**. El panel se arregla
   solo (vuelve a publicarse con el siguiente cambio, o a mano: Actions →
   "Publicar el panel" → Run workflow). Los kioscos **no**: hay que cambiar la
   dirección en `packages/compartido/src/configuracion.ts`
   (`PROYECTOS_SUPABASE`) y publicar una versión nueva (sección 9). Eso ya es
   trabajo de programador. Los kioscos conservan su alta, porque la tabla de
   kioscos se restauró.

---

## 8. Fechas de vencimiento y tareas periódicas

Algunas contraseñas de programa (tokens) **vencen solas**. Cuando una vence,
**el kiosco y el panel siguen funcionando normal**, pero alguna tarea
automática deja de hacerse **sin que nadie se entere**, salvo que alguien
revise GitHub → Actions y vea taches rojos. Por eso hay que tener estas fechas
anotadas (en la hoja de credenciales y en un recordatorio del calendario del
Gmail del sistema, un mes antes).

| Qué | Vence | Qué deja de funcionar si vence | Cómo se renueva |
|---|---|---|---|
| **Token de Supabase** (secreto `SUPABASE_ACCESS_TOKEN`) | **25-09-2027** (dura 1 año; Supabase no deja más) | Casi todas las tareas automáticas: **respaldos**, **resumen diario**, publicar el panel, publicar la base y el botón **Crear administrador** | Abajo, "Renovar el token de Supabase" |
| **Token de versiones** (secreto `TOKEN_VERSIONES`) | **No vence** (se creó así; GitHub muestra un aviso amarillo por eso, y está bien: sólo puede subir instaladores a los dos repositorios de versiones) | — | Sólo si se filtra: borrarlo y crear otro igual (sección 9, "Prepararlo", paso 2) |
| **Token de Cloudflare** (secreto `CLOUDFLARE_API_TOKEN`) | **No vence** | — | Sólo si se filtra (sección 10) |
| **Contraseña de aplicación de Gmail** (secreto `CORREO_CONTRASENA_APP`) | **No vence**, pero Google la **anula si se cambia la contraseña del Gmail** | El resumen diario y el correo de "¿Olvidaste tu contraseña?" del panel | Sección 11, "Si cambia la contraseña del Gmail" |
| **Verificación en dos pasos de GitHub** | Obligatoria desde el **12-11-2026** | Si no se activa, GitHub limita la cuenta del sistema | GitHub → foto de perfil → Settings → Password and authentication |
| **Tareas programadas de GitHub** (respaldos y resumen diario) | GitHub las **apaga** si el repositorio pasa **60 días sin cambios** (y nadie va a cambiar el código después de la entrega). Antes manda un correo al Gmail del sistema | Los **respaldos** y el **resumen diario** dejan de hacerse | Abrir el correo de GitHub, o ir a Actions → la tarea → botón **Enable workflow**. Se puede hacer antes de que pase: ver "Tareas periódicas" |

### Renovar el token de Supabase

1. Entrar a <https://supabase.com> con el Gmail del sistema.
2. Arriba a la derecha, el icono de la cuenta → **Account preferences** →
   **Access Tokens** → **Generate new token**.
3. Nombre: `GitHub`. Vencimiento: el más largo que deje. **Generate token**.
4. Supabase muestra el token **una sola vez**: copiarlo.
5. GitHub → repositorio `codigo-del-sistema` → Settings → Secrets and variables
   → Actions → `SUPABASE_ACCESS_TOKEN` → el lápiz (editar) → pegar → **Update
   secret**.
6. Comprobar: Actions → "Publicar en Supabase" → Run workflow → produccion.
   Debe salir verde.
7. En Supabase, borrar el token viejo. Anotar la **nueva fecha de
   vencimiento** en la hoja de credenciales y en el calendario.

### Tareas periódicas

| Cada cuándo | Qué | Dónde se explica |
|---|---|---|
| Cada semana (recomendado) | Revisar el correo del Gmail del sistema: ahí llegan los avisos de GitHub, Supabase y Google (tareas desactivadas, tokens por vencer) | Sección 8 |
| Cada mes (**obligatorio**) | GitHub → Actions → "Respaldo de la base de datos" y "Resumen diario por correo": que estén en verde; si arriba aparece el aviso de que la tarea se desactivó, picar **Enable workflow**. Opcional: bajar el respaldo y subirlo al Drive | Esta sección y la 7 |
| Cada semestre | Registrar en el panel los días festivos y vacaciones del calendario escolar de la UAT | Manual del jefe, sección 4 |
| Cada año | Renovar el token de Supabase | Arriba |
| Antes de retirar una PC | Guardar las fotos en USB y dar de baja el kiosco | Sección 5 |

---

## 9. Publicar una versión nueva del kiosco

Los kioscos **se actualizan solos**. Cada 2 horas preguntan si hay versión
nueva y, si la hay, la descargan sin molestar a nadie. La instalan:

- en una PC **compartida**: la siguiente vez que se cierra el kiosco;
- en una PC **sólo para checar**: de madrugada (2:00 a 5:00), si nadie lo ha
  usado en 5 minutos.

Tarda menos de un minuto, el kiosco vuelve a abrirse solo y no se pierde
ningún dato. Para instalarla en ese momento: **⚙ Administrador → Instalar la
versión nueva** (el botón aparece cuando ya hay una descargada).

### Dónde viven las versiones

En **repositorios públicos aparte que sólo tienen instaladores** (sin código),
en la cuenta del sistema. Uno por ambiente, para que un kiosco de pruebas
nunca baje una versión de producción:

| Ambiente | Repositorio |
|---|---|
| pruebas | `cuenta-del-sistema/versiones-kiosco-pruebas` |
| producción | `cuenta-del-sistema/versiones-kiosco` |

Son públicos porque el kiosco no puede llevar una contraseña para descargar de
uno privado: todo lo que va dentro del instalador se considera público. El
código sigue en el repositorio privado.

### Prepararlo (una sola vez; ya está hecho)

1. En GitHub, con la cuenta del sistema: **New repository** →
   `versiones-kiosco-pruebas`, **Public**, sin nada más. Lo mismo
   con `versiones-kiosco`.
2. Un token para que GitHub pueda publicar ahí: foto de perfil → Settings →
   Developer settings → **Personal access tokens → Fine-grained tokens →
   Generate new token**.
   - Nombre: `publicar-versiones-kiosco`.
   - Vencimiento (*Expiration*): **No expiration** (sin vencimiento). Es
     seguro porque sólo tiene permiso sobre los dos repositorios de versiones.
   - **Repository access → Only select repositories** → los dos de versiones.
   - **Permissions → Contents: Read and write**. Nada más.
3. En el repositorio del código (`codigo-del-sistema`): Settings → Secrets and
   variables → Actions → **New repository secret** → nombre `TOKEN_VERSIONES`,
   valor: el token.

### Publicar una versión (trabajo de programador)

1. Cambiar el número en `apps/kiosco-main/package.json`, en `"version"`
   (por ejemplo, de `1.0.0` a `1.0.1`).
2. En la terminal:
   ```
   git commit -am "Version 1.0.1"
   git tag v1.0.1
   git push && git push --tags
   ```
3. GitHub arma el instalador y lo publica en el repositorio de versiones
   (Actions → "Instalador del kiosco", unos 10 minutos).
4. Listo: en las siguientes horas cada kiosco lo baja y lo instala. En el
   panel, página **Kioscos**, se ve qué versión tiene cada uno.

**Si una versión sale mal:** lo más rápido es **borrarla** en Releases del
repositorio de versiones antes de que los kioscos la bajen. Después, publicar
otra con un número mayor que corrija el problema (los kioscos nunca regresan a
un número menor).

---

## 10. Publicar el panel

El panel es una página web hecha de puros archivos. **GitHub la arma y la sube
a Cloudflare solo**, cada vez que cambia algo del panel en el código. Cloudflare
sólo la sirve, gratis y sin límite de visitas.

| Dirección | Con qué base habla |
|---|---|
| <https://panel.mi-cuenta.workers.dev> | **Producción** (la del jefe) |
| <https://panel-pruebas.mi-cuenta.workers.dev> | **Siempre pruebas** (para ensayar) |

- **Cuenta:** Cloudflare, se entra **con Google** (el Gmail del sistema).
- **A qué base se conecta:** lo deduce solo, con los secretos de Supabase. No
  hay que copiar ninguna llave.
- **Volver a publicarlo a mano** (por ejemplo, si una publicación falló):
  GitHub → Actions → **"Publicar el panel"** → Run workflow.

**Secretos que usa:** los de Supabase (`SUPABASE_ACCESS_TOKEN`,
`SUPABASE_REF_PRUEBAS`, `SUPABASE_REF_PRODUCCION`) y estos dos:

| Secreto | Qué es | De dónde sale |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | El permiso para subir el panel | Cloudflare → icono de la cuenta → Profile → API Tokens → plantilla "Edit Cloudflare Workers", sin fecha de fin |
| `CLOUDFLARE_ACCOUNT_ID` | El número de la cuenta de Cloudflare | Cloudflare → Workers & Pages → Account details |

Si falta alguno, la publicación sale en rojo y dice cuál. Mientras tanto, el
panel en línea **se queda como estaba**: nunca se queda sin panel.

**Si el token de Cloudflare se filtró o dejó de servir:** Cloudflare → icono
de la cuenta → Profile → API Tokens → en ese token, **Roll** (da uno nuevo) →
pegarlo en el secreto `CLOUDFLARE_API_TOKEN`.

---

## 11. Supabase: la base de datos en internet

### Cosas que pueden pasar

- **El proyecto se "pausa":** el plan gratuito de Supabase pausa un proyecto
  que pasa 7 días sin uso. No debería pasar (los kioscos se reportan cada
  minuto y los respaldos corren dos veces por semana). Si pasa:
  supabase.com → el proyecto → **Restore**. Mientras tanto los kioscos siguen
  registrando y mandan todo al volver.
- **Cambiar la contraseña de la base:** Supabase → el proyecto → Project
  Settings → Database → **Reset password**. Después actualizar en GitHub el
  secreto `SUPABASE_PASSWORD_PRODUCCION` (o `_PRUEBAS`). Si no, los respaldos
  salen en rojo.
- **La llave secreta (`service_role`)** no se guarda en ningún lado, a
  propósito: las tareas de GitHub se la piden a Supabase cuando la necesitan.
  Si alguna vez apareció escrita en algún archivo: Supabase → Project
  Settings → API → **regenerarla**.
- **Cambios a la forma de la base:** **nunca a mano** en supabase.com. Se hacen
  con una migración nueva en el código (trabajo de programador) y GitHub la
  publica sola.

### El correo de "¿Olvidaste tu contraseña?" del panel

Se configura **solo**: la tarea "Publicar en Supabase" le pone a la base la
dirección del panel, el texto del correo en español y el envío con el Gmail
del sistema (si existen los secretos `CORREO_USUARIO` y
`CORREO_CONTRASENA_APP`). No hay que entrar a supabase.com.

**Probarlo:** en el panel, "¿Olvidaste tu contraseña?" con tu propio correo.
Si no llega: revisar la carpeta de spam; luego Supabase → el proyecto →
**Logs → Auth**, que dice el error (casi siempre la contraseña de aplicación).

**Si cambia la contraseña del Gmail del sistema:** Google anula todas las
contraseñas de aplicación. Hay que crear otra (cuenta de Google → Seguridad →
Contraseñas de aplicaciones → nombre `Supabase` → **Crear**), copiar las 16
letras sin espacios, pegarlas en el secreto `CORREO_CONTRASENA_APP` y correr
Actions → "Publicar en Supabase" → produccion.

### Nadie puede entrar al panel

Si todos los administradores olvidaron su contraseña y el correo no llega:

- **La llave maestra:** GitHub → Actions → **Crear administrador** → Run
  workflow → el correo y nombre de esa persona. Si la cuenta ya existe, le pone
  una **contraseña temporal nueva** y la deja **activa como administrador**.
  La contraseña temporal aparece en el **resumen** de la corrida (al abrirla,
  arriba). Al entrar al panel, pide ponerse una propia. Después se puede
  borrar esa corrida (los tres puntos → Delete workflow run).
- **Otra forma:** supabase.com → el proyecto → Authentication → **Users** →
  buscar el correo → los tres puntos → **Send password recovery** (manda el
  mismo correo del panel).

**Ningún dato se pierde** en ninguno de estos casos: la cuenta para entrar y
los registros de asistencia son cosas separadas. Por eso conviene que siempre
haya **al menos dos administradores** (el jefe y soporte): si uno olvida su
contraseña, el otro le da una temporal desde Accesos.

---

## 12. El resumen diario por correo

Lo manda la tarea **"Resumen diario por correo"**, cada mañana de lunes a
sábado, con lo del día anterior: retardos, faltas, quién no registró salida,
qué revisar en el kiosco y si algún kiosco o cámara falla. Usa tres secretos:
`CORREO_USUARIO` y `CORREO_CONTRASENA_APP` (desde dónde se manda) y
`CORREO_JEFE` (a quién le llega).

Al entregar el sistema, `CORREO_JEFE` es el **mismo Gmail del sistema**, para
no llenarle la bandeja al jefe. Para que le llegue a otra persona: GitHub →
Settings → Secrets and variables → Actions → `CORREO_JEFE` → el lápiz →
escribir el correo → **Update secret**. Varios correos van separados por coma.

Si falta alguno de los tres secretos, o venció el token de Supabase, el
resumen **no se manda** (y la corrida sale en rojo).

---

## 13. Datos de demostración (sólo en pruebas)

Para enseñar el sistema o probar los reportes sin personal real: en el panel
de **pruebas**, Configuración → "Permitir datos de demostración" en **1**. En
Empleados aparece el botón **Generar datos de demostración**: crea 5 personas
inventadas (marcadas **DEMO**, una de ellas velador) con 1 a 3 semanas de
registros, algunos con retardo, falta, sin salida o foto tapada.

En **producción** esa opción viene en **0** y debe quedarse así: si se
prende, las personas inventadas se mezclan con el personal real en los
reportes.

---

## 14. Problemas comunes

| Lo que pasa | Por qué suele pasar | Qué hacer |
|---|---|---|
| El kiosco dice "sin conexión" | No hay internet, o Supabase se pausó | Revisar el internet de la PC; si está bien, sección 11 |
| El kiosco dice "dado de baja" o pide alta | Lo dieron de baja en el panel, o se copió a otra PC | Generar un código nuevo en el panel y darlo de alta (sección 3) |
| "Cámara no disponible" | Cable suelto, u otro programa está usando la cámara | Reconectar la cámara; cerrar otros programas. Mientras, se sigue registrando |
| Muchos registros con "Foto no guardada" | Disco lleno | Liberar espacio en el disco |
| "Hora dudosa" en todos los registros | La pila del BIOS se acabó, o la zona horaria está mal | Cambiar la pila; en Windows, poner hora y zona automáticas |
| El panel no muestra un cambio reciente | Falló "Publicar el panel" | GitHub → Actions → abrir la corrida en rojo y leer el error (casi siempre un secreto) |
| El panel abre pero no deja entrar a nadie | Nadie tiene cuenta, u olvidaron todas las contraseñas | Sección 11, "Nadie puede entrar al panel" |
| El jefe no puede entrar al ⚙ Administrador del kiosco | No ha puesto su usuario del kiosco, o el kiosco no se ha actualizado | Panel → Mi cuenta; esperar unos minutos con internet |
| El kiosco muestra "Registros que la oficina no aceptó" | La persona no existe en el panel, o el kiosco estaba dado de baja | Arreglar la causa en el panel y, en el kiosco, "Volver a enviarlos" |
| Varias tareas de Actions en rojo a la vez | **Venció el token de Supabase** | Sección 8, "Renovar el token de Supabase" |
| Una tarea de Actions en rojo | Un secreto mal copiado, vencido o cambiado | Abrir la corrida y leer el primer error |
| No llega el correo de "¿Olvidaste tu contraseña?" | Cambió la contraseña del Gmail, o el correo cayó en spam | Sección 11, "El correo de ¿Olvidaste tu contraseña?" |
| No llega el resumen diario | Falta un secreto `CORREO_*`, venció el token de Supabase, o GitHub apagó la tarea por inactividad | Secciones 12 y 8 |
| No hay respaldos recientes en Actions | GitHub apagó la tarea por 60 días sin cambios, o venció el token de Supabase | Sección 8: **Enable workflow** o renovar el token |

---

## 15. Trabajar en el código (para programadores)

Lo que hay que saber antes de cambiar algo: `docs/curso/estado-actual.md` y
`docs/decisiones.md`.

Requisitos: Node 24, Docker Desktop y Git.

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
npm run probar                    # kiosco
npm run probar:sincronizacion     # kiosco <-> nube local
npm run supabase:probar           # esquema, RLS, reportes, ARCO
npm run supabase:funciones:probar # Edge Functions
npm run panel:probar              # el panel usado como el jefe (con panel:servir corriendo)
```

Antes de `npm run probar`, correr
`node --check apps/kiosco-main/probar-autenticacion.cjs`: si el archivo no
carga, Electron deja ventanas de error en pantalla.

Si el servidor local de Edge Functions no toma un cambio:
`docker restart supabase_edge_runtime_kiosko-asistencia`.

Al subir a `main`, GitHub corre las pruebas; si pasan, publica la base y el
panel solos. `npm run supabase:primer-admin` hace lo mismo que la tarea "Crear
administrador", pero pide la llave secreta de Supabase en la PC: preferir la
tarea de GitHub.

Registro del programa (para depurar): el kiosco escribe en la consola de
Electron; en desarrollo se ve en la terminal de `npm run kiosco:dev`.
