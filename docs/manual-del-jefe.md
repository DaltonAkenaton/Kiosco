# Manual del jefe

> Para quien revisa la asistencia y administra el sistema. No hace falta saber
> de computadoras. Cada término raro en el panel tiene un **ⓘ**: púlsalo y te
> explica en palabras simples.

---

## 1. Cómo funciona todo, en un minuto

```
   PASILLO                              TU OFICINA
 ┌──────────────┐    internet     ┌─────────────────────┐
 │   KIOSCO     │ ──────────────► │  PANEL (navegador)  │
 │ cámara + PIN │  registros,     │  asistencia,        │
 │ fotos (aquí) │  NUNCA fotos    │  reportes, ajustes  │
 └──────────────┘                 └─────────────────────┘
```

- El personal checa en el **kiosco**: elige su número de la lista (o escribe su
  número de empleado, según Configuración), teclea su PIN, y el kiosco toma una
  foto.
- La **foto se queda en el kiosco**, con candado. Nunca viaja por internet.
- El **registro** (quién, a qué hora, entrada o salida) llega a tu **panel** en
  segundos. Si no hay internet, el kiosco lo guarda y lo manda cuando vuelve.
- El panel **calcula** retardos, faltas y horas con las reglas que tú pones.
  Si cambias una regla, los reportes (también los viejos) se recalculan solos.

**El sistema informa; no descuenta.** Lo que se haga con un retardo lo decides tú.

---

## 2. Entrar al panel

1. Abre en el navegador la dirección del panel (está en la hoja de credenciales).
2. Correo y contraseña. La primera vez, el sistema te pide cambiar la
   contraseña temporal por una tuya.
3. Arriba está el menú, siempre visible. **Salir** está a la derecha.

**¿Olvidaste la contraseña?** Tres caminos, del más fácil al último recurso:

1. En la pantalla de entrada, escribe tu correo y pica **¿Olvidaste tu
   contraseña?** → **Mandarme el correo para cambiarla**. Te llega un correo
   (revisa también *spam*) con un enlace; al abrirlo pones una contraseña nueva
   y entras directo. El enlace sirve una sola vez y por poco tiempo.
2. Si el correo no llega, pídele a otro administrador que te dé una
   contraseña temporal en **Accesos → Contraseña nueva**.
3. Si nadie puede entrar, quien da soporte te da una contraseña temporal
   desde GitHub (manual técnico, "Nadie puede entrar al panel").

En ningún caso se pierde información: sólo cambia la contraseña.

**La sesión se cierra sola** si el panel se queda sin usar (30 minutos, se
cambia en Configuración). Un minuto antes aparece un aviso con el botón
**Sigo aquí**. Es para que una computadora que se queda abierta no deje el
sistema a la mano de cualquiera.

Las ventanas (por ejemplo, "Registrar a mano") se cierran con **Esc** o
picando fuera de ellas. Las que muestran un PIN o una contraseña **una sola
vez** no: esas sólo se cierran con su botón, para que no se pierda el dato por
un clic accidental.

---

## 3. El día a día

### Pendientes (lo que hay que atender con el personal)

Es la **primera pestaña**, y el panel **abre ahí** cuando hay algo sin atender
(el número rojo junto a "Pendientes" dice cuántos). Así lo del viernes sigue
ahí el lunes.

Cada **caso** es algo de una persona que conviene revisar:

| Caso | Cuándo sale |
|---|---|
| **Llegó tarde** | Llegó tarde ese día los minutos de Configuración → Pendientes (15) o más |
| **Tarde en la semana** | Sus minutos tarde de lunes a domingo suman 30 o más. Cuentan **desde su hora de entrada**, aunque estén dentro de la tolerancia: 12 minutos cinco días = 60 |
| **Faltó** | Le tocaba, no vino y no tiene permiso registrado |
| **No registró su salida** | Entró y nunca marcó salida |
| **Registró después de su baja** | Alguien checó con una persona que ya diste de baja |
| **Cámara tapada** | Checó con la cámara tapada |

