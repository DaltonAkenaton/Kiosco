/**
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
 *      picar en cualquier otro lado;
 *    - no hace nada mas: picarla nunca abre una foto ni cambia un filtro.
 *
 *  Uso:
 *      <kiosco-ayuda titulo="Conservada" texto="Esta foto no se borrara..." />
 */

import { Component, HostListener, computed, input, signal } from '@angular/core';

/** Clases de Tailwind para cada lado. Escritas completas para que Tailwind las encuentre. */
const POSICIONES = {
  centro: 'left-1/2 -translate-x-1/2',
  derecha: 'right-0',
  izquierda: 'left-0',
} as const;

@Component({
  selector: 'kiosco-ayuda',
  template: `
    <span class="relative inline-block align-middle">
      <button
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
          class="absolute top-full z-[70] mt-2 flex w-80 flex-col gap-2 rounded-2xl border-2 p-4
                 text-left text-base font-normal normal-case tracking-normal shadow-2xl"
          [class]="posicion()"
          style="background-color: var(--kiosko-superficie); border-color: var(--kiosko-borde); color: var(--kiosko-texto)"
          (click)="$event.stopPropagation()"
        >
          <b class="text-lg">{{ titulo() }}</b>
          <span class="leading-snug">{{ texto() }}</span>
          <button
            type="button"
            class="boton-tactil self-end rounded-xl px-4 py-1 text-base font-bold"
            style="background-color: var(--kiosko-institucion-primario)"
            (click)="abierta.set(false)"
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
   * Hacia donde se abre. 'centro' por defecto; 'derecha' cuando el simbolo
   * esta pegado al borde derecho de la pantalla, para que no se salga.
   */
  readonly alinear = input<'centro' | 'derecha' | 'izquierda'>('centro');

  protected readonly abierta = signal(false);
  protected readonly posicion = computed(() => POSICIONES[this.alinear()]);

  protected alternar(evento: MouseEvent): void {
    // Sin esto, picar la "i" dentro de un renglon de la tabla abriria
    // tambien la foto de ese renglon.
    evento.stopPropagation();
    this.abierta.update((a) => !a);
  }

  /** Picar en cualquier otro lado la cierra. */
  @HostListener('document:click')
  protected alPicarFuera(): void {
    this.abierta.set(false);
  }
}
