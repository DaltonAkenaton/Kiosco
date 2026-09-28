/**
 * ============================================================================
 *  RENGLONES DE "CARGANDO" PARA UNA TABLA
 * ============================================================================
 *
 *  Mientras llegan los datos, en vez de "No hay nadie" (que asusta: "¿se
 *  borro todo?"), unos renglones grises que laten. Va dentro del <tbody>:
 *
 *      <tbody>
 *        @if (cargando()) {
 *          <tr panel-cargando-tabla [columnas]="5"></tr>
 *        } @else { ... }
 *      </tbody>
 *
 *  Se pone como atributo de un <tr> porque dentro de una tabla el navegador
 *  no acepta etiquetas propias: las sacaria de la tabla.
 */

import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'tr[panel-cargando-tabla]',
  host: { 'aria-busy': 'true' },
  template: `
    @for (c of celdas(); track $index) {
      <td class="py-3 pr-4"><span class="esqueleto" [style.width.%]="c"></span></td>
    }
  `,
})
export class CargandoTabla {
  readonly columnas = input.required<number>();

  /** Anchos distintos por columna: parecen datos, no una barra. */
  protected readonly celdas = computed(() => Array.from({ length: this.columnas() }, (_, i) => [70, 90, 55, 80, 45, 65][i % 6]));
}

/** Varios renglones de "cargando". */
export const RENGLONES_CARGANDO = [0, 1, 2, 3, 4];
