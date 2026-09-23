/**
 * ============================================================================
 *  SERVICIO DE CAMARA
 * ============================================================================
 *
 *  Se encarga de tres cosas:
 *
 *    1. Encender la camara y mantener el video en vivo.
 *    2. Vigilar que siga viva, y avisar al proceso principal cuando cambia.
 *    3. Capturar la foto del momento del registro, redimensionada y medida.
 *
 *  LA REGLA QUE MANDA AQUI (CLAUDE.md seccion 5):
 *
 *      La camara NUNCA bloquea el registro.
 *
 *  Si no hay camara, si el usuario niega el permiso, si alguien desconecta el
 *  cable: el empleado registra igual. Lo unico que pasa es que la marca sale
 *  con la bandera `sin_camara` para que el jefe lo revise.
 *
 *  Por eso NINGUNA funcion de este archivo lanza excepciones hacia afuera.
 *  Todas devuelven algo utilizable, aunque sea `null`.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { PuenteKiosco } from './puente-kiosco';

/** Lo que devuelve una captura. */
export interface FotoCapturada {
  /** La imagen en formato data URL: "data:image/jpeg;base64,...". */
  jpegBase64: string;
  /** Mediciones para detectar lente tapado. */
  mediciones: { brilloPromedio: number; varianza: number };
}

/** Por que no hay camara, en lenguaje entendible. */
export type MotivoSinCamara =
  | 'permiso_denegado'
  | 'no_encontrada'
  | 'en_uso_por_otra_app'
  | 'no_soportada'
  | 'desconectada'
  | 'error_desconocido';

@Injectable({ providedIn: 'root' })
export class Camara {
  private readonly puente = inject(PuenteKiosco);

  /** El flujo de video en vivo. `null` si la camara no esta disponible. */
  private readonly _flujo = signal<MediaStream | null>(null);
  readonly flujo = this._flujo.asReadonly();

  /** ¿Hay camara funcionando ahora mismo? */
  readonly disponible = computed(() => this._flujo() !== null);

  /** Si no hay camara, por que. Sirve para el mensaje en pantalla y el log. */
  private readonly _motivo = signal<MotivoSinCamara | null>(null);
  readonly motivo = this._motivo.asReadonly();

  /** Mensaje ya redactado para mostrar al empleado. */
  readonly mensajeDeFalla = computed(() => {
    switch (this._motivo()) {
      case 'permiso_denegado':
        return 'Windows no le da permiso a este programa de usar la cámara.';
      case 'no_encontrada':
        return 'No hay ninguna cámara conectada.';
      case 'en_uso_por_otra_app':
        return 'Otro programa está usando la cámara.';
      case 'no_soportada':
        return 'Esta computadora no puede usar la cámara.';
      case 'desconectada':
        return 'Se desconectó la cámara.';
      case 'error_desconocido':
        return 'La cámara no responde.';
      default:
        return null;
    }
  });

  /** Ancho y calidad de la foto, que llegan de la configuracion central. */
  private anchoFotoPx = 480;
  private calidadJpeg = 0.7;

  /** El temporizador que vigila la camara. */
  private vigilante: ReturnType<typeof setInterval> | null = null;

  /**
   * Lienzo reutilizable para capturar. Se crea UNA vez y se reutiliza.
   *
   * ¿Por que no crear uno nuevo en cada foto? Porque el kiosco vive prendido
   * meses. Crear y tirar un lienzo cientos de veces al dia deja basura que el
   * navegador tiene que ir limpiando; reutilizarlo no cuesta nada.
   */
  private lienzo: HTMLCanvasElement | null = null;

  /**
   * Enciende la camara.
   *
   * Nunca lanza excepcion: si falla, deja el motivo en `motivo` y sigue.
   */
  async iniciar(anchoFotoPx: number, calidadJpeg: number, intervaloVigilanciaMs: number): Promise<void> {
    this.anchoFotoPx = anchoFotoPx;
    this.calidadJpeg = calidadJpeg;

    await this.encender();

    // Vigilancia periodica (CLAUDE.md 5: "verificacion periodica del estado").
    // Cubre el caso de que alguien desconecte el cable a media manana.
    this.vigilante = setInterval(() => void this.revisar(), intervaloVigilanciaMs);
  }

  /**
   * Ultima medicion de brillo y varianza, para el medidor de desarrollo.
   *
   * ¿Por que existe? Porque calibrar los umbrales de "camara tapada" a ojo
   * es adivinar. Con el medidor en pantalla puedes tapar el lente con el
   * dedo, LEER los numeros reales de tu camara, y ajustar los umbrales con
   * datos en vez de con corazonadas.
   *
   * Cada camara da numeros distintos: la de una laptop no se parece a una
   * webcam externa en un pasillo oscuro. Por eso los umbrales son
   * configurables y por eso hace falta poder medirlos en cada instalacion.
   */
  private readonly _ultimaMedicion = signal<{ brilloPromedio: number; varianza: number } | null>(
    null,
  );
  readonly ultimaMedicion = this._ultimaMedicion.asReadonly();

