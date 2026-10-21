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
import { EntradaAdmin } from './servicios/entrada-admin';
import { PuenteKiosco } from './servicios/puente-kiosco';

/**
 * Cuanto despues de empezar a presionar aparece la rayita de avance. Antes
 * no: un toque normal al letrero no debe mostrar nada.
 */
const MS_ANTES_DE_MOSTRAR_AVANCE = 1000;

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
    this.soltarLetrero();
  }

  // --------------------------------------------------------------------------
  //  Mantener presionado el letrero = modo administrador (servicios/entrada-admin.ts)
  // --------------------------------------------------------------------------
  private readonly entradaAdmin = inject(EntradaAdmin);
  private temporizadorLetrero: ReturnType<typeof setTimeout> | null = null;
  private temporizadorAvance: ReturnType<typeof setTimeout> | null = null;
  /** Mientras se mantiene presionado (ya pasado el primer segundo): la rayita que se llena. */
  protected readonly avanceVisible = signal(false);
  /** Lo que tarda en llenarse la rayita, en segundos (lo que falta despues del primero). */
  protected readonly segundosDeAvance = signal(0);

  protected presionarLetrero(evento: PointerEvent): void {
    // Solo el boton principal del raton (o un dedo): el derecho no cuenta.
    if (evento.button !== 0) return;
    this.soltarLetrero();
    const total = (this.configuracion()?.segundosParaEntrarAlAdministrador ?? 3) * 1000;
    this.temporizadorAvance = setTimeout(() => {
      this.segundosDeAvance.set(Math.max(0, total - MS_ANTES_DE_MOSTRAR_AVANCE) / 1000);
      this.avanceVisible.set(true);
    }, MS_ANTES_DE_MOSTRAR_AVANCE);
    this.temporizadorLetrero = setTimeout(() => {
      this.soltarLetrero();
      this.entradaAdmin.pedir();
    }, total);
  }

  /** Se solto, se salio del letrero o Windows cancelo el toque: no pasa nada. */
  protected soltarLetrero(): void {
    if (this.temporizadorLetrero) clearTimeout(this.temporizadorLetrero);
    if (this.temporizadorAvance) clearTimeout(this.temporizadorAvance);
    this.temporizadorLetrero = null;
    this.temporizadorAvance = null;
    this.avanceVisible.set(false);
  }
}
