/**
 * (Copia del componente del kiosco, apps/kiosco-ui/src/app/componentes/ayuda.ts.
 * Son dos aplicaciones Angular separadas; si cambias uno, cambia el otro.)
 *
 *
 * ============================================================================
 *  AYUDA  (el simbolo ⓘ)
 * ============================================================================
 *
 *  Un circulito con una "i" junto a cualquier palabra que alguien pueda no
 *  entender ("Conservada", "Reloj sospechoso"...). Al picarlo se abre una
 *  explicacion corta, en palabras de todos los dias.
 *
 *  Regla del proyecto (23-09-2026): quien usa esto puede no saber nada de
 *  computadoras. Por eso:
 *
 *    - se abre con CLIC y no al pasar el raton: mucha gente no sabe que hay
 *      que dejar el cursor quieto encima para que salga algo;
 *    - trae un boton "Entendido" para cerrarla, ademas de cerrarse sola al
 *      picar en cualquier otro lado, con Esc o al desplazar la pagina;
 *    - no hace nada mas: picarla nunca abre una foto ni cambia un filtro.
 *
 *  Dos arreglos de la fase de pruebas (26-09-2026):
 *    - SOLO UNA abierta a la vez en toda la pagina (antes se podian abrir
 *      todas y se encimaban);
 *    - la ventanita se coloca en la pantalla, no dentro de la tabla: si no
 *      cabe abajo se abre arriba, y nunca se sale por los lados.
 *
 *  Uso:
 *      <panel-ayuda titulo="Conservada" texto="Esta foto no se borrara..." />
 */

import { Component, ElementRef, HostListener, computed, inject, input, signal, viewChild } from '@angular/core';

/** La ayuda abierta en este momento, en toda la pagina (a lo mas una). */
const abiertaAhora = signal<object | null>(null);

const ANCHO = 320;
const MARGEN = 8;
/** Alto aproximado de la ventanita, para decidir si cabe abajo. */
const ALTO_ESPERADO = 220;

@Component({
  selector: 'panel-ayuda',
  template: `
    <span class="ml-1 inline-block align-middle">
      <button
        #boton
        type="button"
        class="boton-tactil inline-flex h-6 w-6 items-center justify-center rounded-full border-2
               text-sm font-black leading-none"
        style="border-color: var(--kiosko-texto-suave); color: var(--kiosko-texto-suave)"
        [attr.aria-label]="'Que significa: ' + titulo()"
        [attr.aria-expanded]="abierta()"
        (click)="alternar($event)"
      >
        i
      </button>

      @if (abierta()) {
        <span
          role="dialog"
          class="fixed z-[80] flex flex-col gap-2 rounded-2xl border-2 p-4 text-left text-base font-normal
                 whitespace-normal normal-case tracking-normal shadow-2xl"
          [style.width.px]="ancho"
          [style.left.px]="lugar().izquierda"
          [style.top.px]="lugar().arriba"
          [style.bottom.px]="lugar().abajo"
          style="background-color: var(--kiosko-superficie); border-color: var(--kiosko-borde); color: var(--kiosko-texto)"
          (click)="$event.stopPropagation()"
        >
          <b class="text-lg">{{ titulo() }}</b>
          <span class="leading-snug">{{ texto() }}</span>
          <button
            type="button"
            class="boton-tactil self-end rounded-xl px-4 py-1 text-base font-bold"
            style="background-color: var(--kiosko-institucion-primario)"
            (click)="cerrar()"
          >
            Entendido
          </button>
        </span>
      }
    </span>
  `,
})
export class Ayuda {
  /** La palabra que se explica. Sale en negritas arriba de la explicacion. */
  readonly titulo = input.required<string>();
  /** La explicacion, en palabras de todos los dias. */
  readonly texto = input.required<string>();
  /**
   * Se conserva por compatibilidad: la posicion ahora se calcula sola segun
   * el espacio que haya en la pantalla.
   */
  readonly alinear = input<'centro' | 'derecha' | 'izquierda'>('centro');

  private readonly boton = viewChild.required<ElementRef<HTMLButtonElement>>('boton');
  private readonly anfitrion = inject(ElementRef);

  protected readonly ancho = ANCHO;
  protected readonly abierta = computed(() => abiertaAhora() === this);
  protected readonly lugar = signal<{ izquierda: number; arriba: number | null; abajo: number | null }>({
    izquierda: 0,
    arriba: 0,
    abajo: null,
  });

  protected alternar(evento: MouseEvent): void {
    // Sin esto, picar la "i" dentro de un renglon de la tabla abriria
    // tambien lo que haga ese renglon.
    evento.stopPropagation();
    if (this.abierta()) {
      this.cerrar();
      return;
    }
    this.colocar();
    abiertaAhora.set(this); // y cualquier otra abierta se cierra sola
  }

  protected cerrar(): void {
    if (this.abierta()) abiertaAhora.set(null);
  }

  /** Junto al circulito, dentro de la pantalla. */
  private colocar(): void {
    const r = this.boton().nativeElement.getBoundingClientRect();
    const izquierda = Math.min(
      Math.max(MARGEN, r.left + r.width / 2 - ANCHO / 2),
      window.innerWidth - ANCHO - MARGEN,
    );
    const cabeAbajo = window.innerHeight - r.bottom >= ALTO_ESPERADO;
    this.lugar.set(
      cabeAbajo
        ? { izquierda, arriba: r.bottom + MARGEN, abajo: null }
        : { izquierda, arriba: null, abajo: window.innerHeight - r.top + MARGEN },
    );
  }

  /** Picar en cualquier otro lado, Esc o desplazar la pagina la cierran. */
  @HostListener('document:click', ['$event'])
  protected alPicarFuera(evento: MouseEvent): void {
    if (!this.anfitrion.nativeElement.contains(evento.target as Node)) this.cerrar();
  }

  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  @HostListener('window:scroll')
  protected alMoverse(): void {
    this.cerrar();
  }
}
