/**
 * ============================================================================
 *  CONFIGURACION CENTRAL DEL SISTEMA
 * ============================================================================
 *
 *  ESTE ES EL ARCHIVO QUE VAS A TOCAR MAS SEGUIDO.
 *
 *  Regla del proyecto: ningun numero "magico" vive suelto dentro del codigo.
 *  Si manana el jefe dice "ahora el PIN va a ser de 6 digitos", tu cambias
 *  UN numero aqui y toda la aplicacion (teclado, validaciones, mensajes de
 *  error, base de datos) se adapta sola. No hay que buscar el "4" escondido
 *  en veinte archivos.
 *
 *  ---------------------------------------------------------------------------
 *  IMPORTANTE: hay DOS tipos de configuracion en este sistema
 *  ---------------------------------------------------------------------------
 *
 *  1) La de ESTE archivo  -> valores ESTRUCTURALES y VALORES POR DEFECTO.
 *     Se compilan dentro del programa. Cambiarlos requiere volver a generar
 *     el instalador. Aqui van cosas como "cuantos digitos tiene un PIN".
 *
 *  2) La de la TABLA `configuracion` en Supabase -> valores OPERATIVOS.
 *     El jefe los cambia desde el panel y el kiosco los recibe al
 *     sincronizar, sin reinstalar nada. Aqui van cosas como "tolerancia de
 *     retardo" o "dias de retencion de fotos".
 *
 *     El CLAUDE.md (seccion 8) exige que horarios, tolerancias y turnos vivan
 *     en TABLAS, nunca en codigo. Por eso esos valores NO estan aqui.
 *
 *  Los valores de abajo marcados como `PorDefecto` son el "plan B": lo que
 *  usa el kiosco mientras todavia no ha podido sincronizar con la nube
 *  (por ejemplo, el primer arranque en una PC nueva sin internet).
 *
 *  ---------------------------------------------------------------------------
 *  Como leer este archivo
 *  ---------------------------------------------------------------------------
 *  `as const` al final de cada bloque le dice a TypeScript:
 *  "estos valores son fijos, avisame si alguien intenta modificarlos en
 *   tiempo de ejecucion". Es una red de seguridad, no cambia el valor.
 */

// Los colores no viven aqui, viven en `tema.json` (ver `tema.ts`), porque
// tambien los necesita el CSS de la pantalla y un archivo .ts no lo puede leer.
import { COLORES } from './tema';

// ============================================================================
//  1. IDENTIFICACION DEL EMPLEADO  (numero de empleado + PIN)
// ============================================================================
export const IDENTIFICACION = {
  /**
   * ¿COMO SE IDENTIFICA EL EMPLEADO?  <-- LA DECISION MAS IMPORTANTE DE AQUI
   *
   *   'usuario'  El empleado teclea un nombre de usuario corto: "dgomez"
   *              (primera letra del nombre + apellido paterno).
   *              + Nadie tiene que memorizar un numero.
   *              - Necesita TECLADO COMPLETO. Con guantes o manos humedas a
   *                las 6 AM, teclear letras es mas lento y con mas errores.
   *
   *   'lista'    La pantalla muestra la lista de empleados y cada uno
   *              presiona el numero que esta junto a su nombre.
   *              + No hay NADA que memorizar. Es la opcion mas rapida:
   *                una tecla en vez de seis.
   *              + Funciona con teclado numerico.
   *              - Muestra los nombres del personal en una pantalla publica.
   *              - Solo sirve con pocos empleados (ver `maximoEmpleadosParaLista`).
   *
   *   'numero'   Numero de empleado, el del gafete.
   *              + Rapido y numerico.
   *              - En la practica casi nadie se lo sabe.
   *
   * ELEGIDO: 'lista'. Nada que memorizar, funciona con teclado numerico y
   * con guantes. Se probaron los tres en pantalla y este gano. Con los ~20
   * empleados confirmados, el numero es de DOS digitos (01-20): dos teclas en
   * vez de una, y sigue sin haber nada que memorizar (D-026). La pantalla lo
   * decide sola segun cuantas personas hay.
   */
  modo: 'lista' as 'usuario' | 'lista' | 'numero',

  /**
   * Solo para el modo 'lista': hasta cuantas personas sigue siendo comodo
   * buscar el propio nombre. Con 13 o mas la pantalla pasa a tres columnas
   * compactas; mas alla de este numero, conviene pensar en el modo 'usuario'
   * (D-026, "Reconsiderar si").
   *
   * HOY ES INFORMATIVO: nada lo aplica. La lista se muestra completa aunque se
   * pase, porque dejar a alguien fuera de la lista seria impedirle checar.
   */
  maximoEmpleadosParaLista: 24,

  /** Largo minimo del nombre de usuario ("dgomez" son 6). */
  largoUsuarioMinimo: 3,

  /** Largo maximo del nombre de usuario. */
  largoUsuarioMaximo: 20,

  /** Digitos minimos que puede tener un numero de empleado. */
  largoNumeroEmpleadoMinimo: 3,

  /** Digitos maximos. El teclado en pantalla deja de aceptar teclas al llegar aqui. */
  largoNumeroEmpleadoMaximo: 4,

  /**
   * Digitos del PIN.
   * <-- CAMBIA ESTOS NUMEROS Y TODO EL SISTEMA SE ADAPTA (puntos en pantalla,
   *     validacion, mensajes, reglas de PIN temporal).
   *
   * ESTAN IGUALES A PROPOSITO, y eso cambia mucho la experiencia.
   *
   * Antes eran 4 y 6, y en la primera prueba visual se vio el problema: la
   * pantalla dibujaba SEIS puntos vacios, el empleado tecleaba sus cuatro
   * digitos, y quedaban dos puntos sin llenar. Parecia que faltaba algo.
   * Ademas habia que presionar Enter, porque con largo variable el sistema
   * no puede saber si ya terminaste de teclear.
   *
   * Con largo fijo:
   *   - se dibujan exactamente 4 puntos: los que hay que llenar;
   *   - al teclear el cuarto se valida SOLO, sin Enter.
   *
   * El flujo completo queda en 5 teclas: el numero de tu nombre y 4 digitos.
   *
   * Si algun dia se quiere PIN de 6, se cambian LOS DOS numeros.
   */
  largoPinMinimo: 4,
  largoPinMaximo: 4,

  /**
   * Si es `true`, en cuanto el empleado teclea el ultimo digito posible del PIN
   * se valida solo, sin que tenga que presionar "Aceptar".
   * Solo funciona si largoPinMinimo === largoPinMaximo (si no, el sistema no
   * puede saber cuando terminaste de teclear).
   */
  validarAutomaticamenteAlCompletarPin: true,
} as const;

