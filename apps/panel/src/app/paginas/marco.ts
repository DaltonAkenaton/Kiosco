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
 *  En celular (21-10-2026): el encabezado fijo se comia la cuarta parte de la
 *  pantalla. Ahi se esconden el subtitulo y el nombre de quien entro, el menu
 *  se desvanece a la derecha (pista de que hay mas) y la seccion abierta se
 *  recorre a la vista.
 *
 *  Tambien vigila la inactividad (servicios/inactividad.ts): avisa un minuto
 *  antes y cierra la sesion al vencer.
 */

import { Component, OnDestroy, OnInit, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Avisos } from '../servicios/avisos';
import { AvisosDelPanel } from '../servicios/avisos-del-panel';
import { Inactividad } from '../servicios/inactividad';
import { Pendientes } from '../servicios/pendientes';
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
            <p class="hidden text-sm opacity-80 sm:block">Panel administrativo</p>
          </div>
          <div class="flex items-center gap-4">
            @if (sesion.admin(); as a) {
              <span class="hidden text-right text-sm leading-tight sm:block">
                <b class="block text-base">{{ a.nombre }}</b>
                {{ a.rol === 'admin' ? 'Administrador' : 'Supervisor' }}
              </span>
            }
            <button type="button" class="boton-secundario" (click)="salir()">Salir</button>
          </div>
        </div>

        <nav class="contenedor menu-principal flex gap-1 overflow-x-auto pb-2">
          @for (s of secciones(); track s.ruta) {
            <a [routerLink]="s.ruta" routerLinkActive="activo" class="enlace-menu">
              {{ s.nombre }}
              <!-- Cuantas cosas hay que atender ahi (servicios/pendientes.ts y avisos-del-panel.ts). -->
              @if (s.pendientes > 0) {
                <span class="insignia-pendientes" [attr.aria-label]="s.pendientes + ' para atender'">{{ s.pendientes }}</span>
              }
            </a>
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

      <!-- Avisos breves de "listo" (servicios/avisos.ts). Los errores no van aqui. -->
      <div class="avisos-breves no-imprimir" aria-live="polite">
        @for (a of avisos.lista(); track a.id) {
          <div class="aviso-breve" role="status">
            <span aria-hidden="true" class="text-2xl leading-none">✔</span>
            <p class="flex-1">{{ a.texto }}</p>
            <button type="button" class="boton-secundario !px-3 !py-1 text-sm" (click)="avisos.quitar(a.id)">Cerrar</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class Marco implements OnInit, OnDestroy {
  protected readonly sesion = inject(Sesion);
  protected readonly inactividad = inject(Inactividad);
  protected readonly avisos = inject(Avisos);
  private readonly avisosDelPanel = inject(AvisosDelPanel);
  private readonly pendientes = inject(Pendientes);
  private readonly router = inject(Router);

  constructor() {
    // La sesion se cerro por fuera (otra pestaña, o Supabase ya no la
    // renueva): a la pantalla de entrada, en vez de quedarse con tablas vacias.
    effect(() => {
      if (!this.sesion.admin()) void this.router.navigateByUrl('/entrar');
    });
    // La seccion abierta, a la vista en el menu (en celular puede quedar fuera, a la derecha).
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) {
        setTimeout(() => document.querySelector('.menu-principal .activo')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }
    });
  }

  /** Accesos y Bitacora solo para el rol admin: la base tampoco se los deja a un supervisor. */
  protected readonly secciones = computed(() => [
    // Primero: es donde se abre el panel cuando hay algo que atender (0029).
    { ruta: '/pendientes', nombre: 'Pendientes', pendientes: this.pendientes.abiertos() },
    { ruta: '/asistencia', nombre: 'Asistencia', pendientes: this.avisosDelPanel.deAsistencia().length },
    { ruta: '/reportes', nombre: 'Reportes', pendientes: 0 },
    { ruta: '/empleados', nombre: 'Empleados', pendientes: 0 },
    { ruta: '/horarios', nombre: 'Horarios', pendientes: 0 },
    { ruta: '/ausencias', nombre: 'Incidencias', pendientes: 0 },
    { ruta: '/kioscos', nombre: 'Kioscos', pendientes: this.avisosDelPanel.deKioscos().length },
    { ruta: '/notas', nombre: 'Notas', pendientes: 0 },
    { ruta: '/configuracion', nombre: 'Configuración', pendientes: 0 },
    ...(this.sesion.esAdmin()
      ? [
          { ruta: '/accesos', nombre: 'Accesos', pendientes: 0 },
          { ruta: '/bitacora', nombre: 'Bitácora', pendientes: 0 },
        ]
      : []),
    { ruta: '/mi-cuenta', nombre: 'Mi cuenta', pendientes: 0 },
  ]);

  ngOnInit(): void {
    this.inactividad.iniciar(() => void this.salir('inactividad'));
    this.avisosDelPanel.iniciar();
    this.pendientes.iniciar();
  }

  ngOnDestroy(): void {
    this.inactividad.detener();
    this.avisosDelPanel.detener();
    this.pendientes.detener();
  }

  protected async salir(motivo: 'inactividad' | null = null): Promise<void> {
    this.inactividad.detener();
    await this.sesion.salir(motivo);
    await this.router.navigateByUrl('/entrar');
  }
}
