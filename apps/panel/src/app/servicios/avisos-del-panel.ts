/**
 * ============================================================================
 *  AVISOS DEL PANEL: lo de las maquinas que hay que atender  (06-10-2026)
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
 *
 *  (Tampoco con los PENDIENTES de la 0029 — servicios/pendientes.ts —, que son
 *  casos de PERSONAS: retardos, faltas... Esto es de las maquinas y de
 *  registros raros: camaras, kioscos, cuarentena.)
 *
 *  "YA LO VI" (06-10-2026). Un aviso que no se puede quitar termina siendo
 *  ruido, y el dia que llega uno importante ya nadie lo lee. Con "Ya lo vi"
 *  se esconde... hasta que la cosa EMPEORA:
 *    - con cantidad (desconexiones, registros): vuelve si hay MAS que cuando
 *      se escondio;
 *    - sin cantidad (camara caida, kiosco sin conexion): vuelve si es OTRA
 *      vez (otro "desde": la camara volvio y se cayo de nuevo).
 *  Se recuerda en ESTA computadora (localStorage): cada administrador decide
 *  que ya reviso. Cuando un aviso deja de existir, se olvida que se vio, para
 *  que si vuelve a pasar se avise de nuevo.
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

export interface AvisoDelPanel {
  /** Para el `track` de Angular y para "Ya lo vi": un aviso por tipo y kiosco. */
  clave: string;
  /** Cuantos (desconexiones, registros...). Para saber si empeoro. */
  cantidad: number | null;
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

/** Donde se recuerda lo que ya se vio (en esta computadora). */
const CLAVE_VISTOS = 'panel-pendientes-vistos';

type Vistos = Record<string, { cantidad: number | null; desde: string | null }>;

function leerVistos(): Vistos {
  try {
    const guardado = localStorage.getItem(CLAVE_VISTOS);
    const leido = guardado ? (JSON.parse(guardado) as unknown) : {};
    return typeof leido === 'object' && leido !== null ? (leido as Vistos) : {};
  } catch {
    return {}; // sin almacenamiento: se ven todos, que es lo seguro
  }
}

function guardarVistos(vistos: Vistos): void {
  try {
    localStorage.setItem(CLAVE_VISTOS, JSON.stringify(vistos));
  } catch {
    // no se pudo recordar: el aviso volvera a salir, y nada mas
  }
}

/** ¿Lo que se ve ahora es lo mismo (o menos) que lo que se marco "Ya lo vi"? */
function sigueVisto(p: AvisoDelPanel, visto: Vistos[string] | undefined): boolean {
  if (!visto) return false;
  if (p.cantidad !== null || visto.cantidad !== null) return (p.cantidad ?? 0) <= (visto.cantidad ?? 0);
  return p.desde === visto.desde;
}

@Injectable({ providedIn: 'root' })
export class AvisosDelPanel {
  private readonly sesion = inject(Sesion);
  /** Todos los que da la base, vistos o no. */
  private readonly _todos = signal<AvisoDelPanel[]>([]);
  private readonly _vistos = signal<Vistos>(leerVistos());

  /** Los que se muestran: los que no se marcaron "Ya lo vi" (o que empeoraron). */
  readonly lista = computed(() => {
    const vistos = this._vistos();
    return this._todos().filter((p) => !sigueVisto(p, vistos[p.clave]));
  });

  readonly deKioscos = computed(() => this.lista().filter((p) => p.donde === 'kioscos'));
  readonly deAsistencia = computed(() => this.lista().filter((p) => p.donde === 'asistencia'));

  /** "Ya lo vi": se esconde en esta computadora hasta que empeore. */
  yaLoVi(p: AvisoDelPanel): void {
    const vistos = { ...this._vistos(), [p.clave]: { cantidad: p.cantidad, desde: p.desde } };
    this._vistos.set(vistos);
    guardarVistos(vistos);
  }

  /**
   * Lo nuevo que llego de la base. Lo que ya no existe se olvida de los
   * vistos: si vuelve a pasar dentro de un mes, es un aviso nuevo.
   */
  private recibir(lista: AvisoDelPanel[]): void {
    this._todos.set(lista);
    const claves = new Set(lista.map((p) => p.clave));
    const vistos = this._vistos();
    const quedan = Object.fromEntries(Object.entries(vistos).filter(([clave]) => claves.has(clave)));
    if (Object.keys(quedan).length !== Object.keys(vistos).length) {
      this._vistos.set(quedan);
      guardarVistos(quedan);
    }
  }

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
    this._todos.set([]);
  }

  /** Pregunta a la base. Sin internet se queda con lo ultimo que sabia. */
  async actualizar(): Promise<void> {
    const { data, error } = await this.sesion.bd.rpc('avisos_del_panel');
    if (error) return;
    const ahora = this.sesion.ahora();
    const zona = this.sesion.zona();
    this.recibir((data as HechoDeLaBase[]).map((h) => this.enPalabras(h, ahora, zona)));
  }

  private enPalabras(h: HechoDeLaBase, ahora: number, zona: string): AvisoDelPanel {
    const kiosco = h.dispositivo ?? 'Un kiosco';
    const n = h.cantidad ?? 0;
    const base = { clave: `${h.tipo}:${h.dispositivo_id ?? ''}`, desde: h.desde, cantidad: h.cantidad };
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