// ============================================================================
//  2. SEGURIDAD DEL PIN  (intentos fallidos y bloqueos)
// ============================================================================
//  CLAUDE.md 3.4: "Bloqueo temporal por empleado tras N intentos fallidos
//  (configurable) y retardo creciente."
//
//  Ojo con el equilibrio: bloquear mucho tiempo choca con la REGLA DE ORO
//  ("nunca impedir que alguien registre"). Por eso el bloqueo es corto y
//  temporal, y el jefe siempre puede registrar la asistencia manualmente.
export const SEGURIDAD_PIN = {
  /**
   * Intentos fallidos seguidos antes de bloquear a ese empleado.
   *
   * Cuatro es suficiente: te puedes equivocar de tecla una vez, dudar otra, y
   * todavia te queda un intento. A partir de ahi ya no parece un dedo torpe.
   *
   * Entre 4 y 5 la diferencia de seguridad es minima (un PIN de 4 digitos
   * tiene 10 000 combinaciones; probar una mas no acerca a nadie). Lo que de
   * verdad protege es el retardo creciente de abajo y, sobre todo, la foto.
   *
   * Este valor tambien sera ajustable desde el panel administrativo, en la tabla
   * `configuracion` de Supabase. Aqui vive solo el valor por defecto.
   */
  intentosFallidosMaximos: 4,

  /** Cuanto dura el bloqueo, en segundos. 300 = 5 minutos. */
  segundosDeBloqueo: 300,

  /**
   * Cuantos minutos se "olvidan" los intentos fallidos.
   *
   * ¿PARA QUE SIRVE ESTO? Sin esto habria un error molesto y dificil de
   * diagnosticar: los fallos se irian sumando PARA SIEMPRE.
   *
   * Imagina a alguien que se equivoca una vez el lunes, otra el martes y otra
   * el miercoles. El jueves se equivoca por cuarta vez... y queda bloqueado,
   * sin entender nada, porque para el fue "la primera vez que me equivoco".
   *
   * Con este olvido, los intentos se cuentan solo dentro de una ventana de
   * tiempo. Si pasaron mas de 15 minutos desde el ultimo fallo, el contador
   * vuelve a cero. El bloqueo sirve contra alguien probando PINes uno tras
   * otro AHORA, que es de lo que protege; no contra alguien distraido.
   */
  minutosParaOlvidarIntentos: 15,

  /**
   * Retardo creciente: despues de cada intento fallido el sistema espera
   * un poco antes de responder. Esto hace inutil probar PINes a mano.
   * Formula: retardo = retardoBaseMs * (2 ^ intentosFallidos), topado por el maximo.
   * Con 250ms queda: 250ms, 500ms, 1s.
   *
   * ¿POR QUE TAN SUAVE? Porque la cuenta sale asi: con bloqueo a los 4
   * intentos y 5 minutos de castigo, probar las 10 000 combinaciones de un
   * PIN de 4 digitos tomaria casi NUEVE DIAS seguidos. El retardo creciente
   * encima de eso no cambia nada para un atacante...
   *
   * ...pero SI se nota, y mucho, para alguien que solo se equivoco de tecla.
   * Un empleado esperando 3 segundos frente a la pantalla a las 6 AM cree
   * que el sistema se trabo.
   *
   * Regla general: cuando una medida de seguridad estorba mucho al usuario
   * legitimo y casi no estorba al atacante, esta mal calibrada.
   */
  retardoBaseMs: 250,
  retardoMaximoMs: 2000,

  /**
   * Cuantos segundos vale una identificacion ya hecha, mientras el empleado
   * decide en la pantalla de confirmacion.
   *
   * ¿QUE ES ESTO? Cuando alguien teclea bien su PIN, el proceso principal NO
   * guarda la marca todavia: guarda en memoria un "pase" con quien es, la
   * hora exacta y las lecturas de reloj, y le manda a la pantalla solo un
   * numero al azar. La pantalla ensena la confirmacion y, si el empleado
   * acepta, devuelve ese numero para que se guarde la marca.
   *
   * El pase se usa UNA vez y caduca. Este valor es cuanto aguanta.
   *
   * 60 segundos es mucho mas que los 3 de la cuenta regresiva, y es a
   * proposito: no queremos que caduque justo cuando alguien se quedo pensando
   * si le tocaba entrada o salida. Es un limite de cordura, no una prisa.
   */
  segundosDeVidaDeLaIdentificacion: 60,

  /**
   * Costo de bcrypt para el hash del PIN.
   * Numero mas alto = mas seguro pero mas lento. Cada +1 DUPLICA el tiempo.
   * 10 tarda ~60ms en una PC modesta, que es imperceptible para el empleado
   * pero carisimo para alguien que quiera probar millones de PINes.
   * No bajes de 10.
   */
  costoBcrypt: 10,
} as const;

