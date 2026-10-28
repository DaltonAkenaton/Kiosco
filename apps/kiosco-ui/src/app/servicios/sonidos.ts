/**
 * ============================================================================
 *  SERVICIO DE SONIDOS
 * ============================================================================
 *
 *  ARQUITECTURA.md 13.1: "Retroalimentacion con sonidos distintos para entrada,
 *  salida y error."
 *
 *  ¿POR QUE UN KIOSCO NECESITA SONIDO?
 *  -----------------------------------
 *  Porque la gente no se queda mirando la pantalla. Cuando la confirmacion
 *  aparece, el empleado ya esta guardando las llaves, quitandose los guantes
 *  o dandose la vuelta. El oido no necesita estar mirando.
 *
 *  Y hay un segundo motivo, mas serio: es un canal que NO depende de la
 *  vista. Quien no distingue bien el verde del ambar, o quien simplemente
 *  dejo los lentes en casa a las 6 de la manana, sigue sabiendo que paso.
 *
 *  LOS TRES SONIDOS SON DISTINTOS ENTRE SI, NO SOLO "BONITOS"
 *  ---------------------------------------------------------
 *      entrada -> dos notas que SUBEN      (re, la)
 *      salida  -> dos notas que BAJAN      (la, re)
 *      error   -> una nota grave y aspera, repetida
 *
 *  La DIRECCION es la informacion. Subir = llegaste, bajar = te vas: es una
 *  metafora que no hay que ensenarle a nadie. Si los dos sonidos fueran
 *  "pitidos agradables" distintos, habria que memorizar cual es cual, y eso
 *  no lo hace nadie.
 *
 *  ---------------------------------------------------------------------------
 *  ¿POR QUE NO ARCHIVOS .MP3?
 *  ---------------------------------------------------------------------------
 *  Porque el navegador ya trae un sintetizador adentro (la Web Audio API), y
 *  para tres pitidos usarlo sale ganando en todo:
 *
 *    - No hay archivos que empaquetar, que se pierdan al instalar, ni que
 *      alguien tenga que volver a generar si cambia el diseno.
 *    - No hay que relajar la Content-Security-Policy para cargar audio. Un
 *      oscilador no es un recurso que se descargue: se calcula.
 *    - No hay retraso la primera vez (un archivo hay que descargarlo y
 *      decodificarlo; el oscilador suena en el mismo milisegundo).
 *    - Cambiar el sonido es cambiar un numero aqui, no abrir un editor de
 *      audio.
 *
 *  ---------------------------------------------------------------------------
 *  LA REGLA DE ORO TAMBIEN APLICA AQUI
 *  ---------------------------------------------------------------------------
 *  NINGUNA funcion de este archivo lanza excepciones ni bloquea nada. Si la
 *  PC no tiene bocinas, si el sonido esta silenciado, si Windows tiene el
 *  audio roto: el kiosco registra igual y nadie se entera. Un checador que
 *  falla porque no pudo hacer "bip" seria absurdo.
 */

import { Injectable, inject } from '@angular/core';
import { PuenteKiosco } from './puente-kiosco';

/** Los tres avisos que el kiosco sabe dar. */
export type TipoDeSonido = 'entrada' | 'salida' | 'error';

/**
 * Una nota: que frecuencia, cuando empieza (contando desde "ya") y cuanto
 * dura. Todo en segundos, que es como mide el tiempo la Web Audio API.
 */
interface Nota {
  frecuenciaHz: number;
  desdeS: number;
  duracionS: number;
}

/**
 * Las notas de cada aviso.
 *
 * Las frecuencias son notas musicales de verdad, no numeros al azar: D5 y A5
 * estan a una quinta de distancia, que es el intervalo que el oido reconoce
 * como "abierto" y agradable. Dos frecuencias cualesquiera suenan a alarma de
 * microondas.
 *
 * El error usa una nota MUCHO mas grave y la repite. Grave + repetido es como
 * suena "algo esta mal" en casi cualquier aparato, y ademas no se puede
 * confundir con los otros dos ni oyendolo de lejos.
 */
const PARTITURAS: Record<TipoDeSonido, { notas: Nota[]; forma: OscillatorType }> = {
  //  sube:  re  ->  la
  entrada: {
    forma: 'sine',
    notas: [
      { frecuenciaHz: 587.33, desdeS: 0, duracionS: 0.11 }, // D5
      { frecuenciaHz: 880.0, desdeS: 0.1, duracionS: 0.17 }, // A5
    ],
  },

  //  baja:  la  ->  re
  salida: {
    forma: 'sine',
    notas: [
      { frecuenciaHz: 880.0, desdeS: 0, duracionS: 0.11 }, // A5
      { frecuenciaHz: 587.33, desdeS: 0.1, duracionS: 0.17 }, // D5
    ],
  },

  //  grave y repetido
  error: {
    // 'square' (onda cuadrada) suena aspera y electronica, a diferencia de la
    // 'sine', que es suave y redonda. Es justo lo que se quiere aqui: el
    // error no debe sonar agradable.
    forma: 'square',
    notas: [
      { frecuenciaHz: 174.61, desdeS: 0, duracionS: 0.13 }, // F3
      { frecuenciaHz: 174.61, desdeS: 0.18, duracionS: 0.2 },
    ],
  },
};

