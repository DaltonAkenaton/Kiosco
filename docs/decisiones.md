# Decisiones del proyecto

> Las elecciones importantes, **con las alternativas que se descartaron y por
> qué**. Cuando alguien (tú dentro de un año, o quien herede esto) pregunte
> "¿por qué está hecho así?", la respuesta está aquí.

Formato: qué se decidió · qué se descartó · por qué · cuándo reconsiderarlo.

---

## D-001 · Monorepo con npm workspaces

**Decidido:** un solo repositorio con `apps/` y `packages/`, gestionado con
npm workspaces.

**Descartado:**

- *Tres repositorios separados.* Los tipos compartidos habría que copiarlos a
  mano o publicarlos como paquete npm versionado. En un proyecto que mantiene
  una persona sola, es una fuente garantizada de desincronización.
- *Nx o Turborepo.* Son excelentes para monorepos grandes: caché de compilación,
  grafo de dependencias, generadores. Aquí añaden un archivo de configuración
  más y un concepto más que aprender, para tres proyectos.
- *pnpm workspaces.* Técnicamente superior (ahorra disco, es más estricto con
  las dependencias), pero obliga a instalar pnpm en cada máquina donde se toque
  el proyecto. npm ya viene con Node.

**Por qué:** el criterio dominante del proyecto es *"debe poder mantenerse con
documentación, sin su autor presente"* (CLAUDE.md sección 1). Cada herramienta
extra es una cosa más que quien herede esto tiene que aprender.

**Reconsiderar si:** el proyecto pasa de ~6 paquetes o las compilaciones
empiezan a tardar más de un minuto.

---

## D-002 · esbuild para compilar, `tsc` sólo para revisar

**Decidido:** esbuild genera el JavaScript; TypeScript corre aparte con
`--noEmit` sólo para revisar tipos.

**Descartado:**

- *Sólo `tsc`.* Es lento y, sobre todo, **no junta archivos en uno solo**. El
  `preload.js` debe ser un archivo autocontenido o Electron no encuentra sus
  dependencias.
- *Webpack o Vite para el proceso principal.* Mucho más configuración para el
  mismo resultado en este caso.
- *Sólo esbuild, sin `tsc`.* Sería un error: **esbuild no revisa tipos, los
  borra sin mirarlos.** Sin `tsc` perderíamos la mitad del valor de usar
  TypeScript.

**Por qué:** cada herramienta hace lo que mejor hace. esbuild traduce en
milisegundos; `tsc` revisa a fondo.

**Reconsiderar si:** aparece algún problema de compatibilidad con un módulo
nativo que esbuild no maneje bien.

---

## D-003 · Angular 21, no 22

**Decidido:** Angular 21 en `apps/kiosco-ui`.

**Descartado:** Angular 22 (la versión actual).

**Por qué:** Angular 22 exige Node `^24.15.0` o superior, y la máquina de
desarrollo tiene **24.13.1**. El CLI se niega a instalar.

**Cómo revertirlo cuando toque:**

```bash
# 1. Instalar Node 24.15+ desde https://nodejs.org
# 2. Desde apps/kiosco-ui:
npx ng update @angular/core @angular/cli
```

No corre prisa: Angular 21 tiene soporte vigente. Pero conviene no dejarlo
pasar mucho: el CLAUDE.md pide "versión estable actual".

**Reconsiderar:** en cuanto se actualice Node.

---

## D-004 · TypeScript 5.9 en todo el monorepo

**Decidido:** una sola versión, `~5.9.2`, en todos los paquetes.

**Descartado:** TypeScript 6.0 (más nuevo) en el proceso principal y 5.9 en
Angular.

**Por qué:** `@angular/build` 21 declara `typescript >=5.9 <6.0`. Intentar usar
6.0 hace fallar la instalación. Y tener dos versiones distintas de TypeScript
en un mismo monorepo confunde al editor: te muestra errores que el compilador
no reporta, y viceversa.

Como efecto secundario, el proyecto ya está preparado para TypeScript 6: no
usa `baseUrl` (que quedó obsoleta), sino rutas relativas en `paths`.

**Reconsiderar:** al subir a Angular 22 (ver D-003).

---

## D-005 · Sin enrutador de Angular en el kiosco

**Decidido:** el kiosco es un solo componente con estados internos.

**Descartado:** `provideRouter` con rutas `/inicio`, `/confirmar`, `/exito`.

**Por qué:** el flujo del kiosco (CLAUDE.md sección 4) es una sola pantalla que
cambia de estado, no páginas distintas. Con rutas tendríamos direcciones
navegables, historial y botón de "atrás" — complejidad sin beneficio, y
superficie extra que habría que bloquear por seguridad.

**El panel administrativo sí lo usará**, porque ahí sí hay secciones separadas.

**Reconsiderar si:** el kiosco crece a pantallas realmente independientes (por
ejemplo, un modo de administración local).

---

## D-006 · La interfaz nunca habla con internet

**Decidido:** `connect-src 'self'` en la CSP. Sólo el proceso principal se
comunica con Supabase.

**Descartado:** que Angular llame a Supabase directamente, que es lo habitual en
una app web normal.

**Por qué:** dos razones que se refuerzan.

1. **Seguridad.** Si alguien comprometiera la pantalla, no tendría a dónde
   mandar los datos. No puede filtrar información de empleados ni fotos.
2. **La regla de oro.** La red nunca debe bloquear la interfaz. Manteniendo
   toda la comunicación en el proceso principal, es estructuralmente imposible
   que una llamada lenta congele la pantalla del kiosco.

**Reconsiderar:** nunca, para el kiosco. El panel administrativo es otra cosa:
es una web normal, sí habla con Supabase directamente, y se protege con RLS.

---

## D-007 · Errores explícitos en lugar de `TODO` silenciosos

**Decidido:** los manejadores IPC que aún no tienen implementación validan la
entrada y devuelven un error con el texto de qué falta y en qué paso del plan.

**Descartado:** devolver datos falsos de prueba, o dejar un `// TODO` y que la
función no devuelva nada.

**Por qué:** datos falsos pueden colarse a producción y nadie los nota hasta
que hay 200 registros inventados. Un `TODO` silencioso deja a quien continúe el
trabajo depurando a ciegas. Un mensaje como *"La base de datos local aún no
está instalada (paso 3 del plan)"* se explica solo.