// ============================================================================
//  3. INTERFAZ DEL KIOSCO  (tiempos y comportamiento de pantalla)
// ============================================================================
export const INTERFAZ = {
  /**
   * CLAUDE.md 4.4: "Si no toca nada, se confirma automaticamente."
   * Segundos de la cuenta regresiva en la pantalla de confirmacion.
   *
   * Es el numero mas delicado de este archivo, porque mide DOS cosas
   * contrarias a la vez:
   *
   *   - cuanto tiene que esperar alguien que ya sabe lo que quiere;
   *   - cuanto tiene alguien para darse cuenta de que el sistema le sugirio
   *     la accion equivocada y alcanzar a corregirla.
   *
   * EMPEZO EN 3 Y SUBIO A 5 tras probarlo en pantalla.
   *
   * Tres segundos bastan para LEER la confirmacion, pero no para leerla,
   * darse cuenta de que dice lo contrario de lo que uno queria, y alcanzar
   * a presionar el boton. Y ese segundo caso es la razon de ser de toda la
   * pantalla: si no da tiempo de corregir, la accion "sugerida" vuelve a ser
   * una accion impuesta.
   *
   * Los dos segundos extra no le cuestan nada a quien ya sabe lo que hace:
   * presiona Enter (o 1) y no espera. Solo los paga quien se quedo dudando,
   * que es justo a quien hay que darselos.
   *
   * Bajarlo a 1 volveria inutil el boton de cambiar. Subirlo a 10 haria que
   * la gente empezara a presionar Enter sin leer, que es peor que no tener
   * confirmacion.
   */
  segundosConfirmacionAutomatica: 5,

  /** Si el empleado deja el teclado a medias, se limpia solo despues de este tiempo. */
  segundosInactividadParaLimpiar: 20,

  /**
   * Cuanto dura en pantalla la confirmacion del registro.
   *
   * Empezo en 2 segundos y en la primera prueba con una persona real no le
   * dio tiempo ni de leerla: "solo mire algo verde y algo amarillo".
   *
   * Seis segundos suena mucho, pero el problema que resuelve es serio. La
   * duda tipica frente a un checador es "¿si agarro?, ¿si marque?", y cuando
   * alguien no esta seguro, VUELVE A CHECAR — y entonces si genera un
   * registro equivocado. Mas vale que la pantalla se quede un rato de mas.
   *
   * Ademas el mensaje se quita solo en cuanto el siguiente empleado teclea
   * cualquier cosa, asi que en la practica nunca estorba a la fila.
   */
  segundosMensajeExito: 6,

  /**
   * La camara se muestra en espejo (como te ves en un espejo real).
   * Si esta en false, la gente se ve "al reves" y les cuesta acomodarse.
   *
   * OJO: esto solo afecta como SE VE en pantalla. La foto que se guarda como
   * evidencia nunca sale espejeada; se toma del video original.
   */
  videoEnEspejo: true,

  /**
   * Teclado numerico dibujado en la pantalla, para usar con el raton.
   *
   * Apagado por defecto: la PC del kiosco tiene teclado fisico y no es tactil,
   * asi que el teclado en pantalla solo estorbaria.
   *
   * ¿Y por que existe entonces? Por la regla de oro: es un kiosco en un
   * pasillo. Si el teclado se descompone, se desconecta o se lo llevan un
   * lunes a las 6 AM, nadie podria registrar hasta conseguir otro.
   * Con este interruptor, pones `true`, la gente checa con el raton mientras
   * tanto, y nadie se queda sin marcar.
   *
   * <-- PONLO EN true SI SE QUEDAN SIN TECLADO
   */
  mostrarTecladoEnPantalla: false,

  /**
   * ¿Se puede ver la lista de registros guardados desde el kiosco?
   *
   * Es la PRIMERA VERSION de la pantalla de auditoria del modo administrador
   * (CLAUDE.md 5.2, bloque 3.b). Hoy muestra la tabla; cuando exista el modo
   * administrador quedara detras de usuario y contrasena, y cada registro
   * llevara su foto al lado.
   *
   * APAGADO desde el 22-09-2026: ya existe el modo administrador (boton del
   * engrane), que muestra lo mismo y mas —con foto— detras de una contrasena.
   *
   * Por que importa: esta pantalla muestra a que hora entro y salio cada
   * persona, y el kiosco esta en un pasillo publico. Sin contrasena delante,
   * es un tablero de asistencia a la vista de cualquiera.
   *
   * <-- PONLO EN true SOLO PARA UNA DEMOSTRACION, Y REGRESALO A false
   */
  mostrarRegistrosEnKiosco: false,

  /** Cuantos registros se traen para esa pantalla. */
  maximoRegistrosEnPantalla: 50,

  /** El reloj de la pantalla principal se refresca cada tantos milisegundos. */
  intervaloRelojMs: 1000,

  /**
   * ------------------------------------------------------------------------
   *  SONIDOS  (CLAUDE.md 13.1: "sonidos distintos para entrada, salida y error")
   * ------------------------------------------------------------------------
   *
   * Los tres sonidos NO son archivos: se generan con el sintetizador que ya
   * trae el navegador. Ver `servicios/sonidos.ts`.
   *
   * ¿Por que importan en un kiosco? Porque cuando la pantalla confirma, el
   * empleado suele estar guardando las llaves, quitandose los guantes o ya
   * dandose la vuelta. El oido no necesita estar mirando.
   *
   * Y son distintos ENTRE SI a proposito, no solo "un sonido bonito":
   *
   *     entrada -> dos notas que SUBEN
   *     salida  -> dos notas que BAJAN
   *     error   -> grave y aspero
   *
   * La direccion (sube o baja) ES la informacion. Alguien de espaldas sabe si
   * marco entrada o salida sin voltear, y quien no distingue bien los colores
   * de la pantalla tiene un segundo canal que no depende de la vista.
   */
  sonidosActivos: true,

  /**
   * Volumen de esos sonidos, de 0 (mudo) a 1.
   *
   * 0.35 es discreto a proposito: el kiosco vive en un pasillo. Un pitido a
   * todo volumen se vuelve una molestia, alguien termina desconectando las
   * bocinas... y entonces se pierde tambien el aviso de error, que es el que
   * de verdad hacia falta.
   *
   * <-- SUBELO SI EL PASILLO ES RUIDOSO, BAJALO SI MOLESTA
   */
  volumenSonidos: 0.35,

  /**
   * Cuantas horas se sigue mostrando el estado de un empleado en la lista
   * ("Adentro desde 06:02").
   *
   * ¿PARA QUE UN LIMITE? Porque si no, el lunes por la manana la lista
   * seguiria diciendo "Adentro desde las 14:00" de la marca del viernes.
   * Una etiqueta vieja no informa: confunde.
   *
   * 16 horas cubre cualquier turno completo, incluido el nocturno de
   * 22:00 a 06:00, y se apaga sola antes de que la informacion caduque.
   *
   * (En la Fase 3, cuando existan los turnos, esto se calculara con la
   * "fecha laboral" de verdad. Mientras, una ventana de horas es una
   * aproximacion honesta y suficiente.)
   */
  horasParaMostrarEstadoEnLista: 16,
} as const;

