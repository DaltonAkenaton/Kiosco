/**
 * ============================================================================
 *  VENTANA CON MOTIVO  (ARQUITECTURA.md 10: "todas requieren motivo")
 * ============================================================================
 *
 *  La ventana que aparece antes de cualquier accion que cambia algo: dar de
 *  baja, PIN nuevo, registrar a mano... Explica que va a pasar, pide el
 *  motivo (queda en la bitacora) y tiene dos botones con palabras.
 *
 *  Uso:
 *      <panel-dialogo titulo="Dar de baja a Juan" textoBoton="Dar de baja"
 *                     [peligro]="true" [ocupado]="guardando()" [error]="error()"
 *                     (confirmar)="darDeBaja($event)" (cancelar)="cerrar()">
 *        Lo que se explica arriba del motivo.
 *      </panel-dialogo>
 *
 *  `etiquetaMotivo` y `sugerencias` (0029): para Pendientes, donde no se
 *  pregunta "¿por que?" sino "¿que se hizo?", con botones de las respuestas
 *  de siempre ("Se hablo con la persona") que llenan el campo de un clic.
 *
 *  `$event` es el motivo ya escrito. El contenido (lo de adentro) puede traer
 *  sus propios campos: el dialogo solo agrega el motivo y los botones.
 *
 *  Se cierra (como "Cancelar") con la tecla Esc o picando fuera de la
 *  ventana, salvo mientras guarda. Picar afuera cuenta solo si el clic
 *  EMPIEZA afuera: quien selecciona texto dentro de un campo y suelta el
 *  raton fuera de la ventana no pierde lo que escribio.
 *
 *  `hayCambios` (21-10-2026): en una ventana con mucho que escribir (una
 *  nota), Esc o un clic afuera PREGUNTAN antes de tirar lo escrito. El boton
 *  Cancelar no pregunta: ese si se pico a proposito.
 */

import { Component, HostListener, input, output, signal } from '@angular/core';

/** Lo minimo que pide la base (exigir_motivo, migracion 0015). */
export const LARGO_MINIMO_MOTIVO = 10;

