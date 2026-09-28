/**
 * ============================================================================
 *  SERVICIO: PUENTE HACIA EL PROCESO PRINCIPAL
 * ============================================================================
 *
 *  ¿Que es un "servicio" en Angular?
 *  ---------------------------------
 *  Una clase que guarda datos o hace trabajo, y que los componentes (las
 *  pantallas) pueden pedir. La idea es simple: los componentes PINTAN, los
 *  servicios HACEN.
 *
 *  ¿Por que no llamar `window.kiosco` directo desde cada pantalla?
 *  --------------------------------------------------------------
 *  Por tres razones muy practicas:
 *
 *    1. Si `window.kiosco` no existe (porque abriste la app en un navegador
 *       normal para probar la interfaz), aqui se detecta UNA vez, en lugar de
 *       llenar cada pantalla de comprobaciones.
 *
 *    2. Si manana cambia el nombre de un metodo, se corrige en un solo lugar.
 *
 *    3. Las pantallas quedan faciles de probar: en una prueba automatizada se
 *       puede sustituir este servicio por uno falso.
 *
 *  `@Injectable({providedIn: 'root'})` = "Angular, crea UNA sola copia de esta
 *  clase para toda la aplicacion y damela a quien la pida". A eso se le llama
 *  inyeccion de dependencias.
 */

import { Injectable, signal } from '@angular/core';
import type {
  ApiAdmin,
  ConfiguracionParaInterfaz,
  EmpleadoParaLista,
  EstadoCamaraReportado,
  EstadoKiosco,
  MarcaParaMostrar,
  ResultadoCambioPin,
  ResultadoEnrolamiento,
  ResultadoIdentificacion,
  ResultadoPausa,
  ResultadoRegistro,
  SolicitudIdentificacion,
  SolicitudRegistro,
} from '@kiosko/compartido';

@Injectable({ providedIn: 'root' })
export class PuenteKiosco {
  /**
   * ¿Estamos corriendo dentro de Electron?
   *
   * `typeof window !== 'undefined'` protege el caso en que el codigo corra
   * fuera de un navegador (por ejemplo en una prueba automatizada).
   */
  readonly disponible = typeof window !== 'undefined' && window.kiosco !== undefined;

  /**
   * ¿Que es un "signal"?
   * --------------------
   * Una caja que guarda un valor y AVISA sola a la pantalla cuando cambia.
   * Es la forma moderna de Angular de mantener la interfaz sincronizada:
   * tu cambias el valor con `.set(...)` y el HTML se repinta solo.
   *
   * Antes esto se hacia con librerias complicadas (RxJS, Zone.js). Con
   * signals es una linea.
   */
  private readonly _estado = signal<EstadoKiosco | null>(null);

  /**
   * Version de solo lectura del estado, para que las pantallas lo lean pero
   * no lo puedan modificar. `asReadonly()` quita el metodo `.set()`.
   * Es la misma idea de "minimo privilegio" que aplicamos en Electron.
   */
  readonly estado = this._estado.asReadonly();

  private readonly _configuracion = signal<ConfiguracionParaInterfaz | null>(null);
  readonly configuracion = this._configuracion.asReadonly();

  /** Guarda la funcion para darse de baja del canal de avisos. */
  private cancelarSuscripcion: (() => void) | null = null;

  /**
   * Arranca el puente: pide la configuracion, el estado y se suscribe a los
   * avisos del proceso principal.
   *
   * Se llama una sola vez, al iniciar la aplicacion.
   */
  async iniciar(): Promise<void> {
    if (!window.kiosco) {
      console.warn(
        '[puente] window.kiosco no existe. La interfaz esta corriendo fuera de Electron.',
      );
      return;
    }

    // Las dos peticiones son independientes, asi que las lanzamos a la vez con
    // `Promise.all` en lugar de esperar una y luego la otra. Se nota al arrancar.
    const [configuracion, estado] = await Promise.all([
      window.kiosco.obtenerConfiguracion(),
      window.kiosco.obtenerEstado(),
    ]);

    this._configuracion.set(configuracion);
    this._estado.set(estado);

    // Deja constancia de que el puente respondio. En el kiosco real esta linea
    // es lo primero que vas a buscar cuando algo no funcione: si aparece, el
    // cableado esta bien y el problema esta mas arriba.
    console.info(
      `[puente] Conectado. PIN de ${configuracion.largoPinMinimo}-${configuracion.largoPinMaximo} digitos, ` +
        `zona ${configuracion.zonaHoraria}, version ${estado.version}.`,
    );

    // A partir de aqui, el proceso principal nos avisa solo cuando algo cambie
    // (se cayo la red, subieron marcas, etc.). No hay que preguntar en bucle.
    this.cancelarSuscripcion = window.kiosco.alCambiarEstado((nuevoEstado) => {
      this._estado.set(nuevoEstado);
    });
  }

  /** Corta la suscripcion. Importante para no dejar escuchas colgadas. */
  detener(): void {
    this.cancelarSuscripcion?.();
    this.cancelarSuscripcion = null;
  }

