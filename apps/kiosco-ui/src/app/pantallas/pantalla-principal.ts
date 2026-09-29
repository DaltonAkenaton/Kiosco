/**
 * ============================================================================
 *  PANTALLA PRINCIPAL DEL KIOSCO
 * ============================================================================
 *
 *  Es la pantalla que el personal ve todo el dia (CLAUDE.md 4.1):
 *  video en vivo, reloj grande, identificacion, y una barra discreta de estado.
 *
 *  ---------------------------------------------------------------------------
 *  LOS TRES MODOS DE IDENTIFICACION
 *  ---------------------------------------------------------------------------
 *  Se elige con `IDENTIFICACION.modo` en la configuracion central:
 *
 *    'usuario'  teclea "dgomez"  -> necesita teclado completo
 *    'lista'    elige su nombre de una lista numerada -> una sola tecla
 *    'numero'   teclea "0123"    -> nadie se lo sabe
 *
 *  La pantalla soporta los tres. Cambias la palabra en la configuracion y la
 *  interfaz se reacomoda sola: no hay tres pantallas, hay una que se adapta.
 *
 *  ---------------------------------------------------------------------------
 *  La maquina de estados
 *  ---------------------------------------------------------------------------
 *      identificador ──> pin ──> validando ──> confirmando ──> guardando
 *            ^             │           │              │              │
 *            └─────────────┴──(error)──┘              │              │
 *            └───────────────────────(cancelar)───────┘              │
 *            └─────────────────────────────────(exito o error)───────┘
 *
 *  Tener el paso en un solo signal, en vez de cinco banderas sueltas
 *  (`estaEscribiendoPin`, `estaValidando`, `estaConfirmando`...), hace
 *  imposibles los estados contradictorios como "validando y confirmando a la
 *  vez".
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE EXISTE EL PASO "CONFIRMANDO" (bloque 3)
 *  ---------------------------------------------------------------------------
 *  Hasta el bloque 2, teclear el PIN registraba la marca de inmediato con la
 *  accion que el sistema sugeria. Funcionaba, y tenia un problema serio:
 *
 *      si el sistema sugeria mal, el empleado se enteraba DESPUES,
 *      cuando ya estaba guardado.
 *
 *  Y sugerir mal pasa de verdad. El caso tipico: alguien marca salida, se da
 *  cuenta de que olvido algo y regresa. El sistema, que lo ve "afuera", le
 *  sugiere ENTRADA — correcto. Pero cuando se va otra vez ese mismo dia, sin
 *  confirmacion no tendria forma de decir "no, esto es salida".
 *
 *  CLAUDE.md 4.4 lo resuelve asi, y es lo que hace este paso:
 *    - se MUESTRA lo que se va a registrar, en grande, antes de guardarlo;
 *    - hay un boton para cambiarlo y otro para cancelar;
 *    - si el empleado no hace nada, se confirma solo a los 3 segundos.
 *
 *  Ese ultimo punto es el que mantiene la regla de oro: la confirmacion
 *  INFORMA, no estorba. Quien no tiene nada que corregir no presiona nada.
 */

import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  ConfiguracionParaInterfaz,
  EmpleadoParaLista,
  EstadoNube,
  MarcaParaMostrar,
  TipoMarca,
} from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { Reloj } from '../componentes/reloj';
import { ModoAdmin } from './modo-admin';
import { TecladoNumerico } from '../componentes/teclado-numerico';
import { Camara, type FotoCapturada } from '../servicios/camara';
import { PuenteKiosco } from '../servicios/puente-kiosco';
import { Sonidos } from '../servicios/sonidos';

/**
 * Los pasos por los que puede ir un registro.
 *
 *   identificador  eligiendo o tecleando quien es
 *   pin            tecleando el PIN
 *   validando      el proceso principal esta comprobando el PIN
 *   confirmando    la cuenta regresiva: "vas a registrar ENTRADA, ¿si?"
 *   guardando      ya se acepto; se esta escribiendo la marca en disco
 */
type Paso = 'identificador' | 'pin' | 'validando' | 'confirmando' | 'guardando';

/**
 * Lo que espera en la pantalla de confirmacion mientras corre la cuenta.
 *
 * Fijate en lo que NO esta aqui: el id del empleado. La pantalla no lo
 * necesita y por lo tanto no lo tiene. Lo unico que guarda es el `pase`, y
 * el proceso principal es quien sabe a quien pertenece.
 */
interface RegistroPendiente {
  /** El pase de un solo uso que devolvio `identificar`. */
  tokenRegistro: string;
  nombre: string;
  /** La hora del evento, ya formateada por el proceso principal ("06:02"). */
  hora: string;
  /** Lo que se va a registrar. Cambia si el empleado presiona "cambiar". */
  tipo: TipoMarca;
  /**
   * Si el kiosco no pudo adivinar entrada o salida, el aviso que se muestra.
   * Con aviso NO hay cuenta regresiva: la persona elige.
   */
  duda: string | null;
  /**
   * La foto tomada AL VALIDAR EL PIN, no al confirmar.
   *
   * Se guarda aqui, en memoria, durante los segundos de la cuenta regresiva.
   * Si se tomara al confirmar, habria una ventana de tres segundos para
   * quitarse y poner a otra persona frente a la camara.
   */
  foto: FotoCapturada | null;
}

/**
 * Cada cuanto se refresca la cuenta regresiva, en milisegundos.
 *
 * 50 ms son 20 refrescos por segundo: suficiente para que la barra se vea
 * deslizarse y no dando saltos. Es barato porque lo unico que cambia es un
 * `transform: scaleX(...)`, que la tarjeta grafica resuelve sola sin volver a
 * calcular la pagina (ver el comentario de las animaciones en styles.css).
 *
 * Con 1000 ms bastaria para el numero, pero la barra avanzaria a tirones.
 */
const INTERVALO_CUENTA_MS = 50;

/**
 * Cuanto dura en pantalla un aviso neutro (el "Cancelado").
 *
 * Mas corto que la confirmacion de exito, que dura 6 segundos, y a proposito:
 * la confirmacion tiene que aguantar la duda de "¿si quedo?", mientras que
 * quien cancela ya sabe lo que hizo. Tres segundos alcanzan para leerlo sin
 * estorbarle al siguiente de la fila.
 */
const SEGUNDOS_DE_AVISO = 3;

@Component({
  selector: 'kiosco-pantalla-principal',
  imports: [Ayuda, Reloj, TecladoNumerico, ModoAdmin],
  templateUrl: './pantalla-principal.html',
})
export class PantallaPrincipal implements OnInit, OnDestroy {
  private readonly puente = inject(PuenteKiosco);
  private readonly sonidos = inject(Sonidos);
  protected readonly camara = inject(Camara);

  /**
   * `viewChild` busca un elemento dentro del HTML de este componente
   * (el que lleva `#video`). Es `.required` porque el <video> SIEMPRE existe,
   * aunque no haya camara: nunca se mete dentro de un @if, justamente para
   * que esta referencia no se quede apuntando a un elemento destruido.
   */
  private readonly elementoVideo = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  protected readonly estado = this.puente.estado;
  protected readonly configuracion = this.puente.configuracion;

  protected readonly paso = signal<Paso>('identificador');

  /** Lo que el empleado lleva tecleado como identificador (usuario o numero). */
  protected readonly identificador = signal('');
  protected readonly pin = signal('');

  /** Solo para el modo 'lista'. */
  protected readonly empleados = signal<EmpleadoParaLista[]>([]);
  protected readonly empleadoElegido = signal<EmpleadoParaLista | null>(null);

  protected readonly error = signal<string | null>(null);

  private temporizadorInactividad: ReturnType<typeof setTimeout> | null = null;

  // --------------------------------------------------------------------------
  //  Valores derivados
  // --------------------------------------------------------------------------

  protected readonly modo = computed(() => this.configuracion()?.modoIdentificacion ?? 'usuario');

  /** En el modo 'usuario' hay que teclear letras, asi que el campo es de texto. */
  protected readonly identificadorEsTexto = computed(() => this.modo() === 'usuario');

  protected readonly largoMaximoActual = computed(() => {
    const config = this.configuracion();
    if (!config) return 0;
    if (this.paso() === 'pin') return config.largoPinMaximo;
    return this.modo() === 'usuario'
      ? config.largoUsuarioMaximo
      : config.largoNumeroEmpleadoMaximo;
  });

  protected readonly valorActual = computed(() =>
    this.paso() === 'pin' ? this.pin() : this.identificador(),
  );

