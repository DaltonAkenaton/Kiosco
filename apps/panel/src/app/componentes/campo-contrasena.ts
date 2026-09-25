/**
 * ============================================================================
 *  UNA CASILLA DE CONTRASENA "COMO DEBE SER"
 * ============================================================================
 *
 *  - Boton **Mostrar / Ocultar** con palabras (no un ojito: no todos saben que
 *    el ojito se pica). Donde mas importa es al PONER una contrasena nueva: si
 *    se teclea mal y no se ve, se guarda una que nadie conoce.
 *  - Aviso de **Bloq Mayus** activado, que es la causa numero uno de "mi
 *    contrasena no sirve".
 *
 *  Uso:  <panel-campo-contrasena [(valor)]="miSenal" autocompletar="new-password" />
 */

import { Component, input, model, signal } from '@angular/core';

@Component({
  selector: 'panel-campo-contrasena',
  template: `
    <div class="flex gap-2">
      <input
        class="campo min-w-0 flex-1"
        [class.font-mono]="mostrar()"
        [type]="mostrar() ? 'text' : 'password'"
        [attr.autocomplete]="autocompletar()"
        spellcheck="false"
        autocapitalize="off"
        [value]="valor()"
        (input)="valor.set(texto($event))"
        (keydown)="revisarMayusculas($event)"
        (keyup)="revisarMayusculas($event)"
        (blur)="mayusculas.set(false)"
      />
      <button type="button" class="boton-secundario shrink-0" (click)="mostrar.set(!mostrar())">
        {{ mostrar() ? 'Ocultar' : 'Mostrar' }}
      </button>
    </div>
    @if (mayusculas()) {
      <p class="mt-1 font-bold" style="color: var(--kiosko-atencion)">
        ⚠ Las MAYÚSCULAS están activadas (tecla Bloq Mayús).
      </p>
    }
  `,
})
export class CampoContrasena {
  readonly valor = model('');
  readonly autocompletar = input('new-password');

  protected readonly mostrar = signal(false);
  protected readonly mayusculas = signal(false);

  protected revisarMayusculas(evento: KeyboardEvent): void {
    this.mayusculas.set(evento.getModifierState?.('CapsLock') ?? false);
  }

  protected texto(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
