/**
 * ============================================================================
 *  CONFIGURACION  (CLAUDE.md 1.3 y 10: "lo que hace moldeable el sistema")
 * ============================================================================
 *
 *  Las reglas que el jefe puede cambiar sin programador: tolerancia, minutos
 *  para falta, retencion de fotos, intentos de PIN, umbrales de camara y
 *  reloj... Cada una con un nombre entendible, que es, para que se usa y
 *  entre que valores se puede poner (los limites vienen de la base, 0015).
 *
 *  Cambiar una pide motivo y queda en la bitacora. Los kioscos la reciben en
 *  su siguiente sincronizacion (cada 5 minutos, si tienen internet).
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { Avisos } from '../servicios/avisos';
import { Sesion } from '../servicios/sesion';
import { PALABRAS_CONFIGURACION as PALABRAS, fecha, hora } from '../textos';

interface Opcion {
  clave: string;
  valor: unknown;
  descripcion: string;
  grupo: string;
  tipo: 'entero' | 'texto';
  minimo: number | null;
  maximo: number | null;
  unidad: string;
  actualizado_en: string;
}

/**
 * Las que usa el KIOSCO (bajan con la sincronizacion). Las demas las usa la
 * base al calcular (reportes) o este panel, y valen desde el momento en que
 * se guardan. Sirve para decirle al jefe CUANDO se nota su cambio.
 */
const LAS_USA_EL_KIOSCO = new Set([
  'intentos_pin_maximos', 'segundos_bloqueo_pin', 'minutos_olvidar_intentos', 'umbral_brillo_minimo',
  'umbral_varianza_minima', 'umbral_desfase_reloj_ms', 'dias_retencion_fotos', 'zona_horaria',
  'horas_para_cierre_automatico',
]);

/** Un turno con su propia tolerancia o sus propios minutos (Horarios). */
interface TurnoConReglaPropia {
  nombre: string;
  tolerancia_minutos: number | null;
  minutos_para_falta: number | null;
}

const GRUPOS: Record<string, string> = {
  asistencia: 'Asistencia',
  pin: 'PIN de los empleados',
  camara: 'Cámara',
  tiempo: 'Hora y reloj',
  privacidad: 'Privacidad',
  dispositivos: 'Kioscos',
  panel: 'Este panel',
  general: 'General',
};

