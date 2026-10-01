# Primeros pasos: poner a funcionar el sistema

> **Para quién es:** para quien va a arrancar el sistema en la facultad. Son
> los pasos **en orden**, una sola vez. Cada paso dice dónde está la
> explicación completa. No hace falta saber de computadoras.
>
> **Lo que necesitas a la mano:** tu correo y contraseña del panel, la PC
> donde irá el kiosco (con cámara y, de preferencia, teclado numérico), un
> teclado con letras, y la lista del personal con sus horarios.

---

## 1. Entra al panel y pon tu contraseña

1. Abre <https://panel.mi-cuenta.workers.dev> en el navegador.
2. Escribe tu correo y la contraseña temporal que te dieron.
3. El panel te pide poner **una contraseña tuya**. A partir de ahí, la
   temporal ya no sirve.

*Manual del jefe, sección 2.*

## 2. Pon tu usuario y contraseña del kiosco

En el panel: **Mi cuenta** → **Usuario y contraseña del kiosco**. Son para
entrar al modo administrador del kiosco (ahí se ven las fotos). Es **otra**
contraseña, distinta a la del panel, a propósito.

*Manual del jefe, sección 4, "Mi cuenta".*

## 3. Revisa la configuración

En el panel: **Configuración**. Ya viene lista (tolerancia de 10 minutos,
fotos se borran a los 30 días, etc.). Sólo confirma una cosa:

- **"La PC del kiosco se usa para otras cosas"**: déjala en **Sí** si en esa
  PC también se trabaja; ponla en **No** si la PC es sólo para checar.

Cada opción tiene un **ⓘ** que explica qué hace.

## 4. Instala el kiosco en la PC

1. Descarga el instalador: en GitHub, repositorio
   `versiones-kiosco` → **Releases** → la versión más reciente →
   `ControlDeAsistencia-Instalador-….exe`.
2. Doble clic. Si Windows dice **"Windows protegió su PC"**: **Más
   información → Ejecutar de todas formas** (es normal; no es virus).
3. Aparece un icono de un **reloj con palomita** en el escritorio.
4. Comprueba que se ve la cámara y que el reloj tiene la hora correcta.

*Manual técnico, sección 2 (también explica cómo dejar Windows listo: que no
se apague la pantalla ni se reinicie a la hora de checar).*

## 5. Da de alta el kiosco

"Dar de alta" es presentarle el kiosco al sistema, para que lo que se registre
ahí llegue al panel.

1. En el panel: **Kioscos → + Dar de alta un kiosco** → nombre (por ejemplo
   "Entrada principal") y ubicación. Te da un **código de 8 letras** que dura
   **15 minutos**.
2. En el kiosco, en la barra de abajo: **Dar de alta** → escribe el código
   (con un teclado con letras) → **Dar de alta**.
3. Espera unos minutos con internet. Entra al kiosco en **⚙ Administrador**
   con tu usuario del kiosco (paso 2).
4. El kiosco avisa en amarillo que falta la **contraseña de recuperación de
   las fotos**. Invéntala, escríbela y **anótala a mano en la hoja de
   credenciales**. Sin ella, si algún día se reinstala Windows, las fotos se
   pierden.

*Manual técnico, sección 3.*

## 6. Da de alta al personal

En el panel: **Empleados**. Dos formas:

- **Muchos a la vez (recomendado):** **Importar lista de Excel** → **Descargar
  plantilla** → llena un renglón por persona → guárdala → elígela. Al final,
  **imprime la hoja con los PIN**.
- **Uno por uno:** **+ Agregar empleado** → nombre y apellidos.

El sistema le da a cada persona un **PIN temporal**, que se muestra **una sola
vez**. Entrégaselo a cada quien **en privado**. La primera vez que cheque, el
kiosco le pide elegir uno propio.

*Manual del jefe, sección 4, "Empleados".*

## 7. Asigna los horarios

En el panel: **Horarios** → en el renglón de cada persona, **Poner horario**:
qué turno (matutino, vespertino
o nocturno) y qué días. Si algún día entra a otra hora (por ejemplo, el sábado
a las 7), también se pone ahí. Si los turnos de la facultad son a otras horas,
primero se ajustan los **Turnos**. La lista de Excel del paso 6 no trae horarios:
se ponen aquí, uno por persona.

**Quien no tenga horario no tendrá retardos ni faltas:** sólo se verán sus
registros.

*Manual del jefe, sección 4, "Horarios" (trae el paso a paso).*

## 8. Registra festivos y vacaciones

En el panel: **Ausencias**. Con el **calendario escolar de la UAT** en la mano:

- cada día festivo: **+ Agregar día festivo**;
- cada periodo vacacional: **+ Registrar incidencia** → tipo **Vacaciones** →
  **Todos los que tenían turno esos días** → fecha de inicio y de fin.

Así nadie aparece con faltas en días que no se trabajó.

*Manual del jefe, sección 4, "Vacaciones de la universidad".*

## 9. Imprime y pega junto al kiosco

- La **guía para empleados** (una hoja, a doble cara).
- Un **aviso de privacidad**. El que viene con el sistema es un **borrador**:
  hay que mandarlo a la **Unidad de Transparencia de la UAT** para que lo
  revisen. Mientras tanto, se puede pegar el borrador como aviso provisional.

## 10. Prueba de 1 a 2 semanas

Que el personal cheque en el kiosco **y además** siga con el método de ahora
(lista, firma, lo que se use). Al final de cada día, compara en el panel
(**Asistencia** y **Reportes**) contra el método de siempre. Cuando coincidan
y todos sepan usarlo, ya se puede dejar el método viejo.

---

## Después, de vez en cuando

| Cada cuándo | Qué | Dónde |
|---|---|---|
| Cada día (si quieres) | Ver la asistencia en el panel | Manual del jefe, sección 3 |
| Cada mes | GitHub → Actions: que los respaldos estén en verde | Manual técnico, sección 8 |
| Cada semestre | Festivos y vacaciones del calendario escolar | Paso 8 |
| Cuando alguien olvide su PIN | Empleados → **PIN nuevo** | Manual del jefe, sección 6 |
| Cuando algo falle | La tabla "Cuando algo pasa" | Manual del jefe, sección 6 |
