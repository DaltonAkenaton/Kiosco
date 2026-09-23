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

const GRUPOS: Record<string, string> = {
  asistencia: 'Asistencia',
  pin: 'PIN de los empleados',
  camara: 'Cámara',
  tiempo: 'Hora y reloj',
  privacidad: 'Privacidad',
  dispositivos: 'Kioscos',
  general: 'General',
};

@Component({
  selector: 'panel-configuracion',
  imports: [Ayuda, Dialogo],
  templateUrl: './configuracion.html',
})
export class Configuracion implements OnInit {
  protected readonly sesion = inject(Sesion);
  protected readonly opciones = signal<Opcion[]>([]);
  protected readonly error = signal<string | null>(null);

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
    const { data, error } = await this.sesion.bd
      .from('configuracion')
      .select('clave, valor, descripcion, grupo, tipo, minimo, maximo, unidad, actualizado_en')
      .order('grupo')
      .order('clave');
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

  protected abrir(o: Opcion): void {
    this.errorAccion.set(null);
    this.nuevoValor.set(String(o.valor));
    this.editando.set(o);
  }

  protected async guardar(o: Opcion, motivo: string): Promise<void> {
    let valor: unknown;
    if (o.tipo === 'entero') {
      const numero = Number(this.nuevoValor().trim());
      if (!Number.isInteger(numero)) {
        this.errorAccion.set('Escribe un número entero, sin decimales ni letras.');
        return;
      }
      if (o.minimo !== null && o.maximo !== null && (numero < o.minimo || numero > o.maximo)) {
        this.errorAccion.set(`Debe estar entre ${o.minimo} y ${o.maximo}.`);
        return;
      }
      valor = numero;
    } else {
      valor = this.nuevoValor().trim();
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
    await this.cargar();
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
