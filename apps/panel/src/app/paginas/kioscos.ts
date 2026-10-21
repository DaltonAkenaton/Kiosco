/**
 * ============================================================================
 *  KIOSCOS: como esta cada uno  (CLAUDE.md 7 "heartbeat", 10)
 * ============================================================================
 *
 *  Lo que cada kiosco reporta en su latido: ultima conexion, camara,
 *  registros sin enviar, version y desfase del reloj. Con alertas arriba para
 *  lo que hay que atender: un kiosco que no se reporta, una camara caida,
 *  fotos que faltan o se alteraron.
 *
 *  Tambien: dar de alta uno nuevo (codigo de 8 caracteres, CLAUDE.md 3.3) y
 *  dar de baja uno (revocar), ambos solo el rol admin.
 */

import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { Avisos } from '../servicios/avisos';
import { AvisosDelPanel } from '../servicios/avisos-del-panel';
import { Sesion } from '../servicios/sesion';
import { fecha, haceCuanto, hora } from '../textos';

interface Kiosco {
  id: string;
  nombre: string;
  ubicacion: string;
  activo: boolean;
  enrolado_en: string;
  revocado_en: string | null;
  ultima_conexion: string | null;
  version_app: string | null;
  camara_ok: boolean | null;
  camara_caida_desde: string | null;
  pendientes: number;
  desfase_reloj_ms: number | null;
}

/** Cada cuanto se refresca la pagina sola, para que la "ultima conexion" no mienta. */
const SEGUNDOS_PARA_REFRESCAR = 60;

/** Cuantos dias hacia atras se muestra "Lo que se hizo en los kioscos". */
const DIAS_ACTIVIDAD = 30;
const MAXIMO_ACTIVIDAD = 30;

/** Los eventos que se muestran, en palabras. Los demas (camara, pausa...) ya salen en las alertas. */
const TEXTOS_DE_ACTIVIDAD: Record<string, (quien: string, d: Record<string, unknown>) => string> = {
  registros_descartados: (quien, d) =>
    `${quien} descartó ${d['cantidad'] ?? '?'} registro(s) que la oficina no había aceptado. Motivo: «${d['motivo'] ?? 'sin motivo'}».`,
  exportacion_usb: (quien, d) =>
    `${quien} guardó ${d['registros'] ?? '?'} registro(s) y ${d['fotos'] ?? 0} foto(s) en una memoria USB.`,
  fotos_recuperadas: (quien, d) =>
    `${quien} recuperó ${d['recuperadas'] ?? '?'} foto(s) con la contraseña de recuperación.`,
  modo_admin_bloqueado: () => 'Varios intentos fallidos seguidos de entrar al modo administrador: se bloqueó un rato.',
  llave_fotos_reemplazada: () =>
    'La llave de las fotos de este kiosco no se pudo abrir (¿se reinstaló Windows?) y se creó una nueva. Las fotos anteriores necesitan la contraseña de recuperación.',
};

@Component({
  selector: 'panel-kioscos',
  imports: [Ayuda, Dialogo],
  templateUrl: './kioscos.html',
})
export class Kioscos implements OnInit, OnDestroy {
  protected readonly sesion = inject(Sesion);
  private readonly avisos = inject(Avisos);
  protected readonly avisosDelPanel = inject(AvisosDelPanel);
  protected readonly zona = this.sesion.zona;
  protected readonly cargando = signal(true);

  protected readonly kioscos = signal<Kiosco[]>([]);
  protected readonly fotosPorRevisar = signal<Map<string, number>>(new Map());
  /** "Lo que se hizo en los kioscos": eventos que el jefe debe poder ver. */
  protected readonly actividad = signal<{ id: string; kiosco: string; ocurrido_en: string; texto: string }[]>([]);
  protected readonly DIAS_ACTIVIDAD = DIAS_ACTIVIDAD;
  protected readonly AYUDA_ACTIVIDAD =
    'Lo que alguien hizo en el modo administrador de un kiosco y que conviene saber desde aquí: ' +
    'descartar registros que la oficina no aceptó, guardar fotos en una memoria USB o recuperar fotos ' +
    'con la contraseña de recuperación. Queda anotado quién, cuándo y (si lo pidió) el motivo.';
  protected readonly minutosSinConexion = signal(60);
  /**
   * PC compartida (ajuste "kiosco_pc_compartida", 0026): el kiosco se cierra
   * al terminar de checar, asi que "no se reporta" es lo normal y NO es alerta.
   */
  protected readonly pcCompartida = signal(true);
  protected readonly ahora = signal(this.sesion.ahora());
  protected readonly error = signal<string | null>(null);

