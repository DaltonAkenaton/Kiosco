/**
 * ============================================================================
 *  LA SESION DEL JEFE  (Supabase Auth, ARQUITECTURA.md 3.2)
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
import { hoyEn } from '@kiosko/compartido';
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

  /**
   * La direccion con la que se abrio la pagina, ANTES de que supabase-js la
   * limpie. Si el enlace del correo ya se uso o vencio, Supabase regresa aqui
   * con `error=...` (ver haySesionDeRecuperacion).
   */
  private readonly direccionInicial = typeof location === 'undefined' ? '' : location.hash + location.search;

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

  /** Dias que se guardan las fotos en el kiosco (Configuracion), para decirlo en los textos. */
  private readonly _diasRetencionFotos = signal(30);
  readonly diasRetencionFotos = this._diasRetencionFotos.asReadonly();

  /** La zona para mostrar horas. Baja de la tabla `configuracion` al entrar. */
  private readonly _zona = signal('America/Matamoros');
  readonly zona = this._zona.asReadonly();

  /**
   * Cuanto se desvia el reloj de ESTA computadora del de la base (ms).
   *
   * 20-10-2026: en la PC de la oficina, "actualizado a las" decia 13:01 a las
   * 12:01. Windows tenia la zona de Ciudad de Mexico y la hora adelantada a
   * mano para que "se viera bien": por dentro, el reloj estaba una hora
   * corrido. Las horas de los REGISTROS ya salian bien (vienen de la base);
   * lo que dependia del reloj de la PC ("hoy", "actualizado a las") no.
   * Al entrar se pregunta la hora a la base y todo lo de "ahora" usa esto.
   */
  private desfaseMs = 0;

  private iniciada: Promise<void> | null = null;

  constructor() {
    // La sesion se puede cerrar sin que esta pestaña haga nada: "Salir" en
    // otra pestaña, el cierre por inactividad de otra, o que Supabase ya no
    // acepte renovarla. Sin esto, la pagina seguia "abierta" mostrando tablas
    // vacias (RLS ya no entrega nada) y el jefe no sabia por que.
    // El marco lo ve y manda a la pantalla de entrada.
    if (this.configurada) {
      this.bd.auth.onAuthStateChange((evento) => {
        if (evento === 'SIGNED_OUT') this._admin.set(null);
      });
    }
  }

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

  /**
   * "¿Olvidaste tu contraseña?": Supabase manda un correo con un enlace de un
   * solo uso que abre /nueva-contrasena. Devuelve `null` si se pidio, o el
   * mensaje a mostrar si no.
   *
   * Nunca dice si el correo existe o no: responde lo mismo, para que nadie
   * use esta pantalla para averiguar que correos tienen acceso.
   */
  async pedirEnlaceDeContrasena(correo: string): Promise<string | null> {
    if (!this.configurada) return 'El panel todavía no está conectado a la base de datos. Avisa a soporte.';
    const { error } = await this.bd.auth.resetPasswordForEmail(correo.trim(), {
      redirectTo: `${location.origin}/nueva-contrasena`,
    });
    if (!error) return null;
    if (error.status === 429) {
      return 'Ya se pidieron varios correos hace poco. Espera un rato (hasta una hora) y vuelve a intentar.';
    }
    // Un correo que no existe NO da error; esto es falta de internet o de
    // configuracion del correo en Supabase (docs/manual-tecnico.md).
    return 'No se pudo mandar el correo. Revisa el internet; si sigue, avisa a soporte.';
  }

  /**
   * Al abrir el enlace del correo, supabase-js lee la llave que viene en la
   * direccion y abre una sesion de "recuperacion". Devuelve `true` si la hay.
   */
  async haySesionDeRecuperacion(): Promise<boolean> {
    if (!this.configurada) return false;
    // Enlace usado o vencido: aunque ya hubiera una sesion abierta en este
    // navegador, se dice que el enlace no sirve.
    if (/(^|[#&?])error=/.test(this.direccionInicial)) return false;
    const { data } = await this.bd.auth.getSession();
    if (!data.session) return false;
    // Cuenta como actividad: si no, el cierre por inactividad (que mira la
    // ultima vez que se uso el panel, quiza hace dias) la cerraria al entrar.
    Inactividad.marcarActividad();
    return true;
  }

  /**
   * Ya con la contrasena nueva puesta: revisa que sea administrador activo,
   * y quita la marca de "contrasena temporal" si la tenia.
   */
  async terminarRecuperacion(): Promise<string | null> {
    const { data } = await this.bd.auth.getUser();
    if (!data.user) return 'El enlace ya no sirve. Pide otro correo.';
    const motivo = await this.cargarAdministrador(data.user.id, data.user.email ?? '');
    if (motivo) {
      await this.bd.auth.signOut();
      return motivo;
    }
    if (this._debeCambiarContrasena()) await this.contrasenaCambiada();
    this.motivoSalida.set(null);
    this.iniciada = Promise.resolve();
    this._lista.set(true);
    return null;
  }

  /** Tras cambiar la contrasena del panel: ya no es temporal. */
  async contrasenaCambiada(): Promise<void> {
    await this.bd.rpc('contrasena_panel_cambiada');
    this._debeCambiarContrasena.set(false);
  }

  /** La hora de AHORA segun la base (no segun el reloj de esta PC), en ms. */
  ahora(): number {
    return Date.now() + this.desfaseMs;
  }

  /** La fecha de hoy en Nuevo Laredo ("2026-10-20"), con la hora de la base. */
  hoy(): string {
    return hoyEn(this._zona(), this.ahora());
  }

  /**
   * Pregunta la hora a la base y guarda la diferencia con este reloj. Se
   * descuenta la mitad de lo que tardo la respuesta (lo que tardo en volver).
   * Sin internet se queda con la que tenia: nunca impide nada.
   */
  private async medirReloj(): Promise<void> {
    const antes = Date.now();
    const { data, error } = await this.bd.rpc('hora_del_servidor');
    const despues = Date.now();
    if (error || typeof data !== 'string') return;
    const servidor = new Date(data).getTime();
    if (Number.isNaN(servidor)) return;
    this.desfaseMs = servidor - (antes + despues) / 2;
  }

  /** Un ajuste recien cambiado en Configuracion: que se note sin volver a entrar. */
  aplicarAjuste(clave: string, valor: unknown): void {
    if (clave === 'zona_horaria' && typeof valor === 'string') this._zona.set(valor);
    if (clave === 'minutos_inactividad_panel') Inactividad.fijarMinutos(Number(valor));
    if (clave === 'permitir_datos_demostracion') this._permiteDemostracion.set(Number(valor) === 1);
    if (clave === 'dias_retencion_fotos' && Number(valor) >= 1) this._diasRetencionFotos.set(Number(valor));
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
      .in('clave', ['zona_horaria', 'minutos_inactividad_panel', 'permitir_datos_demostracion', 'dias_retencion_fotos']);
    for (const { clave, valor } of ajustes ?? []) this.aplicarAjuste(clave, valor);
    await this.medirReloj();
    return null;
  }
}
