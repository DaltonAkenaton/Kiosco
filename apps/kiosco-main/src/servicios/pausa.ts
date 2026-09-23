/**
 * ============================================================================
 *  PAUSA: PRESTAR LA COMPUTADORA UN RATO
 * ============================================================================
 *
 *  EL PROBLEMA
 *  -----------
 *  El kiosco instalado va en pantalla completa y no se deja cerrar. Eso esta
 *  bien si la PC solo sirve para checar. Pero si es una computadora que
 *  alguien mas usa —un maestro que necesita buscar algo, soporte revisando
 *  otra cosa— entonces una aplicacion que no se quita de en medio es un
 *  estorbo serio, y la primera reaccion de cualquiera seria desinstalarla.
 *
 *  Todavia NO esta confirmado como es esa computadora (CLAUDE.md 14), asi que
 *  se asume lo mas flexible y se deja apagable: \`CONFIG.pausa.permitida\`.
 *
 *  ---------------------------------------------------------------------------
 *  PAUSAR NO ES CERRAR
 *  ---------------------------------------------------------------------------
 *  Son dos necesidades distintas, y confundirlas fue el error de la primera
 *  version, que solo ofrecia cerrar:
 *
 *      PAUSAR   el kiosco se minimiza y VUELVE SOLO a los N minutos.
 *               Para quien necesita la PC diez minutos.
 *
 *      CERRAR   Ctrl+Alt+Shift+Q. Para mantenimiento de verdad.
 *               Ver arranque-automatico.ts.
 *
 *  Al maestro no le sirve cerrar el kiosco: le sirve que se quite de en medio
 *  y regrese sin que el tenga que acordarse de nada.
 *
 *  ---------------------------------------------------------------------------
 *  LAS DOS COSAS QUE HACEN QUE ESTO NO ROMPA LA REGLA DE ORO
 *  ---------------------------------------------------------------------------
 *  Con el kiosco pausado NADIE PUEDE CHECAR. Eso choca de frente con la regla
 *  de oro del proyecto, y por eso la pausa tiene dos propiedades que no son
 *  negociables:
 *
 *    1. VUELVE SOLA. Siempre, por temporizador, sin depender de que alguien
 *       se acuerde. Una pausa que dependa de la buena memoria de quien la
 *       pidio es una pausa que algun dia dura hasta el dia siguiente.
 *
 *    2. DEJA CONSTANCIA. Cada pausa y cada regreso se anotan en la bandeja de
 *       salida. Sin eso, una marca que falta entre las 10:15 y las 10:32 es un
 *       hueco inexplicable; con eso, tiene explicacion.
 */

import type { BrowserWindow } from 'electron';
import { CONFIG, type EstadoKiosco } from '@kiosko/compartido';
import { registrarEvento } from '../datos/repositorio-eventos';
import { debeIrEnModoKiosco } from '../ventana';

/** Como termino una pausa. Se guarda en el evento, para poder distinguirlas. */
type MotivoDeRegreso = 'temporizador' | 'manual' | 'cierre';

/**
 * La ventana y el avisador se reciben UNA vez, al arrancar, en vez de
 * importarlos.
 *
 * Es para no crear un ciclo de importaciones: este archivo necesita avisar
 * cambios de estado, y quien los maneja (`ipc/manejadores.ts`) necesita llamar
 * a `pausar()`. Si cada uno importara al otro, tendriamos dos archivos que se
 * necesitan mutuamente — algo que a veces funciona y a veces explota segun el
 * orden en que se carguen, que es la peor clase de error.
 */
let ventanaPrincipal: BrowserWindow | null = null;
let avisarCambioDeEstado: ((cambios: Partial<EstadoKiosco>) => void) | null = null;

let temporizador: ReturnType<typeof setTimeout> | null = null;

/** Cuando termina la pausa en curso, o `null` si no hay ninguna. */
let terminaEnMs: number | null = null;

export function configurarPausa(
  ventana: BrowserWindow,
  avisar: (cambios: Partial<EstadoKiosco>) => void,
): void {
  ventanaPrincipal = ventana;
  avisarCambioDeEstado = avisar;

  /**
   * Si alguien restaura la ventana desde la barra de tareas, la pausa termina
   * AHI, no cuando venza el temporizador.
   *
   * Sin esto habria un estado mentiroso: la pantalla visible y funcionando,
   * pero el sistema creyendo que sigue pausada. El contador seguiria corriendo
   * y al vencer intentaria "reanudar" algo que ya estaba reanudado.
   */
  ventana.on('restore', () => {
    if (terminaEnMs !== null) reanudar('manual');
  });
}

