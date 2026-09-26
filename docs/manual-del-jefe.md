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

- El personal checa en el **kiosco**: elige su número de la lista, teclea su
  PIN, y el kiosco toma una foto.
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

¿Olvidaste la contraseña? Pídele a otro administrador que te dé una nueva en
**Accesos → Contraseña nueva**.

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

### Asistencia (la pantalla principal)

Lista de todos los registros. Filtra por fecha, persona, kiosco y
**Revisión**:

- *Sólo los que tienen algo raro*: sin foto, foto tapada, hora dudosa,
  captura manual, cuarentena.
- *Revisar la foto en el kiosco*: los que conviene ver en persona. Junta varios
  y ve una sola vez al kiosco (ver sección 5).

Las etiquetas de cada registro:

| Etiqueta | Qué significa | ¿Qué hago? |
|---|---|---|
| Sin cámara / Sin foto | La cámara no funcionaba. | Nada, si es raro. Si le pasa seguido a la misma persona, revisa. |
| Foto tapada | La foto salió negra: alguien tapó la cámara. | Ve la foto en el kiosco. |
| Foto no guardada | La cámara sí servía, pero la computadora no pudo guardar la foto. | Avisa a soporte. |
| Hora dudosa | La hora de la computadora parecía movida. | Compara con los demás registros de ese día. |
| Captura manual | La registró un administrador a mano. | Nada: ya tiene su motivo. |
| En cuarentena | Llegó de un kiosco dado de baja. | Revísalo antes de tomarlo en cuenta. |

**+ Registrar a mano**: para cuando no hubo luz, se cayó el kiosco o alguien
olvidó su PIN. Pide persona, entrada o salida, fecha, hora y el **motivo**.

**Corregir** un registro: si alguien picó "entrada" cuando salía, o checó dos
veces. El registro original **nunca se borra**: la corrección queda aparte, con
tu nombre y el motivo, y el reporte ya la toma en cuenta.

### Reportes

Elige el rango de fechas. Dos vistas:

- **Día por día**: cada persona, cada día: a qué hora entró y salió, retardo,
  falta, horas trabajadas.
- **Resumen por persona**: cuántos retardos, faltas y horas en el periodo.

**⬇ Descargar para Excel**: baja la vista que estás viendo. Se abre con doble clic.

Cómo se decide cada cosa (se ajusta en **Configuración**):

- **A tiempo**: llegó dentro de la tolerancia (10 minutos por defecto).
- **Retardo**: después de la tolerancia, pero antes de los minutos para falta (30).
- **Falta**: no llegó, o llegó después de esos 30 minutos.
- **No registró salida**: entró y no marcó salida. El sistema **no inventa** la
  hora: corrígelo tú con "Registrar a mano" si sabes a qué hora salió.
- **Ausencia justificada** / **Festivo**: lo que registres en Ausencias.

### Resumen diario por correo

Si se configuró, cada mañana (lunes a sábado) te llega un correo con lo de
ayer: retardos, faltas, quién no registró salida, qué hay que revisar en el
kiosco y si algún kiosco o cámara está fallando.

---

## 4. Administrar (sólo el rol **Administrador**)

### Empleados

- **+ Agregar empleado**: nombre y apellidos. El sistema propone el usuario y
  **genera el PIN**. Te lo muestra **una sola vez**: imprímelo o anótalo y
  dáselo a la persona en privado.
- **Importar lista de Excel**: para muchos a la vez. El ⓘ explica cómo preparar
  el archivo. Al final imprime la hoja con todos los PIN.
- **PIN nuevo**: si alguien lo olvidó. El viejo deja de servir.
- **Dar de baja**: ya no puede checar. **No se borra nada**; se puede reactivar.
- **Sus datos (ARCO)**: descarga todo lo que el sistema tiene de esa persona.
  Es para cuando la persona lo pide por escrito (derechos ARCO).
- **Suprimir sus datos**: sólo con autorización de la **Unidad de
  Transparencia**. Borra su nombre de todo el sistema, **no se puede deshacer**.
  Sus registros de entrada y salida se quedan, sin nombre. Antes hay que darla
  de baja. Si tenía fotos marcadas "Conservar" en el kiosco, quítales la marca
  allá.

