/**
 * ============================================================================
 *  PENDIENTES: casos de PERSONAS que el jefe tiene que atender  (0029)
 * ============================================================================
 *
 *  Junta con el jefe (20-10-2026): tiene muchas cosas que hacer, y lo que ve
 *  el viernes ya se le olvido el lunes. Un pendiente es un CASO (llego tarde
 *  toda la semana, falto, no registro su salida...) que se queda abierto
 *  hasta que alguien lo atiende y escribe que hizo.
 *
 *  La base hace todo: `revisar_pendientes()` busca casos nuevos con las
 *  reglas de Configuracion, cierra solos los que ya no aplican y devuelve
 *  cuantos quedan abiertos. Aqui solo se llama y se guarda ese numero para el
 *  menu ("Pendientes ③") y para decidir a donde entrar.
 *
 *  Sin correo ni WhatsApp (lo pidio el jefe): el recordatorio es que el panel
 *  ABRA en Pendientes cuando hay algo (rutas.ts, `alEntrar`).
 *
 *  (No confundir con servicios/avisos-del-panel.ts: eso es de las maquinas,
 *  camaras y kioscos.)
 */

import { Injectable, inject, signal } from '@angular/core';
import { Sesion } from './sesion';

/**
 * Cada cuanto se vuelve a revisar. Mas que los avisos de los kioscos (60 s):
 * un retardo o una falta no cambian de un minuto a otro, y revisar lee el
 * reporte de dos semanas.
 */
const MINUTOS_PARA_REVISAR = 5;

@Injectable({ providedIn: 'root' })
export class Pendientes {
  private readonly sesion = inject(Sesion);

  private readonly _abiertos = signal(0);
  /** Cuantos pendientes hay sin atender (el numero del menu). */
  readonly abiertos = this._abiertos.asReadonly();

  private temporizador: ReturnType<typeof setInterval> | null = null;

  /** Lo llama el marco al entrar. Con la pestaña escondida no revisa: nadie esta viendo. */
  iniciar(): void {
    if (this.temporizador) return;
    void this.revisar();
    this.temporizador = setInterval(() => {
      if (!document.hidden) void this.revisar();
    }, MINUTOS_PARA_REVISAR * 60 * 1000);
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    this._abiertos.set(0);
  }

  /**
   * Pide a la base que revise. Devuelve cuantos quedan abiertos, o `null` si
   * no se pudo (sin internet): se queda con el ultimo numero que sabia.
   */
  async revisar(): Promise<number | null> {
    const { data, error } = await this.sesion.bd.rpc('revisar_pendientes');
    if (error || typeof data !== 'number') return null;
    this._abiertos.set(data);
    return data;
  }

  /** Despues de atender o reabrir uno: el numero del menu, al dia. */
  ajustar(cambio: number): void {
    this._abiertos.update((n) => Math.max(0, n + cambio));
  }
}
