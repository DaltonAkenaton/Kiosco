/**
 * ============================================================================
 *  AVISOS BREVES ("✔ Guardado")
 * ============================================================================
 *
 *  Antes, al guardar algo la ventana simplemente se cerraba. Para quien no
 *  usa mucho la computadora eso no dice nada: ¿se guardo, o se cerro sola?
 *  Ahora aparece abajo un aviso verde con lo que paso, y se va solo.
 *
 *  Los errores NO van aqui: se quedan dentro de la ventana, junto a lo que
 *  hay que corregir, y no se van solos.
 *
 *  Uso:  inject(Avisos).exito('Guardado. Los kioscos lo reciben en unos minutos.')
 */

import { Injectable, signal } from '@angular/core';

/** Lo que dura a la vista. Con letras grandes y alguien que lee despacio, 5 s. */
const DURACION_MS = 5000;

export interface Aviso {
  id: number;
  texto: string;
}

@Injectable({ providedIn: 'root' })
export class Avisos {
  private siguienteId = 1;
  private readonly _lista = signal<Aviso[]>([]);
  readonly lista = this._lista.asReadonly();

  exito(texto: string): void {
    const id = this.siguienteId++;
    this._lista.update((l) => [...l.slice(-2), { id, texto }]);
    setTimeout(() => this.quitar(id), DURACION_MS);
  }

  quitar(id: number): void {
    this._lista.update((l) => l.filter((a) => a.id !== id));
  }
}
