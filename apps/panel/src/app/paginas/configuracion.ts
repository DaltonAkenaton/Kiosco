/**
 * ============================================================================
 *  CONFIGURACION  (ARQUITECTURA.md 1.3 y 10: "lo que hace moldeable el sistema")
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
import { descargarExcel } from '../servicios/escribir-excel';
import { armarRespaldo } from '../servicios/respaldo';
import { Sesion } from '../servicios/sesion';
import { PALABRAS_CONFIGURACION as PALABRAS, fecha, hora } from '../textos';

interface Opcion {
  clave: string;
  valor: unknown;
  descripcion: string;
  grupo: string;
  tipo: 'entero' | 'texto' | 'fecha';
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
  'horas_para_cierre_automatico', 'identificar_con_numero',
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
  pendientes: 'Pendientes',
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

  // Respaldo (0027): una copia de todas las tablas en Excel, en el momento.
  protected readonly respaldoAbierto = signal(false);
  protected readonly respaldando = signal(false);
  protected readonly avanceRespaldo = signal('');
  protected readonly errorRespaldo = signal<string | null>(null);
  protected readonly AYUDA_RESPALDO =
    'Trae lo mismo que el respaldo automático que se hace cada lunes y jueves: una hoja de Excel por tabla ' +
    '(registros, personal, horarios, cambios de horario, ausencias, pendientes, correcciones, bitácora, configuración, ' +
    'kioscos), sin PIN ni ' +
    'contraseñas. NO trae las fotos: nunca salen del kiosco; se respaldan desde el kiosco, en el modo ' +
    'administrador, con "Guardar en memoria USB". Queda anotado en la bitácora quién lo descargó y cuándo.';

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
    if (o.tipo === 'fecha' && typeof o.valor === 'string') {
      return new Date(`${o.valor}T12:00:00Z`).toLocaleDateString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
      });
    }
    // Las reglas de minutos de Pendientes (0029) se apagan con 0.
    if (o.clave.startsWith('pendientes_minutos') && Number(o.valor) === 0) return 'Apagado';
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
      const choque = this.chocaConUnTurno(o.clave, numero) ?? (await this.faltanNumeros(o.clave, numero));
      if (choque) {
        this.errorAccion.set(choque);
        return;
      }
      valor = numero;
    } else if (o.tipo === 'fecha') {
      valor = this.nuevoValor().trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valor as string)) {
        this.errorAccion.set('Elige una fecha.');
        return;
      }
      if ((valor as string) > this.sesion.hoy()) {
        this.errorAccion.set('La fecha no puede ser después de hoy.');
        return;
      }
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

  /**
   * Checar con el numero de empleado (0029): con alguien activo SIN numero,
   * esa persona no podria checar. Se dice quienes son antes de encenderlo.
   */
  private async faltanNumeros(clave: string, numero: number): Promise<string | null> {
    if (clave !== 'identificar_con_numero' || numero !== 1) return null;
    const { data, error } = await this.sesion.bd
      .from('empleados').select('nombre, apellido_paterno').eq('activo', true).is('numero_empleado', null);
    if (error) return 'No se pudo revisar que todos tengan número. Revisa el internet y vuelve a intentar.';
    if (!data || data.length === 0) return null;
    const nombres = data.slice(0, 5).map((e) => `${e.nombre} ${e.apellido_paterno}`).join(', ');
    return `${data.length} persona(s) activa(s) no tienen número de empleado (${nombres}${data.length > 5 ? '…' : ''}). ` +
      'Pónselo en Empleados → Editar antes de encender esto; si no, no podrían checar.';
  }

  protected abrirRespaldo(): void {
    this.errorRespaldo.set(null);
    this.avanceRespaldo.set('');
    this.respaldoAbierto.set(true);
  }

  /**
   * Primero se anota en la bitacora (si no se pudo anotar, no se baja nada);
   * despues se baja cada tabla y se arma el Excel.
   */
  protected async descargarRespaldo(motivo: string): Promise<void> {
    this.respaldando.set(true);
    this.errorRespaldo.set(null);
    this.avanceRespaldo.set('Anotando en la bitácora…');
    try {
      const { error } = await this.sesion.bd.rpc('registrar_descarga_respaldo', { p_motivo: motivo });
      if (error) {
        this.errorRespaldo.set(mensajeDeError(error));
        return;
      }
      const hojas = await armarRespaldo(this.sesion.bd, this.sesion.zona(), (tabla, numero, total) =>
        this.avanceRespaldo.set(`Bajando ${tabla.replaceAll('_', ' ')} (${numero} de ${total})…`),
      );
      const hoy = this.sesion.hoy();
      descargarExcel(`respaldo-${hoy}.xlsx`, hojas);
      this.respaldoAbierto.set(false);
      this.avisos.exito('Respaldo descargado. Guárdalo en un lugar seguro y bórralo de Descargas.');
    } catch (e) {
      this.errorRespaldo.set(
        `No se pudo completar el respaldo. Revisa el internet y vuelve a intentar. (${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      this.respaldando.set(false);
    }
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
