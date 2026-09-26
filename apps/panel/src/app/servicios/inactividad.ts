/**
 * ============================================================================
 *  CERRAR LA SESION POR INACTIVIDAD  (migracion 0018)
 * ============================================================================
 *
 *  Un panel abierto toda la noche en la computadora de una oficina es una
 *  puerta abierta: cualquiera que pase puede dar de baja gente o cambiar
 *  reglas "como el jefe". Tras N minutos sin uso (Configuracion,
 *  `minutos_inactividad_panel`), la sesion se cierra sola.
 *
 *  - "Uso" = mover el raton, teclear, picar, desplazar.
 *  - Un minuto antes aparece un aviso con un boton "Sigo aqui".
 *  - La ultima actividad se guarda en el navegador (localStorage). Asi:
 *      * si hay dos pestañas abiertas, usar una mantiene viva la otra;
 *      * si se cerro el navegador y se abre al dia siguiente, la sesion ya
 *        vencida se cierra al entrar, en vez de seguir abierta.
 */

import { Injectable, NgZone, inject, signal } from '@angular/core';

const CLAVE_ACTIVIDAD = 'panel-ultima-actividad';
const CLAVE_LIMITE = 'panel-minutos-inactividad';
/** Si la configuracion no ha llegado todavia. Mismo valor que la migracion 0018. */
const MINUTOS_POR_DEFECTO = 30;
const AVISO_ANTES_MS = 60_000;
const REVISAR_CADA_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class Inactividad {
  private readonly zona = inject(NgZone);

  /** Segundos que faltan para el cierre, cuando ya hay que avisar; si no, `null`. */
  readonly segundosRestantes = signal<number | null>(null);

  private temporizador: ReturnType<typeof setInterval> | null = null;
  private alVencer: (() => void) | null = null;
  private ultimaEscrituraMs = 0;

  private readonly registrar = (): void => {
    const ahora = Date.now();
    // No escribir en cada movimiento del raton: basta una vez por segundo.
    if (ahora - this.ultimaEscrituraMs < 1000) return;
    this.ultimaEscrituraMs = ahora;
    guardar(CLAVE_ACTIVIDAD, String(ahora));
    if (this.segundosRestantes() !== null) this.zona.run(() => this.segundosRestantes.set(null));
  };

  /** Minutos vigentes (los que bajaron de Configuracion al entrar). */
  static minutosLimite(): number {
    const guardado = Number(leer(CLAVE_LIMITE));
    return Number.isFinite(guardado) && guardado >= 1 ? guardado : MINUTOS_POR_DEFECTO;
  }

  static fijarMinutos(minutos: number): void {
    if (Number.isFinite(minutos) && minutos >= 1) guardar(CLAVE_LIMITE, String(minutos));
  }

  /** ¿La ultima actividad guardada ya esta vencida? (por ejemplo, el navegador se quedo cerrado). */
  static vencida(): boolean {
    const ultima = Number(leer(CLAVE_ACTIVIDAD));
    if (!Number.isFinite(ultima) || ultima <= 0) return false;
    return Date.now() - ultima >= Inactividad.minutosLimite() * 60_000;
  }

  /** Al entrar: la actividad empieza ahora. */
  static marcarActividad(): void {
    guardar(CLAVE_ACTIVIDAD, String(Date.now()));
  }

  iniciar(alVencer: () => void): void {
    this.detener();
    this.alVencer = alVencer;
    Inactividad.marcarActividad();
    // Fuera de Angular: escuchar el raton no debe redibujar la pagina.
    this.zona.runOutsideAngular(() => {
      for (const evento of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
        window.addEventListener(evento, this.registrar, { passive: true, capture: true });
      }
      this.temporizador = setInterval(() => this.revisar(), REVISAR_CADA_MS);
    });
  }

  detener(): void {
    for (const evento of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
      window.removeEventListener(evento, this.registrar, { capture: true });
    }
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    this.segundosRestantes.set(null);
  }

  /** El boton "Sigo aqui" del aviso. */
  seguir(): void {
    this.ultimaEscrituraMs = 0;
    this.registrar();
  }

  private revisar(): void {
    const ultima = Number(leer(CLAVE_ACTIVIDAD)) || Date.now();
    const faltanMs = Inactividad.minutosLimite() * 60_000 - (Date.now() - ultima);
    this.zona.run(() => {
      if (faltanMs <= 0) {
        const alVencer = this.alVencer;
        this.detener();
        alVencer?.();
      } else {
        this.segundosRestantes.set(faltanMs <= AVISO_ANTES_MS ? Math.ceil(faltanMs / 1000) : null);
      }
    });
  }
}

// localStorage puede fallar (modo privado estricto): entonces sin memoria entre pestañas.
function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function guardar(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // sin almacenamiento: sigue funcionando dentro de esta pestaña
  }
}