@Component({
  selector: 'panel-configuracion',
  imports: [Ayuda, Dialogo],
  templateUrl: './configuracion.html',
})
export class Configuracion implements OnInit {
  protected readonly sesion = inject(Sesion);
  private readonly avisos = inject(Avisos);
  protected readonly opciones = signal<Opcion[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  private turnos: TurnoConReglaPropia[] = [];

  protected readonly editando = signal<Opcion | null>(null);
  protected readonly nuevoValor = signal('');
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  protected readonly fecha = fecha;
  protected readonly hora = hora;

  protected readonly porGrupo = computed(() => {
    const grupos = new Map<string, Opcion[]>();
    for (const o of this.opciones()) grupos.set(o.grupo, [...(grupos.get(o.grupo) ?? []), o]);
    return [...grupos.entries()].map(([grupo, opciones]) => ({ nombre: GRUPOS[grupo] ?? grupo, opciones }));
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const [{ data, error }, turnos] = await Promise.all([
      this.sesion.bd
        .from('configuracion')
        .select('clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad, actualizado_en')
        .order('grupo')
        .order('clave'),
      this.sesion.bd.from('turnos').select('nombre, tolerancia_minutos, minutos_para_falta').eq('activo', true),
    ]);
    this.cargando.set(false);
    this.turnos = (turnos.data ?? []) as TurnoConReglaPropia[];
    if (error) {
      this.error.set('No se pudo traer la configuración. Revisa el internet.');
      return;
    }
    this.opciones.set(data as Opcion[]);
  }

  protected palabras(o: Opcion): { nombre: string; explicacion: string; seUsaEn: string } {
    return PALABRAS[o.clave] ?? { nombre: o.clave, explicacion: o.descripcion, seUsaEn: '' };
  }

  protected valorEnPalabras(o: Opcion): string {
    return `${String(o.valor)}${o.unidad ? ' ' + o.unidad.replace('dias', 'días') : ''}`;
  }

  /** Una opcion de 0 a 1 es un "si o no": se muestra con dos botones, no con un numero. */
  protected esSiNo(o: Opcion): boolean {
    return o.tipo === 'entero' && Number(o.minimo) === 0 && Number(o.maximo) === 1;
  }

  protected abrir(o: Opcion): void {
    this.errorAccion.set(null);
    this.nuevoValor.set(String(o.valor));
    this.editando.set(o);
  }

  protected async guardar(o: Opcion, motivo: string): Promise<void> {
    let valor: unknown;
    if (o.tipo === 'entero') {
      const texto = this.nuevoValor().trim();
      // Con Number() a secas, un campo VACIO valia 0 ("tolerancia: 0") y
      // "1e2" valia 100. Solo digitos.
      if (!/^-?[0-9]+$/.test(texto)) {
        this.errorAccion.set('Escribe un número entero, sin decimales ni letras.');
        return;
      }
      const numero = Number(texto);
      if (o.minimo !== null && o.maximo !== null && (numero < o.minimo || numero > o.maximo)) {
        this.errorAccion.set(`Debe estar entre ${o.minimo} y ${o.maximo}.`);
        return;
      }
      const choque = this.chocaConUnTurno(o.clave, numero);
      if (choque) {
        this.errorAccion.set(choque);
        return;
      }
      valor = numero;
    } else {
      valor = this.nuevoValor().trim();
      if (valor === '') {
        this.errorAccion.set('Escribe un valor.');
        return;
      }
    }
    if (String(valor) === String(o.valor)) {
      this.errorAccion.set('Es el mismo valor que ya tiene. Escribe otro, o pica Cancelar.');
      return;
    }

    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error } = await this.sesion.bd.rpc('actualizar_configuracion', {
      p_clave: o.clave,
      p_valor: valor,
      p_motivo: motivo,
    });
    this.guardando.set(false);
    if (error) {
      this.errorAccion.set(mensajeDeError(error));
      return;
    }
    this.editando.set(null);
    this.sesion.aplicarAjuste(o.clave, valor);
    this.avisos.exito(
      LAS_USA_EL_KIOSCO.has(o.clave)
        ? 'Guardado. Los kioscos lo reciben en unos minutos (en cuanto tengan internet).'
        : 'Guardado. Ya cuenta desde ahora.',
    );
    await this.cargar();
  }

  /**
   * Un turno puede tener SU tolerancia o SUS minutos de "retardo mayor"
   * (Horarios); el que deja vacio usa el de aqui. La base revisa que los dos
   * de aqui no se contradigan, pero no la mezcla: con un turno de tolerancia
   * propia de 20 y "retardo mayor" de aqui bajado a 15, llegar 18 minutos
   * tarde seria "a tiempo" y 21, "retardo mayor", sin pasar nunca por
   * "retardo". Devuelve el mensaje si choca, o nada (null).
   */
  private chocaConUnTurno(clave: string, numero: number): string | null {
    for (const t of this.turnos) {
      if (clave === 'minutos_para_falta' && t.minutos_para_falta === null && t.tolerancia_minutos !== null &&
          numero <= t.tolerancia_minutos) {
        return `El turno "${t.nombre}" tiene su propia tolerancia de ${t.tolerancia_minutos} minutos: esto debe ser más. ` +
          'Cambia primero esa tolerancia en Horarios, o pon aquí un número mayor.';
      }
      if (clave === 'tolerancia_retardo_minutos' && t.tolerancia_minutos === null && t.minutos_para_falta !== null &&
          numero >= t.minutos_para_falta) {
        return `El turno "${t.nombre}" tiene sus propios minutos para "retardo mayor" (${t.minutos_para_falta}): la tolerancia debe ser menor. ` +
          'Cámbialos primero en Horarios, o pon aquí un número menor.';
      }
    }
    return null;
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
