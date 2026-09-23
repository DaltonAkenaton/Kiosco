/**
 * ============================================================================
 *  COMPONENTE RAIZ
 * ============================================================================
 *
 *  Su unico trabajo es:
 *    1. Arrancar el puente con el proceso principal.
 *    2. Pintar la franja institucional.
 *    3. Dar paso a la pantalla que toque.
 *
 *  Es deliberadamente delgado. Toda la logica del kiosco vive en
 *  `pantallas/pantalla-principal.ts`. Cuando lleguen la pantalla de
 *  confirmacion y la de exito (bloque 3), este archivo solo decidira cual
 *  mostrar — nada mas.
 */

import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { PantallaPrincipal } from './pantallas/pantalla-principal';
import { PuenteKiosco } from './servicios/puente-kiosco';

@Component({
  selector: 'app-root',
  imports: [PantallaPrincipal],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly puente = inject(PuenteKiosco);

  protected readonly configuracion = this.puente.configuracion;
  protected readonly hayPuente = this.puente.disponible;

  /** ¿Ya terminamos de hablar con el proceso principal? */
  protected readonly cargando = signal(true);

  /** Si el arranque fallo, aqui queda el mensaje. */
  protected readonly errorDeArranque = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      await this.puente.iniciar();
    } catch (fallo) {
      // El detalle tecnico va al registro, no a la pantalla: a quien viene a
      // checar no le sirve, y le tiene que quedar claro que hacer.
      console.error('[arranque] no se pudo iniciar', fallo);
      this.errorDeArranque.set(
        'El checador no pudo arrancar. Ciérralo y vuelve a abrirlo; si sigue igual, avisa a tu jefe para que registre tu asistencia.',
      );
    } finally {
      // `finally` corre pase lo que pase. Sin esto, un fallo dejaria la
      // pantalla en "Conectando..." para siempre, y eso es justo lo que la
      // regla de oro prohibe.
      this.cargando.set(false);
    }
  }

  ngOnDestroy(): void {
    this.puente.detener();
  }
}