  /**
   * Mide el cuadro actual sin guardar ninguna foto.
   *
   * Se usa solo para el medidor de desarrollo. En produccion no se llama:
   * medir cada segundo gasta procesador para nada.
   */
  medirAhora(video: HTMLVideoElement): void {
    const foto = this.capturar(video, { soloMedir: true });
    this._ultimaMedicion.set(foto?.mediciones ?? null);
  }

  /** Apaga todo. Se llama al destruir el componente. */
  detener(): void {
    if (this.vigilante !== null) {
      clearInterval(this.vigilante);
      this.vigilante = null;
    }
    this.apagarFlujo();
  }

  // --------------------------------------------------------------------------
  //  Encendido
  // --------------------------------------------------------------------------

  private async encender(): Promise<void> {
    // `navigator.mediaDevices` no existe en contextos no seguros. En Electron
    // siempre existe, pero comprobarlo evita un error feo si algun dia esta
    // pantalla se abre en otro lado.
    if (!navigator.mediaDevices?.getUserMedia) {
      this.registrarFalla('no_soportada');
      return;
    }

    try {
      const flujo = await navigator.mediaDevices.getUserMedia({
        // Pedimos una resolucion comoda para el video en pantalla.
        // La foto se reduce despues a `anchoFotoPx`, asi que no hace falta
        // pedir 4K: solo gastaria procesador sin mejorar la evidencia.
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false, // jamas. No grabamos sonido de nadie.
      });

      this._flujo.set(flujo);
      this._motivo.set(null);

      // Si alguien desconecta la camara fisicamente, el navegador dispara
      // 'ended' en la pista. Es mas rapido que esperar a la vigilancia.
      for (const pista of flujo.getVideoTracks()) {
        pista.addEventListener('ended', () => this.registrarFalla('desconectada'));
      }

      await this.puente.reportarEstadoCamara({ disponible: true });
      console.info('[camara] encendida');
    } catch (fallo) {
      this.registrarFalla(this.interpretarError(fallo));
    }
  }

  /**
   * Traduce el error del navegador a algo que un humano pueda leer en el panel.
   *
   * Los nombres vienen del estandar de la API de medios; hay que conocerlos
   * porque el mensaje que traen no sirve para diagnosticar a distancia.
   */
  private interpretarError(fallo: unknown): MotivoSinCamara {
    if (!(fallo instanceof Error)) return 'error_desconocido';

    switch (fallo.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'permiso_denegado';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'no_encontrada';
      case 'NotReadableError': // tipico: Teams o Zoom abiertos
        return 'en_uso_por_otra_app';
      default:
        return 'error_desconocido';
    }
  }

  private registrarFalla(motivo: MotivoSinCamara): void {
    this.apagarFlujo();
    this._motivo.set(motivo);
    void this.puente.reportarEstadoCamara({ disponible: false, detalle: motivo });
    console.warn(`[camara] no disponible: ${motivo}`);
  }

  private apagarFlujo(): void {
    const flujo = this._flujo();
    if (flujo) {
      // Hay que detener cada pista a mano. Si no, la luz de la camara se
      // queda encendida aunque la app ya no la use.
      for (const pista of flujo.getTracks()) pista.stop();
    }
    this._flujo.set(null);
  }

  // --------------------------------------------------------------------------
  //  Vigilancia
  // --------------------------------------------------------------------------

  /**
   * Revisa si la camara sigue viva; si murio, intenta revivirla.
   *
   * Ese reintento automatico importa: si alguien tropieza con el cable USB y
   * lo vuelve a conectar, la camara se recupera sola en unos segundos, sin que
   * nadie tenga que reiniciar el kiosco.
   */
  private async revisar(): Promise<void> {
    const flujo = this._flujo();

    if (flujo) {
      // `readyState === 'live'` es la forma de preguntar "¿sigues transmitiendo?"
      const sigueViva = flujo.getVideoTracks().some((pista) => pista.readyState === 'live');
      if (!sigueViva) this.registrarFalla('desconectada');
      return;
    }

    // No hay camara: intentar de nuevo, por si la reconectaron.
    await this.encender();
  }

  // --------------------------------------------------------------------------
  //  Captura
  // --------------------------------------------------------------------------

