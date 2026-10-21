/**
 * ============================================================================
 *  ELEGIR EMPLEADO  (un buscador en lugar de una lista larga)
 * ============================================================================
 *
 *  Prueba del autor (20-10-2026): con muchos empleados, buscar a alguien en
 *  un menu desplegable es tedioso. Aqui se escribe parte del nombre o del
 *  numero ("guada", "1008", "A12") y la lista se reduce a quienes coinciden.
 *  Sin acentos ni mayusculas que importen: "jose" encuentra a "José".
 *
 *  OJO: casi siempre va dentro de un <label>. Picar algo dentro de una
 *  etiqueta "pica" tambien su campo, y la lista se volvia a abrir; por eso
 *  los clics de adentro llevan preventDefault().
 *
 *  Se maneja con el raton o con el teclado: flechas para moverse, Enter para
 *  elegir, Esc para cerrar.
 *
 *  Uso:
 *      <panel-elegir-empleado [opciones]="empleados()" [valor]="empleadoId()"
 *                             textoVacio="Todos" (elegir)="empleadoId.set($event)" />
 *
 *  `textoVacio` es la opcion de "nadie en particular" ("Todos", "Cualquiera").
 *  Si no se pone, no hay esa opcion: hay que elegir a alguien.
 */

import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';

export interface OpcionDeEmpleado {
  id: string;
  /** Lo que se ve; conviene que traiga el numero ("#1008 · Guadalupe Martinez"). */
  nombre: string;
}

/** "#1008 · Guadalupe Martinez": asi se puede buscar tambien por el numero. */
export function conNumero(nombre: string, numero: string | null | undefined): string {
  return numero ? `#${numero} · ${nombre}` : nombre;
}

/** Cuantas se muestran a la vez: con mas, mejor seguir escribiendo. */
const MAXIMO_VISIBLES = 50;

/** "José Ramírez" -> "jose ramirez": para buscar sin que importen acentos. */
function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

@Component({
  selector: 'panel-elegir-empleado',
  template: `
    <div class="relative">
      <input
        class="campo w-full min-w-64"
        role="combobox"
        autocomplete="off"
        [attr.aria-expanded]="abierta()"
        aria-autocomplete="list"
        [placeholder]="textoDelCampo() || 'Escribe un nombre o número'"
        [value]="abierta() ? busqueda() : textoDelCampo()"
        (focus)="abrir()"
        (click)="abrir()"
        (input)="escribir($event)"
        (keydown)="tecla($event)"
      />
      @if (valor() && textoVacio() !== null && !abierta()) {
        <button
          type="button"
          class="text-texto-suave absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-2 text-lg leading-none"
          aria-label="Quitar"
          title="Quitar"
          (click)="$event.preventDefault(); quitar()"
        >
          ✕
        </button>
      }
      @if (abierta()) {
        <ul
          role="listbox"
          class="bg-superficie border-borde absolute z-[70] mt-1 max-h-72 w-max max-w-[28rem] min-w-full overflow-y-auto rounded-xl border-2 py-1 shadow-2xl"
        >
          @for (o of visibles(); track o.id; let i = $index) {
            <li
              role="option"
              class="cursor-pointer px-3 py-2"
              [attr.data-id]="o.id"
              [attr.aria-selected]="o.id === valor()"
              [class.font-bold]="o.id === valor()"
              [style.background-color]="i === resaltada() ? 'color-mix(in srgb, var(--kiosko-texto) 14%, transparent)' : null"
              (mousedown)="$event.preventDefault()"
              (mouseenter)="resaltada.set(i)"
              (click)="$event.preventDefault(); escoger(o.id)"
            >
              {{ o.nombre }}
            </li>
          } @empty {
            <li class="text-texto-suave px-3 py-2">Nadie coincide con «{{ busqueda() }}».</li>
          }
        </ul>
      }
    </div>
  `,
})
export class ElegirEmpleado {
  private readonly elemento = inject(ElementRef<HTMLElement>);

  readonly opciones = input.required<OpcionDeEmpleado[]>();
  readonly valor = input<string>('');
  /** La opcion de "nadie en particular"; `null` = hay que elegir a alguien. */
  readonly textoVacio = input<string | null>(null);
  readonly elegir = output<string>();

  protected readonly abierta = signal(false);
  protected readonly busqueda = signal('');
  protected readonly resaltada = signal(0);

  /** Lo que se lee en el campo cerrado: la persona elegida, o "Todos". */
  protected readonly textoDelCampo = computed(() => {
    const elegida = this.opciones().find((o) => o.id === this.valor());
    return elegida?.nombre ?? this.textoVacio() ?? '';
  });

  /** La lista, ya filtrada; "Todos" primero (si existe y no se esta buscando). */
  protected readonly visibles = computed<OpcionDeEmpleado[]>(() => {
    const palabras = sinAcentos(this.busqueda().trim()).split(/\s+/).filter(Boolean);
    const coinciden = this.opciones().filter((o) => {
      const nombre = sinAcentos(o.nombre);
      return palabras.every((p) => nombre.includes(p));
    });
    const vacio = this.textoVacio();
    const lista = vacio !== null && palabras.length === 0 ? [{ id: '', nombre: vacio }, ...coinciden] : coinciden;
    return lista.slice(0, MAXIMO_VISIBLES);
  });

  protected abrir(): void {
    if (this.abierta()) return;
    this.busqueda.set('');
    this.resaltada.set(Math.max(0, this.visibles().findIndex((o) => o.id === this.valor())));
    this.abierta.set(true);
  }

  protected escribir(evento: Event): void {
    this.busqueda.set((evento.target as HTMLInputElement).value);
    this.resaltada.set(0);
    this.abierta.set(true);
  }

  protected tecla(evento: KeyboardEvent): void {
    const total = this.visibles().length;
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!this.abierta()) {
        this.abrir();
        return;
      }
      const paso = evento.key === 'ArrowDown' ? 1 : -1;
      this.resaltada.set(total === 0 ? 0 : (this.resaltada() + paso + total) % total);
    } else if (evento.key === 'Enter') {
      if (!this.abierta()) return;
      evento.preventDefault();
      const o = this.visibles()[this.resaltada()];
      if (o) this.escoger(o.id);
    } else if (evento.key === 'Escape' && this.abierta()) {
      evento.stopPropagation(); // que no cierre tambien la ventana donde esta
      this.cerrar();
    } else if (evento.key === 'Tab') {
      this.cerrar();
    }
  }

  protected escoger(id: string): void {
    this.cerrar();
    if (id !== this.valor()) this.elegir.emit(id);
  }

  protected quitar(): void {
    this.elegir.emit('');
  }

  private cerrar(): void {
    this.abierta.set(false);
    this.busqueda.set('');
  }

  /** Picar fuera la cierra sin cambiar nada. */
  @HostListener('document:mousedown', ['$event'])
  protected fuera(evento: MouseEvent): void {
    if (this.abierta() && !this.elemento.nativeElement.contains(evento.target as Node)) this.cerrar();
  }
}
