/**
 * ============================================================================
 *  EL MARCO: encabezado con el menu, y abajo la seccion que toque
 * ============================================================================
 *  Menu con palabras, no con iconos (criterio del proyecto: "el usuario no
 *  sabe nada"), y siempre a la vista, sin menus escondidos.
 */

import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Sesion } from '../servicios/sesion';

@Component({
  selector: 'panel-marco',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-full flex-col">
      <header
        class="flex flex-wrap items-center gap-x-8 gap-y-2 border-b-4 px-6 py-3"
        style="background-color: var(--kiosko-institucion-primario); border-color: var(--kiosko-institucion-secundario)"
      >
        <div>
          <p class="text-lg font-bold">Control de Asistencia</p>
          <p class="text-sm opacity-80">Panel administrativo</p>
        </div>

        <nav class="flex flex-wrap gap-2">
          @for (s of secciones(); track s.ruta) {
            <a
              [routerLink]="s.ruta"
              routerLinkActive="bg-fondo font-bold"
              class="rounded-lg px-4 py-2 text-base hover:bg-fondo/60"
            >
              {{ s.nombre }}
            </a>
          }
        </nav>

        <div class="ml-auto flex items-center gap-4">
          @if (sesion.admin(); as a) {
            <span class="text-right text-sm">
              <b class="block text-base">{{ a.nombre }}</b>
              {{ a.rol === 'admin' ? 'Administrador' : 'Supervisor' }}
            </span>
          }
          <button type="button" class="boton-secundario" (click)="salir()">Salir</button>
        </div>
      </header>

      <main class="flex-1 px-6 py-5">
        <router-outlet />
      </main>
    </div>
  `,
})
export class Marco {
  protected readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  /** Bitacora solo para el rol admin: la RLS no se la deja leer a un supervisor. */
  protected readonly secciones = computed(() => [
    { ruta: '/asistencia', nombre: 'Asistencia' },
    { ruta: '/reportes', nombre: 'Reportes' },
    { ruta: '/empleados', nombre: 'Empleados' },
    { ruta: '/horarios', nombre: 'Horarios' },
    { ruta: '/ausencias', nombre: 'Ausencias' },
    { ruta: '/kioscos', nombre: 'Kioscos' },
    { ruta: '/configuracion', nombre: 'Configuración' },
    ...(this.sesion.esAdmin()
      ? [
          { ruta: '/accesos', nombre: 'Accesos' },
          { ruta: '/bitacora', nombre: 'Bitácora' },
        ]
      : []),
    { ruta: '/mi-cuenta', nombre: 'Mi cuenta' },
  ]);

  protected async salir(): Promise<void> {
    await this.sesion.salir();
    await this.router.navigateByUrl('/entrar');
  }
}
