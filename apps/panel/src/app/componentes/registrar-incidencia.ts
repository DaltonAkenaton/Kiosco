/**
 * ============================================================================
 *  REGISTRAR UNA INCIDENCIA  (migraciones 0016 y 0020)
 * ============================================================================
 *
 *  La ventana que usan dos pantallas: Incidencias ("+ Registrar incidencia")
 *  y Reportes (boton "Justificar" en un dia con falta o retardo, que llega
 *  con la persona, el dia y un tipo sugerido ya puestos).
 *
 *  Dos familias, porque cuentan distinto en el reporte:
 *
 *    AUSENCIA JUSTIFICADA  no vino, con razon: no es falta, pero no suma horas.
 *    SE DA POR BUENO       vino (o debia checar) y el problema no fue suyo:
 *                          el dia cuenta completo, con las horas del turno.
 *
 *  Se puede registrar para UNA persona, para TODOS los que tenian turno, o
 *  para todos los de UN turno ("se cayo el sistema el martes").
 *
 *  Los registros de entrada y salida nunca se tocan: la incidencia solo cambia
 *  como se califica el dia.
 */

import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { Dialogo, mensajeDeError } from './dialogo';
import { Sesion } from '../servicios/sesion';

export interface TipoDeIncidencia {
  valor: string;
  familia: 'ausencia' | 'por_bueno';
  texto: string;
  ejemplo: string;
}

export const TIPOS_DE_INCIDENCIA: TipoDeIncidencia[] = [
  { valor: 'vacaciones', familia: 'ausencia', texto: 'Vacaciones', ejemplo: 'sus días de vacaciones' },
  { valor: 'incapacidad', familia: 'ausencia', texto: 'Incapacidad', ejemplo: 'enfermedad, accidente, maternidad (con papel del IMSS o ISSSTE)' },
  { valor: 'permiso', familia: 'ausencia', texto: 'Permiso', ejemplo: 'fallecimiento de un familiar, nacimiento de un hijo, trámites' },
  { valor: 'comision', familia: 'ausencia', texto: 'Comisión', ejemplo: 'está trabajando, pero en otro lugar' },
  { valor: 'falta_justificada', familia: 'ausencia', texto: 'Falta justificada', ejemplo: 'faltó por una razón válida sin papel (amaneció enfermo, un accidente)' },
  { valor: 'olvido_registro', familia: 'por_bueno', texto: 'No se registró', ejemplo: 'sí vino, pero olvidó checar o el kiosco no lo tomó' },
  { valor: 'falla_sistema', familia: 'por_bueno', texto: 'Falla del sistema', ejemplo: 'se cayó el kiosco, el internet o la luz' },
  { valor: 'retardo_justificado', familia: 'por_bueno', texto: 'Retardo justificado', ejemplo: 'llegó tarde por una razón aceptada (avisó, lo mandaron a otro lado)' },
];

export function textoDeIncidencia(valor: string): string {
  return TIPOS_DE_INCIDENCIA.find((t) => t.valor === valor)?.texto ?? valor;
}

export function familiaDeIncidencia(valor: string): 'ausencia' | 'por_bueno' | null {
  return TIPOS_DE_INCIDENCIA.find((t) => t.valor === valor)?.familia ?? null;
}

/** Lo que llega ya puesto desde Reportes. */
export interface IncidenciaSugerida {
  empleadoId: string;
  fecha: string;
  tipo: string;
}

