/**
 * ============================================================================
 *  LA SESION DEL JEFE  (Supabase Auth, CLAUDE.md 3.2)
 * ============================================================================
 *
 *  Entrar con correo y contrasena NO basta para usar el panel: ademas hay que
 *  estar en la tabla `administradores` y con `activo = true`. Asi, dar de baja
 *  a alguien es desactivar su fila, sin tener que borrar su cuenta.
 *
 *  Las reglas de verdad estan en la base (RLS): aunque alguien se saltara
 *  esta pantalla, la base no le daria ni un renglon. Esto solo sirve para
 *  mostrarle un mensaje claro en vez de tablas vacias.
 */

import { Injectable, computed, signal } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENTORNO } from '../../entorno/entorno';
import { Inactividad } from './inactividad';

export interface Administrador {
  userId: string;
  nombre: string;
  rol: 'admin' | 'supervisor';
  correo: string;
}

@Injectable({ providedIn: 'root' })
export class Sesion {
  /** `false` si no hay a que Supabase conectarse (produccion sin configurar). */
  readonly configurada = ENTORNO.supabaseUrl !== '' && ENTORNO.supabaseLlavePublica !== '';

  /** El cliente de Supabase. Con la llave PUBLICA: lo que se ve lo decide RLS. */
  readonly bd: SupabaseClient = createClient(
    ENTORNO.supabaseUrl || 'http://sin-configurar.invalid',
    ENTORNO.supabaseLlavePublica || 'sin-configurar',
  );

  private readonly _admin = signal<Administrador | null>(null);
  readonly admin = this._admin.asReadonly();
  readonly esAdmin = computed(() => this._admin()?.rol === 'admin');

  /** Entro con una contrasena temporal (la dio otro administrador): debe ponerse una propia. */
  private readonly _debeCambiarContrasena = signal(false);
  readonly debeCambiarContrasena = this._debeCambiarContrasena.asReadonly();

  /** `true` cuando ya se sabe si hay sesion o no (para no parpadear el login). */
  private readonly _lista = signal(false);
  readonly lista = this._lista.asReadonly();

  /** ¿Se permite generar datos de demostracion? (Configuracion, migracion 0018). */
  private readonly _permiteDemostracion = signal(false);
  readonly permiteDemostracion = this._permiteDemostracion.asReadonly();

  /** Por que se salio la ultima vez, para explicarlo en la pantalla de entrada. */
  readonly motivoSalida = signal<'inactividad' | null>(null);

  /** La zona para mostrar horas. Baja de la tabla `configuracion` al entrar. */
  private readonly _zona = signal('America/Matamoros');
  readonly zona = this._zona.asReadonly();

  private iniciada: Promise<void> | null = null;

  /** Revisa si ya habia una sesion abierta (por ejemplo, tras recargar la pagina). */
  iniciar(): Promise<void> {
    this.iniciada ??= (async () => {
      if (this.configurada) {
        const { data } = await this.bd.auth.getSession();
        if (data.session && Inactividad.vencida()) {
          // Se quedo abierta y sin uso mas del limite (por ejemplo, el
          // navegador cerrado toda la noche): se cierra antes de mostrar nada.
          await this.bd.auth.signOut();
          this.motivoSalida.set('inactividad');
        } else if (data.session) {
          await this.cargarAdministrador(data.session.user.id, data.session.user.email ?? '');
        }
      }
      this._lista.set(true);
    })();
    return this.iniciada;
  }

  /** Devuelve `null` si entro, o el mensaje a mostrar si no. */
  async entrar(correo: string, contrasena: string): Promise<string | null> {
    if (!this.configurada) return 'El panel todavía no está conectado a la base de datos. Avisa a soporte.';

    const { data, error } = await this.bd.auth.signInWithPassword({ email: correo.trim(), password: contrasena });
    if (error || !data.user) {
      // Un solo mensaje para correo o contrasena: decir cual fallo ayuda a
      // quien prueba correos, no a quien se equivoco de tecla.
      return error?.status === 400 || error?.status === 401
        ? 'Correo o contraseña incorrectos. Revisa las mayúsculas y vuelve a intentar.'
        : 'No hay conexión con la base de datos. Revisa el internet y vuelve a intentar.';
    }

    const motivo = await this.cargarAdministrador(data.user.id, data.user.email ?? '');
    if (motivo) {
      await this.bd.auth.signOut();
      return motivo;
    }
    Inactividad.marcarActividad();
    this.motivoSalida.set(null);
    return null;
  }

  /** Tras cambiar la contrasena del panel: ya no es temporal. */
  async contrasenaCambiada(): Promise<void> {
    await this.bd.rpc('contrasena_panel_cambiada');
    this._debeCambiarContrasena.set(false);
  }

  /** Un ajuste recien cambiado en Configuracion: que se note sin volver a entrar. */
  aplicarAjuste(clave: string, valor: unknown): void {
    if (clave === 'zona_horaria' && typeof valor === 'string') this._zona.set(valor);
    if (clave === 'minutos_inactividad_panel') Inactividad.fijarMinutos(Number(valor));
    if (clave === 'permitir_datos_demostracion') this._permiteDemostracion.set(Number(valor) === 1);
  }

  async salir(motivo: 'inactividad' | null = null): Promise<void> {
    await this.bd.auth.signOut();
    this._admin.set(null);
    this.motivoSalida.set(motivo);
  }

  /** Busca su fila en `administradores`. Devuelve el motivo si no puede entrar. */
  private async cargarAdministrador(userId: string, correo: string): Promise<string | null> {
    const { data, error } = await this.bd
      .from('administradores')
      .select('user_id, nombre, rol, activo, debe_cambiar_contrasena')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      this._admin.set(null);
      return 'No se pudo revisar tu permiso. Intenta de nuevo en un momento.';
    }
    if (!data || !data.activo) {
      this._admin.set(null);
      return data
        ? 'Tu acceso al panel está dado de baja. Si es un error, pide a un administrador que lo reactive.'
        : 'Esta cuenta no tiene permiso para usar el panel. Pide a un administrador que te dé acceso.';
    }

    this._admin.set({ userId: data.user_id, nombre: data.nombre, rol: data.rol, correo });
    this._debeCambiarContrasena.set(data.debe_cambiar_contrasena === true);

    const { data: ajustes } = await this.bd
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['zona_horaria', 'minutos_inactividad_panel', 'permitir_datos_demostracion']);
    for (const { clave, valor } of ajustes ?? []) {
      if (clave === 'zona_horaria' && typeof valor === 'string') this._zona.set(valor);
      if (clave === 'minutos_inactividad_panel') Inactividad.fijarMinutos(Number(valor));
      if (clave === 'permitir_datos_demostracion') this._permiteDemostracion.set(Number(valor) === 1);
    }
    return null;
  }
}