/**
 * Cuanto tarda cada nota en levantarse, en segundos.
 *
 * NO ES DECORACION. Si una nota empieza y termina de golpe, el altavoz da un
 * salto brusco y se oye un CLIC seco antes y despues del pitido. Subir el
 * volumen en 8 ms y bajarlo poco a poco elimina ese clic por completo. Es la
 * diferencia entre "suena bien" y "suena a aparato barato".
 */
const SUBIDA_S = 0.008;

/**
 * El volumen nunca llega a cero exacto.
 *
 * `exponentialRampToValueAtTime` no acepta el cero (matematicamente una curva
 * exponencial nunca lo alcanza), asi que se usa un valor practicamente
 * inaudible. Es una peculiaridad de la Web Audio API, no una decision.
 */
const CASI_CERO = 0.0001;

@Injectable({ providedIn: 'root' })
export class Sonidos {
  private readonly puente = inject(PuenteKiosco);

  /**
   * El sintetizador. Se crea la PRIMERA vez que hace falta, no al arrancar.
   *
   * ¿Por que tarde y no en el constructor? Porque un AudioContext reserva
   * recursos de audio del sistema operativo. En un kiosco que vive prendido
   * meses, no tiene sentido tener el audio tomado desde el arranque si
   * todavia no ha checado nadie.
   */
  private contexto: AudioContext | null = null;

  /** Si el audio resulto imposible en esta PC, se deja de intentar. */
  private inservible = false;

  /**
   * Reproduce el aviso que corresponda.
   *
   * No devuelve nada y no hay que esperarla: el sonido ocurre en paralelo a
   * todo lo demas. Quien la llama sigue su camino de inmediato.
   */
  reproducir(tipo: TipoDeSonido): void {
    const config = this.puente.configuracion();

    // Apagado desde la configuracion central, o el audio ya fallo antes.
    if (config?.sonidosActivos === false || this.inservible) return;

    const volumen = config?.volumenSonidos ?? 0.35;
    if (volumen <= 0) return;

    try {
      const contexto = this.obtenerContexto();
      if (!contexto) return;

      /**
       * Chromium puede dejar el audio "suspendido" hasta que el usuario
       * interactue con la pagina. En el kiosco siempre hay una tecla de por
       * medio antes de cualquier sonido, asi que con pedir que despierte
       * basta.
       *
       * `.catch()` y no `await`: si no despierta, mala suerte, pero el
       * registro NO espera por el audio.
       */
      if (contexto.state === 'suspended') {
        void contexto.resume().catch(() => undefined);
      }

      const { notas, forma } = PARTITURAS[tipo];
      const ahora = contexto.currentTime;

      for (const nota of notas) {
        this.tocarNota(contexto, nota, forma, volumen, ahora);
      }
    } catch (fallo) {
      // Pase lo que pase, el kiosco sigue. Se deja constancia una sola vez.
      console.warn('[sonidos] no se pudo reproducir; se desactiva el audio', fallo);
      this.inservible = true;
    }
  }

  /**
   * Toca UNA nota.
   *
   * La cadena es siempre la misma y se arma nueva cada vez:
   *
   *     oscilador  ->  control de volumen  ->  bocinas
   *
   * ¿Por que crear un oscilador nuevo para cada nota en vez de reutilizarlo?
   * Porque asi los disenaron: un OscillatorNode se arranca y se detiene UNA
   * vez, y despues se descarta; el navegador lo libera solo. Intentar
   * reciclarlos es una fuente clasica de errores silenciosos.
   */
  private tocarNota(
    contexto: AudioContext,
    nota: Nota,
    forma: OscillatorType,
    volumen: number,
    ahora: number,
  ): void {
    const oscilador = contexto.createOscillator();
    const control = contexto.createGain();

    oscilador.type = forma;
    oscilador.frequency.value = nota.frecuenciaHz;

    const inicio = ahora + nota.desdeS;
    const fin = inicio + nota.duracionS;

    // La "envolvente" del volumen: de casi cero al volumen en 8 ms, y de ahi
    // bajando hasta casi cero al terminar la nota. Ver SUBIDA_S y CASI_CERO.
    control.gain.setValueAtTime(CASI_CERO, inicio);
    control.gain.exponentialRampToValueAtTime(volumen, inicio + SUBIDA_S);
    control.gain.exponentialRampToValueAtTime(CASI_CERO, fin);

    oscilador.connect(control);
    control.connect(contexto.destination);

    oscilador.start(inicio);
    oscilador.stop(fin);
  }

  /** Crea el sintetizador la primera vez que se necesita. */
  private obtenerContexto(): AudioContext | null {
    if (this.contexto) return this.contexto;
    if (typeof AudioContext === 'undefined') return null;

    this.contexto = new AudioContext();
    return this.contexto;
  }
}