// ============================================================================
//  3.b  PAUSA: PRESTAR LA COMPUTADORA UN RATO
// ============================================================================
//
//  EL PROBLEMA QUE RESUELVE
//  ------------------------
//  El kiosco instalado va en pantalla completa y no se deja cerrar. Eso esta
//  bien si la PC solo sirve para checar... pero nadie ha confirmado que sea
//  asi (CLAUDE.md 14: pendiente). Si resulta ser una computadora que alguien
//  mas usa —un maestro que necesita buscar algo, soporte revisando otra
//  cosa— entonces una aplicacion que no se quita de en medio es un estorbo
//  serio, y la primera reaccion de cualquiera seria desinstalarla.
//
//  LA DIFERENCIA ENTRE "PAUSAR" Y "CERRAR"
//  ---------------------------------------
//  Son necesidades distintas y por eso son dos cosas distintas:
//
//    PAUSAR   el kiosco se MINIMIZA y vuelve solo a los N minutos.
//             Para quien necesita la PC diez minutos. No cierra nada.
//
//    CERRAR   Ctrl+Alt+Shift+Q. Para mantenimiento de verdad.
//             Ver arranque-automatico.ts.
//
//  LO QUE HAY QUE TENER PRESENTE
//  -----------------------------
//  Con el kiosco pausado, NADIE PUEDE CHECAR. Eso choca de frente con la
//  regla de oro del proyecto, y por eso la pausa:
//
//    - vuelve sola, siempre, sin depender de que alguien se acuerde;
//    - deja constancia en la bandeja de salida, para que el jefe pueda
//      explicar por que falta un registro entre las 10:15 y las 10:32.
//
//  Una pausa sin constancia seria un hueco inexplicable en la asistencia.
export const PAUSA = {
  /**
   * ¿Se puede pausar el kiosco?
   *
   * <-- PONLO EN false SI LA PC ES SOLO PARA CHECAR
   *
   * En ese caso el boton desaparece de la pantalla y la unica salida vuelve a
   * ser la combinacion de mantenimiento. Se queda en `true` mientras no se
   * confirme como es la computadora: es el valor que no estorba en ninguno de
   * los dos escenarios, porque si sobra basta apagarlo.
   */
  permitida: true,

  /**
   * El codigo que hay que teclear para pausar.
   *
   * ESTO NO ES SEGURIDAD, Y CONVIENE DECIRLO CLARO.
   *
   * El CLAUDE.md 3.2 es explicito: "todo lo empaquetado en el .exe se
   * considera publico". Este codigo viaja dentro del programa, asi que quien
   * quiera puede averiguarlo.
   *
   * Es un TOPE CONTRA EL USO CASUAL, y no necesita ser mas. Pausar el kiosco
   * no da acceso a nada: las marcas ya estan guardadas, no se pueden editar
   * desde aqui, y la pausa vuelve sola y queda registrada. Lo unico que evita
   * este codigo es que alguien lo presione por curiosidad.
   *
   * Cuando exista el panel (bloque 8), este valor se movera a la tabla
   * `configuracion` para que el jefe lo cambie sin reinstalar.
   */
  codigo: '1234',

  /**
   * A los cuantos minutos vuelve solo el kiosco.
   *
   * 15 minutos es suficiente para una consulta rapida y lo bastante corto
   * para que la PC no se quede prestada media manana. Quien necesite mas
   * vuelve a pausarla.
   */
  minutosParaVolver: 15,
} as const;