@Component({
  selector: 'panel-dialogo',
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6"
      style="background-color: rgb(0 0 0 / 0.7)"
      (mousedown)="presionEnElFondo($event)"
      (click)="clicEnElFondo($event)"
    >
      <form
        class="ventana bg-superficie border-borde flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-3xl border-2 p-5 sm:p-8"
        (submit)="$event.preventDefault(); enviar()"
      >
        <h2 class="text-2xl font-bold">{{ titulo() }}</h2>
        <div class="flex flex-col gap-3 text-lg"><ng-content /></div>

        @if (pedirMotivo()) {
          <label class="flex flex-col gap-1">
            <span>{{ etiquetaMotivo() }} <span class="text-texto-suave">(queda anotado en la bitácora)</span></span>
            @if (sugerencias().length > 0) {
              <span class="flex flex-wrap gap-2">
                @for (s of sugerencias(); track s) {
                  <button type="button" class="boton-secundario !px-3 !py-1 text-base" (click)="escribir(s)">{{ s }}</button>
                }
              </span>
            }
            <input class="campo" [placeholder]="ejemploMotivo()" [value]="motivo()" (input)="escribir(valor($event))" />
            @if (motivo().trim().length < minimo) {
              <span class="text-base font-semibold" style="color: var(--kiosko-atencion)">
                ✎ {{ etiquetaMotivo() === '¿Por qué?' ? 'Escribe por qué' : 'Escríbelo' }} (al menos {{ minimo }} letras; llevas {{ motivo().trim().length }}) para poder guardar.
              </span>
            }
          </label>
        }

        @if (error(); as mensaje) {
          <p class="rounded-xl px-4 py-3 font-bold" style="background-color: rgb(239 68 68 / 0.18); color: var(--kiosko-peligro)">
            {{ mensaje }}
          </p>
        }

        <div class="flex flex-wrap gap-3">
          <button
            type="submit"
            class="boton-principal"
            [style.background-color]="peligro() ? 'var(--kiosko-peligro)' : null"
            [style.border-color]="peligro() ? 'var(--kiosko-peligro)' : null"
            [disabled]="ocupado() || (pedirMotivo() && motivo().trim().length < minimo)"
          >
            {{ ocupado() ? 'Guardando…' : textoBoton() }}
          </button>
          <button type="button" class="boton-secundario" [disabled]="ocupado()" (click)="cerrar()">Cancelar</button>
        </div>
      </form>
    </div>
  `,
})
export class Dialogo {
  readonly titulo = input.required<string>();
  readonly textoBoton = input('Guardar');
  readonly peligro = input(false);
  readonly ocupado = input(false);
  readonly error = input<string | null>(null);
  readonly pedirMotivo = input(true);
  readonly ejemploMotivo = input('Ej.: lo pidió el empleado el 23 de septiembre');
  readonly etiquetaMotivo = input('¿Por qué?');
  /** Respuestas de siempre: un clic las escribe en el campo (se pueden editar). */
  readonly sugerencias = input<string[]>([]);
  /** Hay algo escrito que se perderia: Esc y el clic afuera preguntan primero. */
  readonly hayCambios = input(false);

  readonly confirmar = output<string>();
  readonly cancelar = output<void>();
  /** El motivo cada vez que cambia (Pendientes marca "justificar" segun la sugerencia elegida). */
  readonly alEscribir = output<string>();

  protected readonly motivo = signal('');
  protected readonly minimo = LARGO_MINIMO_MOTIVO;

  protected empezoAfuera = false;

  /**
   * OJO: esto es una funcion que NO devuelve nada, a proposito. Si en la
   * plantilla se escribiera como expresion (`a && b && cerrar()`), en un clic
   * DENTRO de la ventana daria `false`, y Angular trata un `false` como
   * "cancela este clic": el boton Guardar dejaba de enviar el formulario.
   */
  protected presionEnElFondo(evento: MouseEvent): void {
    // Igual que abajo: funcion SIN valor de regreso. Como expresion
    // (`empezoAfuera = ...`) daba `false` al presionar DENTRO de la ventana, y
    // Angular cancelaba el "presionar": las casillas no recibian el cursor y
    // los menus desplegables no abrian (E-021).
    this.empezoAfuera = evento.target === evento.currentTarget;
  }

  protected clicEnElFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget && this.empezoAfuera) this.cerrarSinQuerer();
  }

  /** Esc o clic afuera: puede ser sin querer, asi que si hay algo escrito se pregunta. */
  @HostListener('document:keydown.escape')
  protected cerrarSinQuerer(): void {
    if (this.ocupado()) return;
    if (this.hayCambios() && !window.confirm('¿Cerrar sin guardar? Se pierde lo que escribiste.')) return;
    this.cancelar.emit();
  }

  protected cerrar(): void {
    if (!this.ocupado()) this.cancelar.emit();
  }

  protected enviar(): void {
    if (this.pedirMotivo() && this.motivo().trim().length < this.minimo) return;
    this.confirmar.emit(this.motivo().trim());
  }

  protected escribir(texto: string): void {
    this.motivo.set(texto);
    this.alEscribir.emit(texto);
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}

/**
 * El error de la base, para mostrarlo. Los mensajes que escribimos en las
 * funciones de la 0015 ("Solo un administrador...", "Debe estar entre...")
 * ya son para personas y salen tal cual; uno tecnico ("violates foreign key")
 * se cambia por algo que el jefe pueda usar.
 */
export function mensajeDeError(error: { message?: string } | null | undefined): string {
  const texto = error?.message ?? '';
  const tecnico = /violates|constraint|syntax|permission denied|relation|column|JWT|fetch/i.test(texto);
  if (!texto || tecnico) return 'No se pudo guardar. Revisa el internet y vuelve a intentar; si sigue, avisa a soporte.';
  return texto;
}
