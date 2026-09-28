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
 *      picar en cualquier otro lado o con Esc;
 *    - no hace nada mas: picarla nunca abre una foto ni cambia un filtro.
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE "popover" Y NO UNA CAJA CON position: absolute  (28-09-2026)
 *  ---------------------------------------------------------------------------
 *  La version anterior era una caja `absolute` debajo del simbolo. Se veia
 *  bien en medio de la pantalla y mal en todos los demas lados:
 *    - en la barra de abajo se abria HACIA ABAJO, fuera de la pantalla;
 *    - dentro de la tabla la ensanchaba y aparecia una barra horizontal;
 *    - dentro de una ventana con desplazamiento, la ventana la recortaba.
 *
 *  El atributo `popover` pone la caja en la "capa superior" del navegador,
 *  la misma de los dialogos: encima de todo, fuera de cualquier contenedor
 *  que recorte. Y se coloca a mano junto al simbolo: abajo si cabe, arriba
 *  si no, y siempre dentro de la pantalla.
 *
 *  Uso:
 *      <kiosco-ayuda titulo="Conservada" texto="Esta foto no se borrara..." />
 */

import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  input,
  signal,
  viewChild,
} from '@angular/core';

/** Separacion entre el simbolo y la caja, y margen minimo con el borde de la pantalla. */
const SEPARACION_PX = 10;
const MARGEN_PANTALLA_PX = 12;

@Component({
  selector: 'kiosco-ayuda',
  template: `
    <button
      #boton
      type="button"
      class="ayuda-boton boton-tactil inline-flex items-center justify-center rounded-full border-2 align-middle
             text-sm font-black leading-none"
      [class.ayuda-boton-abierta]="abierta()"
      [attr.aria-label]="'Qué significa: ' + titulo()"
      [attr.aria-expanded]="abierta()"
      (click)="alternar($event)"
    >
      i
    </button>

    <div
      #caja
      popover="manual"
      role="dialog"
      class="ayuda-caja"
      [attr.data-lado]="lado()"
      [style.left.px]="posicion().x"
      [style.top.px]="posicion().y"
      [style.--flecha-x]="posicion().flecha + 'px'"
      (click)="$event.stopPropagation()"
    >
      <b class="text-lg leading-tight">{{ titulo() }}</b>
      <!-- pre-line: respeta los saltos de renglon del texto (listas cortas). -->
      <span class="whitespace-pre-line leading-snug">{{ texto() }}</span>
      <button type="button" class="boton-tactil boton-primario self-end rounded-xl px-4 py-1.5 text-base font-bold"
              (click)="cerrar()">
        Entendido
      </button>
    </div>
  `,
  host: { class: 'inline-block align-middle' },
})
export class Ayuda implements OnDestroy {
  /** La palabra que se explica. Sale en negritas arriba de la explicacion. */
  readonly titulo = input.required<string>();
  /** La explicacion, en palabras de todos los dias. */
  readonly texto = input.required<string>();
  /**
   * Ya no hace falta: la caja se acomoda sola para no salirse. Se conserva
   * para no tener que tocar cada lugar donde se usa.
   */
  readonly alinear = input<'centro' | 'derecha' | 'izquierda'>('centro');

  private readonly boton = viewChild.required<ElementRef<HTMLButtonElement>>('boton');
  private readonly caja = viewChild.required<ElementRef<HTMLElement>>('caja');

  protected readonly abierta = signal(false);
  protected readonly lado = signal<'abajo' | 'arriba'>('abajo');
  protected readonly posicion = signal({ x: 0, y: 0, flecha: 0 });

  /** Solo una ayuda abierta a la vez en toda la pantalla. */
  private static abiertaAhora: Ayuda | null = null;

  protected alternar(evento: MouseEvent): void {
    // Sin esto, picar la "i" dentro de un renglon de la tabla abriria
    // tambien la foto de ese renglon.
    evento.stopPropagation();
    if (this.abierta()) this.cerrar();
    else this.abrir();
  }

  private abrir(): void {
    if (Ayuda.abiertaAhora && Ayuda.abiertaAhora !== this) Ayuda.abiertaAhora.cerrar();
    Ayuda.abiertaAhora = this;
    const caja = this.caja().nativeElement;
    try {
      caja.showPopover();
    } catch {
      return; // ya estaba abierta, o el navegador no la soporta
    }
    this.abierta.set(true);
    this.acomodar();
  }

  protected cerrar(): void {
    if (!this.abierta()) return;
    this.abierta.set(false);
    if (Ayuda.abiertaAhora === this) Ayuda.abiertaAhora = null;
    try {
      this.caja().nativeElement.hidePopover();
    } catch {
      // ya estaba cerrada
    }
  }

  /**
   * La coloca junto al simbolo. Primero se mide (ya abierta, porque cerrada
   * no tiene tamaño) y luego se decide: abajo si cabe, si no arriba; y de
   * lado, centrada en el simbolo pero sin salirse de la pantalla.
   */
  private acomodar(): void {
    const ancla = this.boton().nativeElement.getBoundingClientRect();
    const caja = this.caja().nativeElement.getBoundingClientRect();
    const anchoPantalla = window.innerWidth;
    const altoPantalla = window.innerHeight;

    const cabeAbajo = ancla.bottom + SEPARACION_PX + caja.height <= altoPantalla - MARGEN_PANTALLA_PX;
    const cabeArriba = ancla.top - SEPARACION_PX - caja.height >= MARGEN_PANTALLA_PX;
    const lado = cabeAbajo || !cabeArriba ? 'abajo' : 'arriba';

    const centro = ancla.left + ancla.width / 2;
    const x = Math.min(
      Math.max(centro - caja.width / 2, MARGEN_PANTALLA_PX),
      anchoPantalla - caja.width - MARGEN_PANTALLA_PX,
    );
    const yDeseada = lado === 'abajo' ? ancla.bottom + SEPARACION_PX : ancla.top - SEPARACION_PX - caja.height;
    const y = Math.min(Math.max(yDeseada, MARGEN_PANTALLA_PX), altoPantalla - caja.height - MARGEN_PANTALLA_PX);

    this.lado.set(lado);
    // La flechita apunta al simbolo aunque la caja se haya recorrido de lado.
    this.posicion.set({ x, y, flecha: Math.min(Math.max(centro - x, 18), caja.width - 18) });
  }

  /** Picar en cualquier otro lado la cierra. */
  @HostListener('document:click')
  protected alPicarFuera(): void {
    this.cerrar();
  }

  @HostListener('document:keydown.escape')
  protected alPresionarEsc(): void {
    this.cerrar();
  }

  /**
   * Si la pantalla se desplaza o cambia de tamaño, la caja quedaria flotando
   * lejos de su simbolo: se cierra. (`true` = escuchar tambien el
   * desplazamiento de cualquier contenedor, no solo el de la pagina.)
   */
  @HostListener('window:resize')
  protected alCambiarTamano(): void {
    this.cerrar();
  }

  private readonly alDesplazar = (evento: Event): void => {
    if (this.abierta() && !this.caja().nativeElement.contains(evento.target as Node)) this.cerrar();
  };

  constructor() {
    document.addEventListener('scroll', this.alDesplazar, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.alDesplazar, true);
    if (Ayuda.abiertaAhora === this) Ayuda.abiertaAhora = null;
  }
}