// ============================================================================
//  4. CAMARA Y FOTOGRAFIA
// ============================================================================
//  CLAUDE.md 5: la camara NUNCA bloquea el registro.
export const CAMARA = {
  /**
   * Lado mayor de la foto guardada, en pixeles. CLAUDE.md 4: "640x480".
   *
   * Estuvo en 480 por una version anterior de la especificacion. Se subio a
   * 640 el 23-09-2026, al agregar el zoom del modo administrador: con 480, al
   * acercar mas de 2x ya solo se veian cuadritos. La camara entrega 1280x720,
   * asi que los 640 son detalle real, no una foto chica estirada.
   *
   * Costo: ~60-80 KB por foto en vez de ~30-50. Con 20 personas y 30 dias de
   * retencion son ~110 MB en disco. Nada, para cualquier computadora.
   */
  anchoFotoPx: 640,

  /** Calidad JPEG de 0 a 1. 0.7 da fotos de 60-80 KB a 640 px, suficientes para reconocer a alguien. */
  calidadJpeg: 0.7,

  /** Cada cuanto se revisa si la camara sigue viva (CLAUDE.md 5). */
  intervaloVerificacionMs: 5000,

  /**
   * Deteccion de lente tapado (con un dedo, cinta, etc.).
   * El sistema saca el brillo promedio del frame (0 = negro total, 255 = blanco).
   * Si esta por DEBAJO de este numero, se levanta la bandera `foto_obstruida`.
   * Sube el numero si el cuarto es muy oscuro y quieres ser mas exigente.
   */
  umbralBrilloMinimo: 45,
  // Medido con el medidor de desarrollo en una camara de laptop, con una
  // cara bien iluminada: brillo ~166, varianza ~3640. Los umbrales de abajo
  // estan MUY por debajo de eso, asi que no hay riesgo de falsos avisos.
  // Con el dedo sobre el lente si baja lo suficiente para marcarse.
  // Se comprobo ademas que un vaso enfrente NO marca, que es lo correcto:
  // con un vaso todavia se te ve la cara, asi que la foto sigue sirviendo.

  /**
   * La varianza mide cuanta "textura" tiene la imagen. Una pared lisa o un
   * lente tapado tienen varianza casi cero; una cara tiene mucha.
   * Por debajo de este numero tambien se marca `foto_obstruida`.
   */
  umbralVarianzaMinima: 250,

  /** El panel alerta si una camara lleva mas de estos minutos caida. */
  minutosCaidaParaAlerta: 15,
} as const;

// ============================================================================
//  5. RELOJ Y ANTI-MANIPULACION
// ============================================================================
//  CLAUDE.md 6. La idea: el empleado con acceso a la PC podria cambiar la hora
//  de Windows para "llegar temprano". No lo podemos impedir, pero SI lo podemos
//  detectar y dejar constancia. Las banderas nunca bloquean el registro.
export const RELOJ = {
  /**
   * Zona horaria oficial del sistema (CLAUDE.md 6: confirmado America/Matamoros).
   * Este es solo el valor por defecto; el real vive en la tabla `configuracion`.
   * PROHIBIDO usar America/Mexico_City u offsets fijos como "-06:00".
   */
  zonaHorariaPorDefecto: 'America/Matamoros',

  /**
   * Comparamos dos relojes:
   *   - el de pared (la hora de Windows, que se puede cambiar a mano)
   *   - el monotonico (un cronometro que solo avanza y NO se puede tocar)
   * Si al momento de una marca ambos no coinciden por mas de este margen,
   * alguien movio la hora -> bandera `reloj_sospechoso`.
   * 60000 ms = 1 minuto de tolerancia (cubre el ajuste normal de Windows).
   */
  umbralDesfaseSospechosoMs: 60_000,

  /** Cada cuanto se pregunta la hora al servidor para recalcular el desfase. */
  intervaloSincronizacionHoraMs: 5 * 60 * 1000, // 5 minutos

  /**
   * Si el desfase contra el servidor cambia mas que esto entre dos consultas,
   * las marcas offline de ese periodo quedan marcadas para revision.
   */
  cambioDesfaseSignificativoMs: 120_000, // 2 minutos
} as const;