/** ¿Esta pausado ahora mismo? */
export function estaPausado(): boolean {
  return terminaEnMs !== null;
}

/** El estado de la pausa, tal como viaja a la pantalla. */
export function estadoDePausa(): Pick<EstadoKiosco, 'pausado' | 'pausaTerminaEn'> {
  return {
    pausado: terminaEnMs !== null,
    pausaTerminaEn: terminaEnMs === null ? null : new Date(terminaEnMs).toISOString(),
  };
}

/** Lo que responde un intento de pausar. */
export type ResultadoPausa =
  | { ok: true; minutos: number }
  | { ok: false; mensaje: string };

/**
 * Minimiza el kiosco durante unos minutos.
 *
 * El codigo se comprueba AQUI, en el proceso principal, y nunca viaja a la
 * pantalla. La pantalla solo sabe CUANTOS digitos tiene, para dibujar los
 * puntos.
 *
 * ¿Y de que sirve, si el codigo va dentro del .exe y el CLAUDE.md 3.2 dice que
 * todo lo empaquetado es publico? De que no aparezca en el codigo de la
 * interfaz, que es la parte mas facil de inspeccionar. Es minimo privilegio
 * aplicado con honestidad: no vuelve secreto el codigo, pero tampoco lo
 * regala. Y lo que protege es pequeno a proposito — pausar no da acceso a
 * nada, solo evita que alguien presione el boton por curiosidad.
 */
export function pausar(codigo: string): ResultadoPausa {
  if (!CONFIG.pausa.permitida) {
    return { ok: false, mensaje: 'En este kiosco la computadora es sólo para registrar la asistencia.' };
  }

  if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) {
    return { ok: false, mensaje: 'No se pudo esconder el checador. Intenta de nuevo.' };
  }

  if (codigo !== CONFIG.pausa.codigo) {
    // Mismo criterio que el PIN: al usuario no se le dice en que fallo. Al log
    // si, porque es lo que permite distinguir "tecleo mal" de "el sistema esta
    // roto" sin tener que adivinar (ver E-019).
    console.warn(
      `[pausa] codigo rechazado: llegaron ${codigo.length} digitos, ` +
        `se esperaban ${CONFIG.pausa.codigo.length}`,
    );
    return { ok: false, mensaje: 'Código incorrecto. Vuelve a intentarlo.' };
  }

  const minutos = CONFIG.pausa.minutosParaVolver;

  /**
   * Salir del modo kiosco ANTES de minimizar.
   *
   * Con `kiosk: true`, Windows no deja minimizar la ventana: esa es
   * precisamente la razon de ser de ese modo. Si se llamara `minimize()` sin
   * apagarlo antes, no pasaria nada — y el sintoma seria un boton que no hace
   * nada, sin ningun error que lo explique.
   */
  console.info('[pausa] codigo correcto; saliendo de pantalla completa');

  /*
    HAY QUE DESHACER LAS CUATRO COSAS, NO SOLO EL MODO KIOSCO.

    La primera version solo apagaba `kiosk` y `fullScreen`, y no bastaba: la
    ventana salia de pantalla completa y se quedaba ahi, sin minimizarse.

    El motivo es que una ventana creada con `kiosk: true` nace ademas SIN BOTON
    DE MINIMIZAR — a nivel de Windows, no de Electron. Y `minimize()` sobre una
    ventana no minimizable no falla: no hace nada, que es peor.

    `setMinimizable(true)` le devuelve esa capacidad. `setAlwaysOnTop(false)`
    cubre el otro caso en que la ventana se queda encima de todo aunque ya no
    este en pantalla completa.
  */
  ventanaPrincipal.setKiosk(false);
  ventanaPrincipal.setFullScreen(false);
  ventanaPrincipal.setAlwaysOnTop(false);
  ventanaPrincipal.setMinimizable(true);

  /*
    ⚠ MINIMIZAR VA EN UN SEGUNDO TIEMPO, Y NO ES UN CAPRICHO.

    Salir de pantalla completa en Windows no es instantaneo: hay una animacion
    de por medio. Si se llama `minimize()` mientras esa transicion sigue
    corriendo, Windows la IGNORA — sin error, sin aviso, sin nada.

    El sintoma es el peor posible: tecleas el codigo correcto, la ventana se
    sale de pantalla completa... y ahi se queda. Parece que el codigo estuvo
    mal, cuando en realidad estuvo bien.

    Con un respiro de 200 ms la transicion termina y la orden llega. Y se
    comprueba el resultado, para que quede constancia si aun asi fallara: un
    boton que no hace nada y no deja rastro es imposible de diagnosticar a
    distancia, que es como se va a dar soporte a esta computadora.
  */
  const ventana = ventanaPrincipal;
  setTimeout(() => {
    if (ventana.isDestroyed()) return;

    ventana.minimize();

    if (ventana.isMinimized()) {
      console.info('[pausa] ventana minimizada');
      return;
    }

    /*
      PLAN B: SI NO SE DEJA MINIMIZAR, SE ESCONDE.

      Llegar aqui significa que Windows ignoro la orden pese a todo lo anterior.
      Podriamos rendirnos y dejar la ventana en pantalla, pero entonces el boton
      "Usar esta PC" no cumpliria lo unico que promete, y quien lo presiono se
      quedaria mirando el kiosco sin entender por que.

      `hide()` la quita de la pantalla Y de la barra de tareas. Es mas brusco
      que minimizar —ya no se puede traer de vuelta con un clic— y por eso es el
      plan B y no el A. La red de seguridad sigue puesta: el temporizador la
      devuelve sola a los 15 minutos, pase lo que pase.
    */
    console.warn('[pausa] Windows ignoro minimize(); se oculta la ventana');
    ventana.hide();
  }, 250);

  terminaEnMs = Date.now() + minutos * 60 * 1000;

  temporizador = setTimeout(() => reanudar('temporizador'), minutos * 60 * 1000);

  registrarEvento('kiosco_pausado', { minutos });
  avisarCambioDeEstado?.(estadoDePausa());

  console.info(`[pausa] kiosco minimizado por ${minutos} minutos`);

  return { ok: true, minutos };
}

