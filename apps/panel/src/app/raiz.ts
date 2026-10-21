import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** La raiz: solo aloja la pagina que toque (entrar, o el marco con el menu). */
@Component({
  selector: 'panel-raiz',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class Raiz {
  /**
   * Fechas y horas: al picar en CUALQUIER parte del campo se abre el
   * calendario o el reloj, no solo en el iconito (prueba del autor,
   * 20-10-2026: no se sabia que se podia picar). Se sigue pudiendo escribir.
   */
  @HostListener('document:click', ['$event'])
  protected abrirSelector(evento: MouseEvent): void {
    const campo = evento.target;
    if (!(campo instanceof HTMLInputElement) || (campo.type !== 'date' && campo.type !== 'time')) return;
    if (campo.disabled || campo.readOnly) return;
    try {
      campo.showPicker();
    } catch {
      // el navegador no lo permite (o ya estaba abierto): se escribe a mano
    }
  }
}