// ============================================================================
//  6. SINCRONIZACION CON LA NUBE
// ============================================================================
//  CLAUDE.md 7. La red NUNCA bloquea la interfaz: todo esto corre por detras.
export const SINCRONIZACION = {
  /**
   * EL INTERRUPTOR GENERAL (CLAUDE.md 7). Con `false` el kiosco funciona 100%
   * local y no intenta hablar con nadie: ni se enrola, ni sube, ni baja. Es
   * lo que permite entregar el sistema aunque el cliente decida al final que
   * no quiere nube.
   */
  activa: true,

  /**
   * ¿Se suben las fotos? NO: la foto nunca sale del kiosco; a la nube va solo
   * su hash (CLAUDE.md 5.1). El interruptor existe para que, si algun dia el
   * cliente cambia de opinion, quede claro donde se decide. Hoy nada lo lee
   * para subir: encenderlo requeriria construir esa parte.
   */
  subirFotos: false,

  /**
   * Donde viven las Edge Functions. En desarrollo, el Supabase local
   * (`npx supabase start`). En el kiosco instalado, el proyecto de
   * PRODUCCION: se llena al crear la cuenta (CLAUDE.md 13.3). Mientras este
   * vacio, el kiosco instalado se comporta como si `activa` fuera `false`.
   *
   * AQUI VA LA "Project URL" DEL PROYECTO DE PRODUCCION, tal como se copia
   * de Supabase -> Project Settings -> API: 'https://xxxx.supabase.co'.
   * Es publica (no es una llave). Despues: `npm run empaquetar`.
   */
  urlFuncionesDesarrollo: 'http://127.0.0.1:54321/functions/v1',
  // FASE DE PRUEBAS: apunta a asistencia-pruebas. Al entregar, cambiar a
  // produccion: 'https://ref-de-produccion.supabase.co' (docs/PASOS-FINALES.md).
  urlFuncionesProduccion: 'https://ref-de-pruebas.supabase.co',

  /**
   * Tras guardar una marca, en cuanto intenta subirla. No es inmediato para
   * juntar en un solo viaje las que llegan seguidas (la fila de las 6 AM).
   */
  segundosTrasUnaMarca: 3,

  /**
   * Una respuesta que tarda mas que esto no sirve para medir el desfase del
   * reloj: no se sabe en que momento del viaje la escribio el servidor.
   */
  viajeMaximoParaMedirDesfaseMs: 5000,

  /** Cada cuanto intenta vaciar la bandeja de salida (outbox) hacia Supabase. */
  intervaloPushMs: 30_000,

  /** Cada cuanto baja el catalogo de empleados, PINes y configuracion. */
  intervaloPullMs: 5 * 60 * 1000,

  /** Cada cuanto reporta "sigo vivo" al panel (heartbeat). */
  intervaloHeartbeatMs: 60_000,

  /** Cuantas marcas manda por lote. Mas grande = menos viajes, pero mas riesgo si falla. */
  tamanoLote: 50,

  /**
   * Reintento con espera creciente (backoff exponencial): si falla, espera
   * 2s, luego 4s, 8s, 16s... hasta el tope. Evita machacar un servidor caido.
   */
  reintentoBaseMs: 2000,
  reintentoMaximoMs: 5 * 60 * 1000,

  /** Segundos que espera una peticion de red antes de darse por vencida. */
  segundosTiempoLimitePeticion: 15,
} as const;

// ============================================================================
//  7. VENTANA DE ELECTRON  (como se ve y se comporta la aplicacion de escritorio)
// ============================================================================
export const VENTANA = {
  /** Titulo que aparece en la barra de Windows. */
  titulo: 'Control de Asistencia',

  /**
   * En produccion el kiosco va en pantalla completa sin barra de titulo,
   * para que nadie lo minimice o lo cierre.
   * Durante el desarrollo conviene ponerlo en false para poder trabajar.
   */
  pantallaCompletaEnProduccion: true,

  /** Tamano de la ventana cuando NO esta en pantalla completa (modo desarrollo). */
  anchoDesarrollo: 1280,
  altoDesarrollo: 800,

  /** Medidas minimas. Debajo de esto el teclado numerico ya no cabe bien. */
  anchoMinimo: 1024,
  altoMinimo: 700,

  /**
   * Color que pinta la ventana ANTES de que cargue la interfaz.
   * Si lo dejas en blanco se ve un parpadeo feo al arrancar.
   *
   * No esta escrito aqui a proposito: lo toma del tema, para que no pueda
   * quedar desincronizado con el fondo real de la pantalla. Si quieres
   * cambiarlo, edita `tema.json`.
   */
  colorDeFondo: COLORES.fondo,
} as const;

// ============================================================================
//  8. RUTAS Y NOMBRES DE ARCHIVO LOCALES
// ============================================================================
export const ALMACENAMIENTO = {
  /** Nombre del archivo SQLite dentro de la carpeta de datos del usuario. */
  archivoBaseDeDatos: 'kiosco.db',

  /**
   * Carpeta HEREDADA: ahi guardaban las fotos, SIN CIFRAR, las versiones
   * anteriores al bloque 3.b. Ya no se escribe nada en ella. Solo se consulta
   * al arrancar, para cifrar lo que haya quedado y vaciarla
   * (ver `migrarFotosHeredadas` en servicios/fotos.ts).
   */
  carpetaFotosHeredada: 'fotos_pendientes',

  /**
   * El "gafete" del kiosco ante la nube: su token, cifrado con DPAPI de
   * Windows (CLAUDE.md 3.3). Copiado a otra PC no se puede descifrar.
   */
  archivoCredencial: 'credencial-kiosco.json',
} as const;