/**
 * Devuelve el kiosco a la pantalla.
 *
 * Llega aqui por tres caminos: venció el temporizador, alguien restauro la
 * ventana a mano, o la aplicacion se esta cerrando.
 */
export function reanudar(motivo: MotivoDeRegreso): void {
  if (terminaEnMs === null) return; // no habia pausa: no hay nada que deshacer

  const inicioMs = terminaEnMs - CONFIG.pausa.minutosParaVolver * 60 * 1000;
  const duracionRealSegundos = Math.max(0, Math.round((Date.now() - inicioMs) / 1000));

  terminaEnMs = null;

  if (temporizador !== null) {
    clearTimeout(temporizador);
    temporizador = null;
  }

  // Al cerrar no se restaura nada: la ventana se esta yendo.
  if (motivo !== 'cierre' && ventanaPrincipal && !ventanaPrincipal.isDestroyed()) {
    // Si se uso el plan B (`hide()`), la ventana ni siquiera existe en
    // pantalla: hay que mostrarla antes de restaurarla.
    if (!ventanaPrincipal.isVisible()) ventanaPrincipal.show();

    ventanaPrincipal.restore();

    // Devolverla al estado en que estaba. La regla vive en `ventana.ts`, en un
    // solo lugar, para que no se pueda desincronizar con la de la creacion.
    if (debeIrEnModoKiosco()) {
      ventanaPrincipal.setFullScreen(true);
      ventanaPrincipal.setKiosk(true);
    }

    ventanaPrincipal.focus();
  }

  // La DURACION REAL es el dato util para el panel, no los minutos que se
  // pidieron: si alguien restauro a los dos minutos, la asistencia solo
  // estuvo interrumpida dos minutos.
  registrarEvento('kiosco_reanudado', { motivo, duracionRealSegundos });
  avisarCambioDeEstado?.(estadoDePausa());

  console.info(`[pausa] kiosco reanudado (${motivo}, ${duracionRealSegundos} s)`);
}
