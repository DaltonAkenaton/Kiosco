/**
 * ============================================================================
 *  ACCESOS AL PANEL: quien puede entrar aqui  (migracion 0017)
 * ============================================================================
 *
 *  Solo para el rol admin. Dar acceso a alguien nuevo crea su cuenta con una
 *  contrasena temporal (la inventa el sistema, igual que el PIN de los
 *  empleados) que se muestra UNA vez. Al entrar la primera vez, el panel lo
 *  manda a "Mi cuenta" a ponerse una propia.
 *
 *  Crear la cuenta lo hace la Edge Function `administradores`, porque
 *  necesita la llave service_role, que nunca va en el navegador. Cambiar el
 *  rol o dar de baja lo hace la base directo (`cambiar_administrador`).
 *
 *  Nadie se cambia a si mismo, y siempre queda al menos un administrador:
 *  asi nadie deja el sistema sin dueño por un clic.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { CargandoTabla, RENGLONES_CARGANDO } from '../componentes/cargando-tabla';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { Avisos } from '../servicios/avisos';
import { Sesion } from '../servicios/sesion';

interface Acceso {
  user_id: string;
  nombre: string;
  correo: string | null;
  rol: 'admin' | 'supervisor';
  activo: boolean;
  usuario_kiosco: string | null;
  debe_cambiar_contrasena: boolean;
}

type Accion =
  | { tipo: 'nuevo' }
  | { tipo: 'rol'; acceso: Acceso }
  | { tipo: 'estado'; acceso: Acceso }
  | { tipo: 'contrasena'; acceso: Acceso };

@Component({
  selector: 'panel-accesos',
  imports: [Ayuda, CargandoTabla, Dialogo],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Accesos al panel</h1>
        <p class="text-texto-suave mt-1">
          Quién puede entrar a este panel y qué puede hacer.
          <panel-ayuda titulo="Administrador y supervisor" [texto]="AYUDA.roles" alinear="izquierda" />
        </p>
      </div>
      <button type="button" class="boton-principal" (click)="abrir({ tipo: 'nuevo' })">+ Dar acceso a alguien</button>
    </div>

    @if (error(); as mensaje) {
      <p class="mt-4 font-bold" style="color: var(--kiosko-peligro)">{{ mensaje }}</p>
    }

    <div class="tabla-desplazable mt-4">
    <table class="w-full border-collapse text-left">
      <thead>
        <tr class="text-texto-suave border-borde border-b text-sm uppercase tracking-wide">
          <th class="py-2 pr-4">Nombre</th>
          <th class="py-2 pr-4">Correo</th>
          <th class="py-2 pr-4">Puede</th>
          <th class="py-2 pr-4">Kiosco <panel-ayuda titulo="Usuario del kiosco" [texto]="AYUDA.kiosco" /></th>
          <th class="py-2 pr-4">Estado</th>
          <th class="py-2">Acciones</th>
        </tr>
      </thead>
      <tbody>
        @if (cargando()) {
          @for (r of RENGLONES_CARGANDO; track r) {
            <tr panel-cargando-tabla [columnas]="6"></tr>
          }
        }
        @for (a of accesos(); track a.user_id) {
          <tr class="border-borde border-b" [class.opacity-60]="!a.activo">
            <td class="py-2 pr-4 font-semibold">{{ a.nombre }} @if (a.user_id === sesion.admin()?.userId) { <span class="text-texto-suave">(tú)</span> }</td>
            <td class="py-2 pr-4">{{ a.correo ?? '—' }}</td>
            <td class="py-2 pr-4">{{ a.rol === 'admin' ? 'Todo (administrador)' : 'Consultar y registrar a mano (supervisor)' }}</td>
            <td class="py-2 pr-4 font-mono">{{ a.usuario_kiosco ?? '—' }}</td>
            <td class="py-2 pr-4">
              @if (!a.activo) {
                <span style="color: var(--kiosko-peligro)">Sin acceso</span>
              } @else if (a.debe_cambiar_contrasena) {
                Todavía con contraseña temporal
              } @else {
                Activo
              }
            </td>
            <td class="py-2">
              @if (a.user_id !== sesion.admin()?.userId) {
                <div class="flex flex-wrap gap-2">
                  @if (a.activo) {
                    <button type="button" class="boton-secundario !px-3 !py-1" (click)="abrir({ tipo: 'rol', acceso: a })">
                      {{ a.rol === 'admin' ? 'Hacer supervisor' : 'Hacer administrador' }}
                    </button>
                    <button type="button" class="boton-secundario !px-3 !py-1" (click)="abrir({ tipo: 'contrasena', acceso: a })">Contraseña nueva</button>
                  }
                  <button type="button" class="boton-secundario !px-3 !py-1" (click)="abrir({ tipo: 'estado', acceso: a })">
                    {{ a.activo ? 'Quitar acceso' : 'Devolver acceso' }}
                  </button>
                </div>
              } @else {
                <span class="text-texto-suave text-sm">Lo tuyo se cambia en "Mi cuenta"</span>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
    </div>

    @if (accion(); as ac) {
      @switch (ac.tipo) {
        @case ('nuevo') {
          <panel-dialogo titulo="Dar acceso al panel" textoBoton="Dar acceso" ejemploMotivo="Ej.: nueva jefa del turno nocturno"
                         [ocupado]="guardando()" [error]="errorAccion()" (confirmar)="crear($event)" (cancelar)="cerrar()">
            <label class="flex flex-col gap-1">Nombre completo
              <input class="campo" [value]="nombre()" (input)="nombre.set(valor($event))" />
            </label>
            <label class="flex flex-col gap-1">Correo (con el que va a entrar)
              <input class="campo" type="email" [value]="correo()" (input)="correo.set(valor($event))" />
            </label>
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-1">¿Qué puede hacer? <panel-ayuda titulo="Administrador y supervisor" [texto]="AYUDA.roles" alinear="izquierda" /></legend>
              <label class="flex items-center gap-2"><input type="radio" name="rol" class="h-5 w-5" [checked]="rol() === 'supervisor'" (change)="rol.set('supervisor')" /> Supervisor: consultar y registrar asistencia a mano</label>
              <label class="flex items-center gap-2"><input type="radio" name="rol" class="h-5 w-5" [checked]="rol() === 'admin'" (change)="rol.set('admin')" /> Administrador: todo, incluso cambiar reglas y dar accesos</label>
            </fieldset>
            <p class="text-texto-suave text-base">El sistema le da una contraseña temporal. Te la muestra una sola vez; al entrar, tendrá que ponerse una propia.</p>
          </panel-dialogo>
        }
        @case ('rol') {
          <panel-dialogo [titulo]="(ac.acceso.rol === 'admin' ? 'Hacer supervisor a ' : 'Hacer administrador a ') + ac.acceso.nombre"
                         textoBoton="Cambiar" [ocupado]="guardando()" [error]="errorAccion()"
                         (confirmar)="cambiar(ac.acceso, ac.acceso.rol === 'admin' ? 'supervisor' : 'admin', true, $event)" (cancelar)="cerrar()">
            @if (ac.acceso.rol === 'admin') {
              <p>Podrá seguir consultando y registrando asistencia a mano, pero ya no cambiar reglas, empleados ni accesos.</p>
            } @else {
              <p>Podrá hacer todo: cambiar la configuración, dar de alta empleados, revocar kioscos y dar acceso a otros.</p>
            }
          </panel-dialogo>
        }
        @case ('estado') {
          <panel-dialogo [titulo]="(ac.acceso.activo ? 'Quitar el acceso a ' : 'Devolver el acceso a ') + ac.acceso.nombre"
                         [textoBoton]="ac.acceso.activo ? 'Quitar acceso' : 'Devolver acceso'" [peligro]="ac.acceso.activo"
                         [ocupado]="guardando()" [error]="errorAccion()"
                         (confirmar)="cambiar(ac.acceso, ac.acceso.rol, !ac.acceso.activo, $event)" (cancelar)="cerrar()">
            @if (ac.acceso.activo) {
              <p>Ya no podrá entrar a este panel ni al modo administrador de los kioscos (en cuanto sincronicen). <b>No se borra nada:</b> lo que hizo sigue en la bitácora.</p>
            } @else {
              <p>Podrá volver a entrar con su contraseña de antes. Si no la recuerda, usa "Contraseña nueva".</p>
            }
          </panel-dialogo>
        }
        @case ('contrasena') {
          <panel-dialogo [titulo]="'Contraseña nueva para ' + ac.acceso.nombre" textoBoton="Dar contraseña nueva"
                         ejemploMotivo="Ej.: olvidó su contraseña del panel" [ocupado]="guardando()" [error]="errorAccion()"
                         (confirmar)="restablecer(ac.acceso, $event)" (cancelar)="cerrar()">
            <p>La que tenía deja de servir. El sistema le da una temporal y te la muestra una sola vez.</p>
            <p class="text-texto-suave">Esto es sólo para el panel. La contraseña del kiosco la pone cada quien en "Mi cuenta".</p>
          </panel-dialogo>
        }
      }
    }

    @if (entregar(); as e) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-6" style="background-color: rgb(0 0 0 / 0.8)">
        <div class="ventana bg-superficie border-borde hoja-de-pines flex w-full max-w-xl flex-col gap-4 rounded-3xl border-2 p-8">
          <h2 class="text-2xl font-bold">Contraseña temporal</h2>
          <p class="no-imprimir text-lg"><b>Anótala o imprímela ahora:</b> no se vuelve a mostrar. Entrégala en persona.</p>
          <p>Panel: <b>{{ direccion }}</b></p>
          <p>Correo: <b>{{ e.correo }}</b></p>
          <p>Contraseña: <b class="font-mono text-3xl tracking-widest">{{ e.contrasena }}</b></p>
          <p class="text-texto-suave">Al entrar la primera vez, el panel pedirá cambiarla por una propia.</p>
          <div class="no-imprimir flex gap-3">
            <button type="button" class="boton-principal" (click)="imprimir()">Imprimir</button>
            <button type="button" class="boton-secundario" (click)="entregar.set(null)">Ya la anoté, cerrar</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class Accesos implements OnInit {
  protected readonly sesion = inject(Sesion);

  protected readonly accesos = signal<Acceso[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly accion = signal<Accion | null>(null);
  private readonly avisos = inject(Avisos);
  protected readonly cargando = signal(true);
  protected readonly RENGLONES_CARGANDO = RENGLONES_CARGANDO;
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly entregar = signal<{ correo: string; contrasena: string } | null>(null);

  protected readonly nombre = signal('');
  protected readonly correo = signal('');
  protected readonly rol = signal<'admin' | 'supervisor'>('supervisor');

  protected readonly direccion = location.origin;

  protected readonly AYUDA = {
    roles:
      'Un SUPERVISOR puede ver toda la asistencia, los reportes y los kioscos, y registrar asistencia a ' +
      'mano. Un ADMINISTRADOR además puede cambiar la configuración, dar de alta empleados, revocar ' +
      'kioscos y dar acceso a otras personas. Conviene que haya pocos administradores.',
    kiosco:
      'El usuario con que esa persona entra al modo administrador del kiosco (para ver fotos). Cada quien ' +
      'lo pone en su "Mi cuenta". Si dice "—", todavía no puede entrar al kiosco.',
  };

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const { data, error } = await this.sesion.bd
      .from('administradores')
      .select('user_id, nombre, correo, rol, activo, usuario_kiosco, debe_cambiar_contrasena')
      .order('activo', { ascending: false })
      .order('nombre');
    this.cargando.set(false);
    if (error) {
      this.error.set('No se pudo traer la lista. Revisa el internet y vuelve a intentar.');
      return;
    }
    this.accesos.set(data as Acceso[]);
  }

  protected abrir(accion: Accion): void {
    this.errorAccion.set(null);
    if (accion.tipo === 'nuevo') {
      this.nombre.set('');
      this.correo.set('');
      this.rol.set('supervisor');
    }
    this.accion.set(accion);
  }

  protected cerrar(): void {
    if (!this.guardando()) this.accion.set(null);
  }

  /** Llama a la Edge Function y devuelve su respuesta, o deja el error escrito. */
  private async pedirAlServidor(cuerpo: Record<string, unknown>): Promise<Record<string, string> | null> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { data, error } = await this.sesion.bd.functions.invoke('administradores', { body: cuerpo });
    this.guardando.set(false);
    if (error) {
      // El mensaje para personas viene en el cuerpo de la respuesta.
      let mensaje = 'No se pudo. Revisa el internet y vuelve a intentar; si sigue, avisa a soporte.';
      try {
        const respuesta = (error as { context?: Response }).context;
        const json = respuesta ? await respuesta.json() : null;
        if (typeof json?.mensaje === 'string') mensaje = json.mensaje;
      } catch {
        // sin cuerpo: se queda el mensaje general
      }
      this.errorAccion.set(mensaje);
      return null;
    }
    return data as Record<string, string>;
  }

  protected async crear(motivo: string): Promise<void> {
    const correo = this.correo().trim().toLowerCase();
    if (this.nombre().trim().length < 3) {
      this.errorAccion.set('Escribe el nombre completo.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      this.errorAccion.set('Ese correo no parece válido.');
      return;
    }
    const r = await this.pedirAlServidor({ accion: 'crear', correo, nombre: this.nombre().trim(), rol: this.rol(), motivo });
    if (!r?.['contrasenaTemporal']) return;
    this.accion.set(null);
    this.entregar.set({ correo, contrasena: r['contrasenaTemporal'] });
    await this.cargar();
  }

  protected async restablecer(acceso: Acceso, motivo: string): Promise<void> {
    const r = await this.pedirAlServidor({ accion: 'restablecer', userId: acceso.user_id, motivo });
    if (!r?.['contrasenaTemporal']) return;
    this.accion.set(null);
    this.entregar.set({ correo: acceso.correo ?? acceso.nombre, contrasena: r['contrasenaTemporal'] });
    await this.cargar();
  }

  protected async cambiar(acceso: Acceso, rol: string, activo: boolean, motivo: string): Promise<void> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await this.sesion.bd.rpc('cambiar_administrador', {
      p_user_id: acceso.user_id, p_rol: rol, p_activo: activo, p_motivo: motivo,
    });
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    this.accion.set(null);
    this.avisos.exito(
      !activo ? `${acceso.nombre} ya no puede entrar al panel.`
        : !acceso.activo ? `${acceso.nombre} puede volver a entrar.`
          : `${acceso.nombre} ahora es ${rol === 'admin' ? 'administrador' : 'supervisor'}.`,
    );
    await this.cargar();
  }

  protected imprimir(): void {
    window.print();
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