// ============================================================================
//  8.b  FOTOS: CIFRADO Y RETENCION  (CLAUDE.md 5.1)
// ============================================================================
//  LA FOTO NUNCA SALE DEL KIOSCO. Vive cifrada en disco y a la nube solo va
//  su hash. Aqui estan los valores ESTRUCTURALES (los que decide el
//  programador). El plazo de retencion es regla de negocio: el valor de aqui
//  es solo el respaldo mientras no llegue el de la tabla `configuracion`.
export const FOTOS = {
  /** Carpeta dentro de la de datos. Adentro: AAAA/MM/<uuid-de-la-marca>.jpg.enc */
  carpeta: 'fotos',

  /** Extension de las fotos cifradas. El ".enc" avisa que no se abren con doble clic. */
  extension: '.jpg.enc',

  /** Archivo con la llave de cifrado (envuelta; nunca en claro). */
  archivoLlave: 'llave-fotos.json',

  /**
   * Dias que se conserva una foto antes de borrarse (CLAUDE.md 5.1).
   *
   * RESPALDO: el valor real es `dias_retencion_fotos` de la tabla
   * `configuracion`, que baja con la sincronizacion. Este solo se usa mientras
   * ese no haya llegado nunca.
   */
  diasRetencionPorDefecto: 30,

  /** Cada cuantas horas se buscan fotos vencidas (ademas de al arrancar). */
  horasEntreDepuraciones: 6,

  /**
   * Espera antes de la primera busqueda tras arrancar. Al arrancar lo primero
   * es que la pantalla aparezca y la gente pueda checar; borrar puede esperar.
   */
  segundosAntesDeLaPrimeraDepuracion: 60,

  /**
   * Largo minimo de la contrasena de recuperacion.
   *
   * Es la unica proteccion de las fotos si alguien se lleva el disco, y NO
   * tiene limite de intentos (el atacante prueba en su propia computadora).
   * Por eso es larga: una frase de varias palabras, no un PIN.
   */
  largoMinimoContrasenaRecuperacion: 12,

  /**
   * Parametros de scrypt: convierte la contrasena en una llave, a proposito
   * LENTO (~0.1 s y 32 MB de memoria por intento). Para quien la teclea una
   * vez no se nota; para quien prueba millones de contrasenas es un muro.
   *
   * Se guardan dentro del archivo de la llave, asi que subirlos manana no
   * rompe las llaves ya envueltas.
   */
  scrypt: { costo: 2 ** 15, tamanoBloque: 8, paralelismo: 1 },
} as const;

// ============================================================================
//  8.c  MODO ADMINISTRADOR EN EL KIOSCO  (CLAUDE.md 5.2)
// ============================================================================
//  La unica forma de ver las fotos. Se entra con el boton del ENGRANE de la
//  barra de abajo, y usuario y contrasena de administrador del sistema (no de
//  Windows).
//
//  ¿Por que un boton y no una combinacion de teclas? Decision del 22-09-2026:
//  el jefe puede ser una persona mayor, poco familiarizada con la
//  computadora, y una combinacion de cuatro teclas se olvida. Lo que protege
//  no es que la puerta este escondida: es la contrasena (ver D-029).
export const MODO_ADMIN = {
  /** Se cierra solo tras estos minutos sin actividad (CLAUDE.md 5.2: 2 minutos). */
  minutosDeInactividad: 2,

  /** Cuantos registros rechazados por la oficina se listan (los mas recientes). */
  rechazadosAMostrar: 50,

  /**
   * UN INTENTO FALLIDO REGRESA A LA PANTALLA PRINCIPAL, con el aviso
   * "Intento fallido. Quedo registrado con fecha y hora." (que es verdad: cada
   * fallo queda en la bitacora de eventos).
   *
   * No hay bloqueo de minutos para el jefe que se equivoca: un bloqueo de 5
   * minutos a quien tiene las mayusculas puestas solo castiga al que tiene
   * derecho a entrar. Y ademas, con un bloqueo general, cualquier empleado
   * podria dejar al jefe fuera tecleando 5 contrasenas malas a proposito.
   *
   * Lo unico que queda es una RED DE SEGURIDAD para quien prueba contrasenas
   * una tras otra: a partir de este numero de fallos SEGUIDOS, hay que esperar
   * antes del siguiente intento. El jefe que se equivoca una o dos veces nunca
   * la ve.
   */
  fallosAntesDeEsperar: 5,

  /** La primera espera, y se duplica con cada fallo mas: 30 s, 1 min, 2 min... */
  segundosDeEsperaInicial: 30,

  /** Tope de la espera. Nunca mas de esto, por muchos fallos que haya. */
  segundosDeEsperaMaxima: 300,

  /**
   * Que datos se muestran ENCIMA de la foto al verla en el modo administrador.
   *
   * Se MUESTRAN, no se graban en la imagen: la foto guardada queda limpia
   * (D-025). Solo al exportar a USB se graban, porque ahi los archivos viajan
   * sueltos.
   *
   * Cuando exista el panel, esto lo decidira el jefe desde ahi. Mientras, aqui.
   */
  datosSobreLaFoto: {
    fechaHora: true,
    tipo: true,
    numeroEmpleado: true,
    nombre: true,
  },

  /** Tope de renglones por busqueda. Con 20 personas, 200 son ~5 dias completos. */
  maximoRegistrosPorConsulta: 200,

  /**
   * Cada cuantos segundos, como mucho, la pantalla avisa "sigo aqui" mientras
   * la persona mueve el raton. Mas seguido no aporta nada: solo mensajes.
   */
  segundosEntreAvisosDeActividad: 20,

  /** Cuanto se queda en pantalla el aviso de intento fallido. */
  segundosAvisoIntentoFallido: 6,

  /**
   * Zoom del visor de fotos. Mas alla de ~2x la foto se ve pixeleada: no hay
   * mas detalle que el que se capturo (ver CAMARA.anchoFotoPx). El tope evita
   * acercarse tanto que solo se vean cuadritos.
   */
  zoomMaximoFoto: 4,

  /** Cuanto acerca cada clic en "Acercar" o cada giro de la rueda del raton. */
  pasoZoomFoto: 0.5,
} as const;