**Reconsiderar:** no aplica. Cada error se elimina cuando se implementa su paso.

---

## D-008 · Tailwind CSS 4

**Decidido:** Tailwind vía `@tailwindcss/postcss`, con los colores del kiosco
como variables CSS en `styles.css`.

**Descartado:**

- *CSS a mano.* Más lento de iterar, y el CLAUDE.md pide ajustar tamaños y
  contraste según cómo se vea en la pantalla real del kiosco.
- *Angular Material.* Está pensado para aplicaciones densas de escritorio, no
  para botones gigantes de kiosco. Habría que pelearse con sus estilos.

**Por qué:** cambiar `text-4xl` por `text-6xl` y ver el resultado al instante
es exactamente lo que este proyecto necesita en la fase de ajuste con el
cliente.

**Reconsiderar si:** el panel administrativo necesita tablas y formularios
complejos; ahí Angular Material sí tendría sentido.

---

## D-009 · Identidad visual en un JSON, generada hacia CSS

**Decidido:** los colores y los datos de la institución viven en
`packages/compartido/src/tema.json`. Un script (`generar-tema.mjs`) lo
convierte en variables CSS, enganchado a `prestart` y `prebuild` para que corra
solo.

**Descartado:**

- *Escribir los colores en el CSS y otra vez en el TypeScript.* Siempre se
  desincroniza: alguien cambia uno y olvida el otro. Y como el síntoma es
  cosmético, nadie lo reporta y se queda ahí meses.
- *Mandar los colores por IPC.* Llegarían **después** de que la pantalla ya se
  pintó, produciendo un parpadeo en cada arranque. El estilo tiene que estar
  listo antes del primer píxel; no es un dato, es presentación.
- *Dejar los colores fijos en el código.* La identidad de una institución
  pública se actualiza con cada administración. Un cambio caro es, en la
  práctica, un cambio que nunca se hace — y menos en una facultad sin
  departamento de TI.

**Por qué:** el CSS no puede leer un archivo JSON y TypeScript sí. Un solo
origen más un generador automático resuelve el desfase de raíz, en vez de
confiar en que alguien se acuerde.

**Detalle que costó una corrección:** las variables generadas usan el prefijo
`--kiosko-*`, no `--color-*`. Con el mismo prefijo en ambos lados, la línea
puente quedaba `--color-fondo: var(--color-fondo)`: una referencia circular que
el navegador descarta en silencio.

**Reconsiderar si:** llega a haber varias instituciones o varios temas
simultáneos; entonces habría que cargar el tema en tiempo de ejecución en lugar
de al compilar.

---

## D-010 · Los colores semánticos no obedecen a la identidad institucional

**Decidido:** `entrada`, `salida`, `peligro` y `atencion` son independientes de
los colores de la universidad. El color institucional se usa sólo en adornos
(franja superior, bordes), nunca en botones ni en áreas grandes.

**Descartado:** aplicar la paleta institucional a toda la pantalla — que es lo
que se suele pedir cuando alguien dice "ponle los colores de la universidad".

**Por qué:** el CLAUDE.md sección 4 exige *"la mayor distinción visual posible
entre ENTRADA y SALIDA"*. Ahí el color no es decoración, es **información**: el
error que hay que evitar es que alguien medio dormido registre salida creyendo
que entró, y eso le cuesta su día de trabajo. Si el color institucional
invadiera esos elementos, la imagen habría roto la función del sistema.

El generador avisa automáticamente cuando dos colores se acercan demasiado.

**Si el color oficial choca con uno semántico**, el orden de solución es:

1. Reducir **dónde** aparece el institucional (franja más delgada, sólo borde).
2. Si aun así compite, mover el **tono semántico** — que "salida" sea ámbar es
   costumbre, no ley.

Nunca se cambia el color oficial de la universidad, y nunca se deja la
ambigüedad ahí.

**Reconsiderar:** no aplica. Es una regla de usabilidad y accesibilidad, no una
preferencia estética.

---

## D-011 · Excepciones de contraste justificadas, en vez de bajar el umbral

**Decidido:** cuando dos colores se parecen según la medida pero en la práctica
nunca compiten, se registran en `excepcionesDeContraste` dentro de `tema.json`,
**con un motivo escrito**. El generador las imprime como "excepción aceptada"
en lugar de callarlas.

**Descartado:**

- *Bajar `DISTANCIA_MINIMA_SEGURA`.* Apagaría todos los avisos, incluidos los
  reales. El umbral dejaría de proteger lo que importa (ENTRADA vs SALIDA).
- *Dejar el aviso permanente.* Es lo peor de todo: la gente se acostumbra a
  ignorar los avisos, y el día que aparezca uno de verdad tampoco lo verá.
- *Distorsionar el color semántico* (mover el rojo de error hacia rosa) sólo
  para pasar la medida. Sería cambiar algo que funciona por complacer a una
  métrica aproximada.

**Por qué:** la medida de distancia RGB es útil pero tosca — no sabe **dónde**
aparece cada color. El naranja institucional vive en un filete de 4 px bajo la
cabecera; el rojo de error, en un mensaje al centro. Nunca hay una decisión en
la que el usuario deba distinguirlos.

Exigir un motivo escrito es la parte importante: si no puedes explicar por qué
la excepción es segura, probablemente no lo es. Es el mismo principio que un
`eslint-disable` con comentario.

**Reconsiderar si:** las excepciones se multiplican. Tres o cuatro es señal de
que la paleta tiene un problema de fondo, no de que la medida esté mal.

---

## D-012 · El kiosco no calcula retardos

**Decidido:** el kiosco sólo registra la hora de la marca. Retardos, faltas y
horas trabajadas los calcula el **servidor**, al generar el reporte, con la
configuración vigente en ese momento.

**Descartado:** guardar en cada marca si fue retardo, calculándolo en el kiosco
con la tolerancia que tenga en caché.

**Por qué:** tres razones que se refuerzan.

