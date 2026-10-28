/**
 * ============================================================================
 *  COMPONENTE: RELOJ
 * ============================================================================
 *
 *  El reloj grande de la pantalla principal (ARQUITECTURA.md 4.1).
 *
 *  Es un componente aparte —y no unas lineas dentro de la pantalla— por dos
 *  razones:
 *
 *    1. Tiene un temporizador que hay que apagar al destruirlo. Encerrar esa
 *       responsabilidad aqui evita olvidarla.
 *    2. La pantalla de confirmacion tambien va a mostrar la hora. Con un
 *       componente, se reutiliza.
 *
 *  `template` en vez de `templateUrl`: cuando el HTML son diez lineas, tenerlo
 *  aqui mismo se lee mejor que saltar entre dos archivos.
 */

import { Component, OnDestroy, OnInit, computed, input, signal } from '@angular/core';

@Component({
  selector: 'kiosco-reloj',
  template: `
    <div class="text-center">
      <!--
        La clase tabular-nums hace que todos los digitos ocupen el mismo
        ancho. Sin eso el reloj "baila" cada segundo, porque el 1 es mas
        angosto que el 8. En una pantalla de este tamano se nota muchisimo.

        (Nota: dentro de un template de TypeScript no se pueden usar acentos
        graves para citar codigo; cierran la cadena de texto.)
      -->
      <div class="texto-reloj font-bold leading-none tabular-nums tracking-tight">
        {{ horaTexto() }}
      </div>
      <div class="text-texto-suave texto-fecha mt-2">{{ fechaTexto() }}</div>
    </div>
  `,
})
export class Reloj implements OnInit, OnDestroy {
  /**
   * `input()` declara un dato que llega DESDE AFUERA:
   *     <kiosco-reloj [zonaHoraria]="..." />
   *
   * `.required` significa que quien use el componente esta obligado a pasarlo.
   * Aqui es a proposito: si la zona horaria fuera opcional tendria un valor por
   * defecto, y un valor por defecto de zona horaria es exactamente el tipo de
   * cosa que produce marcas con una hora de diferencia durante medio ano.
   * Mejor que el compilador obligue a decirla.
   */
  readonly zonaHoraria = input.required<string>();

  /**
   * Si se muestran los segundos.
   *
   * En la pantalla principal si: ver el reloj avanzar es lo que le dice a la
   * gente que el kiosco esta vivo y no colgado. Es un detalle pequeno que
   * evita que alguien se quede esperando frente a una pantalla congelada.
   */
  readonly mostrarSegundos = input<boolean>(true);

  /** Cada cuantos milisegundos se refresca. Viene de la configuracion central. */
  readonly intervaloMs = input<number>(1000);

  /**
   * Cuanto se adelanta Windows respecto a la nube (EstadoKiosco). Se resta
   * para mostrar la hora con la que se GUARDAN los registros, aunque la PC
   * tenga el reloj desfasado.
   */
  readonly desfaseMs = input<number>(0);

  private readonly reloj = signal(Date.now());
  private readonly ahora = computed(() => new Date(this.reloj() - this.desfaseMs()));
  private temporizador: ReturnType<typeof setInterval> | null = null;

  protected readonly horaTexto = computed(() =>
    this.ahora().toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      ...(this.mostrarSegundos() ? { second: '2-digit' as const } : {}),
      hour12: false,
      timeZone: this.zonaHoraria(),
    }),
  );

  /**
   * "Lunes, 28 de septiembre de 2026": mayuscula SOLO al inicio. Antes se
   * usaba la clase `capitalize` de CSS, que pone mayuscula a CADA palabra
   * ("28 De Septiembre De 2026"), y en español eso esta mal.
   */
  protected readonly fechaTexto = computed(() => {
    const texto = this.ahora().toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: this.zonaHoraria(),
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });

  ngOnInit(): void {
    this.temporizador = setInterval(() => this.reloj.set(Date.now()), this.intervaloMs());
  }

  ngOnDestroy(): void {
    if (this.temporizador !== null) clearInterval(this.temporizador);
  }
}