  /**
   * Los puntos de progreso del PIN: uno por digito posible, lleno o vacio.
   *
   * Muestran CUANTOS digitos llevas, nunca CUALES. Quien esta formado atras no
   * tiene por que ver el PIN de nadie.
   */
  protected readonly puntosPin = computed(() => {
    const largo = this.configuracion()?.largoPinMaximo ?? 0;
    const escritos = this.pin().length;
    return Array.from({ length: largo }, (_, i) => i < escritos);
  });

  protected readonly puedeAceptar = computed(() => {
    const config = this.configuracion();
    if (!config) return false;

    if (this.paso() === 'pin') return this.pin().length >= config.largoPinMinimo;

    if (this.modo() === 'lista') return this.empleadoElegido() !== null;

    const minimo =
      this.modo() === 'usuario' ? config.largoUsuarioMinimo : config.largoNumeroEmpleadoMinimo;
    return this.identificador().length >= minimo;
  });

  protected readonly instruccion = computed(() => {
    if (this.paso() === 'validando') return 'Revisando tu PIN…';
    if (this.paso() === 'guardando') return 'Guardando…';
    if (this.paso() === 'confirmando') return 'Confirma tu registro';
    if (this.paso() === 'pin') return 'Ahora teclea tu PIN';

    switch (this.modo()) {
      case 'usuario':
        return 'Escribe tu usuario';
      case 'lista':
        // Con dos cifras hay que DECIRLO: en la primera prueba real se
        // tecleo "1" + Enter esperando elegir al 01, y no paso nada.
        return this.digitosDeLista() > 1
          ? 'Teclea el número junto a tu nombre' // el ejemplo va en el renglon de abajo
          : 'Teclea el número junto a tu nombre';
      case 'numero':
        return 'Escribe tu número de empleado';
    }
  });

  /** Nombre de quien esta checando, para mostrarlo mientras teclea el PIN. */
  protected readonly nombreEnProceso = computed(() => {
    const elegido = this.empleadoElegido();
    if (elegido) return elegido.nombreParaMostrar;
    return this.identificador();
  });

  /**
   * ¿Se solto la camara por estar en pausa?
   *
   * Hace falta recordarlo para distinguir un CAMBIO de un simple repintado:
   * sin esta bandera, el effect de abajo intentaria encender la camara cada
   * vez que cualquier otra cosa del estado cambiara.
   */
  private camaraSoltadaPorPausa = false;

  /** La ultima sincronizacion por la que ya se recargo la lista de empleados. */
  private ultimaListaPorSincronizacion: string | null = null;

  constructor() {
    /**
     * Al pasar a "teclea tu PIN", el kiosco se pone al dia con la nube
     * mientras la persona teclea: si su ultimo registro fue en OTRO kiosco,
     * la sugerencia de ENTRADA/SALIDA ya lo toma en cuenta. No espera nada.
     */
    effect(() => {
      if (this.paso() === 'pin') untracked(() => this.puente.prepararRegistro());
    });

    /**
     * Durante la pausa se SUELTA la camara.
     *
     * No es por ahorrar CPU (que tambien). Es porque la pausa existe para que
     * alguien mas use la computadora, y si el kiosco se queda agarrando la
     * camara desde una ventana minimizada, esa persona no puede usarla para
     * una videollamada — y no tendria forma de entender por que.
     *
     * Prestar la computadora a medias no es prestarla.
     */
    effect(() => {
      const pausado = this.estado()?.pausado === true;

      // Solo actuar en los cambios. La primera pasada encuentra
      // `pausado === false` y `camaraSoltadaPorPausa === false`, asi que no
      // hace nada: encender la camara al inicio le toca a `ngOnInit`.
      if (pausado === this.camaraSoltadaPorPausa) return;
      this.camaraSoltadaPorPausa = pausado;

      if (pausado) {
        this.camara.detener();
      } else {
        void this.arrancarCamara();
      }
    });

    /**
     * Cuando llega el catalogo de la oficina (altas, bajas, cambios de
     * nombre), la lista de empleados se vuelve a pedir. Sin esto, alguien
     * recien dado de alta no apareceria hasta reiniciar el kiosco.
     */
    effect(() => {
      const sincronizado = this.estado()?.ultimaSincronizacion ?? null;
      if (sincronizado === null || sincronizado === this.ultimaListaPorSincronizacion) return;
      this.ultimaListaPorSincronizacion = sincronizado;
      if (this.modo() === 'lista') {
        void this.puente.obtenerEmpleadosParaLista().then((lista) => this.empleados.set(lista));
      }
    });

    /**
     * Un `effect` corre cada vez que cambia algun signal que lee adentro.
     *
     * Aqui conecta el flujo de la camara con el elemento <video>. No se puede
     * hacer en `ngOnInit` porque la camara tarda en encender y puede
     * reconectarse despues; con un effect, cada vez que el flujo cambie
     * (enciende, se cae, revive) el video se actualiza solo.
     */
    effect(() => {
      const flujo = this.camara.flujo();
      const video = this.elementoVideo().nativeElement;

      // `srcObject` es la forma correcta de darle un MediaStream a un <video>.
      // Nada de URLs: el flujo vive en memoria y nunca sale de la maquina.
      video.srcObject = flujo;

      if (flujo) {
        // `play()` puede rechazar (por ejemplo si el elemento se destruye
        // antes). No es un error que importe.
        video.play().catch(() => undefined);
      }
    });
  }

  // --------------------------------------------------------------------------
  //  Ciclo de vida
  // --------------------------------------------------------------------------

  async ngOnInit(): Promise<void> {
    const config = this.configuracion();

    if (this.modo() === 'lista') {
      this.empleados.set(await this.puente.obtenerEmpleadosParaLista());
    }

    await this.arrancarCamara();

    this.arrancarMedidor();
  }

  /**
   * Enciende la camara con los valores de la configuracion.
   *
   * Esta aparte porque se llama desde DOS sitios: al iniciar la pantalla y al
   * volver de una pausa. Copiar las tres lineas en los dos lugares seria la
   * receta habitual para que un dia alguien cambie la calidad del JPEG en uno
   * y no en el otro.
   */
  private async arrancarCamara(): Promise<void> {
    const config = this.configuracion();

    await this.camara.iniciar(
      config?.anchoFotoPx ?? 480,
      config?.calidadJpeg ?? 0.7,
      config?.intervaloVerificacionCamaraMs ?? 5000,
    );
  }

  ngOnDestroy(): void {
    this.camara.detener();
    this.cancelarInactividad();
    // Apagar el temporizador del mensaje de exito. En un kiosco que vive
    // prendido meses, cada temporizador olvidado se va acumulando.
    if (this.temporizadorExito !== null) clearTimeout(this.temporizadorExito);
    if (this.temporizadorMedidor !== null) clearInterval(this.temporizadorMedidor);
    if (this.temporizadorAviso !== null) clearTimeout(this.temporizadorAviso);
    if (this.temporizadorPinNuevo !== null) clearTimeout(this.temporizadorPinNuevo);
    this.detenerCuentaRegresiva();
  }

  // --------------------------------------------------------------------------
  //  Entrada por teclado FISICO
  // --------------------------------------------------------------------------