@Component({
  selector: 'panel-registrar-incidencia',
  imports: [Dialogo],
  template: `
    <panel-dialogo
      titulo="Registrar una incidencia"
      [textoBoton]="para() === 'una' ? 'Registrar' : 'Registrar para varios'"
      ejemploMotivo="Ej.: la huella no lo tomó; lo vio el supervisor a las 6:00"
      [ocupado]="guardando()"
      [error]="error()"
      (confirmar)="guardar($event)"
      (cancelar)="cancelar.emit()"
    >
      @if (permitirVarios()) {
        <fieldset class="flex flex-col gap-1">
          <legend class="mb-1">¿Para quién?</legend>
          <label class="flex items-center gap-2"><input type="radio" name="para" class="h-5 w-5" [checked]="para() === 'una'" (change)="para.set('una')" /> Una persona</label>
          <label class="flex items-center gap-2"><input type="radio" name="para" class="h-5 w-5" [checked]="para() === 'turno'" (change)="para.set('turno')" /> Todos los de un turno</label>
          <label class="flex items-center gap-2"><input type="radio" name="para" class="h-5 w-5" [checked]="para() === 'todos'" (change)="para.set('todos')" /> Todos los que tenían turno esos días</label>
        </fieldset>
      }

      @if (para() === 'una') {
        <label class="flex flex-col gap-1">Quién
          <select class="campo" (change)="empleadoId.set(valor($event))">
            <option value="">Elige a la persona</option>
            @for (e of empleados(); track e.id) {
              <option [value]="e.id" [selected]="e.id === empleadoId()">{{ e.nombre }}</option>
            }
          </select>
        </label>
      } @else if (para() === 'turno') {
        <label class="flex flex-col gap-1">Turno
          <select class="campo" (change)="turnoId.set(valor($event))">
            <option value="">Elige el turno</option>
            @for (t of turnos(); track t.id) {
              <option [value]="t.id" [selected]="t.id === turnoId()">{{ t.nombre }}</option>
            }
          </select>
        </label>
      }

      <label class="flex flex-col gap-1">Qué pasó
        <select class="campo" (change)="tipo.set(valor($event))">
          <optgroup label="No vino, con razón (ausencia justificada)">
            @for (t of ausencias; track t.valor) {
              <option [value]="t.valor" [selected]="t.valor === tipo()">{{ t.texto }} — {{ t.ejemplo }}</option>
            }
          </optgroup>
          <optgroup label="Se da por bueno (el problema no fue suyo)">
            @for (t of porBueno; track t.valor) {
              <option [value]="t.valor" [selected]="t.valor === tipo()">{{ t.texto }} — {{ t.ejemplo }}</option>
            }
          </optgroup>
        </select>
      </label>
      <p class="aviso aviso-atencion text-base font-normal">
        @if (familia() === 'por_bueno') {
          <b>Se da por bueno:</b> esos días cuentan como normales y completos, con las horas de su turno.
          Si hubo retardo o no hubo registro, deja de contar.
        } @else {
          <b>Ausencia justificada:</b> esos días no cuentan como falta, pero tampoco suman horas trabajadas.
        }
        Los registros de entrada y salida no se tocan.
      </p>

      <div class="flex flex-wrap gap-3">
        <label class="flex flex-col gap-1">Desde <input type="date" class="campo" [value]="inicio()" (change)="inicio.set(valor($event))" /></label>
        <label class="flex flex-col gap-1">Hasta (incluido) <input type="date" class="campo" [value]="fin()" (change)="fin.set(valor($event))" /></label>
      </div>
    </panel-dialogo>
  `,
})
export class RegistrarIncidencia implements OnInit {
  private readonly sesion = inject(Sesion);

  /** Lo que llega ya puesto (desde Reportes). */
  readonly sugerida = input<IncidenciaSugerida | null>(null);
  /** Desde Reportes es para una persona; desde Incidencias se puede para varios. */
  readonly permitirVarios = input(true);

  /** Se guardo. Lleva un mensaje para mostrar ("Registrada para 18 personas"). */
  readonly guardado = output<string>();
  readonly cancelar = output<void>();

  protected readonly ausencias = TIPOS_DE_INCIDENCIA.filter((t) => t.familia === 'ausencia');
  protected readonly porBueno = TIPOS_DE_INCIDENCIA.filter((t) => t.familia === 'por_bueno');

  protected readonly empleados = signal<{ id: string; nombre: string }[]>([]);
  protected readonly turnos = signal<{ id: string; nombre: string }[]>([]);

  protected readonly para = signal<'una' | 'turno' | 'todos'>('una');
  protected readonly empleadoId = signal('');
  protected readonly turnoId = signal('');
  protected readonly tipo = signal('vacaciones');
  protected readonly inicio = signal('');
  protected readonly fin = signal('');
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly familia = computed(() => familiaDeIncidencia(this.tipo()));

  async ngOnInit(): Promise<void> {
    const s = this.sugerida();
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: this.sesion.zona() }).format(new Date());
    this.empleadoId.set(s?.empleadoId ?? '');
    this.tipo.set(s?.tipo ?? 'vacaciones');
    this.inicio.set(s?.fecha ?? hoy);
    this.fin.set(s?.fecha ?? hoy);

    const [emp, tur] = await Promise.all([
      this.sesion.bd.from('empleados').select('id, nombre, apellido_paterno, apellido_materno').eq('activo', true).order('nombre'),
      this.sesion.bd.from('turnos').select('id, nombre').order('hora_inicio'),
    ]);
    this.empleados.set(
      (emp.data ?? []).map((e) => ({ id: e.id, nombre: [e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' ') })),
    );
    this.turnos.set(tur.data ?? []);
  }

  protected async guardar(notas: string): Promise<void> {
    if (this.para() === 'una' && !this.empleadoId()) {
      this.error.set('Elige a la persona.');
      return;
    }
    if (this.para() === 'turno' && !this.turnoId()) {
      this.error.set('Elige el turno.');
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    const r =
      this.para() === 'una'
        ? await this.sesion.bd.rpc('registrar_incidencia', {
            p_empleado_id: this.empleadoId(), p_tipo: this.tipo(), p_inicio: this.inicio(), p_fin: this.fin(), p_notas: notas,
          })
        : await this.sesion.bd.rpc('registrar_incidencia_grupal', {
            p_turno_id: this.para() === 'turno' ? this.turnoId() : null,
            p_tipo: this.tipo(), p_inicio: this.inicio(), p_fin: this.fin(), p_notas: notas,
          });
    this.guardando.set(false);
    if (r.error) {
      this.error.set(mensajeDeError(r.error));
      return;
    }
    this.guardado.emit(this.para() === 'una' ? 'Incidencia registrada.' : `Registrada para ${r.data as number} persona(s).`);
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
