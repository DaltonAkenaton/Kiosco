import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** La raiz: solo aloja la pagina que toque (entrar, o el marco con el menu). */
@Component({
  selector: 'panel-raiz',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class Raiz {}
