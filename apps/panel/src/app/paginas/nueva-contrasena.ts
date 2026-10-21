/**
 * ============================================================================
 *  PONER CONTRASENA NUEVA  (el enlace del correo "¿Olvidaste tu contraseña?")
 * ============================================================================
 *
 *  1. En "Entrar", la persona pide el correo (Sesion.pedirEnlaceDeContrasena).
 *  2. Supabase le manda un enlace de UN solo uso que abre esta pagina.
 *  3. supabase-js lee la llave que trae la direccion y abre una sesion.
 *  4. Aqui se pone la contrasena nueva y entra directo al panel.
 *
 *  Si el enlace ya se uso o vencio, no hay sesion: se explica y se ofrece
 *  volver a pedirlo. Para que el correo SALGA en la nube hay que configurar
 *  el Gmail del sistema en Supabase (docs/manual-tecnico.md).
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CampoContrasena } from '../componentes/campo-contrasena';
import { Sesion } from '../servicios/sesion';

@Component({
  selector: 'panel-nueva-contrasena',
  imports: [CampoContrasena],
  template: `
    <div class="flex min-h-full items-center justify-center p-6">
      <form
        class="bg-superficie border-borde flex w-full max-w-lg flex-col gap-5 rounded-3xl border-2 p-10"
        (submit)="$event.preventDefault(); guardar()"
      >
        <div>
          <h1 class="text-3xl font-bold">Contraseña nueva</h1>
          <p class="text-texto-suave mt-1 text-lg">Panel administrativo · Control de Asistencia</p>
        </div>

        @switch (estado()) {
          @case ('revisando') {
            <p class="text-lg">Revisando el enlace…</p>
          }
          @case ('sin-enlace') {
            <p class="aviso aviso-atencion">
              Este enlace ya no sirve: se usó antes o pasó demasiado tiempo. Vuelve a la pantalla de
              entrada, pica "¿Olvidaste tu contraseña?" y pide otro correo.
            </p>
            <button type="button" class="boton-principal text-xl" (click)="irAEntrar()">Ir a la pantalla de entrada</button>
          }
          @case ('formulario') {
            <label class="flex flex-col gap-2 text-lg">Contraseña nueva (al menos 8 letras o números)
              <panel-campo-contrasena [(valor)]="contrasena" />
            </label>
            <label class="flex flex-col gap-2 text-lg">Escríbela otra vez
              <panel-campo-contrasena [(valor)]="contrasena2" />
            </label>
            @if (error(); as mensaje) {
              <p class="aviso aviso-peligro font-bold">{{ mensaje }}</p>
            }
            <button type="submit" class="boton-principal text-xl" [disabled]="guardando() || !contrasena() || !contrasena2()">
              {{ guardando() ? 'Guardando…' : 'Guardar y entrar' }}
            </button>
          }
        }
      </form>
    </div>
  `,
})
export class NuevaContrasena implements OnInit {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly estado = signal<'revisando' | 'sin-enlace' | 'formulario'>('revisando');
  protected readonly contrasena = signal('');
  protected readonly contrasena2 = signal('');
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.estado.set((await this.sesion.haySesionDeRecuperacion()) ? 'formulario' : 'sin-enlace');
  }

  protected async guardar(): Promise<void> {
    this.error.set(null);
    if (this.contrasena().length < 8) {
      this.error.set('La contraseña debe tener al menos 8 letras o números.');
      return;
    }
    if (this.contrasena() !== this.contrasena2()) {
      this.error.set('Las dos contraseñas no son iguales. Escríbelas otra vez.');
      return;
    }
    this.guardando.set(true);
    const { error } = await this.sesion.bd.auth.updateUser({ password: this.contrasena() });
    if (error) {
      this.guardando.set(false);
      this.error.set(
        error.code === 'same_password'
          ? 'Es la misma contraseña que ya tenías. Si la recuerdas, entra con ella; si no, escribe otra.'
          : 'No se pudo guardar. Revisa el internet y vuelve a intentar.',
      );
      return;
    }
    const motivo = await this.sesion.terminarRecuperacion();
    this.guardando.set(false);
    this.contrasena.set('');
    this.contrasena2.set('');
    if (motivo) {
      this.error.set(motivo);
      return;
    }
    await this.router.navigateByUrl('/');
  }

  protected async irAEntrar(): Promise<void> {
    await this.router.navigateByUrl('/entrar');
  }
}
