/**
 * ============================================================================
 *  PENDIENTES: lo que el jefe deberia atender  (06-10-2026)
 * ============================================================================
 *
 *  Antes, las alertas (camara caida, kiosco sin conexion...) vivian solo
 *  dentro de la pagina Kioscos: habia que acordarse de entrar a buscarlas, y
 *  nadie se acuerda. Ahora se llevan a donde el jefe ya esta:
 *
 *    - un numero rojo en el menu ("Kioscos ②"), visible desde cualquier pagina;
 *    - una franja arriba de Asistencia, la pagina donde cae al entrar;
 *    - el detalle, como siempre, en Kioscos y en Asistencia → Revisión.
 *
 *  Todo sale de UNA funcion de la base, `avisos_del_panel()` (0028), para que
 *  el menu, la franja y Kioscos digan exactamente lo mismo. La base da los
 *  hechos (que, cual kiosco, cuantos, desde cuando); aqui se ponen en palabras.
 *
 *  (No confundir con servicios/avisos.ts, que son los avisos verdes de
 *  "✔ Guardado" que se van solos. Estos NO se van solos: se van cuando el
 *  problema se arregla.)
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { Sesion } from './sesion';
import { fecha, haceCuanto } from '../textos';

/** Lo que devuelve `avisos_del_panel()`. */
interface HechoDeLaBase {
  tipo: string;
  dispositivo_id: string | null;
  dispositivo: string | null;
  cantidad: number | null;
  desde: string | null;
}

export interface Pendiente {
  /** Para el `track` de Angular. */
  clave: string;
  texto: string;
  /** En que pagina se atiende. */
  donde: 'kioscos' | 'asistencia';
  /** Para los de Asistencia: que filtro de "Revisión" los muestra. */
  revision?: string;
  /** Desde cuando (para abrir Asistencia en esas fechas). */
  desde: string | null;
}

/** Cada cuanto se vuelve a preguntar. Lo mismo que refresca Kioscos. */
const SEGUNDOS_PARA_REFRESCAR = 60;

@Injectable({ providedIn: 'root' })
export class Pendientes {
  private readonly sesion = inject(Sesion);
  private readonly _lista = signal<Pendiente[]>([]);
  readonly lista = this._lista.asReadonly();

  readonly deKioscos = computed(() => this._lista().filter((p) => p.donde === 'kioscos'));
  readonly deAsistencia = computed(() => this._lista().filter((p) => p.donde === 'asistencia'));

  private temporizador: ReturnType<typeof setInterval> | null = null;

  /** Lo llama el marco al entrar. Con la pestaña escondida no pregunta: nadie esta viendo. */
  iniciar(): void {
    if (this.temporizador) return;
    void this.actualizar();
    this.temporizador = setInterval(() => {
      if (!document.hidden) void this.actualizar();
    }, SEGUNDOS_PARA_REFRESCAR * 1000);
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    this._lista.set([]);
  }

  /** Pregunta a la base. Sin internet se queda con lo ultimo que sabia. */
  async actualizar(): Promise<void> {
    const { data, error } = await this.sesion.bd.rpc('avisos_del_panel');
    if (error) return;
    const ahora = Date.now();
    const zona = this.sesion.zona();
    this._lista.set((data as HechoDeLaBase[]).map((h) => this.enPalabras(h, ahora, zona)));
  }

  private enPalabras(h: HechoDeLaBase, ahora: number, zona: string): Pendiente {
    const kiosco = h.dispositivo ?? 'Un kiosco';
    const n = h.cantidad ?? 0;
    const base = { clave: `${h.tipo}:${h.dispositivo_id ?? ''}`, desde: h.desde };
    switch (h.tipo) {
      case 'kiosco_sin_conexion':
        return { ...base, donde: 'kioscos', texto: `${kiosco}: no se reporta desde ${haceCuanto(h.desde, ahora)}.` };
      case 'camara_caida':
        return {
          ...base, donde: 'kioscos',
          texto: `${kiosco}: la cámara no funciona desde ${haceCuanto(h.desde, ahora)}. Los registros salen sin foto.`,
        };
      case 'camara_inestable':
        return {
          ...base, donde: 'kioscos',
          texto:
            `${kiosco}: la cámara se desconectó ${n} veces desde el ${h.desde ? fecha(h.desde, zona) : '—'}. ` +
            'Puede estar por descomponerse: revisa el cable o ten otra a la mano.',
        };
      case 'fotos_por_revisar':
        return { ...base, donde: 'kioscos', texto: `${kiosco}: ${n} foto(s) faltan o están alteradas.` };
      case 'registros_de_baja':
        return {
          ...base, donde: 'asistencia', revision: 'empleado_de_baja',
          texto: `${n} registro(s) de personas que ya estaban dadas de baja. Revisa si cuentan.`,
        };
      case 'cuarentena':
        return {
          ...base, donde: 'asistencia', revision: 'cuarentena',
          texto: `${n} registro(s) en cuarentena (llegaron de un kiosco dado de baja).`,
        };
      default:
        // Un aviso que la base conoce y este panel todavia no: se dice igual.
        return { ...base, donde: 'kioscos', texto: `${kiosco}: ${h.tipo.replace(/_/g, ' ')}.` };
    }
  }
}