// ============================================================================
//  8.d  EXPORTACION A MEMORIA USB  (CLAUDE.md 5.2)
// ============================================================================
//  Un ZIP con las fotos DESCIFRADAS y con marca de agua, mas un CSV de los
//  registros. Es el unico camino por el que una foto sale del kiosco, y por
//  eso cada foto exportada queda en la bitacora `accesos_foto`.
export const EXPORTACION = {
  /**
   * Que se GRABA en los pixeles de cada foto exportada (D-025). Aqui si se
   * graba, y no solo se muestra encima: en la memoria los archivos viajan
   * sueltos, sin la pantalla de auditoria que diga de quien es cada uno.
   *
   * La lista es la del CLAUDE.md 5.1: fecha, hora, numero de empleado, tipo y
   * nombre del kiosco. El nombre del empleado NO va por defecto (minimizacion
   * de datos): el numero basta para cruzar con el CSV. Si el empleado no
   * tiene numero, se graba su usuario ("dgomez") para que la foto no quede
   * anonima.
   */
  datosGrabados: {
    fechaHora: true,
    tipo: true,
    numeroEmpleado: true,
    nombre: false,
    kiosco: true,
  },

  /**
   * Tamano de la letra grabada: cada punto de la letra se dibuja como un
   * cuadrito de N x N pixeles. Con 3, en una foto de 640 px caben ~34 letras
   * por renglon. Si un renglon no cabe, se baja solo hasta 1.
   */
  escalaDeLetra: 3,

  /** Que tan oscura es la franja detras del texto (0 = transparente, 1 = negra). */
  opacidadDeFranja: 0.7,

  /**
   * Calidad del JPEG al volver a guardar la foto ya marcada. Un poco mas alta
   * que la de captura (CAMARA.calidadJpeg) para no perder detalle de mas al
   * comprimir por segunda vez.
   */
  calidadJpeg: 85,

  /**
   * ¿Se incluye tambien la foto ORIGINAL, sin marca de agua?
   *
   * Solo la original tiene la misma huella (SHA-256) que el registro en la
   * nube, asi que solo con ella se puede comprobar la integridad FUERA del
   * kiosco. A cambio, son fotos sin ningun dato encima: si se separan del
   * CSV, no dicen de quien son. Por defecto no (D-030).
   */
  incluirOriginales: false,

  /**
   * Tope de registros por exportacion. Un mes completo de 20 personas son
   * ~900. El tope evita que un filtro vacio arme un ZIP de un ano entero sin
   * que nadie lo haya pedido.
   */
  maximoRegistros: 5000,

  /**
   * ¿Se ofrece "Elegir otra carpeta"? Sirve para discos USB grandes, que
   * Windows no siempre reconoce como memoria removible. Abre la ventana de
   * Windows para elegir carpeta. Aun asi, NUNCA deja guardar en el disco de
   * esta computadora (salvo en desarrollo): las fotos saldrian sin cifrar
   * justo en el lugar de donde no deben salir en claro.
   */
  permitirElegirCarpeta: true,

  /** Cuanto espera la busqueda de memorias USB antes de darse por vencida. */
  segundosParaBuscarMemorias: 10,

  /** El archivo queda como `<prefijo>_<desde>_a_<hasta>_<cuando>.zip`. */
  prefijoDelArchivo: 'asistencia',
} as const;

// ============================================================================
//  9. AGRUPADOR
// ============================================================================
/**
 * Un solo objeto con todo adentro, por comodidad:
 *   import { CONFIG } from '@kiosko/compartido';
 *   CONFIG.identificacion.largoPinMinimo
 *
 * Tambien puedes importar los bloques sueltos si prefieres:
 *   import { IDENTIFICACION } from '@kiosko/compartido';
 */
export const CONFIG = {
  identificacion: IDENTIFICACION,
  seguridadPin: SEGURIDAD_PIN,
  interfaz: INTERFAZ,
  pausa: PAUSA,
  camara: CAMARA,
  reloj: RELOJ,
  sincronizacion: SINCRONIZACION,
  ventana: VENTANA,
  almacenamiento: ALMACENAMIENTO,
  fotos: FOTOS,
  modoAdmin: MODO_ADMIN,
  exportacion: EXPORTACION,
} as const;

/** El tipo de CONFIG, por si necesitas escribirlo en una firma de funcion. */
export type Configuracion = typeof CONFIG;
