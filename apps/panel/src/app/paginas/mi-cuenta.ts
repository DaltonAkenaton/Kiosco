/**
 * ============================================================================
 *  MI CUENTA: las dos contrasenas del jefe  (D-031)
 * ============================================================================
 *
 *    - La del PANEL (esta pagina, desde su oficina): Supabase Auth.
 *    - La del MODO ADMINISTRADOR DEL KIOSCO (para ver las fotos alla): baja a
 *      cada kiosco con la sincronizacion, por eso es otra.
 *
 *  Son distintas a proposito: si alguien se roba la computadora de un kiosco,
 *  lo que se lleva no le sirve para entrar aqui.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { mensajeDeError } from '../componentes/dialogo';
import { Sesion } from '../servicios/sesion';

@Component({
  selector: 'panel-mi-cuenta',
  imports: [Ayuda],
  template: `
    <h1 class="text-2xl font-bold">Mi cuenta</h1>
    @if (sesion.admin(); as a) {
      <p class="text-texto-suave mt-1">{{ a.nombre }} · {{ a.correo }} · {{ a.rol === 'admin' ? 'Administrador' : 'Supervisor' }}</p>
    }

    @if (sesion.debeCambiarContrasena()) {
      <p class="mt-4 rounded-xl px-4 py-3 text-lg font-bold" style="background-color: rgb(245 158 11 / 0.18)">
        Entraste con una contraseña temporal. Ponte una propia aquí abajo, en "Contraseña de este panel", para poder usar el resto del panel.
      </p>
    }

    <div class="mt-6 grid gap-6 lg:grid-cols-2">
      <!-- ================= Contrasena del KIOSCO ================= -->
      <section class="bg-superficie border-borde flex flex-col gap-4 rounded-3xl border-2 p-6">
        <h2 class="text-xl font-bold">
          Entrar al modo administrador del kiosco
          <panel-ayuda titulo="¿Para qué es?" [texto]="AYUDA.kiosco" alinear="izquierda" />
        </h2>
        <p class="text-texto-suave">
          @if (usuarioKiosco()) {
            Tu usuario en el kiosco es <b class="text-texto font-mono">{{ usuarioKiosco() }}</b>. Aquí puedes cambiar la contraseña.
          } @else {
            Todavía no tienes usuario para el kiosco. Ponlo aquí para poder ver las fotos allá.
          }
        </p>
        <label class="flex flex-col gap-1">Usuario (sin espacios ni acentos)
          <input class="campo font-mono" [value]="usuario()" (input)="usuario.set(valor($event).toLowerCase())" />
        </label>
        <label class="flex flex-col gap-1">Contraseña nueva (al menos 8 letras o números)
          <input class="campo" type="password" autocomplete="new-password" [value]="contrasenaKiosco()" (input)="contrasenaKiosco.set(valor($event))" />
        </label>
        <label class="flex flex-col gap-1">Escríbela otra vez
          <input class="campo" type="password" autocomplete="new-password" [value]="contrasenaKiosco2()" (input)="contrasenaKiosco2.set(valor($event))" />
        </label>
        @if (mensajeKiosco(); as m) {
          <p class="font-bold" [style.color]="m.ok ? 'var(--kiosko-entrada)' : 'var(--kiosko-peligro)'">{{ m.texto }}</p>
        }
        <button type="button" class="boton-principal self-start" [disabled]="guardando()" (click)="guardarKiosco()">Guardar</button>
      </section>

      <!-- ================= Contrasena del PANEL ================= -->
      <section class="bg-superficie border-borde flex flex-col gap-4 rounded-3xl border-2 p-6">
        <h2 class="text-xl font-bold">Contraseña de este panel</h2>
        <p class="text-texto-suave">La que usas para entrar aquí desde tu oficina.</p>
        <label class="flex flex-col gap-1">Contraseña nueva (al menos 8 letras o números)
          <input class="campo" type="password" autocomplete="new-password" [value]="contrasenaPanel()" (input)="contrasenaPanel.set(valor($event))" />
        </label>
        <label class="flex flex-col gap-1">Escríbela otra vez
          <input class="campo" type="password" autocomplete="new-password" [value]="contrasenaPanel2()" (input)="contrasenaPanel2.set(valor($event))" />
        </label>
        @if (mensajePanel(); as m) {
          <p class="font-bold" [style.color]="m.ok ? 'var(--kiosko-entrada)' : 'var(--kiosko-peligro)'">{{ m.texto }}</p>
        }
        <button type="button" class="boton-principal self-start" [disabled]="guardando()" (click)="guardarPanel()">Cambiar contraseña</button>
      </section>
    </div>
  `,
})
export class MiCuenta implements OnInit {
  protected readonly sesion = inject(Sesion);

  protected readonly usuarioKiosco = signal<string | null>(null);
  protected readonly usuario = signal('');
  protected readonly contrasenaKiosco = signal('');
  protected readonly contrasenaKiosco2 = signal('');
  protected readonly contrasenaPanel = signal('');
  protected readonly contrasenaPanel2 = signal('');
  protected readonly guardando = signal(false);
  protected readonly mensajeKiosco = signal<{ ok: boolean; texto: string } | null>(null);
  protected readonly mensajePanel = signal<{ ok: boolean; texto: string } | null>(null);

  protected readonly AYUDA = {
    kiosco:
      'Con este usuario y contraseña entras al modo administrador EN el kiosco (el botón del engrane), ' +
      'que es el único lugar donde se pueden ver las fotos. Es distinta de la de este panel a propósito: ' +
      'si alguien se robara la computadora del kiosco, no podría usarla para entrar aquí. Llega a los ' +
      'kioscos en unos minutos, cuando tengan internet.',
  };

  async ngOnInit(): Promise<void> {
    const admin = this.sesion.admin();
    if (!admin) return;
    const { data } = await this.sesion.bd
      .from('administradores')
      .select('usuario_kiosco')
      .eq('user_id', admin.userId)
      .maybeSingle();
    this.usuarioKiosco.set(data?.usuario_kiosco ?? null);
    this.usuario.set(data?.usuario_kiosco ?? admin.correo.split('@')[0]?.toLowerCase().replace(/[^a-z0-9.]/g, '') ?? '');
  }

  protected async guardarKiosco(): Promise<void> {
    const admin = this.sesion.admin();
    if (!admin) return;
    if (this.contrasenaKiosco().length < 8) {
      this.mensajeKiosco.set({ ok: false, texto: 'La contraseña debe tener al menos 8 letras o números.' });
      return;
    }
    if (this.contrasenaKiosco() !== this.contrasenaKiosco2()) {
      this.mensajeKiosco.set({ ok: false, texto: 'Las dos no son iguales. Escríbelas otra vez.' });
      return;
    }
    this.guardando.set(true);
    const { error } = await this.sesion.bd.rpc('establecer_credenciales_kiosco', {
      p_user_id: admin.userId,
      p_usuario: this.usuario().trim(),
      p_contrasena: this.contrasenaKiosco(),
    });
    this.guardando.set(false);
    this.contrasenaKiosco.set('');
    this.contrasenaKiosco2.set('');
    if (error) {
      this.mensajeKiosco.set({ ok: false, texto: mensajeDeError(error) });
      return;
    }
    this.usuarioKiosco.set(this.usuario().trim());
    this.mensajeKiosco.set({ ok: true, texto: '✔ Guardada. Llega a los kioscos en unos minutos.' });
  }

  protected async guardarPanel(): Promise<void> {
    if (this.contrasenaPanel().length < 8) {
      this.mensajePanel.set({ ok: false, texto: 'La contraseña debe tener al menos 8 letras o números.' });
      return;
    }
    if (this.contrasenaPanel() !== this.contrasenaPanel2()) {
      this.mensajePanel.set({ ok: false, texto: 'Las dos no son iguales. Escríbelas otra vez.' });
      return;
    }
    this.guardando.set(true);
    const { error } = await this.sesion.bd.auth.updateUser({ password: this.contrasenaPanel() });
    this.guardando.set(false);
    this.contrasenaPanel.set('');
    this.contrasenaPanel2.set('');
    if (!error) await this.sesion.contrasenaCambiada();
    this.mensajePanel.set(
      error
        ? { ok: false, texto: 'No se pudo cambiar. Intenta con otra contraseña, más larga.' }
        : { ok: true, texto: '✔ Listo. La próxima vez entra con la nueva.' },
    );
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