1. **Cambiar la tolerancia recalcula el pasado.** Si en marzo el jefe pasa la
   tolerancia de 10 a 15 minutos, los reportes de enero y febrero se ajustan
   solos. Si hubiéramos guardado "retardo: sí", habría que migrar datos —
   o peor, quedaría un histórico incoherente.
2. **Las marcas son inmutables** (CLAUDE.md sección 8). La hora es un **hecho**;
   "llegó tarde" es una **interpretación**. Los hechos se guardan, las
   interpretaciones se calculan.
3. **El kiosco se simplifica.** Menos reglas de negocio en la PC pública es
   menos que mantener y menos que pueda fallar a las 6 AM.

**Consecuencia práctica:** es exactamente lo que hace posible responder "sí" a
la pregunta *"¿y si son 15 minutos de tolerancia en vez de 30?"* sin tocar una
línea de código.

### Es el mismo principio que enseñan en base de datos

*No se almacena lo que se puede calcular.* La edad no se guarda: se guarda la
fecha de nacimiento. El IVA no se guarda: se calcula del subtotal. El retardo
no se guarda: se calcula de la hora y la tolerancia.

### Y aquí va la excepción que casi nunca se enseña junto

> **Sí se almacena lo derivado cuando el valor tenía que quedar congelado en
> ese momento.**

El ejemplo clásico es el precio en una factura. Se podría "calcular" leyendo
la tabla de productos... hasta que suben el precio, y de pronto todas las
facturas viejas mienten sobre lo que el cliente pagó. Por eso una factura
**sí** guarda el precio al que se vendió.

La pregunta que decide siempre es una sola:

> *Si mañana cambia la regla, ¿quiero que el pasado cambie con ella?*
>
> **Sí** → calcúlalo. **No** → guárdalo.

En este sistema salen las dos respuestas:

| Dato | ¿Se guarda? | Razón |
|---|---|---|
| Hora de la marca | **Sí** | Es el hecho. Un hecho no cambia nunca |
| Retardo / falta | **No** | Si cambia la tolerancia, el histórico debe reflejar la regla nueva |
| Horas trabajadas | **No** | Se derivan de dos marcas |
| Motivo de una corrección | **Sí** | Es evidencia de auditoría, no una conclusión |
| Quién hizo la corrección y cuándo | **Sí** | Congelado por definición: pasó una vez |
| Banderas de la marca (`sin_camara`…) | **Sí** | Describen las condiciones **de ese instante**; no se pueden reconstruir después |

Fíjate en las banderas: parecen derivadas ("la cámara estaba caída"), pero son
del tipo congelado. Dentro de un mes nadie puede volver a averiguar si la
cámara funcionaba a las 06:02 de aquel martes. Si no se guarda en el momento,
se pierde.

**Reconsiderar:** no aplica. Es el diseño correcto para datos con reglas que
cambian.

---

## D-013 · `node:sqlite` en lugar de `better-sqlite3`

**Decidido:** usar `node:sqlite`, el SQLite que viene incluido dentro de Node
(y por lo tanto dentro de Electron).

**Descartado:** `better-sqlite3`, que es lo que pedía el CLAUDE.md sección 2.

**Por qué se cambió:** `better-sqlite3` es un módulo nativo (C++) y hay que
compilarlo para el Node concreto que trae Electron. Para Electron 44 **no
existe binario precompilado** (404 al buscarlo), así que habría que
compilarlo desde el código fuente, lo que exige **Visual Studio Build Tools en
cada máquina** donde se toque el proyecto.

Eso choca de frente con la restricción central del CLAUDE.md sección 1: *"el
sistema debe poder mantenerse con documentación, sin su autor presente"*, en
una facultad que *"no tiene departamento de TI"*. Ver el error E-007 para los
cuatro intentos y sus mensajes exactos.

**Costo honesto:** `node:sqlite` está marcado como experimental y su API puede
cambiar entre versiones mayores de Node. `better-sqlite3` es más maduro y algo
más rápido.

**Cómo se mitiga:** **todo** el acceso a la base pasa por
`datos/base-de-datos.ts` y los repositorios. Ningún otro archivo del proyecto
sabe qué motor hay detrás. Si algún día hay que cambiar otra vez, se reescribe
esa carpeta y nada más.

Para el volumen real de este sistema (5 empleados, ~10 marcas al día) la
diferencia de rendimiento es irrelevante; la de mantenibilidad es enorme.

**Reconsiderar si:** `node:sqlite` introduce un cambio incompatible, o el
sistema crece a un volumen donde el rendimiento importe. Para entonces quizá
ya existan binarios de `better-sqlite3` para esa versión de Electron.

**Pendiente:** actualizar la sección 2 del CLAUDE.md, que todavía dice
`better-sqlite3`.

---

## D-014 · Un solo mensaje para "usuario no existe" y "PIN incorrecto"

**Decidido:** los dos casos devuelven exactamente el mismo texto —
*"Datos incorrectos. Intenta de nuevo."*— y tardan aproximadamente lo mismo.

