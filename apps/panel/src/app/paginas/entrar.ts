/**
 * ============================================================================
 *  ENTRAR AL PANEL  (correo y contrasena de Supabase Auth)
 * ============================================================================
 *  Como el inicio de sesion del modo administrador del kiosco: letras
 *  grandes, boton "Mostrar" para ver lo escrito y aviso de mayusculas.
 *
 *  OJO: esta contrasena NO es la del modo administrador del kiosco. Son dos,
 *  a proposito (D-031). La pantalla lo dice, para que nadie las confunda.
 */

import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Ayuda } from '../componentes/ayuda';
import { Sesion } from '../servicios/sesion';

@Component({
  selector: 'panel-entrar',
  imports: [Ayuda],
  template: `
    <div class="flex min-h-full items-center justify-center p-6">
      <form
        class="bg-superficie border-borde flex w-full max-w-lg flex-col gap-5 rounded-3xl border-2 p-10"
        (submit)="$event.preventDefault(); entrar()"
      >
        <div>
          <h1 class="text-3xl font-bold">Panel administrativo</h1>
          <p class="text-texto-suave mt-1 text-lg">Control de Asistencia</p>
        </div>

        @if (sesion.motivoSalida() === 'inactividad') {
          <p class="aviso aviso-atencion">
            Tu sesión se cerró sola porque el panel estuvo un rato sin usarse. Es para proteger la
            computadora si se queda abierta. Vuelve a entrar.
          </p>
        }

        @if (!sesion.configurada) {
          <p class="rounded-xl px-4 py-3" style="background-color: rgb(234 179 8 / 0.14)">
            Este panel todavía no está conectado a la base de datos. Avisa a quien le da soporte al
            sistema.
          </p>
        }

        <label class="flex flex-col gap-2 text-lg">
          Correo
          <input class="campo text-xl" type="email" autocomplete="username" autofocus
                 [value]="correo()" (input)="correo.set(valor($event))" />
        </label>

        <label class="flex flex-col gap-2 text-lg">
          <span>
            Contraseña del panel
            <panel-ayuda titulo="¿Cuál contraseña?" [texto]="ayudaContrasena" alinear="izquierda" />
          </span>
          <span class="flex gap-2">
            <input class="campo min-w-0 flex-1 text-xl" autocomplete="current-password"
                   [type]="mostrar() ? 'text' : 'password'" [value]="contrasena()"
                   (input)="contrasena.set(valor($event))"
                   (keydown)="revisarMayusculas($event)" (keyup)="revisarMayusculas($event)" />
            <button type="button" class="boton-secundario" (click)="mostrar.set(!mostrar())">
              {{ mostrar() ? 'Ocultar' : 'Mostrar' }}
            </button>
          </span>
        </label>

        @if (mayusculas()) {
          <p class="font-bold" style="color: var(--kiosko-atencion)">⚠ Las MAYÚSCULAS están activadas.</p>
        }

        @if (error(); as mensaje) {
          <p class="rounded-xl px-4 py-3 font-bold" style="background-color: rgb(239 68 68 / 0.18); color: var(--kiosko-peligro)">
            {{ mensaje }}
          </p>
        }

        <button type="submit" class="boton-principal text-xl" [disabled]="entrando() || !correo() || !contrasena()">
          {{ entrando() ? 'Revisando…' : 'Entrar' }}
        </button>

        <!-- ¿Olvidaste tu contrasena? -->
        @if (!olvido()) {
          <button type="button" class="text-texto-suave self-center underline" (click)="abrirOlvido()">
            ¿Olvidaste tu contraseña?
          </button>
        } @else {
          <div class="border-borde flex flex-col gap-3 border-t-2 pt-4">
            @if (enlaceMandado()) {
              <p class="aviso aviso-bien">
                Listo. Si <b>{{ correo() }}</b> tiene acceso al panel, en unos minutos le llega un correo
                con un enlace para poner una contraseña nueva. Revisa también la carpeta de <b>spam</b>.
                El enlace sirve una sola vez y por poco tiempo.
              </p>
            } @else {
              <p>
                Escribe arriba tu correo y pica el botón. Te llega un correo con un enlace para poner una
                contraseña nueva.
                <panel-ayuda titulo="¿Y si no llega?" [texto]="ayudaOlvido" alinear="izquierda" />
              </p>
              <button type="button" class="boton-secundario" [disabled]="mandando() || !correo().includes('@')"
                      (click)="mandarEnlace()">
                {{ mandando() ? 'Mandando…' : 'Mandarme el correo para cambiarla' }}
              </button>
            }
          </div>
        }
      </form>
    </div>
  `,
})
export class Entrar {
  protected readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly correo = signal('');
  protected readonly contrasena = signal('');
  protected readonly mostrar = signal(false);
  protected readonly mayusculas = signal(false);
  protected readonly entrando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly ayudaContrasena =
    'Es la contraseña para entrar a esta página desde tu oficina. NO es la misma que usas en el ' +
    'modo administrador del kiosco: son dos distintas, a propósito, para que si alguien se roba ' +
    'la computadora del kiosco no pueda entrar aquí.';

  protected readonly olvido = signal(false);
  protected readonly mandando = signal(false);
  protected readonly enlaceMandado = signal(false);

  protected readonly ayudaOlvido =
    'Si en unos minutos no llega (ni en spam), pide a otro administrador que te dé una contraseña ' +
    'temporal desde Accesos. Si nadie más puede entrar, quien da soporte puede ponerte una desde ' +
    'la página de Supabase (manual técnico: "Nadie puede entrar al panel"). No se pierde ningún ' +
    'dato: sólo cambia la contraseña.';

  protected abrirOlvido(): void {
    this.olvido.set(true);
    this.error.set(null);
  }

  protected async mandarEnlace(): Promise<void> {
    this.mandando.set(true);
    this.error.set(null);
    const motivo = await this.sesion.pedirEnlaceDeContrasena(this.correo());
    this.mandando.set(false);
    if (motivo) this.error.set(motivo);
    else this.enlaceMandado.set(true);
  }

  protected async entrar(): Promise<void> {
    this.entrando.set(true);
    this.error.set(null);
    const motivo = await this.sesion.entrar(this.correo(), this.contrasena());
    this.contrasena.set('');
    this.entrando.set(false);
    if (motivo) {
      this.error.set(motivo);
      return;
    }
    await this.router.navigateByUrl('/asistencia');
  }

  protected revisarMayusculas(evento: KeyboardEvent): void {
    this.mayusculas.set(evento.getModifierState?.('CapsLock') ?? false);
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