  protected readonly fecha = fecha;
  protected readonly hora = hora;
  protected readonly haceCuanto = haceCuanto;

  private temporizador: ReturnType<typeof setInterval> | null = null;

  // --- Dar de alta ---
  protected readonly dandoDeAlta = signal(false);
  protected readonly nombreNuevo = signal('');
  protected readonly ubicacionNueva = signal('');
  protected readonly codigo = signal<{ codigo: string; expira: string; nombre: string } | null>(null);

  // --- Dar de baja ---
  protected readonly porRevocar = signal<Kiosco | null>(null);

  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  protected readonly AYUDA = {
    ultimaConexion:
      'Cada minuto, cada kiosco avisa "sigo aquí". Si pasa mucho tiempo sin avisar, puede estar apagado, ' +
      'sin internet o descompuesto. Mientras tanto sigue guardando registros y los manda cuando vuelva.',
    porEnviar:
      'Registros que el kiosco ya guardó pero todavía no manda a la oficina. Si este número crece y no ' +
      'baja, el kiosco lleva rato sin internet.',
    desfase:
      'Cuánto se adelanta o atrasa el reloj de la computadora del kiosco. El sistema lo corrige solo; si es ' +
      'de muchos minutos, conviene revisar la hora de esa computadora.',
    fotos:
      'Fotos que deberían estar en ese kiosco y no están, o que alguien modificó. Hay que ir al kiosco a ' +
      'revisar y avisar a quien le da soporte al sistema.',
  };

  /**
   * Lo que hay que atender, en palabras. Sale de `avisos_del_panel()` (0028)
   * por el servicio AvisosDelPanel: la misma lista que el numero del menu, para
   * que nunca digan cosas distintas. Las reglas (minutos de camara caida,
   * PC compartida, camara que falla a ratos) viven en la base.
   */
  protected readonly alertas = this.avisosDelPanel.deKioscos;

  async ngOnInit(): Promise<void> {
    await this.cargar();
    // Con la pestaña escondida (otra pestaña al frente) no se pregunta: nadie esta viendo.
    this.temporizador = setInterval(() => {
      if (!document.hidden) void this.cargar();
    }, SEGUNDOS_PARA_REFRESCAR * 1000);
  }

  ngOnDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** El boton "Actualizar": no esperar al minuto. */
  protected readonly actualizando = signal(false);

  protected async actualizar(): Promise<void> {
    this.actualizando.set(true);
    await Promise.all([this.cargar(), this.avisosDelPanel.actualizar()]);
    this.actualizando.set(false);
  }

  private async cargar(): Promise<void> {
    void this.cargarActividad();
    void this.avisosDelPanel.actualizar();
    const [kioscos, fotos, config] = await Promise.all([
      this.sesion.bd
        .from('dispositivos')
        .select(
          'id, nombre, ubicacion, activo, enrolado_en, revocado_en, ultima_conexion, version_app, camara_ok, camara_caida_desde, pendientes, desfase_reloj_ms',
        )
        .order('activo', { ascending: false })
        .order('nombre'),
      this.sesion.bd.from('fotos_por_revisar').select('dispositivo_id, casos'),
      this.sesion.bd
        .from('configuracion')
        .select('clave, valor')
        .in('clave', ['minutos_kiosco_sin_conexion_alerta', 'kiosco_pc_compartida']),
    ]);
    this.cargando.set(false);
    if (kioscos.error) {
      this.error.set('No se pudo traer la lista de kioscos. Revisa el internet.');
      return;
    }
    this.error.set(null);
    this.kioscos.set(kioscos.data as Kiosco[]);
    this.fotosPorRevisar.set(new Map((fotos.data ?? []).map((f) => [f.dispositivo_id as string, Number(f.casos)])));
    for (const c of config.data ?? []) {
      if (c.clave === 'minutos_kiosco_sin_conexion_alerta' && typeof c.valor === 'number') this.minutosSinConexion.set(c.valor);
      if (c.clave === 'kiosco_pc_compartida') this.pcCompartida.set(Number(c.valor) === 1);
    }
    this.ahora.set(this.sesion.ahora());
  }