Cada persona es **una tarjeta corta**: qué tiene ("9 faltas, cámara tapada 2
días") y entre qué fechas. Pica la tarjeta (o **Ver los casos**) para ver cada uno. Las tarjetas no
cambian de lugar mientras estás en la página. Si
alguien **faltó varios días seguidos**, la tarjeta te pregunta si está
enfermo, de vacaciones o ya no trabaja aquí: regístralo en **Incidencias** (o
dalo de baja) y esas faltas se cierran solas. Para ver a una sola persona,
escribe su nombre o número en **Empleado**.

En cada caso:

- **Ver su reporte** (faltas y llegadas tarde): abre **Reportes**, día por
  día, en la semana del caso. Ahí ves su horario, cuántos minutos llegó tarde
  cada día ("+4, +14, +52" suman los 70 de la semana) y el botón Justificar.
  El día del caso sale **resaltado en amarillo** (en "Tarde en la semana", los
  días que llegó tarde).
- **Ver sus registros** (salida sin registrar, cámara tapada, registro de
  alguien dado de baja): abre **Asistencia** con esa persona y ese día, que es
  donde se corrige el registro.
- **Registrar incidencia** (sólo en faltas y llegadas tarde): si estaba
  enfermo, tenía permiso o llegó tarde con razón, regístralo ahí mismo. El caso
  se cierra solo y el reporte ya no lo cuenta. Si faltó varios días seguidos,
  la tarjeta trae un botón para registrarlos todos de una vez.
- **Atender**: escribe **qué se hizo** ("Se habló con la persona", "Se levantó
  acta", "Tenía permiso"…; las respuestas de siempre se ponen con un clic). El
  caso pasa a **Atendidos (historia)**, con quién lo atendió y cuándo. Esa es
  la historia de cada persona.
  **Ojo: atender sólo anota; la falta sigue contando.** En una falta o una
  llegada tarde, la ventana trae la casilla **Además, justificar ese día**:
  márcala y elige como qué (permiso, incapacidad, no se registró…) para que
  ya no cuente en los reportes; queda también en **Incidencias**. Las
  respuestas "Tenía permiso del jefe" y "Fue un error del registro" la marcan
  solas; "Se habló con la persona" y "Se levantó acta" la desmarcan (la falta
  sigue contando). Si escribes otra cosa, tú decides si la marcas. Antes de
  guardar, el panel **te pregunta** en grande: "quedará justificada como:
  **Permiso**". Si no es el tipo correcto, **Cancelar** te regresa sin perder
  lo escrito. En **Atendidos** cada falta o retardo dice **✓ Día justificado:
  (tipo)** o **Sigue contando como falta**; si luego quitas la incidencia en
  Incidencias, también aquí deja de decirlo.
  Al atender **Tarde en la semana**, un recuadro
  amarillo te pregunta por **cada día** que llegó tarde esa semana (todos
  marcados): los marcados se cierran junto con la semana; desmarca el que
  vayas a atender aparte (por ejemplo, con su propia acta).
- Si un caso **deja de aplicar** (registras un permiso o vacaciones para ese
  día, registras su salida a mano, cambias su horario), **se cierra solo** y
  dice por qué.
- **Reabrir**: si atendiste uno por error, en Atendidos.
- En **Atendidos** salen los 100 más recientes; abajo, **Ver más antiguos**
  trae los siguientes. Elige una persona en **Empleado** para ver toda su
  historia.

Las reglas (los 15 y 30 minutos, y cuáles casos van a Pendientes) se cambian en
**Configuración → Pendientes**. Con **0** en los minutos, esa regla se apaga.
**Revisar desde** es la fecha desde la que se buscan casos: se puso sola el
día en que se instaló esta versión, para no empezar con cientos de casos
viejos. Muévela hacia atrás si quieres ver días anteriores.

### Notas

Para anotar lo que hay que hacer sin papelitos ni el celular. Cada nota puede
llevar **casillas** que se palomean con un clic. Arriba hay un **buscador** y
tres botones: **Por hacer** (lo normal), **Todo hecho** (las notas con todas
sus casillas palomeadas) y **Todas**. Al escribirla eliges **quién
más la ve**: **Sólo yo**, **Todos** (los que entran al panel) o **Algunos**
(eliges a quiénes). Quien la ve la puede palomear; cambiar quién la ve o
borrarla, sólo quien la escribió. Si una nota habla de un empleado, escribe
hechos ("trae justificante el lunes"), no opiniones.

Al palomear la última casilla en **Por hacer**, la nota no desaparece de
golpe: se queda a la vista con **✔ Todo hecho** hasta que cambies de botón.
Si estás escribiendo una nota y pulsas **Esc** o picas fuera de la ventana,
te pregunta antes de tirar lo escrito.

### Asistencia (la pantalla principal)

Arriba, en rojo, **⚠ Para atender**: lo que conviene revisar, aunque estés en
otra cosa. Por ejemplo: una cámara que lleva rato sin funcionar, una cámara
que **se desconecta a ratos** (señal de que se va a descomponer), o registros
de **personas que ya estaban dadas de baja**. Cada aviso tiene su botón: **Ver
en Kioscos** o **Ver cuáles** (pone solo el filtro para verlos). El aviso se va
solo cuando se arregla lo que lo causa.

¿Ya lo revisaste? Pica **✓ Ya lo vi** y se esconde (también el número del
menú). Vuelve a salir **sólo si empeora**: si la cámara se desconecta otra
vez, si se vuelve a caer, o si llega un registro nuevo. Se recuerda en esa
computadora: si otro administrador entra desde la suya, lo sigue viendo
hasta que también lo marque.

En el menú de arriba, un **número rojo** junto a *Asistencia* o *Kioscos* dice
cuántos avisos hay ahí. Se ve desde cualquier página.

Lista de todos los registros. Filtra por fecha, persona, **turno**, kiosco y
**Revisión** (los filtros se recuerdan mientras la pestaña esté abierta):

- *Sólo los que tienen algo raro*: sin foto, foto tapada, hora dudosa,
  captura manual, cuarentena.
- *Revisar la foto en el kiosco*: los que conviene ver en persona. Junta varios
  y ve una sola vez al kiosco (ver sección 5).

Las etiquetas de cada registro:

| Etiqueta | Qué significa | ¿Qué hago? |
|---|---|---|
| ✖ Sin foto (en rojo) | La cámara no funcionaba: desconectada, tapada o descompuesta. | Si es raro, nada. Si le pasa seguido a la misma persona, revisa: desconectar la cámara es la trampa más fácil. |
| ✖ Foto tapada (en rojo) | La foto salió negra: alguien tapó la cámara. | Ve la foto en el kiosco. |
| ⚠ Falta en el kiosco / ⚠ Alterada | Alguien tocó los archivos de las fotos. | Lo más grave: avisa a soporte. |
| Borrada por antigüedad (en gris) | Pasaron los días de Configuración y la foto se borró sola. | Nada: es lo normal. |
| Foto no guardada | La cámara sí servía, pero la computadora no pudo guardar la foto. | Avisa a soporte. |
| Hora dudosa | La hora de la computadora parecía movida. | Compara con los demás registros de ese día. |
| Captura manual | La registró un administrador a mano. | Nada: ya tiene su motivo. |
| En cuarentena | Llegó de un kiosco dado de baja. | Revísalo antes de tomarlo en cuenta. |
| Persona dada de baja | La persona ya estaba dada de baja cuando registró. Pasa cuando el kiosco estaba sin internet y todavía no se enteraba de la baja. | Decide tú: si sí trabajó, déjalo; si no, **Corregir → Anular**. |

**+ Registrar a mano**: para cuando no hubo luz, se cayó el kiosco o alguien
olvidó su PIN. Pide persona, entrada o salida, fecha, hora y el **motivo**.

**Corregir** un registro: si alguien picó "entrada" cuando salía, o checó dos
veces. El registro original **nunca se borra**: la corrección queda aparte, con
tu nombre y el motivo, y el reporte ya la toma en cuenta.

### Reportes

Elige el rango de fechas. Dos vistas:

- **Día por día**: cada persona, cada día: a qué hora entró y salió, retardo,
  falta, horas trabajadas.
- **Resumen por persona**: cuántos retardos, faltas, minutos tarde y horas en
  el periodo. Con **Ordenar por** ves arriba a quien **faltó más**, tuvo **más
  retardos** o sumó **más minutos tarde**. **Ver sus días** (bajo cada nombre)
  abre el día por día de esa persona.

**Periodo**: botones de un clic para no batallar con los calendarios: Esta
semana, Este mes, Mes pasado, Últimos 3 meses y Este año. Ejemplo: "¿quién
faltó más el mes pasado?" → **Resumen por persona** → **Mes pasado** →
Ordenar por **Más faltas primero**.

**⬇ Descargar Excel**: baja un archivo de Excel con **dos hojas** ("Resumen
por persona" y "Día por día"; la que estás viendo va primero), con cada dato
en su columna, títulos en negritas y filtros listos. Se abre con doble clic.

**🖨 Imprimir o PDF**: abre la ventana de impresión con el reporte en hoja
horizontal y sin los botones. Para tener un PDF, en "Destino" elige
**Guardar como PDF**. Sirve para mandarlo por correo o archivarlo.

(Los mismos dos botones están en **Asistencia**, para la lista de registros.)

Cómo se decide cada cosa (se ajusta en **Configuración**):

- **A tiempo**: llegó dentro de la tolerancia (10 minutos por defecto).
- **Retardo**: llegó después de la tolerancia.
- **Retardo mayor**: llegó más de 30 minutos tarde (configurable). **Sí vino**:
  no es falta.
- **Repuso X min**: llegó tarde y se quedó más tiempo al salir. El sistema lo
  informa; qué hacer con eso lo decides tú.
- **Todavía no llega**: su turno ya empezó y no ha registrado entrada. Puede
  llegar tarde; si termina su turno sin llegar, es falta.
- **Programado**: su turno de ese día todavía no empieza (días futuros).
- **Sin entrada**: registró su **salida** pero no su entrada: sí vino. No es
  falta; con **Justificar → No se registró** el día cuenta completo.
- **Falta**: **no vino** en todo su turno. Si fue por enfermedad, un accidente
  u otra razón válida, regístralo en **Ausencias** (falta justificada o
  incapacidad) y deja de contar como falta.
- Si prefieres la regla de antes (llegar muy tarde = falta), en Configuración
  pon "Llegar muy tarde cuenta como falta" en **Sí**.
- **Tiempo extra**: se quedó después de su hora de salida (desde 30 minutos,
  configurable; salir 5 minutos tarde no cuenta). Aparece como "+X extra"
  debajo de la hora de salida. Si llegó tarde, primero se descuenta lo que
  repuso. Un **turno doble** (14 o 16 horas) se ve así: su día normal más el
  tiempo extra. El sistema lo informa; no paga ni descuenta nada.
- **No registró salida**: entró y no marcó salida. El sistema **no inventa** la
  hora: corrígelo tú con "Registrar a mano" si sabes a qué hora salió. Si al
  día siguiente ya registró su entrada nueva, el día anterior queda en "No
  registró salida" en ese momento y el día nuevo se cuenta normal.
- **Ausencia justificada** / **Festivo**: lo que registres en Ausencias.

### Resumen diario por correo

Cada mañana (lunes a sábado) llega un correo con lo de ayer: retardos, faltas,
quién no registró salida, qué hay que revisar en el kiosco y si algún kiosco o
cámara está fallando.

Llega al **correo del sistema** (el Gmail de la hoja de credenciales), no al
tuyo, para no llenarte la bandeja: ábrelo cuando quieras revisar. Lo mismo lo
ves en el panel en cualquier momento. Si prefieres recibirlo en tu correo,
pide a soporte que lo cambie (manual técnico, "Resumen diario").

---

## 4. Administrar (sólo el rol **Administrador**)

### Empleados

- **+ Agregar empleado**: nombre y apellidos. El sistema propone el usuario y
  **genera un PIN temporal**. Te lo muestra **una sola vez**: imprímelo o
  anótalo y dáselo a la persona en privado. La primera vez que cheque con él,
  el kiosco le pide **elegir uno propio** (como en el cajero del banco); así
  nadie más lo conoce, ni tú. Mientras no lo elija, en la lista dice
  "Todavía no elige su PIN".
- **Después del alta**, en la ventana del PIN, pica **Siguiente: asignar su
  horario**: abre el editor de horarios con esa persona ya elegida. También
  hay un botón **Horario** en cada persona de la lista. El **número de
  empleado es obligatorio**: de 4 a 12 letras o números (como A12345), sin
  espacios. El panel lo guarda en mayúsculas.
- **Importar lista de Excel**: para muchos a la vez. En la ventana, **⬇
  Descargar plantilla**: es un Excel con las columnas listas, dos renglones de
  ejemplo y una hoja de **Instrucciones**. Borra los ejemplos, escribe un
  renglón por persona, guárdala y elígela. Al final imprime la hoja con todos
  los PIN.
- **⬇ Descargar lista (Excel)**: la lista del personal (número, nombre,
  usuario, si está activo y si ya cambió su PIN), cada dato en su columna.
- **PIN nuevo**: si alguien lo olvidó. El viejo deja de servir y el nuevo es
  temporal: al checar con él, elige otro propio.
- **Dar de baja**: ya no puede checar y **su horario termina ese día** (ya no
  le cuentan faltas). **No se borra nada**; se puede reactivar, y entonces hay
  que asignarle su horario otra vez en Horarios.
- **Sus datos (ARCO)**: muestra una **constancia** con todo lo que el sistema
  tiene de esa persona, para imprimirla o guardarla como PDF (y, si la pide,
  el archivo de datos). Es para cuando la persona lo solicita por escrito: la
  UAT, como institución pública, está obligada a entregárselo.
- **Suprimir sus datos**: sólo con autorización de la **Unidad de
  Transparencia**. Borra su nombre de todo el sistema, **no se puede deshacer**.
  Sus registros de entrada y salida se quedan, sin nombre. Antes hay que darla
  de baja. Si tenía fotos marcadas "Conservar" en el kiosco, quítales la marca
  allá. Lo que ustedes escribieron a mano en **Notas** no se toca solo:
  busca su nombre en Notas y edita o borra lo que hable de esa persona.

Cada cambio te pide un **motivo** y queda en la **Bitácora**.

### Horarios

- **Turnos**: plantillas (Matutino 06–14, Vespertino 14–22, Nocturno 22–06).
  El nocturno cuenta para el día en que **empieza**. Si cambias las **horas**
  de un turno, el panel pregunta **"¿a partir de qué día?"**: los días
  anteriores se siguen calculando con el horario viejo, así nadie aparece con
  retardos que no tuvo.
- **Horario de cada persona**: qué turno, qué días, y si algún día entra a otra
  hora (por ejemplo, el sábado a las 7). Un cambio de horario es "a partir del
  día X": los días anteriores se siguen calculando con el horario viejo.
- Quien **no tiene horario** no tiene retardos ni faltas: sólo se ven sus registros.

**Paso a paso: ponerle horario a una persona**

1. Panel → **Horarios**. Abajo está la tabla **"Horario de cada persona"**.
2. En su renglón, pica **Poner horario** (o **Cambiar horario** si ya tenía).
3. **Turno**: elige matutino, vespertino o nocturno.
4. **A partir del**: el día desde el que vale. Para alguien nuevo, el día que
   empieza a trabajar.
5. **Qué días trabaja**: marca la casilla de cada día (por ejemplo, lunes a
   viernes y sábado).
6. Si **un día entra a otra hora** (por ejemplo, el sábado de 7:00 a 13:00):
   en ese día marca **otra hora** y escribe la entrada y la salida.
7. Escribe el **motivo** (por ejemplo, "alta" o "cambió al turno
   vespertino") y pica **Guardar horario**.

Al **importar la lista de Excel** no se ponen los horarios: después de
importar, pasa a **Horarios** y ponle el suyo a cada persona. Al dar de alta a
**una** persona, el botón **Siguiente: asignar su horario** te trae directo
aquí.

**Cambios por un día** (abajo en Horarios): para **un solo día**.

- **El horario de una persona**: ese día entra a otra hora, o **descansa**.
- **Dos personas se intercambian el turno**: "el viernes Juan cubre a Pedro y
  Pedro a Juan". Antes de guardar, el panel dice cómo queda cada quien.

Ese día los retardos y las faltas se miden contra el cambio; el resto de los
días sigue igual. Sin esto, quien cubre a otro aparecería con **falta** en su
turno y llegando a una hora rara en el del otro (y le saldrían pendientes que
no son). En **Reportes** ese día dice "cambio del día" o "intercambio". Con
**Quitar** se deshace (un intercambio se quita para los dos).

**Si los turnos de la facultad son a otras horas:** en **Turnos**, pica
**Cambiar** en el turno (o **+ Nuevo turno**) y pon su hora de entrada y de
salida. Hazlo **antes** de poner los horarios de las personas.

### Incidencias y días festivos

Una incidencia es algo fuera de lo normal. Hay dos familias, y cuentan distinto:

**Ausencia justificada** (no vino, con razón): no es falta, pero no suma horas.
- **Vacaciones**.
- **Incapacidad**: enfermedad, accidente, maternidad (con papel del IMSS/ISSSTE).
- **Permiso**: fallecimiento de un familiar, nacimiento de un hijo, trámites.
- **Comisión**: está trabajando, pero en otro lugar.
- **Falta justificada**: faltó por una razón válida sin papel (amaneció enfermo).

**Se da por bueno** (el problema no fue suyo): el día cuenta **normal y
completo**, con las horas de su turno.
- **No se registró**: sí vino, pero olvidó checar o el kiosco no lo tomó.
- **Falla del sistema**: se cayó el kiosco, el internet o la luz.
- **Retardo justificado**: llegó tarde por una razón aceptada.

La pantalla **Incidencias** trae esta misma explicación arriba de la lista, y
cada renglón lleva su etiqueta (**ausencia justificada** o **se da por
bueno**); al pasar el mouse por encima dice qué significa.

Formas de registrarla:
- **+ Registrar incidencia**: para **una persona**, para **todos los de un
  turno** o para **todos los que tenían turno** esos días (por ejemplo, "se
  cayó el sistema el martes").
- Desde **Reportes → Día por día**: en cada falta, retardo o salida sin
  registrar hay un botón **Justificar**, que abre la ventana ya llena con la
  persona, el día y el tipo más probable.

Los registros de entrada y salida **nunca se tocan**: la incidencia sólo cambia
cómo se califica el día. Si te equivocas, **Quitar** la regresa a como estaba.

**Para encontrar una incidencia**, arriba de la lista hay filtros: **Empleado**,
**Tipo** (por ejemplo, sólo incapacidades), **Desde / Hasta** y **Buscar en las
notas** (por ejemplo "IMSS"). Debajo dice cuántas son y cuántos días suman.
Ejemplo: "¿cuántos días de incapacidad lleva Juan este año?" → Empleado: Juan,
Tipo: Incapacidad, Desde: 1 de enero. **Quitar filtros** vuelve a mostrar todo.
- **+ Agregar día festivo**: ese día nadie tiene falta. Es de un día a la vez:
  para periodos largos, usa vacaciones (abajo).

**Vacaciones de la universidad** (diciembre, Semana Santa, verano):
- **Si descansan todos:** **+ Registrar incidencia** → tipo **Vacaciones** →
  **Todos los que tenían turno esos días** → fecha de inicio y de fin. Un solo
  registro cubre a todo el personal y todo el periodo.
- **Si unos descansan y otros se quedan de guardia:** registra las vacaciones
  **persona por persona**, sólo a los que se van. Los que se quedan siguen con
  su horario normal.
- Si alguien con vacaciones sí vino a trabajar, **sus horas cuentan** igual.

**Consejo:** al empezar cada semestre, con el **calendario escolar de la UAT**
en la mano, registra de una vez los días festivos y los periodos vacacionales.
Así nadie amanece con faltas que no son.

### Kioscos

Arriba, **⚠ Para atender**: kioscos sin conexión, cámaras caídas, cámaras que
**se desconectan a ratos** (conviene revisar el cable o tener otra cámara a la
mano antes de que falle del todo) y fotos que faltan. Son los mismos avisos de
Asistencia. La página se actualiza sola cada minuto; con **↻ Actualizar** lo
ves al momento.

¿Cuándo avisa? Se ajusta en **Configuración → Cámara**: "Minutos de cámara
caída para avisar" (15) y "Desconexiones de cámara para avisar" (3 en 7
días).

- **+ Dar de alta un kiosco**: nombre y ubicación. Da un **código de 8
  letras** que dura 15 minutos. En el kiosco, abajo, se pica **Dar de alta** y
  se escribe el código.
- **Dar de baja este kiosco**: si se robaron o se retiró la PC. Deja de poder
  enviar al instante. Lo que ya había registrado antes de la baja llega "en
  cuarentena" para que lo revises: nunca se pierde.

### Configuración

Las reglas del sistema: tolerancia, minutos para "retardo mayor", horas para
"no registró salida", días que se guardan las fotos, intentos de PIN, umbrales
de la cámara y del reloj… Cada una tiene su ⓘ y su rango permitido. Si un
valor choca con otra regla (por ejemplo, una tolerancia mayor que los minutos
de "retardo mayor"), el panel no lo deja guardar y explica por qué. Un cambio
llega a los kioscos en unos minutos y los reportes se recalculan solos.

**Checar con el número de empleado** (Configuración → Kioscos): con "Sí", en
el kiosco cada quien escribe su **número de empleado** (puede llevar letras,
como A12345) y **Enter**, y luego su PIN; ya no se ve la lista de nombres. Con
"No", cada quien elige su nombre de la lista. **Antes de encenderlo**, ponle
su número a todos en **Empleados → Corregir datos**: el panel no te deja
encenderlo si falta alguien, y si después das de alta a alguien sin número,
Empleados te avisa en rojo (no podría checar).

### Respaldo (una copia de todos los datos)

**Configuración → Respaldo → Descargar respaldo**: baja al momento un Excel con
**todos los datos** del sistema, una hoja por cosa (registros, personal,
horarios, ausencias, correcciones…). Sin PIN ni contraseñas. Queda en la
**Bitácora** quién lo bajó y cuándo.

**Cuándo:** por ejemplo, **una vez al mes**. Guárdalo en el Drive de la
facultad, en una carpeta a la que sólo entren quienes deben: **son datos
personales**. No lo dejes en Descargas ni lo mandes por WhatsApp.

Además, el sistema hace **solo** un respaldo completo cada lunes y jueves, sin
que tengas que hacer nada (manual técnico, sección 7).

| Qué | Dónde está su respaldo |
|---|---|
| Registros, personal, horarios, ausencias, correcciones, configuración | **Panel** (este botón) y **automático** cada lunes y jueves |
| **Las fotos** | **Sólo en el kiosco**: modo administrador → **Guardar en memoria USB**. El respaldo del panel **no** las trae, porque las fotos nunca salen del kiosco |

### Accesos

Quién puede entrar al panel.

- **+ Dar acceso a alguien**: nombre, correo y qué puede hacer:
  - **Supervisor**: ver todo y registrar a mano.
  - **Administrador**: todo (reglas, empleados, kioscos, accesos).
- El sistema da una **contraseña temporal** (se muestra una vez). Al entrar,
  la persona pone la suya.
- **Contraseña nueva**, **Hacer administrador/supervisor**, **Quitar acceso**.
- Nadie puede cambiarse a sí mismo, y siempre queda al menos un administrador.

### Bitácora

Todo cambio hecho en el sistema: quién, cuándo, qué había antes, qué quedó y
por qué. Nunca muestra PIN ni contraseñas (de un PIN sólo dice "cambió").

Para encontrar algo, usa los filtros:

- **Qué tipo de cambio**: altas, bajas, cambios de PIN, registros anulados,
  capturas a mano, Configuración, horarios, kioscos, accesos.
- **Quién lo hizo** y **Sobre qué persona** (todo lo que le pasó a alguien:
  su alta, sus PIN, sus correcciones, su baja).
- **Desde / Hasta** y **Buscar en el motivo** (por ejemplo, "prueba").
- **Quitar filtros** vuelve a mostrar todo.

### Mi cuenta

- **Contraseña de este panel.**
- **Usuario y contraseña del kiosco**: para entrar al modo administrador de los
  kioscos (a ver fotos). Es **otra** contraseña, a propósito: si alguien se
  roba un kiosco, no le sirve para entrar al panel.

---

## 5. En el kiosco: ver fotos

Las fotos **sólo** se ven en el kiosco.

1. Mantén presionado **3 segundos** el letrero de arriba del kiosco (**"UAT FCACS Nuevo Laredo"**): se abre la ventana del **modo administrador**. (Desde la versión 1.0.4 ya no hay botón "Administrador" a la vista.)
2. Tu usuario y contraseña **del kiosco** (los de "Mi cuenta").
   Un error te regresa a la pantalla principal y queda anotado.
3. Filtra por fecha, persona o revisión. Pica un registro para ver su foto.
   Con **Ampliar** o doble clic, se hace grande (rueda del ratón = zoom).
4. **Conservar**: si hay una queja o duda, marca la foto para que **no se
   borre** a los 30 días. Pide motivo. Cuando se resuelva, quítale la marca.
5. **💾 Guardar en memoria USB**: exporta lo filtrado (fotos con marca de
   agua + hoja de Excel). Conecta la memoria antes.
6. **Salir** al terminar. Si no, se cierra solo a los 2 minutos.

Cada foto que ves o exportas queda anotada (quién y cuándo) y llega a la
bitácora del panel.

Lo que también puedes ver ahí:

- **Registros que la oficina no aceptó** (por ejemplo, de alguien que no existe
  en el panel): arregla la causa en el panel y pica **Volver a enviarlos**. Si
  no deben contar (por ejemplo, **pruebas** hechas con el kiosco dado de baja),
  pica **Descartar…** y escribe el motivo: dejan de verse, **no se borran** de
  esa PC, y en el panel, página **Kioscos → Lo que se hizo en los kioscos**,
  queda quién los descartó, cuántos y por qué.
- **Fotos guardadas con un candado anterior**: pasa si se reinstaló Windows.
  Escribe la **contraseña de recuperación** (hoja de credenciales).
- **↻ Sincronizar ahora**: el kiosco habla con la oficina solo, cada minuto.
  Si acabas de cambiar algo en el panel (una baja, un PIN) y no quieres
  esperar, pica este botón. Sin internet no puede hacer nada, pero tampoco se
  pierde nada.
- **🩺 Guardar diagnóstico**: guarda en una memoria USB el "diario" del
  kiosco (lo que le pasó en las últimas dos semanas: cámara desconectada, sin
  internet, errores). Si algo falla, mándaselo a quien da soporte. No lleva
  fotos, PIN ni contraseñas.

### La contraseña de recuperación, en palabras simples

- Las fotos se guardan **con candado**: aunque alguien copie los archivos, no
  puede verlas.
- La **llave** la guarda Windows, escondida. Nunca te la pide: en el día a
  día **no haces nada**.
- Hay casos en que **las fotos siguen en el disco pero Windows pierde la
  llave**: la computadora se descompone y su disco se pasa a otra; se
  reinstala Windows sin borrar el disco; o alguien copió la carpeta de las
  fotos antes de formatear.
- La **contraseña de recuperación** es una **copia de la llave** que tú
  apuntas en papel. En esos casos, con ella se vuelven a abrir.

**Cuándo se usa:** casi nunca. Se define **una vez** en cada kiosco (el aviso
amarillo del modo administrador), se anota en la hoja de credenciales y se
guarda. Si se olvida, nadie puede recuperarla.

**Lo que NO hace:**
- Si se **formatea borrando todo el disco**, las fotos se borran también: la
  contraseña ya no ayuda. Por eso, **antes de formatear o retirar una PC,
  guarda las fotos en una memoria USB** (💾 en el modo administrador).
- Si la computadora se destruye por completo, las fotos de ese kiosco se
  pierden.

En los dos casos los registros de asistencia **no** se pierden: ya están en el
panel.

---

## 6. Cuando algo pasa

| Pasa esto | Haz esto |
|---|---|
| Alguien olvidó su PIN | Empleados → **PIN nuevo**. Mientras, **Registrar a mano**. |
| Alguien tiene que irse a medio turno (una emergencia) | Que marque **SALIDA** en el kiosco al irse. Después, en **Reportes**, ese día sale "(N min antes)" con el botón **Justificar**, que ya propone **Permiso**: escribe el motivo y listo. Sus horas trabajadas sí cuentan. Si se fue sin marcar: **Registrar a mano** su salida, y luego el Permiso. |
| El kiosco está cerrado | Es lo normal si la PC se usa para otras cosas: se abre con su **icono** del escritorio, se registra y se pica **Minimizar** (queda en la barra de tareas, listo para el siguiente) o **Cerrar kiosco**. En el panel, Kioscos lo muestra como "Cerrado" y no es alerta. |
| No puedo entrar al modo administrador de un kiosco nuevo | Primero hay que **darlo de alta**; los administradores le llegan de la oficina. Además tu usuario del kiosco debe estar definido en **Mi cuenta**. |
| Quiero ver los registros que acaban de llegar | En **Asistencia**, botón **↻ Actualizar**. También se actualiza sola cada minuto si estás viendo el día de hoy. |
| Un kiosco dado de baja sigue registrando | Sus registros **no llegan al panel** (a propósito: ya no se confía en él). Se quedan guardados en esa PC. Si la baja fue un error: dale de alta de nuevo con un código y, en ese kiosco, **modo administrador → Registros que la oficina no aceptó → Volver a enviarlos**. (Lo que registró **antes** de la baja y no alcanzó a subir llega solo, marcado "en cuarentena" para revisarlo.) |
| Se fue la luz / no hay kiosco | El personal te avisa por WhatsApp; tú **Registrar a mano** con motivo "sin luz". |
| No hay internet | Nada: el kiosco guarda todo y lo manda al volver. En Kioscos verás "por enviar". |
| El kiosco dice "Sin cámara" | Se sigue registrando, marcado "sin foto". Revisa el cable de la cámara. |
| El panel avisa "la cámara se desconectó N veces" | La cámara falla a ratos: revisa que el cable no esté flojo; si sigue, cámbiala. Es mejor cambiarla antes de que muera. |
| Di de baja a alguien y aun así registró | El kiosco estaba sin internet y no se había enterado. El registro llega marcado **Persona dada de baja** y sale en **⚠ Para atender**: anúlalo si no cuenta. |
| Un kiosco aparece "sin conexión" mucho rato | Revisa que la PC esté prendida y con internet. Si no, soporte. |
| Se robaron o cambiaron la PC | Kioscos → **Dar de baja este kiosco**. Después, alta de la PC nueva. |
| Alguien dice que no llegó tarde | Mira el registro; si hay duda, ve la foto en el kiosco y márcala **Conservar**. |
| Una persona pide sus datos | Empleados → **Sus datos (ARCO)**. |
| Vienen vacaciones o un día festivo | **Ausencias**: el festivo con **+ Agregar día festivo**; el periodo vacacional con **+ Registrar incidencia** → Vacaciones (sección 4, "Vacaciones de la universidad"). |
| Aparecen faltas en días que no se trabajó | Faltó registrar ese festivo o esas vacaciones: regístralos ahora y las faltas desaparecen solas. |

Soporte técnico: ver el [manual técnico](manual-tecnico.md).