  /**
   * Escucha las teclas en toda la ventana.
   *
   * Es la forma de entrada PRINCIPAL del kiosco: la PC tiene teclado fisico
   * (CLAUDE.md 13.1). No usamos un <input> porque en un kiosco el foco se
   * pierde con cualquier clic, y entonces el empleado teclea y no pasa nada.
   * Escuchando la ventana entera, siempre funciona.
   */
  @HostListener('window:keydown', ['$event'])
  alPresionarTecla(evento: KeyboardEvent): void {
    // Con el modo administrador abierto, las teclas son de sus formularios.
    // Sin este corte, escribir "07" en la fecha elegiria a la persona 07.
    if (this.modoAdminAbierto()) return;

    // Igual con la ventana de alta: las teclas son del codigo.
    if (this.dandoDeAlta()) {
      if (evento.key === 'Escape') this.cerrarAlta();
      return;
    }

    /**
     * Si la confirmacion esta en pantalla, CUALQUIER tecla la quita.
     *
     * Los 6 segundos son para quien necesita leerla con calma. Quien ya la
     * leyo no tiene por que esperar: empieza a teclear y la tarjeta se va.
     *
     * Fijate en que NO se hace `preventDefault()` ni se corta aqui: la tecla
     * sigue su camino normal. Asi, si el siguiente empleado presiona "2", se
     * quita la tarjeta Y se elige a la persona 2 en el mismo golpe, en vez de
     * gastar una tecla solo en cerrar.
     */
    // La pantalla de registros se cierra con Esc, como todo lo demas.
    if (this.registros() !== null) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        this.cerrarRegistros();
      }
      return;
    }

    if (this.exito() !== null) this.descartarExito();

    /**
     * Mientras el proceso principal trabaja, el teclado no hace nada.
     *
     * No es por seguridad: es para que una tecla tecleada a destiempo (el
     * clasico "le pico otra vez porque no pasaba nada") no se cuele como el
     * primer digito del siguiente registro.
     */
    if (this.paso() === 'validando' || this.paso() === 'guardando') return;

    // Combinaciones con Ctrl/Alt son atajos del sistema, no texto.
    if (evento.ctrlKey || evento.altKey || evento.metaKey) return;

    /**
     * Si esta pidiendo el codigo de pausa, ese dialogo se lleva las teclas.
     *
     * Va antes que todo lo demas porque es un dialogo MODAL: mientras esta
     * abierto, ningun digito debe escribirse en el identificador ni en el PIN
     * de nadie.
     */
    if (this.pidiendoCodigoDePausa()) {
      this.teclaEnPausa(evento);
      return;
    }

    // "Elige tu PIN" tambien es una ventana modal: sus digitos son el PIN
    // nuevo, nunca el identificador del siguiente.
    if (this.eligiendoPin() !== null) {
      this.teclaEnPinNuevo(evento);
      return;
    }

    /**
     * La confirmacion tiene su propio teclado, y es un mundo aparte: ahi los
     * numeros no escriben nada, eligen entre tres opciones. Por eso se
     * atiende ANTES de toda la logica de escribir y se corta aqui.
     */
    if (this.paso() === 'confirmando') {
      this.teclaEnConfirmacion(evento);
      return;
    }

    switch (evento.key) {
      case 'Backspace':
        evento.preventDefault();
        this.borrarCaracter();
        return;
      case 'Enter':
        evento.preventDefault();
        void this.aceptar();
        return;
      case 'Escape':
        evento.preventDefault();
        this.reiniciar();
        return;
    }

    // --- Digitos: valen siempre (para el PIN, el numero y elegir de la lista)
    if (/^[0-9]$/.test(evento.key)) {
      evento.preventDefault();

      this.teclearDigito(evento.key);
      return;
    }

    // --- Letras: solo cuando se esta tecleando un usuario
    // El PIN es siempre numerico, asi que aqui se filtra por paso y por modo.
    if (this.paso() === 'identificador' && this.modo() === 'usuario') {
      // `evento.key.length === 1` distingue una letra ("a") de una tecla
      // especial ("Shift", "F5", "ArrowLeft"), que traen nombres largos.
      if (evento.key.length === 1 && /^[a-zA-Z.]$/.test(evento.key)) {
        evento.preventDefault();
        // Siempre en minusculas: asi "DGomez" y "dgomez" son lo mismo y nadie
        // se queda fuera por haber dejado puesto el bloqueo de mayusculas.
        this.agregarCaracter(evento.key.toLowerCase());
      }
    }
  }

  // --------------------------------------------------------------------------
  //  Captura
  // --------------------------------------------------------------------------

  protected agregarCaracter(caracter: string): void {
    if (this.paso() === 'validando') return;

    this.error.set(null);
    this.aviso.set(null);
    this.reiniciarInactividad();

    const destino = this.paso() === 'pin' ? this.pin : this.identificador;
    if (destino().length >= this.largoMaximoActual()) return;

    destino.update((actual) => actual + caracter);

    const config = this.configuracion();
    if (!config) return;

    // Avance automatico solo con identificadores de largo FIJO (el numero de
    // empleado). Con un usuario no se puede: el sistema no sabe si "dgom" ya
    // esta completo o si falta escribir "ez".
    if (
      this.paso() === 'identificador' &&
      this.modo() === 'numero' &&
      this.identificador().length === config.largoNumeroEmpleadoMaximo
    ) {
      this.paso.set('pin');
      return;
    }

    // Validacion automatica al completar el PIN, solo si el PIN tiene largo
    // fijo. Si puede ser de 4 a 6 digitos, el sistema no sabe si ya terminaste.
    if (
      this.paso() === 'pin' &&
      config.validarAutomaticamenteAlCompletarPin &&
      config.largoPinMinimo === config.largoPinMaximo &&
      this.pin().length === config.largoPinMaximo
    ) {
      void this.aceptar();
    }
  }

  protected borrarCaracter(): void {
    this.error.set(null);
    this.reiniciarInactividad();

    if (this.paso() === 'pin') {
      if (this.pin().length === 0) {
        // Borrar con el PIN vacio regresa al identificador. Es lo que la gente
        // espera, y evita tener que reiniciar todo por una tecla de mas.
        this.paso.set('identificador');
        this.empleadoElegido.set(null);
        return;
      }
      this.pin.update((actual) => actual.slice(0, -1));
      return;
    }

    if (this.seleccionEnCurso()) {
      this.seleccionEnCurso.set('');
      return;
    }

    this.identificador.update((actual) => actual.slice(0, -1));
  }

  /**
   * Un digito, venga del teclado fisico o del de pantalla.
   *
   * Antes el teclado de pantalla llamaba directo a `agregarCaracter` y el
   * fisico pasaba por aqui: en el modo lista, un clic en "3" ESCRIBIA un 3 en
   * vez de elegir a la tercera persona. Una sola puerta para los dos evita que
   * se vuelvan a separar.
   */
  protected teclearDigito(digito: string): void {
    if (this.modo() === 'lista' && this.paso() === 'identificador') {
      this.teclearDigitoDeLista(digito);
      return;
    }
    this.agregarCaracter(digito);
  }

  /**
   * ------------------------------------------------------------------------
   *  Lista con uno o dos digitos  (D-026)
   * ------------------------------------------------------------------------
   * Con hasta 9 personas basta una tecla. Con 10 o mas, una sola tecla ya no
   * alcanza: el "1" seria a la vez la persona 1 y el principio del 12. Por eso
   * los numeros pasan a tener DOS digitos (01, 02 ... 20) y hacen falta dos
   * teclas. Sigue sin haber nada que memorizar: el numero esta en pantalla.
   *
   * No es una opcion de configuracion: sale del numero de personas. Que alguien
   * pudiera poner "1 digito" con 20 empleados solo serviria para romperlo.
   */
  protected readonly digitosDeLista = computed(() => String(this.empleados().length).length);

  /**
   * Columnas de la lista: hasta 8 personas, dos (casillas anchas y grandes);
   * hasta 24, tres (las ~20 confirmadas caben en 7 filas aun a 1366x768);
   * mas, cuatro. Las filas se reparten el alto disponible (ver el HTML).
   */
  protected readonly columnasLista = computed(() => {
    const total = this.empleados().length;
    return total <= 8 ? 2 : total <= 24 ? 3 : 4;
  });
  protected readonly filasLista = computed(() =>
    Math.max(1, Math.ceil(this.empleados().length / this.columnasLista())),
  );

  /** Lo que lleva tecleado de un numero de dos digitos ("1" esperando el "2"). */
  protected readonly seleccionEnCurso = signal('');

  /** "07" con dos digitos, "7" con uno. Asi se ve igual que lo que se teclea. */
  protected numeroEnLista(indice: number): string {
    return String(indice + 1).padStart(this.digitosDeLista(), '0');
  }

  private teclearDigitoDeLista(digito: string): void {
    this.error.set(null);
    this.reiniciarInactividad();

    const tecleado = this.seleccionEnCurso() + digito;
    if (tecleado.length < this.digitosDeLista()) {
      this.seleccionEnCurso.set(tecleado);
      return;
    }

    this.completarSeleccion(tecleado);
  }

  /** Elige a la persona con ese numero ("1", "01" y "7" tambien valen). */
  private completarSeleccion(tecleado: string): void {
    this.seleccionEnCurso.set('');
    const numero = Number(tecleado);
    // Los numeros en pantalla empiezan en 1, el arreglo en 0.
    const empleado = this.empleados()[numero - 1];
    if (empleado) {
      this.elegirEmpleado(empleado);
    } else {
      const comoSeVe = String(numero).padStart(this.digitosDeLista(), '0');
      this.error.set(`No hay nadie con el número ${comoSeVe}. Busca tu nombre en la lista y teclea el número que tiene al lado.`);
    }
  }

  protected elegirEmpleado(empleado: EmpleadoParaLista): void {
    this.seleccionEnCurso.set('');
    this.empleadoElegido.set(empleado);
    this.identificador.set(empleado.id);
    this.paso.set('pin');
    this.error.set(null);
    this.reiniciarInactividad();
  }

  // --------------------------------------------------------------------------
  //  Selector de modo (SOLO DESARROLLO)
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  //  La conexion con la oficina (CLAUDE.md 7) y el alta del kiosco
  // --------------------------------------------------------------------------

  /**
   * Lo que dice la barra de abajo segun el estado de la nube, con su ⓘ.
   * `alta` = se ofrece el boton para teclear el codigo.
   */
  protected readonly conexion = computed(() => {
    const e = this.estado();
    const TEXTOS: Record<EstadoNube, { texto: string; color: string; ayuda: string; alta: boolean }> = {
      apagada: {
        texto: 'Sólo en esta computadora',
        color: 'var(--kiosko-texto-suave)',
        ayuda:
          'Este kiosco está configurado para no conectarse con la oficina. Los registros se guardan ' +
          'aquí y cuentan igual; para verlos hay que venir a esta computadora.',
        alta: false,
      },
      sin_alta: {
        texto: 'Kiosco sin dar de alta',
        color: 'var(--kiosko-atencion)',
        ayuda:
          'Este kiosco todavía no está conectado con la oficina. Los registros SÍ se guardan aquí y se ' +
          'mandarán cuando se dé de alta. Para darlo de alta, el jefe genera un código en el panel y ' +
          'alguien lo teclea con el botón "Dar de alta".',
        alta: true,
      },
      conectando: {
        texto: 'Conectando…',
        color: 'var(--kiosko-texto-suave)',
        ayuda: 'El kiosco está buscando la conexión con la oficina. Puedes registrarte normalmente.',
        alta: false,
      },
      en_linea: {
        texto: 'Con internet',
        color: 'var(--kiosko-entrada)',
        ayuda: 'El kiosco está conectado con la oficina: los registros se mandan solos.',
        alta: false,
      },
      sin_conexion: {
        texto: 'Sin internet',
        color: 'var(--kiosko-texto-suave)',
        ayuda:
          'No hay conexión con la oficina en este momento. Puedes registrarte normalmente: tu registro ' +
          'se guarda aquí y se manda solo cuando vuelva el internet.',
        alta: false,
      },
      revocado: {
        texto: 'Kiosco dado de baja',
        color: 'var(--kiosko-peligro)',
        ayuda:
          'En el panel dieron de baja este kiosco. Los registros se siguen guardando aquí, pero la ' +
          'oficina ya no los recibe. Si fue un error, el jefe genera un código nuevo y alguien lo ' +
          'teclea con "Dar de alta de nuevo".',
        alta: true,
      },
      no_reconocido: {
        texto: 'La oficina no reconoce este kiosco',
        color: 'var(--kiosko-peligro)',
        ayuda:
          'La oficina ya no reconoce la credencial de este kiosco. Los registros se siguen guardando ' +
          'aquí. Para arreglarlo, el jefe genera un código nuevo en el panel y alguien lo teclea con ' +
          '"Dar de alta de nuevo".',
        alta: true,
      },
    };
    return TEXTOS[e?.nube ?? 'apagada'];
  });

  protected readonly dandoDeAlta = signal(false);
  protected readonly codigoDeAlta = signal('');
  protected readonly enviandoAlta = signal(false);
  protected readonly errorDeAlta = signal<string | null>(null);
  protected readonly altaLograda = signal<string | null>(null);

  protected abrirAlta(): void {
    this.codigoDeAlta.set('');
    this.errorDeAlta.set(null);
    this.altaLograda.set(null);
    this.dandoDeAlta.set(true);
  }

  protected cerrarAlta(): void {
    if (this.enviandoAlta()) return;
    this.dandoDeAlta.set(false);
  }

  protected async enviarAlta(): Promise<void> {
    const codigo = this.codigoDeAlta().trim();
    if (this.enviandoAlta() || codigo.replace(/[^A-Za-z0-9]/g, '').length !== 8) {
      this.errorDeAlta.set('El código tiene 8 letras y números. Revísalo y vuelve a intentar.');
      return;
    }
    this.enviandoAlta.set(true);
    this.errorDeAlta.set(null);
    const resultado = await this.puente.enrolarKiosco(codigo);
    this.enviandoAlta.set(false);
    if (resultado.ok) {
      this.altaLograda.set(resultado.nombre);
    } else {
      this.errorDeAlta.set(resultado.mensaje);
    }
  }

  protected escribirCodigoDeAlta(evento: Event): void {
    // En mayusculas mientras se escribe: asi se ve igual que en el papel.
    this.codigoDeAlta.set((evento.target as HTMLInputElement).value.toUpperCase());
  }

  /** El ⓘ de "N por enviar", en la barra de abajo. */
  protected readonly AYUDA_POR_ENVIAR =
    'Son los registros que ya quedaron guardados en esta computadora, pero que todavía no se ' +
    'mandan al sistema de la oficina. Se mandan solos cuando hay internet. Tu registro ya cuenta ' +
    'desde que ves "ENTRADA" o "SALIDA" en la pantalla: no tienes que hacer nada.';

  /** Los tres modos, para el selector. */
  protected readonly MODOS = [
    { valor: 'usuario' as const, etiqueta: 'Usuario', ayuda: 'teclea dgomez' },
    { valor: 'lista' as const, etiqueta: 'Lista', ayuda: 'elige tu nombre' },
    { valor: 'numero' as const, etiqueta: 'Número', ayuda: 'teclea 0123' },
  ];

  /**
   * ¿Se muestra el selector de modo?
   *
   * Solo en desarrollo. En el kiosco real este boton no debe existir: un
   * empleado no tiene por que poder cambiar como se identifica la gente, y en
   * modo 'lista' quedarian los nombres de todo el personal a la vista.
   *
   * El dato viene del proceso principal (`esDesarrollo`), no de una
   * comprobacion aqui: la pantalla no puede saber por si misma si esta
   * empaquetada, y aunque pudiera, seria mas facil de enganar.
   */
  protected readonly mostrarSelectorDeModo = computed(
    () => this.configuracion()?.esDesarrollo === true,
  );

  /**
   * Medidor de la camara, SOLO EN DESARROLLO.
   *
   * Mide el cuadro actual cada segundo y muestra brillo y varianza en la
   * barra de abajo. Sirve para calibrar los umbrales de "camara tapada" con
   * datos reales en vez de a ojo: tapas el lente con el dedo, lees los
   * numeros de TU camara, y ajustas `umbralBrilloMinimo` y
   * `umbralVarianzaMinima` en la configuracion.
   *
   * Hace falta porque cada camara da numeros distintos. La de una laptop en
   * una oficina iluminada no se parece en nada a una webcam externa en un
   * pasillo a las 6 de la manana.
   */
  private temporizadorMedidor: ReturnType<typeof setInterval> | null = null;

  /**
   * ¿La camara pareceria tapada AHORA, con los umbrales actuales?
   *
   * Es una copia de la regla que aplica el proceso principal, pero solo para
   * el medidor de desarrollo. La decision de verdad —la que levanta la
   * bandera en la marca— se sigue tomando alla, nunca aqui.
   */
  protected readonly obstruidaAhora = computed(() => {
    const m = this.camara.ultimaMedicion();
    const config = this.configuracion();
    if (!m || !config) return false;
    return m.brilloPromedio < config.umbralBrilloMinimo || m.varianza < config.umbralVarianzaMinima;
  });

  private arrancarMedidor(): void {
    if (!this.configuracion()?.esDesarrollo) return;

    this.temporizadorMedidor = setInterval(() => {
      if (this.camara.disponible()) {
        this.camara.medirAhora(this.elementoVideo().nativeElement);
      }
    }, 1000);
  }

  protected async cambiarModo(modo: 'usuario' | 'lista' | 'numero'): Promise<void> {
    await this.puente.cambiarModoIdentificacion(modo);

    // Empezar de cero: lo que estuviera tecleado ya no tiene sentido en el
    // modo nuevo (un usuario no sirve como numero, ni al reves).
    this.reiniciar();

    if (modo === 'lista') {
      this.empleados.set(await this.puente.obtenerEmpleadosParaLista());
    }
  }

  protected async aceptar(): Promise<void> {
    // "1" + Enter en la lista = el 01. Enter cierra el numero a medias en vez
    // de ignorarse: es lo que la gente intenta primero.
    if (this.modo() === 'lista' && this.paso() === 'identificador' && this.seleccionEnCurso()) {
      this.completarSeleccion(this.seleccionEnCurso());
      return;
    }

    if (!this.puedeAceptar()) return;

    if (this.paso() === 'identificador') {
      this.paso.set('pin');
      return;
    }

    await this.identificar();
  }

  protected reiniciar(): void {
    /**
     * Si habia una confirmacion abierta, su pase se tira.
     *
     * Sin esto, presionar Esc durante la cuenta regresiva dejaria en la
     * memoria del proceso principal un permiso de registro vivo durante un
     * minuto. Caducaria solo, si — pero "se cancelo y por dentro seguia
     * valido" es justo la clase de cabo suelto que nadie encuentra despues.
     */
    this.descartarPendiente();

    this.identificador.set('');
    this.pin.set('');
    this.empleadoElegido.set(null);
    this.seleccionEnCurso.set('');
    this.paso.set('identificador');
    this.error.set(null);
    this.cancelarInactividad();
  }

  // --------------------------------------------------------------------------
  //  Identificacion
  // --------------------------------------------------------------------------

  private async identificar(): Promise<void> {
    this.paso.set('validando');
    this.cancelarInactividad();

    /**
     * LA FOTO SE TOMA AQUI, no despues.
     *
     * CLAUDE.md 4.3: "Al validar, EN ESE INSTANTE: se captura timestamp,
     * lecturas de reloj y foto."
     *
     * El motivo es anti-trampa: si la foto se tomara en la pantalla de
     * confirmacion, habria una ventana de dos o tres segundos para que el
     * empleado se quite y ponga a otra persona frente a la camara.
     */
    const foto = this.camara.capturar(this.elementoVideo().nativeElement);

    if (!foto) {
      // Sin camara se registra IGUAL (CLAUDE.md 5). La bandera `sin_camara`
      // la pondra el proceso principal al guardar, en el bloque 2.
      console.warn('[pantalla] registro sin foto: la camara no esta disponible');
    }

    const resultado = await this.puente.identificar({
      identificador: this.identificador(),
      pin: this.pin(),
    });

    if (!resultado.ok) {
      this.sonidos.reproducir('error');
      this.error.set(resultado.mensaje);
      // Se borra el PIN, no el identificador: ahorra volver a teclearlo.
      this.pin.set('');
      this.paso.set('pin');
      this.reiniciarInactividad();
      return;
    }

    // --- Identificado: ahora se PREGUNTA, no se registra ---------------
    //
    // Aqui estaba, hasta el bloque 2, la llamada a `registrarMarca`. Ahora en
    // su lugar se abre la confirmacion, y la marca se guarda —o no— unos
    // segundos despues.
    //
    // Las dos piezas de evidencia ya estan congeladas en este punto:
    //
    //   la FOTO  se capturo unas lineas arriba, al validar el PIN;
    //   la HORA  la guardo el proceso principal dentro del pase.
    //
    // Por eso la espera de la confirmacion no altera nada de lo que se
    // registra: solo decide SI se registra, y de que tipo.
    this.abrirConfirmacion({
      tokenRegistro: resultado.tokenRegistro,
      nombre: resultado.nombreParaMostrar,
      hora: resultado.horaLocalTexto,
      tipo: resultado.accionSugerida,
      duda: resultado.duda,
      foto,
    });
  }

  // --------------------------------------------------------------------------
  //  CONFIRMACION  (CLAUDE.md 4.4)
  // --------------------------------------------------------------------------

  /** Lo que espera confirmacion. `null` = no hay ninguna abierta. */
  protected readonly pendiente = signal<RegistroPendiente | null>(null);

  /** Milisegundos que le quedan a la cuenta regresiva. */
  private readonly msRestantes = signal(0);

  private temporizadorCuenta: ReturnType<typeof setInterval> | null = null;

  /** El total de la cuenta, para poder calcular que fraccion queda. */
  protected readonly msTotalesDeCuenta = computed(
    () => (this.configuracion()?.segundosConfirmacionAutomatica ?? 3) * 1000,
  );

  /**
   * El numero grande de la cuenta: 3, 2, 1.
   *
   * `Math.ceil` y no `Math.round`: con 2 400 ms restantes queremos que diga
   * "3", no "2". Un contador que empieza mostrando un numero menos del que
   * de verdad dura se siente descompuesto.
   */
  protected readonly segundosRestantes = computed(() => Math.ceil(this.msRestantes() / 1000));

  /**
   * Cuanto queda, de 1 a 0. Con esto se dibuja la barra de la confirmacion.
   *
   * Se usa como `scaleX` y no como `width` a proposito: escalar lo resuelve la
   * tarjeta grafica sin recalcular la pagina, y esto se refresca 20 veces por
   * segundo. Ver el comentario de las animaciones en styles.css.
   */
  protected readonly fraccionRestante = computed(() => {
    const total = this.msTotalesDeCuenta();
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, this.msRestantes() / total));
  });

  /** El tipo CONTRARIO al que se va a registrar, para el boton de cambiar. */
  protected readonly tipoContrario = computed<TipoMarca>(() =>
    this.pendiente()?.tipo === 'entrada' ? 'salida' : 'entrada',
  );

  /** Abre la confirmacion y arranca la cuenta regresiva. */
  private abrirConfirmacion(registro: RegistroPendiente): void {
    this.pendiente.set(registro);
    this.paso.set('confirmando');

    // Se limpia lo tecleado YA, no al terminar. Si el empleado cancela, la
    // pantalla debe quedar lista para el siguiente, no con su PIN a medias.
    this.identificador.set('');
    this.pin.set('');
    this.empleadoElegido.set(null);
    this.error.set(null);

    // La limpieza por inactividad no aplica aqui: la cuenta regresiva ya se
    // encarga de que esta pantalla no se quede puesta para siempre.
    this.cancelarInactividad();

    if (registro.duda) {
      // El kiosco no sabe si llega o se va: NO se confirma solo. Si la
      // persona se va sin elegir, se cancela y se avisa que no quedo nada.
      this.detenerCuentaRegresiva();
      this.msRestantes.set(0);
      const segundos = this.configuracion()?.segundosParaElegirSiHayDuda ?? 30;
      this.temporizadorInactividad = setTimeout(() => this.cancelarConfirmacion(), segundos * 1000);
      return;
    }

    this.arrancarCuentaRegresiva();
  }

  /**
   * Arranca (o reinicia) la cuenta regresiva.
   *
   * Es `setInterval` y no `setTimeout` porque ademas de disparar al final hay
   * que ir pintando cuanto falta. Un solo temporizador hace las dos cosas.
   */
  private arrancarCuentaRegresiva(): void {
    this.detenerCuentaRegresiva();
    this.msRestantes.set(this.msTotalesDeCuenta());

    this.temporizadorCuenta = setInterval(() => {
      const restante = this.msRestantes() - INTERVALO_CUENTA_MS;

      if (restante <= 0) {
        this.msRestantes.set(0);
        this.detenerCuentaRegresiva();
        // Nadie toco nada: se confirma solo (CLAUDE.md 4.4).
        void this.confirmarRegistro();
        return;
      }

      this.msRestantes.set(restante);
    }, INTERVALO_CUENTA_MS);
  }

  private detenerCuentaRegresiva(): void {
    if (this.temporizadorCuenta !== null) {
      clearInterval(this.temporizadorCuenta);
      this.temporizadorCuenta = null;
    }
  }

  /**
   * Guarda la marca de verdad.
   *
   * Es lo unico de toda la pantalla que escribe algo permanente. Se llega
   * aqui por tres caminos: la cuenta llego a cero, el empleado presiono
   * "Si, registrar", o presiono Enter.
   */
  protected async confirmarRegistro(): Promise<void> {
    const pendiente = this.pendiente();
    if (!pendiente) return;

    this.detenerCuentaRegresiva();
    // Si habia duda, su espera de 30 s se cancela: ya se eligio.
    this.cancelarInactividad();
    this.paso.set('guardando');

    /**
     * Mientras esto corre, el paso 'guardando' hace que el teclado no
     * responda. Asi no hay forma de mandar el mismo pase dos veces desde la
     * pantalla. Y aunque la hubiera, el proceso principal borra el pase al
     * canjearlo: un segundo intento no duplicaria la marca.
     */
    const registro = await this.puente.registrarMarca({
      tokenRegistro: pendiente.tokenRegistro,
      tipo: pendiente.tipo,
      fotoJpegBase64: pendiente.foto?.jpegBase64 ?? null,
      medicionesImagen: pendiente.foto?.mediciones ?? null,
    });

    // El pase ya se uso: se vacia sin avisarle al proceso principal, porque
    // del otro lado ese pase ya no existe.
    this.pendiente.set(null);

    if (!registro.ok) {
      /**
       * OJO CON EL ORDEN: primero `reiniciar()`, despues el mensaje.
       *
       * Al reves —que es como estaba escrito hasta el bloque 3— el mensaje no
       * se veia NUNCA, porque `reiniciar()` hace `error.set(null)` como parte
       * de dejar la pantalla limpia. El empleado veia la pantalla volver al
       * inicio sin explicacion, y su marca no se habia guardado. Ver E-013 en
       * errores-y-aprendizajes.md.
       */
      this.reiniciar();
      this.error.set(registro.mensaje);
      this.sonidos.reproducir('error');
      return;
    }

    this.mostrarExito({
      nombre: pendiente.nombre,
      // El tipo se toma de la RESPUESTA, no de lo que pedimos. La pantalla
      // debe mostrar lo que quedo guardado, no lo que ella creia.
      tipo: registro.tipo,
      hora: registro.horaLocalTexto,
      banderas: registro.banderas,
    });

    // Registro con el PIN que dio el jefe: ya con la asistencia guardada, se
    // le ofrece elegir uno propio (D-042). La tarjeta de exito se quita (el
    // sonido ya sono): quedaban dos ventanas encimadas. Lo que se registro no
    // se pierde, lo dice la ventana del PIN en su primer renglon.
    if (registro.tokenCambioPin) {
      this.descartarExito();
      this.abrirPinNuevo(registro.tokenCambioPin, pendiente.nombre, {
        tipo: registro.tipo,
        hora: registro.horaLocalTexto,
      });
    }
  }

  // --------------------------------------------------------------------------
  //  PIN propio  (D-042: "como en el cajero")
  // --------------------------------------------------------------------------
  //
  //  Su registro YA se guardo. Esto es aparte y se puede dejar para despues
  //  ("Ahora no"): nunca impide checar.

  /** Quien esta eligiendo PIN y su permiso. `null` = ventana cerrada. */
  protected readonly eligiendoPin = signal<{
    token: string;
    nombre: string;
    registrado: { tipo: 'entrada' | 'salida'; hora: string };
  } | null>(null);
  protected readonly pinNuevo = signal('');
  protected readonly pinNuevoRepetido = signal('');
  protected readonly pasoPinNuevo = signal<'primero' | 'segundo' | 'guardando' | 'terminado'>('primero');
  protected readonly errorPinNuevo = signal<string | null>(null);
  /** El mensaje final (bien o mal) antes de cerrarse sola. */
  protected readonly finalPinNuevo = signal<{ ok: boolean; texto: string } | null>(null);
  private temporizadorPinNuevo: ReturnType<typeof setTimeout> | null = null;

  protected readonly puntosPinNuevo = computed(() => {
    const largo = this.configuracion()?.largoPinMaximo ?? 4;
    const escrito = this.pasoPinNuevo() === 'segundo' ? this.pinNuevoRepetido() : this.pinNuevo();
    return Array.from({ length: largo }, (_, i) => i < escrito.length);
  });

  private abrirPinNuevo(
    token: string,
    nombre: string,
    registrado: { tipo: 'entrada' | 'salida'; hora: string },
  ): void {
    this.eligiendoPin.set({ token, nombre, registrado });
    this.pinNuevo.set('');
    this.pinNuevoRepetido.set('');
    this.pasoPinNuevo.set('primero');
    this.errorPinNuevo.set(null);
    this.finalPinNuevo.set(null);
    this.vigilarPinNuevo();
  }

  /** Si nadie teclea, se cierra como "Ahora no": nadie deja la ventana abierta al siguiente. */
  private vigilarPinNuevo(segundos = this.configuracion()?.segundosSinTeclearAlElegirPin ?? 30): void {
    if (this.temporizadorPinNuevo !== null) clearTimeout(this.temporizadorPinNuevo);
    this.temporizadorPinNuevo = setTimeout(() => this.cerrarPinNuevo(), segundos * 1000);
  }

  /** "Ahora no" (o se acabo el tiempo). Se le vuelve a preguntar la proxima vez. */
  protected cerrarPinNuevo(): void {
    if (this.temporizadorPinNuevo !== null) clearTimeout(this.temporizadorPinNuevo);
    this.temporizadorPinNuevo = null;
    this.eligiendoPin.set(null);
    this.pinNuevo.set('');
    this.pinNuevoRepetido.set('');
    this.errorPinNuevo.set(null);
    this.finalPinNuevo.set(null);
  }

  protected agregarDigitoPinNuevo(digito: string): void {
    const paso = this.pasoPinNuevo();
    if (paso === 'guardando' || paso === 'terminado') return;
    this.errorPinNuevo.set(null);
    this.vigilarPinNuevo();

    const largo = this.configuracion()?.largoPinMaximo ?? 4;
    if (paso === 'primero') {
      if (this.pinNuevo().length >= largo) return;
      this.pinNuevo.update((p) => p + digito);
      if (this.pinNuevo().length === largo) this.pasoPinNuevo.set('segundo');
      return;
    }
    if (this.pinNuevoRepetido().length >= largo) return;
    this.pinNuevoRepetido.update((p) => p + digito);
    if (this.pinNuevoRepetido().length === largo) void this.guardarPinNuevo();
  }

  protected borrarDigitoPinNuevo(): void {
    this.errorPinNuevo.set(null);
    if (this.pasoPinNuevo() === 'segundo') {
      if (this.pinNuevoRepetido() === '') {
        // Borrar con la segunda vacia regresa a corregir la primera.
        this.pasoPinNuevo.set('primero');
        this.pinNuevo.update((p) => p.slice(0, -1));
      } else {
        this.pinNuevoRepetido.update((p) => p.slice(0, -1));
      }
    } else if (this.pasoPinNuevo() === 'primero') {
      this.pinNuevo.update((p) => p.slice(0, -1));
    }
  }

  private empezarPinNuevoOtraVez(mensaje: string): void {
    this.sonidos.reproducir('error');
    this.pinNuevo.set('');
    this.pinNuevoRepetido.set('');
    this.pasoPinNuevo.set('primero');
    this.errorPinNuevo.set(mensaje);
  }

  private async guardarPinNuevo(): Promise<void> {
    const ventana = this.eligiendoPin();
    if (!ventana) return;
    if (this.pinNuevo() !== this.pinNuevoRepetido()) {
      this.empezarPinNuevoOtraVez('No escribiste lo mismo las dos veces. Empieza otra vez.');
      return;
    }

    this.pasoPinNuevo.set('guardando');
    const resultado = await this.puente.elegirPin(ventana.token, this.pinNuevo());
    this.pinNuevo.set('');
    this.pinNuevoRepetido.set('');

    if (!resultado.ok && resultado.volverAEmpezar) {
      this.empezarPinNuevoOtraVez(resultado.mensaje);
      return;
    }

    this.pasoPinNuevo.set('terminado');
    if (resultado.ok) {
      this.sonidos.reproducir('entrada');
      this.finalPinNuevo.set({
        ok: true,
        texto: 'Listo. Desde ahora tu PIN es el que elegiste. El que te dio el jefe ya no sirve.',
      });
    } else {
      this.sonidos.reproducir('error');
      this.finalPinNuevo.set({ ok: false, texto: resultado.mensaje });
    }
    // Se deja leer y se cierra sola.
    this.vigilarPinNuevo(5);
  }

  private teclaEnPinNuevo(evento: KeyboardEvent): void {
    if (evento.key === 'Escape' || (evento.key === 'Enter' && this.pasoPinNuevo() === 'terminado')) {
      evento.preventDefault();
      this.cerrarPinNuevo();
      return;
    }
    if (evento.key === 'Backspace') {
      evento.preventDefault();
      this.borrarDigitoPinNuevo();
      return;
    }
    if (!/^[0-9]$/.test(evento.key)) return;
    evento.preventDefault();
    this.agregarDigitoPinNuevo(evento.key);
  }


  /**
   * Cambia entrada por salida (o al reves) sin registrar todavia.
   *
   * Este boton es la razon de ser de toda la pantalla de confirmacion. Sin
   * el, la accion SUGERIDA seria en realidad una accion impuesta.
   */
  protected cambiarAccion(): void {
    const pendiente = this.pendiente();
    if (!pendiente) return;

    // Si habia duda, la persona ya eligio: se quita el aviso y su espera.
    this.cancelarInactividad();
    this.pendiente.set({
      ...pendiente,
      tipo: pendiente.tipo === 'entrada' ? 'salida' : 'entrada',
      duda: null,
    });

    /**
     * La cuenta VUELVE A EMPEZAR.
     *
     * Acaba de cambiar lo que dice la pantalla, y hay que darle tiempo de
     * leerlo. Si no se reiniciara, quien presiona el boton en el ultimo medio
     * segundo veria confirmarse algo que apenas alcanzo a cambiar — y con la
     * prisa de las 6 de la manana, probablemente ni se enteraria.
     */
    this.arrancarCuentaRegresiva();
  }

  /** El empleado se arrepintio: no se guarda nada. */
  protected cancelarConfirmacion(): void {
    this.reiniciar(); // tira el pase y deja la pantalla limpia

    /**
     * Se avisa que NO quedo nada registrado.
     *
     * Podria parecer innecesario —el empleado presiono cancelar, ya sabe lo
     * que hizo—, pero el problema de fondo de todo este kiosco es la duda:
     * "¿si agarro?, ¿si quedo?". Una pantalla que simplemente vuelve al
     * inicio deja esa duda abierta, y quien duda vuelve a checar.
     */
    this.mostrarAviso('Cancelado: no se registró nada. Si quieres registrar, empieza de nuevo.');
  }

  /**
   * Tira el pase que este esperando, si hay alguno.
   *
   * Lo llama `reiniciar()`, que es por donde pasa cualquier vuelta al inicio
   * (Esc, error, inactividad). Concentrarlo aqui evita tener que acordarse de
   * cancelar el pase en cada uno de esos caminos.
   */
  private descartarPendiente(): void {
    this.detenerCuentaRegresiva();

    const pendiente = this.pendiente();
    if (!pendiente) return;

    this.pendiente.set(null);
    // Sin `await`: la pantalla ya siguio adelante y no tiene nada que esperar.
    void this.puente.cancelarRegistro(pendiente.tokenRegistro);
  }

  /**
   * Las teclas mientras la confirmacion esta en pantalla.
   *
   * Los numeros NO escriben: eligen. Es el mismo lenguaje que ya usa la lista
   * de empleados ("presiona el numero que esta junto a tu nombre"), y es lo
   * que permite manejar toda la confirmacion con el teclado NUMERICO, que es
   * el que de verdad va a estar conectado al kiosco (CLAUDE.md 13.1).
   *
   *     Enter  o  1   registrar ya
   *               2   cambiar entrada por salida
   *     Esc    o  0   cancelar
   *
   * Cualquier otra tecla se ignora a proposito: sin este filtro, un digito
   * tecleado durante la cuenta se colaria como el primer caracter del
   * siguiente empleado.
   */
  private teclaEnConfirmacion(evento: KeyboardEvent): void {
    switch (evento.key) {
      case 'Enter':
      case '1':
        evento.preventDefault();
        void this.confirmarRegistro();
        return;

      case '2':
        evento.preventDefault();
        this.cambiarAccion();
        return;

      case 'Escape':
      case '0':
        evento.preventDefault();
        this.cancelarConfirmacion();
        return;
    }
  }

  // --------------------------------------------------------------------------
  //  Pantalla de exito
  // --------------------------------------------------------------------------

  /** Lo que se muestra tras un registro correcto. `null` = no mostrar nada. */
  protected readonly exito = signal<{
    nombre: string;
    tipo: 'entrada' | 'salida';
    hora: string;
    banderas: string[];
  } | null>(null);

  private temporizadorExito: ReturnType<typeof setTimeout> | null = null;

  /**
   * Quita la confirmacion antes de que se cumplan los segundos.
   *
   * Importante: tambien apaga el temporizador. Si no, quedaria corriendo y
   * dispararia despues sobre una pantalla que ya cambio — y en un kiosco que
   * vive prendido meses, esos temporizadores olvidados se acumulan.
   */
  protected descartarExito(): void {
    if (this.temporizadorExito !== null) {
      clearTimeout(this.temporizadorExito);
      this.temporizadorExito = null;
    }
    this.exito.set(null);
  }

  private mostrarExito(datos: {
    nombre: string;
    tipo: 'entrada' | 'salida';
    hora: string;
    banderas: string[];
  }): void {
    /**
     * El sonido, lo primero.
     *
     * Antes que pintar nada: el oido llega antes que la vista cuando el
     * empleado ya se esta dando la vuelta. Sube si fue entrada, baja si fue
     * salida (ver servicios/sonidos.ts).
     */
    this.sonidos.reproducir(datos.tipo);

    this.exito.set(datos);
    this.identificador.set('');
    this.pin.set('');
    this.empleadoElegido.set(null);
    this.paso.set('identificador');
    this.error.set(null);

    // El mensaje se quita solo. Los segundos salen de la configuracion
    // central, no escritos aqui.
    const segundos = this.configuracion()?.segundosMensajeExito ?? 2;

    if (this.temporizadorExito !== null) clearTimeout(this.temporizadorExito);
    this.temporizadorExito = setTimeout(() => this.exito.set(null), segundos * 1000);

    // Volver a pedir la lista: el estado de quien acaba de checar cambio, y
    // queremos que su etiqueta ("Adentro desde 06:02") ya aparezca cuando la
    // tarjeta se quite.
    if (this.modo() === 'lista') {
      void this.puente.obtenerEmpleadosParaLista().then((lista) => this.empleados.set(lista));
    }
  }

  /** Texto legible de cada bandera, para el aviso de revision. */
  protected textoDeBandera(bandera: string): string {
    switch (bandera) {
      case 'sin_camara':
        return 'la cámara no funcionaba y no hay foto';
      case 'foto_obstruida':
        return 'la cámara parecía tapada';
      case 'foto_no_guardada':
        return 'no se pudo guardar la foto';
      case 'reloj_sospechoso':
        return 'la hora de esta computadora parecía mal';
      default:
        return bandera;
    }
  }

  // --------------------------------------------------------------------------
  //  PAUSA: prestar la computadora un rato
  // --------------------------------------------------------------------------
  //
  //  El kiosco instalado va en pantalla completa y no se deja cerrar. Si la PC
  //  resulta ser compartida —un maestro que necesita buscar algo, soporte
  //  revisando otra cosa— eso es un estorbo serio.
  //
  //  Fijate en que esto MINIMIZA, no cierra. Son necesidades distintas: quien
  //  necesita la computadora diez minutos no quiere cerrar el checador, quiere
  //  que se quite de en medio y vuelva solo.
  //
  //  Toda la logica de verdad (validar el codigo, minimizar, el temporizador
  //  de regreso, el evento para la bitacora) vive en el proceso principal, en
  //  `servicios/pausa.ts`. Aqui solo se recogen los digitos.

  /** ¿Se esta pidiendo el codigo ahora mismo? */
  protected readonly pidiendoCodigoDePausa = signal(false);

  /** Los digitos que lleva tecleados. */
  protected readonly codigoDePausa = signal('');

  protected readonly errorDePausa = signal<string | null>(null);

  /**
   * Que esta pasando con la pausa, para que se vea EN LA PANTALLA.
   *
   * ¿Por que hace falta? Porque "no funciona" puede significar dos cosas muy
   * distintas y desde fuera se ven igual:
   *
   *   - el codigo no se acepto  ->  el problema esta en el codigo o en el envio
   *   - el codigo se acepto y la ventana no se minimizo  ->  el problema es
   *     Windows
   *
   * Sin distinguirlas, arreglar esto es adivinar. El kiosco va a vivir en un
   * pasillo sin nadie que sepa leer un log, asi que cuando algo se pueda
   * diagnosticar desde la propia pantalla, se hace desde la propia pantalla.
   */
  protected readonly estadoDePausa = signal<string | null>(null);

  /** ¿Se muestra el boton? Si la PC es dedicada, el jefe lo apaga y desaparece. */
  /**
   * PC compartida (ajuste del jefe, 29-09-2026): en vez de "Usar esta PC"
   * por 15 minutos, "Cerrar kiosco". En una PC dedicada, como antes.
   */
  protected readonly pcCompartida = computed(() => this.estado()?.pcCompartida === true);
  protected readonly pausaPermitida = computed(
    () => this.configuracion()?.pausaPermitida === true && !this.pcCompartida(),
  );

  /** "Cerrando…": mientras el kiosco manda lo pendiente antes de salir. */
  protected readonly cerrando = signal(false);

  protected minimizarKiosco(): void {
    void this.puente.minimizarKiosco();
  }

  protected cerrarKiosco(): void {
    if (this.cerrando()) return;
    this.cerrando.set(true);
    void this.puente.cerrarKiosco();
  }

  /**
   * Los puntos del codigo, igual que los del PIN: cuantos llevas, nunca cuales.
   *
   * El largo viene de la configuracion, no escrito aqui. La pantalla sabe
   * CUANTOS digitos tiene el codigo; cual es, no — eso solo lo sabe el proceso
   * principal.
   */
  protected readonly puntosDelCodigo = computed(() => {
    const largo = this.configuracion()?.largoCodigoDePausa ?? 0;
    const escritos = this.codigoDePausa().length;
    return Array.from({ length: largo }, (_, i) => i < escritos);
  });

  protected abrirPausa(): void {
    // Si habia algo a medias, se limpia: nadie deja su PIN escrito mientras
    // otra persona pide prestada la computadora.
    this.reiniciar();

    this.codigoDePausa.set('');
    this.errorDePausa.set(null);
    this.pidiendoCodigoDePausa.set(true);
  }

  protected cerrarPausa(): void {
    this.pidiendoCodigoDePausa.set(false);
    this.codigoDePausa.set('');
    this.errorDePausa.set(null);
    this.estadoDePausa.set(null);
  }

  /**
   * Un digito del codigo de pausa, venga de donde venga.
   *
   * ⚠ ESTA FUNCION ES EL ARREGLO DE UN HUECO REAL.
   *
   * El dialogo de pausa solo escuchaba el TECLADO FISICO. En el kiosco eso
   * basta —hay un teclado numerico conectado, es la entrada principal
   * (CLAUDE.md 13.1)—, pero deja fuera dos casos que si ocurren:
   *
   *   - alguien probando la app en una laptop, con el raton;
   *   - el dia que el teclado del kiosco se descomponga, que es justo el dia
   *     en que hay que poder entrar a mantenimiento.
   *
   * El segundo es el grave: un mantenimiento que depende de que funcione el
   * teclado no sirve cuando lo que fallo es el teclado.
   *
   * Por eso la logica de "meter un digito" vive aqui, separada del evento de
   * teclado, y la usan los dos caminos.
   */
  protected agregarDigitoDePausa(digito: string): void {
    this.errorDePausa.set(null);

    const largo = this.configuracion()?.largoCodigoDePausa ?? 0;
    if (largo === 0) {
      // Si esto pasara, el dialogo no dibujaria ni un punto y teclear no haria
      // nada — sin ningun error que lo explicara. Mejor decirlo.
      this.errorDePausa.set('Esta opción todavía no está lista. Avisa a quien le da soporte al sistema.');
      return;
    }

    if (this.codigoDePausa().length >= largo) return;

    this.codigoDePausa.update((actual) => actual + digito);

    // Al completar el largo se intenta solo, sin pedir Enter. Es la misma
    // decision que el PIN: con largo fijo, esperar un Enter es un paso de mas.
    if (this.codigoDePausa().length === largo) void this.intentarPausar();
  }

  protected borrarDigitoDePausa(): void {
    this.errorDePausa.set(null);
    this.codigoDePausa.update((actual) => actual.slice(0, -1));
  }

  private teclaEnPausa(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      this.cerrarPausa();
      return;
    }

    if (evento.key === 'Backspace') {
      evento.preventDefault();
      this.borrarDigitoDePausa();
      return;
    }

    if (!/^[0-9]$/.test(evento.key)) return;

    evento.preventDefault();
    this.agregarDigitoDePausa(evento.key);
  }

  private async intentarPausar(): Promise<void> {
    this.estadoDePausa.set('Revisando…');

    const resultado = await this.puente.pausarKiosco(this.codigoDePausa());

    if (!resultado.ok) {
      this.sonidos.reproducir('error');
      this.estadoDePausa.set(null);
      this.errorDePausa.set(resultado.mensaje);
      this.codigoDePausa.set('');
      return;
    }

    /*
      El codigo era correcto. Se dice EN PANTALLA antes de cerrar el dialogo.

      Antes se cerraba de inmediato, y eso escondia la unica informacion util
      cuando algo sale mal: si la ventana no se minimiza, el empleado ve el
      dialogo desaparecer y el kiosco seguir ahi — exactamente lo mismo que
      veria si el codigo hubiera estado mal.

      Con este mensaje, "no funciona" deja de ser ambiguo.
    */
    this.estadoDePausa.set('Código correcto. El checador se esconde…');

    // Se deja ver un momento. Si la ventana se minimiza —que es lo normal—
    // nadie alcanza a leerlo, y no estorba. Si NO se minimiza, es justo lo que
    // hacia falta saber.
    setTimeout(() => this.cerrarPausa(), 2500);
  }

  // --------------------------------------------------------------------------
  //  PANTALLA DE REGISTROS
  // --------------------------------------------------------------------------
  //
  //  Es la PRIMERA VERSION de la pantalla de auditoria del modo administrador
  //  (CLAUDE.md 5.2, bloque 3.b). Hoy muestra la tabla de lo que se guardo;
  //  manana quedara detras de usuario y contrasena, y cada renglon llevara su
  //  foto al lado.
  //
  //  Se deja ya porque responde la pregunta que cualquiera hace al ver un
  //  checador: "muy bien, ¿y donde queda eso?". Enseñar la pantalla de exito
  //  demuestra que la app responde; enseñar la tabla demuestra que GUARDA.

  // --------------------------------------------------------------------------
  //  Modo administrador (CLAUDE.md 5.2): el boton del engrane
  // --------------------------------------------------------------------------
  protected readonly modoAdminAbierto = signal(false);
  /** "Intento fallido. Quedo registrado..." o "la sesion se cerro". */
  protected readonly avisoAdmin = signal<string | null>(null);
  private temporizadorAvisoAdmin: ReturnType<typeof setTimeout> | null = null;

  protected abrirModoAdmin(): void {
    this.reiniciar();
    this.avisoAdmin.set(null);
    this.modoAdminAbierto.set(true);
  }

  protected alCerrarModoAdmin(mensaje: string | null): void {
    this.modoAdminAbierto.set(false);
    if (this.temporizadorAvisoAdmin) clearTimeout(this.temporizadorAvisoAdmin);
    this.avisoAdmin.set(mensaje);
    if (mensaje) {
      this.temporizadorAvisoAdmin = setTimeout(
        () => this.avisoAdmin.set(null),
        (this.configuracion()?.segundosAvisoModoAdmin ?? 0) * 1000,
      );
    }
  }

  protected readonly registros = signal<MarcaParaMostrar[] | null>(null);
  protected readonly cargandoRegistros = signal(false);

  protected readonly mostrarBotonRegistros = computed(
    () => this.configuracion()?.mostrarRegistros === true,
  );

  protected async abrirRegistros(): Promise<void> {
    this.reiniciar();
    this.cargandoRegistros.set(true);

    // Se pone la lista vacia ANTES de pedir, no despues: asi la pantalla se
    // abre de inmediato con su "Cargando..." en vez de quedarse en la
    // principal hasta que la consulta responda.
    this.registros.set([]);

    const lista = await this.puente.obtenerRegistros();

    this.registros.set(lista);
    this.cargandoRegistros.set(false);
  }

  protected cerrarRegistros(): void {
    this.registros.set(null);
  }

  /**
   * La hora y la fecha de un registro, en la zona configurada.
   *
   * `Intl.DateTimeFormat` con la zona explicita, NUNCA `toLocaleString()` a
   * secas: sin la zona, el navegador usa la de Windows, y toda la pantalla
   * mentiria en una PC con la zona mal puesta. Justo lo que el CLAUDE.md 6
   * prohibe.
   */
  protected fechaHoraDe(ms: number): string {
    const zona = this.configuracion()?.zonaHoraria ?? 'America/Matamoros';

    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: zona,
    }).format(new Date(ms));
  }

  // --------------------------------------------------------------------------
  //  Avisos neutros
  // --------------------------------------------------------------------------

  /**
   * Un mensaje corto que NO es un error.
   *
   * Existe uno solo por ahora ("Cancelado"), y aun asi vale la pena separarlo
   * de `error`: el mensaje de error es rojo y se sacude, porque quiere decir
   * "algo salio mal". Cancelar no es que algo salga mal, es una decision del
   * empleado. Meterlo por el mismo canal lo pintaria de rojo y le diria a
   * alguien que hizo bien su trabajo que se equivoco.
   */
  protected readonly aviso = signal<string | null>(null);

  private temporizadorAviso: ReturnType<typeof setTimeout> | null = null;

  private mostrarAviso(texto: string): void {
    this.aviso.set(texto);

    if (this.temporizadorAviso !== null) clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = setTimeout(() => this.aviso.set(null), SEGUNDOS_DE_AVISO * 1000);
  }

  // --------------------------------------------------------------------------
  //  Inactividad
  // --------------------------------------------------------------------------

  /**
   * Si alguien empieza a teclear y se va, la pantalla se limpia sola.
   *
   * Importa por privacidad y por confusion: dejar el usuario de otra persona
   * en pantalla invita a que el siguiente teclee un PIN sobre el nombre ajeno.
   */
  private reiniciarInactividad(): void {
    this.cancelarInactividad();
    const segundos = this.configuracion()?.segundosInactividadParaLimpiar ?? 20;
    this.temporizadorInactividad = setTimeout(() => this.reiniciar(), segundos * 1000);
  }

  private cancelarInactividad(): void {
    if (this.temporizadorInactividad !== null) {
      clearTimeout(this.temporizadorInactividad);
      this.temporizadorInactividad = null;
    }
  }

  /** Atajo tipado para el HTML. */
  protected config(): ConfiguracionParaInterfaz | null {
    return this.configuracion();
  }
}