  /** Valida numero de empleado + PIN contra la base local. */
  async identificar(solicitud: SolicitudIdentificacion): Promise<ResultadoIdentificacion> {
    if (!window.kiosco) {
      return {
        ok: false,
        motivo: 'error_interno',
        mensaje: 'El programa no está funcionando bien. Avisa a tu jefe para que registre tu asistencia.',
      };
    }
    return window.kiosco.identificar(solicitud);
  }

  /** Lista de empleados activos. Solo se usa en el modo 'lista'. */
  async obtenerEmpleadosParaLista(): Promise<EmpleadoParaLista[]> {
    // Si no hay puente devolvemos lista vacia, no un error: la pantalla
    // muestra "no hay empleados" y sigue viva.
    return (await window.kiosco?.obtenerEmpleadosParaLista()) ?? [];
  }

  /**
   * Cambia el modo de identificacion (solo en desarrollo).
   *
   * El proceso principal devuelve la configuracion ya actualizada, y la
   * guardamos. Asi la pantalla se entera del cambio por el mismo camino que
   * usa siempre, en vez de adivinar el nuevo valor por su cuenta: si el
   * proceso principal rechaza el cambio (produccion), la pantalla se entera.
   */
  async cambiarModoIdentificacion(modo: 'usuario' | 'lista' | 'numero'): Promise<void> {
    const nueva = await window.kiosco?.cambiarModoIdentificacion(modo);
    if (nueva) this._configuracion.set(nueva);
  }

  /** Guarda la marca de entrada o salida. */
  async registrarMarca(solicitud: SolicitudRegistro): Promise<ResultadoRegistro> {
    if (!window.kiosco) {
      return { ok: false, mensaje: 'El programa no está funcionando bien. Avisa a tu jefe para que registre tu asistencia.' };
    }
    return window.kiosco.registrarMarca(solicitud);
  }

  /**
   * Avisa que el empleado cancelo en la confirmacion.
   *
   * Sin `await` en quien la llama: la pantalla ya volvio a su estado normal y
   * no tiene nada que esperar. Si el mensaje se perdiera, el pase caducaria
   * solo en un minuto.
   */
  /** El empleado eligio su PIN propio (D-042). */
  async elegirPin(tokenCambioPin: string, pinNuevo: string): Promise<ResultadoCambioPin> {
    if (!window.kiosco) {
      return { ok: false, volverAEmpezar: false, mensaje: 'No se pudo cambiar tu PIN. Sigue usando el que te dio el jefe.' };
    }
    return window.kiosco.elegirPin(tokenCambioPin, pinNuevo);
  }

  /** Nunca espera ni falla: la pantalla no depende de la red. */
  prepararRegistro(): void {
    try {
      void window.kiosco?.prepararRegistro?.().catch(() => {});
    } catch {
      // Es solo una ayuda para sugerir mejor; si falla, se sugiere como antes.
    }
  }

  async cancelarRegistro(tokenRegistro: string): Promise<void> {
    await window.kiosco?.cancelarRegistro(tokenRegistro);
  }

  /** Los ultimos registros guardados, para la pantalla de consulta. */
  async obtenerRegistros(): Promise<MarcaParaMostrar[]> {
    // Lista vacia y no un error si no hay puente: la pantalla muestra
    // "todavia no hay registros" y sigue viva.
    return (await window.kiosco?.obtenerRegistros()) ?? [];
  }

  /**
   * Minimiza el kiosco unos minutos para prestar la computadora.
   *
   * El codigo viaja al proceso principal, que es quien lo comprueba. Aqui no
   * se sabe cual es el correcto, ni hace falta.
   */
  async pausarKiosco(codigo: string): Promise<ResultadoPausa> {
    if (!window.kiosco) {
      return { ok: false, mensaje: 'El programa no está funcionando bien. Avisa a tu jefe para que registre tu asistencia.' };
    }
    return window.kiosco.pausarKiosco(codigo);
  }

  /** Da de alta el kiosco con el codigo del panel. */
  async enrolarKiosco(codigo: string): Promise<ResultadoEnrolamiento> {
    if (!window.kiosco) {
      return { ok: false, mensaje: 'El programa no está funcionando bien. Ciérralo y vuelve a abrirlo.' };
    }
    return window.kiosco.enrolarKiosco(codigo);
  }

  /** Avisa al proceso principal si la camara vive o murio. */
  async reportarEstadoCamara(estado: EstadoCamaraReportado): Promise<void> {
    await window.kiosco?.reportarEstadoCamara(estado);
  }

  /**
   * El modo administrador (CLAUDE.md 5.2), o `null` si no hay puente.
   *
   * Se entrega el objeto tal cual en vez de envolver cada metodo: todos piden
   * el token y devuelven `ResultadoAdmin`, asi que envolverlos uno por uno
   * solo repetiria las firmas sin agregar nada.
   */
  get admin(): ApiAdmin | null {
    return window.kiosco?.admin ?? null;
  }
}
