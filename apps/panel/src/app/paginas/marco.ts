/**
 * ============================================================================
 *  EL MARCO: encabezado con el menu, y abajo la seccion que toque
 * ============================================================================
 *  Menu con palabras, no con iconos (criterio del proyecto: "el usuario no
 *  sabe nada"), y siempre a la vista, sin menus escondidos.
 *
 *  Dos renglones a proposito: arriba el nombre del sistema y quien esta
 *  dentro (con Salir); abajo el menu. Antes iban en uno solo y, con tantas
 *  secciones, el nombre y "Salir" se caian a otro renglon como si fuera un
 *  error. En pantallas angostas (tablet) el menu se desliza de lado.
 *
 *  Tambien vigila la inactividad (servicios/inactividad.ts): avisa un minuto
 *  antes y cierra la sesion al vencer.
 */

import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Inactividad } from '../servicios/inactividad';
import { Sesion } from '../servicios/sesion';

@Component({
  selector: 'panel-marco',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-full flex-col">
      <header
        class="sticky top-0 z-40 border-b-4 shadow-lg"
        style="background-color: var(--kiosko-institucion-primario); border-color: var(--kiosko-institucion-secundario)"
      >
        <div class="contenedor flex items-center justify-between gap-4 pt-3 pb-2">
          <div class="leading-tight">
            <p class="text-lg font-bold">Control de Asistencia</p>
            <p class="text-sm opacity-80">Panel administrativo</p>
          </div>
          <div class="flex items-center gap-4">
            @if (sesion.admin(); as a) {
              <span class="text-right text-sm leading-tight">
                <b class="block text-base">{{ a.nombre }}</b>
                {{ a.rol === 'admin' ? 'Administrador' : 'Supervisor' }}
              </span>
            }
            <button type="button" class="boton-secundario" (click)="salir()">Salir</button>
          </div>
        </div>

        <nav class="contenedor menu-principal flex gap-1 overflow-x-auto pb-2">
          @for (s of secciones(); track s.ruta) {
            <a [routerLink]="s.ruta" routerLinkActive="activo" class="enlace-menu">{{ s.nombre }}</a>
          }
        </nav>
      </header>

      @if (inactividad.segundosRestantes(); as segundos) {
        <div class="aviso-flotante" role="alert">
          <p>
            <b>¿Sigues ahí?</b> Por seguridad, tu sesión se cerrará en
            <b class="tabular-nums">{{ segundos }}</b> segundos si no usas el panel.
          </p>
          <button type="button" class="boton-principal" (click)="inactividad.seguir()">Sigo aquí</button>
        </div>
      }

      <main class="contenedor flex-1 py-6">
        <router-outlet />
      </main>
    </div>
  `,
})
export class Marco implements OnInit, OnDestroy {
  protected readonly sesion = inject(Sesion);
  protected readonly inactividad = inject(Inactividad);
  private readonly router = inject(Router);

  /** Accesos y Bitacora solo para el rol admin: la base tampoco se los deja a un supervisor. */
  protected readonly secciones = computed(() => [
    { ruta: '/asistencia', nombre: 'Asistencia' },
    { ruta: '/reportes', nombre: 'Reportes' },
    { ruta: '/empleados', nombre: 'Empleados' },
    { ruta: '/horarios', nombre: 'Horarios' },
    { ruta: '/ausencias', nombre: 'Incidencias' },
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

  ngOnInit(): void {
    this.inactividad.iniciar(() => void this.salir('inactividad'));
  }

  ngOnDestroy(): void {
    this.inactividad.detener();
  }

  protected async salir(motivo: 'inactividad' | null = null): Promise<void> {
    this.inactividad.detener();
    await this.sesion.salir(motivo);
    await this.router.navigateByUrl('/entrar');
  }
}