  private async cargarActividad(): Promise<void> {
    const desde = new Date(this.sesion.ahora() - DIAS_ACTIVIDAD * 24 * 60 * 60 * 1000).toISOString();
    const [eventos, admins] = await Promise.all([
      this.sesion.bd
        .from('eventos_dispositivo')
        .select('id, tipo, detalle, ocurrido_en, dispositivo:dispositivos(nombre)')
        .in('tipo', Object.keys(TEXTOS_DE_ACTIVIDAD))
        .gte('ocurrido_en', desde)
        .order('ocurrido_en', { ascending: false })
        .limit(MAXIMO_ACTIVIDAD),
      this.sesion.bd.from('administradores').select('user_id, nombre'),
    ]);
    if (eventos.error) return; // es informacion de apoyo: sin ella, la pagina sigue igual
    const nombres = new Map((admins.data ?? []).map((a) => [a.user_id as string, a.nombre as string]));
    this.actividad.set(
      (eventos.data ?? []).map((e) => {
        const detalle = (e.detalle ?? {}) as Record<string, unknown>;
        const quien = nombres.get(String(detalle['adminId'] ?? '')) ?? 'Un administrador';
        const kiosco = (e.dispositivo as unknown as { nombre: string } | null)?.nombre ?? 'Kiosco';
        return { id: e.id as string, kiosco, ocurrido_en: e.ocurrido_en as string, texto: TEXTOS_DE_ACTIVIDAD[e.tipo as string](quien, detalle) };
      }),
    );
  }

  protected abrirAlta(): void {
    this.nombreNuevo.set('');
    this.ubicacionNueva.set('');
    this.errorAccion.set(null);
    this.dandoDeAlta.set(true);
  }

  /** Pide el codigo a la base. Se muestra UNA vez: en la base solo queda su hash. */
  protected async generarCodigo(): Promise<void> {
    if (!this.nombreNuevo().trim()) {
      this.errorAccion.set('Ponle un nombre al kiosco, por ejemplo "Entrada principal".');
      return;
    }
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { data, error } = await this.sesion.bd.rpc('generar_codigo_enrolamiento', {
      p_nombre: this.nombreNuevo().trim(),
      p_ubicacion: this.ubicacionNueva().trim(),
    });
    this.guardando.set(false);
    const fila = (data as { codigo: string; expira_en: string }[] | null)?.[0];
    if (error || !fila) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    this.dandoDeAlta.set(false);
    this.codigo.set({ codigo: fila.codigo, expira: fila.expira_en, nombre: this.nombreNuevo().trim() });
  }

  protected cerrarCodigo(): void {
    this.codigo.set(null);
    void this.cargar();
  }

  protected abrirBaja(k: Kiosco): void {
    this.errorAccion.set(null);
    this.porRevocar.set(k);
  }

  protected async revocar(k: Kiosco, motivo: string): Promise<void> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await this.sesion.bd.rpc('revocar_dispositivo', { p_dispositivo_id: k.id, p_motivo: motivo });
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    this.porRevocar.set(null);
    this.avisos.exito(`${k.nombre} quedó dado de baja. Lo que mande de aquí en adelante llega apartado, en cuarentena.`);
    await this.cargar();
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }

  protected desfaseEnPalabras(ms: number | null): string {
    if (ms === null) return '—';
    const segundos = Math.round(Math.abs(ms) / 1000);
    if (segundos < 5) return 'a tiempo';
    const texto = segundos < 120 ? `${segundos} s` : `${Math.round(segundos / 60)} min`;
    return ms > 0 ? `${texto} adelantado` : `${texto} atrasado`;
  }

  protected sinReportarse(k: Kiosco): boolean {
    return !k.ultima_conexion || this.ahora() - new Date(k.ultima_conexion).getTime() > this.minutosSinConexion() * 60_000;
  }
}