Cada cambio te pide un **motivo** y queda en la **Bitácora**.

**Datos de demostración (sólo en el sistema de pruebas):** con la opción
"Permitir datos de demostración" en 1 (Configuración), aparece el botón
**🧪 Generar datos de demostración**: crea 5 personas inventadas (marcadas
**DEMO**, una de ellas velador) con 1 a 3 semanas de registros, algunos con
retardo, falta, sin salida o foto tapada. Sirve para ver cómo se comporta el
sistema. En el sistema real esa opción debe quedar en **0**.

### Horarios

- **Turnos**: plantillas (Matutino 06–14, Vespertino 14–22, Nocturno 22–06).
  El nocturno cuenta para el día en que **empieza**.
- **Horario de cada persona**: qué turno, qué días, y si algún día entra a otra
  hora (por ejemplo, el sábado a las 7). Un cambio de horario es "a partir del
  día X": los días anteriores se siguen calculando con el horario viejo.
- Quien **no tiene horario** no tiene retardos ni faltas: sólo se ven sus registros.

### Ausencias y días festivos

- **+ Registrar ausencia**: vacaciones, incapacidad, permiso, comisión o falta
  justificada, con fechas. Esos días salen como "ausencia justificada".
- **+ Agregar día festivo**: ese día nadie tiene falta.

### Kioscos

Arriba, **⚠ Para atender**: kioscos sin conexión, cámaras caídas, registros
sin enviar, relojes movidos.

- **+ Dar de alta un kiosco**: nombre y ubicación. Da un **código de 8
  letras** que dura 15 minutos. En el kiosco, abajo, se pica **Dar de alta** y
  se escribe el código.
- **Dar de baja este kiosco**: si se robaron o se retiró la PC. Deja de poder
  enviar al instante. Lo que ya había registrado antes de la baja llega "en
  cuarentena" para que lo revises: nunca se pierde.

### Configuración

Las reglas del sistema: tolerancia, minutos para falta, horas para "no
registró salida", días que se guardan las fotos, intentos de PIN, umbrales de
la cámara y del reloj… Cada una tiene su ⓘ y su rango permitido. Un cambio
llega a los kioscos en unos minutos y los reportes se recalculan solos.

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
por qué. Nunca muestra PIN ni contraseñas.

### Mi cuenta

- **Contraseña de este panel.**
- **Usuario y contraseña del kiosco**: para entrar al modo administrador de los
  kioscos (a ver fotos). Es **otra** contraseña, a propósito: si alguien se
  roba un kiosco, no le sirve para entrar al panel.

---

## 5. En el kiosco: ver fotos

Las fotos **sólo** se ven en el kiosco.

1. En la barra de abajo del kiosco, pica **⚙ Administrador**.
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
  en el panel): arregla la causa en el panel y pica **Volver a enviarlos**.
- **Fotos guardadas con un candado anterior**: pasa si se reinstaló Windows.
  Escribe la **contraseña de recuperación** (hoja de credenciales).

---

## 6. Cuando algo pasa

| Pasa esto | Haz esto |
|---|---|
| Alguien olvidó su PIN | Empleados → **PIN nuevo**. Mientras, **Registrar a mano**. |
| Se fue la luz / no hay kiosco | El personal te avisa por WhatsApp; tú **Registrar a mano** con motivo "sin luz". |
| No hay internet | Nada: el kiosco guarda todo y lo manda al volver. En Kioscos verás "por enviar". |
| El kiosco dice "cámara no disponible" | Se sigue registrando, marcado "sin foto". Revisa el cable de la cámara. |
| Un kiosco aparece "sin conexión" mucho rato | Revisa que la PC esté prendida y con internet. Si no, soporte. |
| Se robaron o cambiaron la PC | Kioscos → **Dar de baja este kiosco**. Después, alta de la PC nueva. |
| Alguien dice que no llegó tarde | Mira el registro; si hay duda, ve la foto en el kiosco y márcala **Conservar**. |
| Una persona pide sus datos | Empleados → **Sus datos (ARCO)**. |

Soporte técnico: ver el [manual técnico](manual-tecnico.md).
