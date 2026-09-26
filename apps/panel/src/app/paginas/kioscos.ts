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

import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
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

@Component({
  selector: 'panel-kioscos',
  imports: [Ayuda, Dialogo],
  templateUrl: './kioscos.html',
})
export class Kioscos implements OnInit, OnDestroy {
  protected readonly sesion = inject(Sesion);
  protected readonly zona = this.sesion.zona;

  protected readonly kioscos = signal<Kiosco[]>([]);
  protected readonly fotosPorRevisar = signal<Map<string, number>>(new Map());
  protected readonly minutosSinConexion = signal(60);
  protected readonly minutosCamara = signal(15);
  protected readonly ahora = signal(Date.now());
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

  /** Lo que hay que atender, en palabras. */
  protected readonly alertas = computed(() => {
    const lista: string[] = [];
    const limiteMs = this.minutosSinConexion() * 60_000;
    for (const k of this.kioscos()) {
      if (!k.activo) continue;
      if (!k.ultima_conexion || this.ahora() - new Date(k.ultima_conexion).getTime() > limiteMs) {
        lista.push(`${k.nombre}: no se reporta desde ${haceCuanto(k.ultima_conexion, this.ahora()).replace('hace ', 'hace ')}.`);
      }
      // La camara avisa cuando lleva caida mas que "Minutos de camara caida
      // para avisar" (Configuracion). Un parpadeo de un minuto no es alerta.
      if (k.camara_ok === false && k.camara_caida_desde &&
          this.ahora() - new Date(k.camara_caida_desde).getTime() > this.minutosCamara() * 60_000) {
        lista.push(`${k.nombre}: la cámara no funciona desde ${haceCuanto(k.camara_caida_desde, this.ahora())}. Los registros salen sin foto.`);
      }
      const fotos = this.fotosPorRevisar().get(k.id) ?? 0;
      if (fotos > 0) lista.push(`${k.nombre}: ${fotos} foto(s) faltan o están alteradas.`);
    }
    return lista;
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
    this.temporizador = setInterval(() => void this.cargar(), SEGUNDOS_PARA_REFRESCAR * 1000);
  }

  ngOnDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  private async cargar(): Promise<void> {
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
        .in('clave', ['minutos_kiosco_sin_conexion_alerta', 'minutos_camara_caida_alerta']),
    ]);
    if (kioscos.error) {
      this.error.set('No se pudo traer la lista de kioscos. Revisa el internet.');
      return;
    }
    this.error.set(null);
    this.kioscos.set(kioscos.data as Kiosco[]);
    this.fotosPorRevisar.set(new Map((fotos.data ?? []).map((f) => [f.dispositivo_id as string, Number(f.casos)])));
    for (const c of config.data ?? []) {
      if (c.clave === 'minutos_kiosco_sin_conexion_alerta' && typeof c.valor === 'number') this.minutosSinConexion.set(c.valor);
      if (c.clave === 'minutos_camara_caida_alerta' && typeof c.valor === 'number') this.minutosCamara.set(c.valor);
    }
    this.ahora.set(Date.now());
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