**Descartado:** mensajes específicos ("ese usuario no existe", "PIN
incorrecto"), que son más amables.

**Por qué:** un mensaje distinto le dice a quien está probando **cuáles
usuarios existen**. Con eso puede averiguar la plantilla completa tecleando
nombres, y concentrar los intentos en cuentas reales.

Y no basta con igualar el texto: hay que igualar el **tiempo**. Buscar un
usuario inexistente es instantáneo, mientras que comparar un PIN con bcrypt
tarda ~60 ms. Esa diferencia es medible y delata lo mismo que el mensaje. Se
llama **ataque de temporización**.

Por eso existe `simularVerificacion()`: cuando el usuario no existe, el
sistema gasta el mismo tiempo que habría gastado comparando un PIN real, y
después responde.

**El costo:** un empleado que se equivoca de usuario no sabe si falló el
usuario o el PIN. Es un costo aceptable — vuelve a teclear ambos, son ocho
caracteres— y el jefe siempre puede registrar la asistencia a mano.

**Reconsiderar:** no aplica. Es práctica estándar en cualquier sistema con
autenticación.

---

## D-015 · Mostrar el estado del empleado, pero nunca deshabilitar su botón

**Decidido:** en el modo lista, cada empleado muestra si ya checó
("Adentro desde 06:02", con palomita y punto verde). Pero **su botón siempre
funciona**, sin importar su estado.

**Descartado:** deshabilitar el botón después de que alguien marca salida.

**Por qué se descartó:** choca de frente con la regla de oro del proyecto —
*"nunca impedir que alguien registre"* (CLAUDE.md sección 1).

Hay al menos cuatro situaciones reales en las que una persona marca salida y
necesita volver a checar el mismo día:

1. Se le olvidó algo y regresa.
2. Le piden quedarse a cubrir un turno.
3. **Marcó salida por equivocación** y quiere corregir.
4. Sale a comer y vuelve (hoy no se registra, pero podría habilitarse).

Con el botón deshabilitado, esa persona **no puede registrar** y el jefe tiene
que capturarlo a mano. El sistema habría creado el problema que vino a
resolver.

**Lo que sí se tomó de la idea:** la parte valiosa era *ver el estado*, y esa
se implementó completa. Responde de un vistazo la pregunta que originó todo
esto —*"¿ya marqué?"*— sin tener que teclear el PIN para averiguarlo.

**El principio general, que vale para todo el sistema:**

> **Informar, no bloquear.**
>
> Cuando el sistema "sabe" algo que el usuario quizá ignora, la respuesta es
> decírselo con claridad — no quitarle la opción. Quien tiene el contexto
> completo es la persona, no el programa.

El sistema ya sugiere la acción correcta según la última marca; si alguien
elige otra, sus razones tendrá, y queda registrado igual.

**Reconsiderar:** no aplica. Es la regla de oro, y está por encima de
cualquier conveniencia.

---

## D-016 · Animar sólo `transform` y `opacity`

**Decidido:** todas las animaciones del kiosco usan exclusivamente
`transform` (escala, desplazamiento) y `opacity`. Ninguna anima `width`,
`height`, `top`, `left`, `margin` ni `padding`.

**Por qué:** no es una preferencia estética, es cómo dibuja el navegador.
Para pintar la pantalla hace tres trabajos:

| Paso | Qué hace | Costo |
|---|---|---|
| 1. Layout | Calcular dónde va y cuánto mide cada cosa | caro |
| 2. Paint | Dibujar los píxeles | medio |
| 3. Composite | Juntar las capas ya dibujadas | barato, lo hace la tarjeta gráfica |

Animar tamaño o posición obliga a rehacer **los tres**, 60 veces por segundo:
la animación tartamudea y la máquina se calienta.

Animar `transform` y `opacity` sólo toca el paso 3. Es prácticamente gratis —
una PC modesta mueve decenas de esas animaciones sin despeinarse.

**Importa especialmente aquí** porque no sabemos qué computadora va a tocar:
puede ser una máquina de hace ocho años, sin tarjeta gráfica decente. Con
animaciones baratas eso da igual.

**La segunda regla, de criterio:** todas duran entre 120 y 250 ms. Están para
dar **retroalimentación** ("sí te hice caso", "esto cambió"), no para lucirse.

> Una animación que hace esperar al empleado a las 6 de la mañana está mal
> puesta, por bonita que sea.

**Accesibilidad:** se respeta `prefers-reduced-motion`. Windows, macOS y
Android tienen una opción para reducir animaciones, que usan personas con
trastornos vestibulares a quienes el movimiento en pantalla les puede
provocar mareo real. Respetarla son cuatro líneas de CSS.

**Reconsiderar:** no aplica. Es una regla técnica, no una opinión.

---

## D-017 · Un "pase" de un solo uso entre identificarse y registrar

**Decidido:** `identificar` no devuelve el id del empleado. Devuelve un texto
aleatorio de 32 bytes —el *pase*— y el proceso principal se guarda en memoria,
asociado a él, quién es el empleado y **las lecturas de reloj de ese
instante**. `registrarMarca` recibe ese pase, lo canjea y lo borra.

**Descartado:**

- *Seguir mandando el `empleadoId`.* Era lo que había, y permitía registrar a
  nombre de cualquiera saltándose el PIN (ver E-014). La pantalla es la parte
  no confiable del sistema; no puede ser ella quien diga a nombre de quién se
  registra una marca.
- *Volver a leer el reloj al guardar.* Es lo más simple, y rompe el CLAUDE.md
  4.3: la hora registrada sería la de cuando el empleado terminó de leer la
  confirmación, no la de cuando llegó. Con tres segundos de cuenta regresiva
  eso es poco; con alguien que se queda dudando, no.
- *Que la pantalla guarde la hora y la mande de vuelta.* Sería confiar en el
  renderer para el dato más delicado de todo el sistema. Un kiosco cuya hora
  la decide la pantalla es un kiosco en el que la hora se puede elegir.
- *Guardar el pase en SQLite.* Un pase vive 60 segundos y **no debe** sobrevivir
  a nada. Si se va la luz a media confirmación, lo correcto es que desaparezca.
  En disco solo quedarían pases viejos esperando a que alguien los use.

**Por qué:** resuelve dos problemas distintos con una sola pieza, y los dos son
de fondo. Para tener un pase hay que haber pasado por el PIN (seguridad), y la
hora viaja dentro del pase desde el momento de la validación (exactitud).

Es el patrón del boleto de guardarropa: el numerito no dice nada de quién eres
ni de qué dejaste; solo sirve para que quien sí lo sabe te lo devuelva.

**Reconsiderar si:** algún día el kiosco tuviera que atender a varias personas
a la vez de verdad (no es el caso con ~5 empleados), o si apareciera un flujo
donde confirmar pueda tardar más de un minuto.

---

## D-018 · Los sonidos se sintetizan, no se cargan de archivos

**Decidido:** los tres avisos (entrada, salida, error) se generan con la Web
Audio API, con osciladores. No hay archivos de audio en el proyecto.

**Descartado:**

- *Tres archivos `.mp3` o `.wav`.* Es lo normal, y aquí sale perdiendo en
  todo: hay que empaquetarlos, hay que relajar la Content-Security-Policy para
  que la página pueda cargarlos, hay un retraso la primera vez mientras se
  descargan y decodifican, y cambiar un sonido exige abrir un editor de audio.
- *La campanita del sistema (`\a`, `beep`).* Suena igual para todo. El
  requisito del CLAUDE.md 13.1 es justamente que los tres se distingan.
- *Voz sintetizada ("entrada registrada").* Tentador, y mala idea en un
  pasillo: dice en voz alta lo que alguien acaba de hacer, y a las 6 de la
  mañana una voz es mucho más intrusiva que un pitido.

**Por qué:** para tres pitidos, el sintetizador que ya trae el navegador es
más simple que cualquier alternativa. Y permite que el diseño del sonido sea
*información* y no decoración: entrada **sube**, salida **baja**, error es
grave y repetido. La dirección la entiende cualquiera sin que se la expliquen,
y funciona para quien no distingue bien los colores de la pantalla.

**Reconsiderar si:** el cliente pide un sonido concreto (una campana
institucional, por ejemplo) que no se pueda sintetizar.

---

## D-019 · El instalador se instala **por usuario**, sin pedir administrador

**Decidido:** NSIS con `perMachine: false` y `allowElevation: false`. El kiosco
se instala dentro del perfil del usuario.

**Descartado:**

- *Instalación para toda la máquina (`perMachine: true`).* Es lo habitual en
  Windows, y aquí sería un problema serio: exigiría que alguien con permisos de
  administrador esté presente en cada PC, cada vez. Incluidas las
  actualizaciones automáticas, que entonces simplemente no podrían instalarse
  solas — y el CLAUDE.md dice que la facultad no tiene departamento de TI.
- *Instalador de un clic (`oneClick: true`).* Se instala solo en cuanto lo
  abres. Ahorra dos clics a costa de que quien instala no vea lo que está
  pasando. Instalar ocurre una vez por PC y lo hace una persona; ver el
  proceso vale más que la prisa.
- *Dejar elegir la carpeta de instalación.* Una PC con el kiosco instalado en
  una ruta rara es una PC que nadie va a saber reparar dentro de dos años.

**Por qué:** encaja con el entorno descrito en el CLAUDE.md 13, donde el
kiosco corre en una cuenta de Windows **estándar, sin privilegios**.

Y va acompañado de `deleteAppDataOnUninstall: false`: desinstalar **nunca**
borra la base de datos ni las fotos pendientes. Desinstalar suele ser el primer
paso de "reinstalar porque algo anda mal", y ahí es justamente cuando pueden
quedar marcas sin subir.

**Reconsiderar si:** la facultad decide usar el modo kiosco de Windows
(Assigned Access) de una forma que exija instalación para toda la máquina.

---

## D-020 · Las actualizaciones se descargan solas, pero **no** se instalan solas

**Decidido:** `autoDownload: true`, `autoInstallOnAppQuit: false`. La versión
nueva se baja en silencio y espera. Instalarla es una acción explícita.

**Descartado:**

- *Instalar al cerrar (`autoInstallOnAppQuit: true`), que es el valor por
  defecto.* En producción el kiosco se cierra cuando Windows se apaga, así que
  el instalador correría en el siguiente arranque. Si eso cae un lunes a las
  6 de la mañana, el personal se encuentra una barra de progreso en vez de un
  checador.
- *No actualizar automáticamente y punto.* Con varios kioscos y sin
  departamento de TI, "hay que ir con una USB a cada PC" significa, en la
  práctica, que nunca se actualiza.

**Por qué:** separa lo que no molesta a nadie (descargar) de lo que sí puede
molestar (reiniciar e instalar). El kiosco siempre tiene la versión nueva
lista; el momento de aplicarla lo elige quien sabe si hay alguien checando.

**Reconsiderar si:** aparece una ventana de mantenimiento fija y conocida (por
ejemplo "los domingos nadie checa"), en cuyo caso instalar sola a esa hora sería
mejor que depender de que alguien se acuerde.

---

## D-021 · Pausar el kiosco es distinto de cerrarlo

**Decidido:** dos salidas separadas, porque son dos necesidades distintas.

| | Para quién | Qué hace |
|---|---|---|
| **Pausar** — botón "Usar esta PC" | alguien que necesita la computadora 10 minutos | minimiza y **vuelve solo** a los 15 min |
| **Cerrar** — `Ctrl+Alt+Shift+Q` | soporte, mantenimiento | cierra de verdad |

**Descartado:**

- *Sólo la combinación de teclas* (lo que había). Es inútil para quien no la
  conoce, y nadie la va a adivinar. Una salida que hay que saberse de memoria
  no es una salida: es un secreto. Y si el maestro que necesita la PC no
  encuentra cómo quitar el kiosco de en medio, su siguiente idea es
  desinstalarlo.
- *Que el botón cierre la aplicación.* Al maestro no le sirve cerrar el
  checador; le sirve que se quite y vuelva. Cerrarlo deja el kiosco apagado
  hasta que alguien se acuerde de abrirlo, y ese "alguien" no existe.
- *Un botón sin código.* Invita a que un empleado se acostumbre a "apagar el
  checador un ratito" justo cuando llega tarde.
- *Proteger el botón con el PIN de un administrador.* No hay concepto de
  administrador en el kiosco: los administradores viven en el panel, que es
  fase 2. Inventarlo aquí sería construir dos veces lo mismo.

**Por qué:** porque con el kiosco minimizado **nadie puede checar**, y eso
choca de frente con la regla de oro. Por eso la pausa tiene dos propiedades
que no son negociables:

1. **Vuelve sola**, siempre, sin depender de que alguien se acuerde.
2. **Deja constancia** en la bandeja de salida. Sin eso, una marca que falta
   entre las 10:15 y las 10:32 es un hueco inexplicable; con eso, tiene
   explicación.

Sobre el código: **no es seguridad, y conviene decirlo claro.** El CLAUDE.md
3.2 dice que todo lo empaquetado en el `.exe` es público, así que se puede
averiguar. Es un tope contra el uso casual, y no necesita ser más — pausar no
da acceso a nada. Lo que sí se respeta es el mínimo privilegio: el código se
compara en el proceso principal y **nunca viaja a la pantalla**, que sólo sabe
cuántos dígitos tiene.

**Reconsiderar si:** se confirma que la PC es dedicada sólo a checar (entonces
`CONFIG.pausa.permitida = false` y el botón desaparece), o cuando exista el
panel y el código pueda vivir en la tabla `configuracion`.

---

## D-022 · Tres escalones para probar, no dos

**Decidido:** entre "programando" y "instalado" hay un escalón intermedio:
`npm run probar:empaquetado`, que abre la app **empaquetada de verdad** en 10
segundos, sin generar el instalador.

**Descartado:**

- *Sólo dos escalones* (`kiosco:dev` y el instalador), que es lo que había.
  Por ese hueco se coló el E-015: la pantalla se veía perfecta en desarrollo y
  salía sin un solo estilo en el `.exe`, porque la CSP estricta y las rutas
  `file://` sólo existen al empaquetar. Reproducirlo costaba 107 MB y una
  instalación — algo que nadie hace mientras prueba una idea.
- *Un cuarto entorno "casi producción"* que relajara también la CSP o las
  rutas para que fuera más cómodo. Sería volver a tener el mismo hueco un
  escalón más arriba, y con la falsa sensación de estar cubierto.

**Por qué:** el modo prueba apaga **sólo** lo que estorba en tu escritorio
—pantalla completa, arranque con Windows, bloqueo de Alt+F4— y no toca nada de
seguridad. La CSP, el sandbox, las DevTools apagadas y el `file://` siguen
siendo los del kiosco real. Eso es lo que hace que el escalón sirva: si
relajara la seguridad, no probaría lo que hay que probar.

La bandera `--modo-prueba` es inofensiva aunque alguien la descubra: lo único
que consigue es que el kiosco no se ponga en pantalla completa. Los accesos
directos que crea el instalador nunca la pasan.

**Reconsiderar si:** aparece alguna diferencia entre el escalón 2 y el kiosco
instalado de verdad. Ese día el escalón 2 dejó de servir y hay que arreglarlo,
no ignorarlo.

---

## D-023 · Las fotos se quedan en el kiosco; a la nube va sólo el hash

**Decidido (por el cliente, 21-09-2026):** modelo híbrido. Las fotografías
viven cifradas en el disco del kiosco y **nunca** se suben. Los registros de
asistencia sí se sincronizan, llevando el **SHA-256** de la foto y su **estado**.

**Descartado:**

- *Fotos en Supabase Storage* (lo que estaba diseñado hasta ahora, migración
  0010 incluida). El cliente lo descartó para no entrar en políticas de
  seguridad de la información de la universidad.
- *No guardar fotos.* Rompería el modelo antitrampa completo: el CLAUDE.md 3.4
  dice "el PIN identifica; **la foto es la evidencia**".
- *Subirlas sólo cuando el jefe las pida.* Suena a punto medio y es lo peor de
  los dos: la foto igual sale a la nube, pero encima el jefe depende de que el
  kiosco esté encendido y conectado en ese momento.

**Por qué:** es la decisión del cliente y es defendible. Lo que se gana es
concreto: desaparece la transferencia a un encargado externo y el posible
almacenamiento fuera de México.

**Lo que hay que tener presente, porque no es gratis:**

1. **La PC pasa a ser un punto único de fallo.** El CLAUDE.md §1 dice "las
   computadoras cambian con frecuencia; toda PC es reemplazable" — y ahora, si
   una PC muere, se va con ella toda la evidencia fotográfica que tuviera.
2. **`safeStorage` ata la llave al perfil de Windows de esa máquina.** Si se
   reinstala Windows, las fotos quedan ilegibles **para siempre**. Por eso se
   agregó la contraseña de recuperación (D-024).
3. **Revisar una foto pasa a ser un viaje físico.** Si eso cuesta, el jefe deja
   de revisar — y entonces la evidencia no la mira nadie. De ahí el filtro
   "Revisar en kiosco" y la vista `fotos_por_revisar`, que agrupa los casos
   pendientes por kiosco para que sea un viaje y no diez.

**Lo que NO cambia, y conviene decirlo claro:** el aviso de privacidad, el
plazo de retención, la bitácora de accesos y los derechos ARCO siguen siendo
obligación de la UAT exactamente igual. *Local no significa sin reglas.*

**Reconsiderar si:** el cliente cambia de opinión. Está previsto:
`SINCRONIZACION.subirFotos` existe y está en `false`.

---

## D-024 · La llave de las fotos lleva una contraseña de recuperación

**Decidido:** la llave AES se envuelve dos veces: con `safeStorage` (DPAPI) y
con una contraseña de recuperación que el administrador define al instalar.

**Descartado:**

- *Sólo `safeStorage`,* que es lo que decía la especificación. Es más simple y
  tiene un modo de falla intolerable: DPAPI está atado al perfil de Windows de
  esa máquina, así que reinstalar Windows —o que se corrompa el perfil— vuelve
  las fotos ilegibles para siempre. No es hipotético: el CLAUDE.md dice que las
  PCs cambian con frecuencia y que no hay departamento de TI.
- *Guardar la llave en la nube.* Tendría sentido técnico y contradice de frente
  la decisión anterior: si la llave sale, las fotos dejan de ser "sólo locales"
  en cualquier sentido útil.
- *Una llave fija en el código.* Eso no es cifrar, es ofuscar. Todo lo del
  `.exe` es público (CLAUDE.md 3.2).

**Por qué:** porque una medida de seguridad que puede destruir los datos que
protege está mal calibrada. El riesgo real aquí no es que alguien robe las
fotos: es que nadie pueda abrirlas el día que hagan falta.

La contraseña se entrega impresa junto con las demás credenciales
(CLAUDE.md 1.1) y nunca vive en el repositorio ni en la nube.

**Reconsiderar si:** aparece un gestor de secretos institucional donde
depositarla, en cuyo caso deja de depender de una hoja de papel.

---

## D-025 · La marca de agua se aplica al exportar, no al capturar

**Decidido:** las fotos se guardan limpias. La fecha, hora, número de empleado,
tipo y nombre del kiosco se queman en la imagen **sólo** en el ZIP que sale a
USB.

**Descartado:**

- *Marcarlas al capturar,* que es lo que pedía la especificación. Tres razones:
  1. **No agrega seguridad.** Un JPEG se edita. La prueba de integridad ya la
     da el SHA-256, que sí es difícil de falsificar.
  2. **Vuelve la foto más identificable.** Se decidió nombrar los archivos por
     UUID "nunca el nombre del empleado"… y la marca de agua metería el número
     de empleado dentro de los píxeles. Es evitar el dato en el nombre del
     archivo y ponerlo en la imagen.
  3. Cuesta un render por cada captura, en el momento más sensible del flujo.

**Por qué:** el beneficio real de la marca de agua aparece cuando los archivos
**viajan sueltos**. Una carpeta de 500 JPEGs con nombre UUID es inservible sin
el CSV; ahí la marca de agua sí resuelve algo. Dentro del sistema, donde cada
foto está atada a su marca por el nombre del archivo, no resuelve nada.

Mismo beneficio, menos datos personales almacenados — que es un principio
legal, no una preferencia (minimización de datos).

**Reconsiderar si:** se detecta que las fotos exportadas circulan sin su CSV y
alguien las usa fuera de contexto.

---

## D-026 · Con 20 empleados, la lista pasa a dos dígitos

**Decidido:** el modo `'lista'` acepta selección de **dos dígitos** (01–20), y
el máximo sube de 12 a ~24.

**Descartado:**

- *Caer al modo `'usuario'`* ("dgomez"), que es lo que el sistema hacía solo al
  pasar de 12 empleados. Necesita **teclado completo**, y el CLAUDE.md 13.1 dice
  que la entrada preferente es un **teclado numérico** — con guantes y a las 6
  de la mañana. La regla de degradación automática estaba pensada para un
  problema de legibilidad de la lista, no para uno de hardware.
- *Modo `'numero'`* (el del gafete). Ya se había descartado: en la práctica
  nadie se lo sabe.

**Por qué:** lo que hizo ganar al modo lista no fue que la lista fuera corta:
fue que **no hay nada que memorizar** y que funciona con teclado numérico. Dos
teclas en vez de una conserva las dos propiedades; cambiar de modo las pierde
las dos.

El costo es de privacidad: 20 nombres en una pantalla pública en vez de 5. Se
mitiga como ya se hacía —sólo nombre e inicial, "Dalton G."— pero es un costo
real y hay que decirlo.

**Reconsiderar si:** el personal crece más allá de ~24, donde buscar el propio
nombre en la lista empieza a tardar más que teclear un usuario.

---

## D-027 · El ciclo de vida de la foto va en su propia tabla

**Decidido:** la marca guarda el `foto_hash`, que no cambia nunca. Todo lo que
sí cambia con el tiempo (dónde está el archivo, "Conservar", cuándo se borró)
vive en una tabla local aparte, `fotos`.

**Descartado:**

- *Columnas nuevas en `marcas`* (`conservar`, `eliminada_en`…). Más cómodo de
  consultar, y obliga a hacer `UPDATE` sobre una tabla que el CLAUDE.md 8
  declara inmutable. Al primer "sólo esta columna sí se puede cambiar", la regla
  deja de ser una regla.

**Por qué:** separa la **evidencia** (quién, cuándo, la huella de la foto) de la
**administración** del archivo. Es la misma separación que ya hace la nube, donde
sólo `foto_estado` puede cambiar en una marca (migración 0005).

Única excepción, documentada en `registrarFotoHeredada`: las marcas de antes del
3.b reciben su `foto_hash` **una sola vez**, porque la columna no existía y está
vacía, no con otro valor. Ninguna de esas marcas ha salido nunca del kiosco.

**Reconsiderar si:** nunca, mientras las marcas sean inmutables.

---

## D-028 · La retención cuenta desde la última marca, no sólo desde el reloj de Windows

**Decidido:** una foto vence cuando es más vieja que el plazo, medido desde la
**menor** de dos horas: la de Windows y la de la última marca registrada. Con el
reloj sospechoso no se borra nada.

**Descartado:**

- *Usar sólo `Date.now()`.* Es lo obvio y abre una puerta concreta: adelantar el
  reloj 31 días y reiniciar la app borra la evidencia del mes. En un sistema que
  asume que puede haber marcajes irregulares (CLAUDE.md 1), eso no es un
  caso raro.

**Por qué:** así, adelantar el reloj ya no alcanza. Además hay que registrar una
marca con la hora falsa, y esa marca llega a la nube con su `recibido_en`, que la
delata.

**El costo:** si el kiosco pasa semanas sin marcas (vacaciones), las fotos
vencidas se borran cuando vuelve a haber marcas, no el día exacto. Se prefiere
un retraso de días en borrar a una forma de destruir evidencia.

**Reconsiderar si:** la sincronización ya da una hora de servidor confiable. En
ese caso el "ahora" puede salir de ella.

---

## D-029 · Al modo administrador se entra con un botón, y un fallo regresa en vez de bloquear

**Decidido (con el usuario, 22-09-2026):**

- Se entra con un **botón con engrane y la palabra "Administrador"**, en la barra
  de abajo. No con una combinación de teclas.
- Una contraseña equivocada **regresa a la pantalla principal** con el aviso
  "Intento fallido. Quedó registrado con fecha y hora." No hay bloqueo de minutos.
- Queda sólo una **red de seguridad**: a partir del 5.º fallo seguido hay que
  esperar antes del siguiente intento (30 s, 1 min, 2 min… hasta 5 min).
- Ayudas para quien no se lleva con la computadora: aviso de **mayúsculas
  activadas** y botón **"Mostrar"** la contraseña.

**Descartado:**

- *Ctrl+Alt+Shift+A.* El jefe puede ser una persona mayor. Cuatro teclas a la vez
  se olvidan, y un acceso que su dueño no recuerda no le sirve.
- *Bloqueo general de 5 minutos tras 5 fallos* (lo que había antes). Castigaba al
  jefe con las mayúsculas puestas. Y, peor, dejaba que **cualquier empleado
  dejara al jefe fuera** tecleando cinco contraseñas malas a propósito.

**Por qué:** lo que protege el modo administrador es la contraseña, no que la
puerta esté escondida. Regresar a la pantalla principal vuelve lento y visible
probar contraseñas sin castigar al que se equivoca una vez. El aviso dice la
verdad: cada fallo va a `eventos_dispositivo` como `modo_admin_intento_fallido`.

Se descartó también poner "capturando información". Daría a entender que se
tomó una foto, y eso no pasa. Fotografiar a quien falla sería usar la cámara
para un fin distinto de la asistencia (CLAUDE.md 12), y eso tendría que
aprobarlo la Unidad de Transparencia.

**Reconsiderar si:** los eventos muestran intentos en serie. En ese caso se puede
bajar `fallosAntesDeEsperar`.

---

## D-030 · La exportación a USB: sólo fotos marcadas, a una memoria elegida de una lista

**Decidido:**

- El ZIP lleva **sólo las fotos con marca de agua** (`fotos/`), más
  `registros.csv` y `LEEME.txt`. Las originales, sin marca, **no** van por
  defecto (`EXPORTACION.incluirOriginales: false`).
- Lo que se graba es lo que pide el CLAUDE.md 5.1: fecha, hora, tipo, número de
  empleado y kiosco. **No el nombre** (`datosGrabados.nombre: false`). Si el
  empleado no tiene número, se graba su usuario, para que la foto no quede
  anónima.
- El CSV lleva la huella SHA-256 **de la original**, que es la que tiene la
  nube. El kiosco la comprueba antes de exportar (si no cuadra, la foto no sale
  y el CSV dice "alterada").
- El destino se elige de una **lista de memorias USB** que arma el proceso
  principal (Windows, `DriveType = 2`). La pantalla manda sólo la letra, y el
  proceso principal vuelve a comprobar que sea una memoria conectada.
- Existe "Elegir otra carpeta…" para discos USB grandes que Windows presenta
  como disco fijo. **Nunca** deja guardar en el disco del kiosco ni en una
  carpeta de red (salvo en desarrollo).
- Primero se anota **cada foto** en `accesos_foto` (`exportar`), y después se
  escribe. Además, un evento `exportacion_usb` por exportación, aunque no lleve
  fotos: el CSV también son datos personales.
- Sin librerías: el ZIP (método "store", porque los JPEG no se comprimen más) y
  la letra de 5×7 puntos están escritos a mano. `nativeImage` de Electron abre y
  guarda los JPEG.

**Descartado:**

- *Incluir siempre las originales.* Permitirían comprobar la huella fuera del
  kiosco, pero son fotos sin ningún dato: separadas del CSV no dicen de quién
  son. Justo el problema que la marca de agua resuelve (D-025).
- *La ventana "Guardar como" de Windows como camino principal.* A una persona
  poco acostumbrada la pierde entre carpetas. Además, en el kiosco es una
  puerta al explorador de archivos. Se quedó sólo como opción secundaria.
- *Poner el número o el nombre del empleado en el nombre de cada archivo.* Van
  grabados en la foto y en el CSV. El nombre del archivo lleva fecha, hora, tipo
  y UUID, igual que en el kiosco (CLAUDE.md 5.1).
- *Marcar la foto en la pantalla (canvas) y mandarla de vuelta.* El proceso
  principal tendría que creer lo que le devuelve la pantalla.
- *Proteger el ZIP con contraseña.* El cifrado estándar de ZIP es débil, y el
  fuerte (AES) no lo abre Windows sin programas extra. Una contraseña que da
  falsa seguridad es peor que un aviso claro: "las fotos salen sin candado".

**Por qué:** la memoria USB es el único lugar donde las fotos existen sin
cifrar fuera del kiosco. Todo apunta a que lo que sale se entienda solo (marca
de agua, CSV, LEEME), a que salga lo mínimo (sin nombres, sin originales) y a
que quede rastro de cada foto.

**Reconsiderar si:** alguien necesita demostrar fuera del sistema que una foto
no se editó (una queja formal, por ejemplo). Para esa exportación se enciende
`incluirOriginales`.

---

## D-031 · Edge Functions sólo para el kiosco, y una contraseña del jefe aparte para el kiosco

**Decidido:**

- Hay **cuatro Edge Functions**, todas del kiosco: `enrolar-kiosco`,
  `recibir-registros`, `catalogo` y `latido`. El kiosco se identifica con su
  token en `x-kiosco-token`, y por eso las cuatro llevan `verify_jwt = false`.
- Lo que hace el **panel** (generar el código de enrolamiento, revocar un
  kiosco, poner credenciales) son **funciones de la base** con
  `security definer`. Cada una comprueba el rol por dentro.
- Las reglas de guardado (idempotencia, kiosco revocado, cuarentena) viven en
  `recibir_registros()`, en SQL. La Edge Function sólo valida la forma y quién
  llama.
- El jefe tiene una **contraseña para el modo administrador del kiosco**
  (`administradores.usuario_kiosco` y `contrasena_kiosco_hash`) **distinta** de
  la del panel.
- El nombre del kiosco lo pone el jefe **al generar el código**. Quien instala
  sólo teclea el código.

**Descartado:**

- *Generar códigos y revocar con Edge Functions*, como decía el comentario de
  la 0004. Lo que se quería evitar era generar el código en el navegador, y una
  función de la base también corre en el servidor, con el generador de pgcrypto.
  Así es más simple y se prueba igual que el resto del esquema.
- *Que el kiosco use la misma contraseña del panel*, leyendo el hash de
  `auth.users`. Ese hash bajaría a cada kiosco. Quien se robe un disco podría
  adivinarla en su casa sin límite de intentos y entrar al panel desde
  cualquier lado. Separadas, lo peor que consigue es la del kiosco que ya se
  llevó. Además, depender de una tabla interna de Supabase Auth ata el sistema
  a un detalle que puede cambiar.
- *La llave `anon` dentro del `.exe` para llamar a las funciones.* No agrega
  seguridad (todo lo del `.exe` es público, CLAUDE.md 3.2). Lo que identifica al
  kiosco es su token.

**Por qué:** cada pieza queda en el lugar donde se prueba mejor y donde un
error cuesta menos.

**Reconsiderar si:** el jefe no quiere recordar dos contraseñas. Entonces el
panel puede ofrecer "usar la misma" al ponerla, sabiendo el riesgo.

---

## Plantilla para decisiones nuevas

```markdown
## D-0NN · Título corto

**Decidido:**
**Descartado:**
**Por qué:**
**Reconsiderar si:**
```
