/**
 * ============================================================================
 *  VENTANA CON MOTIVO  (CLAUDE.md 10: "todas requieren motivo")
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
 *  `$event` es el motivo ya escrito. El contenido (lo de adentro) puede traer
 *  sus propios campos: el dialogo solo agrega el motivo y los botones.
 *
 *  Se cierra (como "Cancelar") con la tecla Esc o picando fuera de la
 *  ventana, salvo mientras guarda. Picar afuera cuenta solo si el clic
 *  EMPIEZA afuera: quien selecciona texto dentro de un campo y suelta el
 *  raton fuera de la ventana no pierde lo que escribio.
 */

import { Component, HostListener, input, output, signal } from '@angular/core';

/** Lo minimo que pide la base (exigir_motivo, migracion 0015). */
export const LARGO_MINIMO_MOTIVO = 10;

@Component({
  selector: 'panel-dialogo',
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-6"
      style="background-color: rgb(0 0 0 / 0.7)"
      (mousedown)="empezoAfuera = $event.target === $event.currentTarget"
      (click)="clicEnElFondo($event)"
    >
      <form
        class="ventana bg-superficie border-borde flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-3xl border-2 p-8"
        (submit)="$event.preventDefault(); enviar()"
      >
        <h2 class="text-2xl font-bold">{{ titulo() }}</h2>
        <div class="flex flex-col gap-3 text-lg"><ng-content /></div>

        @if (pedirMotivo()) {
          <label class="flex flex-col gap-1">
            <span>¿Por qué? <span class="text-texto-suave">(queda anotado en la bitácora)</span></span>
            <input class="campo" [placeholder]="ejemploMotivo()" [value]="motivo()" (input)="motivo.set(valor($event))" />
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
        @if (pedirMotivo() && motivo().trim().length < minimo) {
          <p class="text-texto-suave text-sm">Escribe el motivo (al menos {{ minimo }} letras) para poder guardar.</p>
        }
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

  readonly confirmar = output<string>();
  readonly cancelar = output<void>();

  protected readonly motivo = signal('');
  protected readonly minimo = LARGO_MINIMO_MOTIVO;

  protected empezoAfuera = false;

  /**
   * OJO: esto es una funcion que NO devuelve nada, a proposito. Si en la
   * plantilla se escribiera como expresion (`a && b && cerrar()`), en un clic
   * DENTRO de la ventana daria `false`, y Angular trata un `false` como
   * "cancela este clic": el boton Guardar dejaba de enviar el formulario.
   */
  protected clicEnElFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget && this.empezoAfuera) this.cerrar();
  }

  @HostListener('document:keydown.escape')
  protected cerrar(): void {
    if (!this.ocupado()) this.cancelar.emit();
  }

  protected enviar(): void {
    if (this.pedirMotivo() && this.motivo().trim().length < this.minimo) return;
    this.confirmar.emit(this.motivo().trim());
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
