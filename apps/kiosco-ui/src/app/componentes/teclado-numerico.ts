/**
 * ============================================================================
 *  COMPONENTE: TECLADO NUMERICO EN PANTALLA
 * ============================================================================
 *
 *  APAGADO POR DEFECTO.
 *
 *  La PC del kiosco tiene teclado fisico y no es tactil, asi que normalmente
 *  este teclado estorba. Existe como respaldo: si el teclado se descompone,
 *  se desconecta o se lo llevan, se pone `mostrarTecladoEnPantalla: true` en
 *  la configuracion y la gente checa con el raton mientras tanto.
 *
 *  Esa es la regla de oro aplicada: nunca impedir que alguien registre.
 *  Un respaldo que cuesta poco hoy vale muchisimo el lunes que falle algo.
 */

import { Component, output } from '@angular/core';

@Component({
  selector: 'kiosco-teclado-numerico',
  template: `
    <div class="grid w-72 grid-cols-3 gap-3">
      @for (tecla of TECLAS; track tecla) {
        <button
          type="button"
          class="bg-superficie border-borde hover:bg-borde active:bg-borde
                 rounded-2xl border py-6 text-3xl font-bold tabular-nums transition-colors"
          (click)="digito.emit(tecla)"
        >
          {{ tecla }}
        </button>
      }

      <button
        type="button"
        class="bg-superficie border-borde hover:bg-borde rounded-2xl border py-6 text-xl font-semibold"
        (click)="borrar.emit()"
      >
        Borrar
      </button>

      <button
        type="button"
        class="bg-superficie border-borde hover:bg-borde rounded-2xl border py-6 text-3xl font-bold tabular-nums"
        (click)="digito.emit('0')"
      >
        0
      </button>

      <button
        type="button"
        class="rounded-2xl py-6 text-xl font-semibold"
        style="background-color: var(--kiosko-entrada); color: var(--kiosko-fondo)"
        (click)="aceptar.emit()"
      >
        Aceptar
      </button>
    </div>
  `,
})
export class TecladoNumerico {
  /** Las teclas del 1 al 9. El 0 va aparte, junto a Borrar y Aceptar. */
  protected readonly TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  /**
   * `output()` declara un aviso que este componente manda HACIA AFUERA:
   *     <kiosco-teclado-numerico (digito)="alTeclear($event)" />
   *
   * Fijate en el reparto de responsabilidades: este componente NO sabe si se
   * esta tecleando un numero de empleado o un PIN, ni cuantos digitos caben,
   * ni que hacer al aceptar. Solo avisa "se presiono el 7".
   *
   * Eso lo hace reutilizable y facil de probar: es un teclado, no un
   * formulario.
   */
  readonly digito = output<string>();
  readonly borrar = output<void>();
  readonly aceptar = output<void>();
}