  /**
   * Toma la foto del instante del registro.
   *
   * Devuelve `null` si no hay camara. Quien llama debe tratar ese `null` como
   * "registrar igual, con bandera `sin_camara`" — nunca como un error.
   *
   * @param video el elemento <video> que esta mostrando el flujo en pantalla
   */
  capturar(
    video: HTMLVideoElement,
    opciones: { soloMedir?: boolean } = {},
  ): FotoCapturada | null {
    if (!this.disponible()) return null;

    // Si el video todavia no tiene medidas, aun no llego el primer cuadro.
    const anchoOriginal = video.videoWidth;
    const altoOriginal = video.videoHeight;
    if (anchoOriginal === 0 || altoOriginal === 0) return null;

    try {
      // --- Redimensionar manteniendo la proporcion -----------------------
      // `anchoFotoPx` (CAMARA.anchoFotoPx en configuracion.ts) es el lado
      // MAYOR de la foto guardada.
      const escala = this.anchoFotoPx / Math.max(anchoOriginal, altoOriginal);
      const ancho = Math.round(anchoOriginal * escala);
      const alto = Math.round(altoOriginal * escala);

      const lienzo = (this.lienzo ??= document.createElement('canvas'));
      lienzo.width = ancho;
      lienzo.height = alto;

      const contexto = lienzo.getContext('2d', { willReadFrequently: true });
      if (!contexto) return null;

      /**
       * DETALLE IMPORTANTE: aqui NO espejeamos.
       *
       * El video se ve en espejo en pantalla porque asi la gente se acomoda
       * mejor (es como verse en un espejo de verdad). Pero eso es solo un
       * efecto visual de CSS.
       *
       * La foto que se guarda es la EVIDENCIA, y una evidencia espejeada
       * esta alterada: los letreros salen al reves y un lunar del lado
       * izquierdo aparece a la derecha. Se guarda la imagen real.
       */
      contexto.drawImage(video, 0, 0, ancho, alto);

      const mediciones = this.medir(contexto, ancho, alto);

      // Convertir el lienzo a JPEG es lo mas caro de todo esto. Cuando solo
      // queremos los numeros para el medidor, nos lo saltamos.
      if (opciones.soloMedir) return { jpegBase64: '', mediciones };

      const jpegBase64 = lienzo.toDataURL('image/jpeg', this.calidadJpeg);

      return { jpegBase64, mediciones };
    } catch (fallo) {
      // Aunque la captura falle, el registro debe continuar.
      console.warn('[camara] fallo la captura:', fallo);
      return null;
    }
  }

  /**
   * Mide brillo y varianza para detectar un lente tapado (CLAUDE.md 5).
   *
   * BRILLO: el promedio de que tan clara es la imagen, de 0 (negro) a 255.
   *         Un lente tapado con un dedo o con cinta da un brillo muy bajo.
   *
   * VARIANZA: cuanta "textura" hay. Mide que tanto se apartan los pixeles del
   *         promedio. Una pared lisa o un lente tapado tienen casi cero; una
   *         cara, con sus sombras y rasgos, tiene mucha.
   *
   * ¿Por que hacen falta las dos? Porque cada una sola se engana facil:
   *   - solo brillo    -> una hoja de papel blanco pasaria (es muy clara)
   *   - solo varianza  -> un cuarto a oscuras con ruido pasaria
   * Juntas es mucho mas dificil hacer trampa tapando la camara.
   *
   * Quien DECIDE si eso es "obstruido" es el proceso principal, comparando
   * contra los umbrales configurables. Aqui solo medimos: la pantalla no toma
   * decisiones de negocio.
   */
  private medir(
    contexto: CanvasRenderingContext2D,
    ancho: number,
    alto: number,
  ): { brilloPromedio: number; varianza: number } {
    const { data } = contexto.getImageData(0, 0, ancho, alto);

    /**
     * No revisamos los ~230 000 pixeles: tomamos uno de cada 16.
     * El resultado es practicamente igual y tarda una fraccion.
     * En un kiosco que debe responder en menos de 1 segundo, eso importa.
     */
    const SALTO = 16;

    let suma = 0;
    let sumaDeCuadrados = 0;
    let cantidad = 0;

    // Cada pixel ocupa 4 posiciones en el arreglo: rojo, verde, azul y alfa.
    for (let i = 0; i < data.length; i += 4 * SALTO) {
      const rojo = data[i] ?? 0;
      const verde = data[i + 1] ?? 0;
      const azul = data[i + 2] ?? 0;

      /**
       * Luminancia percibida. Los coeficientes no son iguales porque el ojo
       * humano no percibe los tres colores con la misma intensidad: es mucho
       * mas sensible al verde que al azul. Es la formula estandar (Rec. 601).
       */
      const luz = 0.299 * rojo + 0.587 * verde + 0.114 * azul;

      suma += luz;
      sumaDeCuadrados += luz * luz;
      cantidad++;
    }

    if (cantidad === 0) return { brilloPromedio: 0, varianza: 0 };

    const promedio = suma / cantidad;
    // Varianza = promedio de los cuadrados - cuadrado del promedio.
    // Es la misma varianza de estadistica, calculada en una sola pasada.
    const varianza = Math.max(0, sumaDeCuadrados / cantidad - promedio * promedio);

    return {
      brilloPromedio: Math.round(promedio * 100) / 100,
      varianza: Math.round(varianza * 100) / 100,
    };
  }
}
