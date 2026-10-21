/**
 * ============================================================================
 *  NOTAS: apuntes y listas de pendientes de los administradores  (0029)
 * ============================================================================
 *
 *  Pedido del autor tras la junta (20-10-2026): un lugar dentro del sistema
 *  para anotar lo que hay que hacer ("pedir a RH la lista de veladores"), en
 *  vez del celular o un papel. Cada nota puede llevar casillas que se
 *  palomean.
 *
 *  ¿Quien la ve? Lo decide quien la escribe:
 *    - Solo yo         (lo normal al crearla);
 *    - Todos           (todos los administradores del panel);
 *    - Algunos         (los que se elijan).
 *  Quien la ve, la puede palomear y editar; cambiar quien la ve o borrarla,
 *  solo quien la escribio. Todo eso lo cuida la base (RLS, migracion 0029),
 *  no esta pantalla.
 *
 *  OJO: si una nota habla de un empleado, es un dato personal. Escribir
 *  hechos ("trae justificante el lunes"), no opiniones.
 *
 *  Prueba del autor (20-10-2026): una nota por renglon, a lo ancho (en
 *  columnas angostas el texto largo se leia mal), y un buscador con el
 *  filtro "Por hacer / Todo hecho / Todas".
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Ayuda } from '../componentes/ayuda';
import { Dialogo, mensajeDeError } from '../componentes/dialogo';
import { Avisos } from '../servicios/avisos';
import { senalRecordada } from '../servicios/recordar';
import { Sesion } from '../servicios/sesion';

type Visibilidad = 'privada' | 'todos' | 'algunos';

/** "Revisión" -> "revision": para buscar sin que importen acentos ni mayusculas. */
function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

interface Tarea {
  texto: string;
  hecha: boolean;
}

interface Nota {
  id: string;
  autor: string;
  titulo: string;
  texto: string;
  tareas: Tarea[];
  visibilidad: Visibilidad;
  actualizado_en: string;
  actualizado_por: string | null;
}

/** Lo que se esta escribiendo en la ventana de editar. */
interface Borrador {
  id: string | null;
  titulo: string;
  texto: string;
  tareas: Tarea[];
  visibilidad: Visibilidad;
  compartidaCon: string[];
}

export const VISIBILIDADES: Record<Visibilidad, { nombre: string; ayuda: string }> = {
  privada: { nombre: 'Sólo yo', ayuda: 'Nadie más la ve.' },
  todos: { nombre: 'Todos', ayuda: 'Todos los que entran al panel la ven y pueden palomear sus casillas.' },
  algunos: { nombre: 'Algunos', ayuda: 'Sólo tú y las personas que elijas abajo.' },
};

@Component({
  selector: 'panel-notas',
  imports: [Ayuda, Dialogo],
  templateUrl: './notas.html',
})
export class Notas implements OnInit {
  protected readonly sesion = inject(Sesion);
  private readonly avisos = inject(Avisos);

  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notas = signal<Nota[]>([]);
  /** Con quien se compartio cada nota mia ("algunos"). */
  private readonly compartidas = signal<Map<string, string[]>>(new Map());
  /** Los administradores activos (para elegir con quien compartir y mostrar nombres). */
  protected readonly administradores = signal<{ id: string; nombre: string; activo: boolean }[]>([]);

  protected readonly VISIBILIDADES = VISIBILIDADES;
  protected readonly OPCIONES_VISIBILIDAD = Object.keys(VISIBILIDADES) as Visibilidad[];

  /** Lo que se escribe en el buscador. */
  protected readonly busqueda = signal('');
  /** "Por hacer": sin casillas, o con alguna sin palomear. "Hechas": todas palomeadas. */
  protected readonly filtro = senalRecordada<'por_hacer' | 'hechas' | 'todas'>('notas.filtro', 'por_hacer');
  /**
   * Las que se terminaron de palomear AQUI: siguen a la vista (y en su lugar)
   * hasta cambiar de filtro. Antes, al palomear la ultima casilla en "Por
   * hacer", la nota se esfumaba y parecia que se habia borrado (21-10-2026).
   */
  private readonly seQuedan = signal<Set<string>>(new Set());

  protected verFiltro(filtro: 'por_hacer' | 'hechas' | 'todas'): void {
    this.seQuedan.set(new Set());
    this.filtro.set(filtro);
  }

  /** Cuantas hay de cada una, para los botones del filtro. */
  protected readonly cuantas = computed(() => {
    const hechas = this.notas().filter((n) => this.estaHecha(n)).length;
    return { por_hacer: this.notas().length - hechas, hechas, todas: this.notas().length };
  });

  /** Primero las que tienen casillas sin palomear; luego, las mas recientes. */
  protected readonly ordenadas = computed(() => {
    const palabras = sinAcentos(this.busqueda().trim()).split(/\s+/).filter(Boolean);
    const filtro = this.filtro();
    const seQuedan = this.seQuedan();
    const pendiente = (n: Nota): boolean => this.faltan(n) > 0 || seQuedan.has(n.id);
    return this.notas()
      .filter((n) => filtro === 'todas' || seQuedan.has(n.id) || (filtro === 'hechas') === this.estaHecha(n))
      .filter((n) => {
        if (palabras.length === 0) return true;
        const todo = sinAcentos([n.titulo, n.texto, ...n.tareas.map((t) => t.texto)].join(' '));
        return palabras.every((p) => todo.includes(p));
      })
      .sort(
        (a, b) =>
          Number(pendiente(b)) - Number(pendiente(a)) || b.actualizado_en.localeCompare(a.actualizado_en),
      );
  });

  /** Una nota "hecha" tiene casillas y todas estan palomeadas. */
  private estaHecha(n: Nota): boolean {
    return n.tareas.length > 0 && this.faltan(n) === 0;
  }

  /** A quien se le puede compartir: los demas administradores activos. */
  protected readonly otrosAdministradores = computed(() =>
    this.administradores().filter((a) => a.activo && a.id !== this.sesion.admin()?.userId),
  );

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const [notas, compartidas, admins] = await Promise.all([
      this.sesion.bd.from('notas').select('id, autor, titulo, texto, tareas, visibilidad, actualizado_en, actualizado_por')
        .order('actualizado_en', { ascending: false }),
      this.sesion.bd.from('notas_compartidas').select('nota_id, user_id'),
      this.sesion.bd.from('administradores').select('user_id, nombre, activo').order('nombre'),
    ]);
    this.cargando.set(false);
    if (notas.error || compartidas.error) {
      this.error.set('No se pudieron traer las notas. Revisa el internet y vuelve a intentar.');
      return;
    }
    this.error.set(null);
    this.notas.set((notas.data ?? []) as Nota[]);
    const mapa = new Map<string, string[]>();
    for (const c of compartidas.data ?? []) mapa.set(c.nota_id, [...(mapa.get(c.nota_id) ?? []), c.user_id]);
    this.compartidas.set(mapa);
    this.administradores.set((admins.data ?? []).map((a) => ({ id: a.user_id, nombre: a.nombre, activo: a.activo })));
  }

  // --------------------------------------------------------------------------
  //  En palabras
  // --------------------------------------------------------------------------

  protected esMia(n: Nota): boolean {
    return n.autor === this.sesion.admin()?.userId;
  }

  protected nombreDe(id: string | null): string {
    if (!id) return 'alguien';
    if (id === this.sesion.admin()?.userId) return 'ti';
    return this.administradores().find((a) => a.id === id)?.nombre ?? 'otro administrador';
  }

  /** "Sólo yo" / "Todos" / "Algunos: Ana, Javier". */
  protected quienLaVe(n: Nota): string {
    if (n.visibilidad !== 'algunos') return VISIBILIDADES[n.visibilidad].nombre;
    const nombres = (this.compartidas().get(n.id) ?? []).map((id) => this.nombreDe(id));
    return nombres.length ? `Algunos: ${nombres.join(', ')}` : 'Algunos (nadie elegido todavía)';
  }

  /** Cuantas casillas faltan por palomear. */
  protected faltan(n: Nota): number {
    return n.tareas.filter((t) => !t.hecha).length;
  }

  protected cuando(iso: string): string {
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: this.sesion.zona() });
  }

  // --------------------------------------------------------------------------
  //  Palomear una casilla: se guarda al momento
  // --------------------------------------------------------------------------

  protected async palomear(n: Nota, indice: number): Promise<void> {
    const tareas = n.tareas.map((t, i) => (i === indice ? { ...t, hecha: !t.hecha } : t));
    this.seQuedan.update((s) => new Set(s).add(n.id));
    // Se ve palomeada de inmediato; si no se pudo guardar, se regresa.
    this.notas.update((lista) => lista.map((x) => (x.id === n.id ? { ...x, tareas } : x)));
    const { error } = await this.sesion.bd.from('notas').update({ tareas }).eq('id', n.id);
    if (error) {
      this.notas.update((lista) => lista.map((x) => (x.id === n.id ? n : x)));
      this.error.set('No se pudo guardar la casilla. Revisa el internet y vuelve a intentar.');
    }
  }

  // --------------------------------------------------------------------------
  //  Escribir y editar
  // --------------------------------------------------------------------------

  protected readonly borrador = signal<Borrador | null>(null);
  protected readonly porBorrar = signal<Nota | null>(null);
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  /** El renglon de "agregar casilla" de la ventana. */
  protected readonly casillaNueva = signal('');
  /** Como estaba el borrador al abrir la ventana, para saber si se escribio algo. */
  private borradorOriginal = '';
  protected readonly hayCambios = computed(() => {
    const b = this.borrador();
    return !!b && (JSON.stringify(b) !== this.borradorOriginal || this.casillaNueva().trim() !== '');
  });

  protected nueva(): void {
    this.errorAccion.set(null);
    this.casillaNueva.set('');
    this.borrador.set({ id: null, titulo: '', texto: '', tareas: [], visibilidad: 'privada', compartidaCon: [] });
    this.borradorOriginal = JSON.stringify(this.borrador());
  }

  protected editar(n: Nota): void {
    this.errorAccion.set(null);
    this.casillaNueva.set('');
    this.borrador.set({
      id: n.id, titulo: n.titulo, texto: n.texto, tareas: n.tareas.map((t) => ({ ...t })),
      visibilidad: n.visibilidad, compartidaCon: [...(this.compartidas().get(n.id) ?? [])],
    });
    this.borradorOriginal = JSON.stringify(this.borrador());
  }

  /** ¿El borrador es de una nota mia (o nueva)? Solo asi se cambia quien la ve. */
  protected borradorEsMio(b: Borrador): boolean {
    if (!b.id) return true;
    const n = this.notas().find((x) => x.id === b.id);
    return !!n && this.esMia(n);
  }

  protected autorDe(b: Borrador): string {
    return this.nombreDe(this.notas().find((x) => x.id === b.id)?.autor ?? null);
  }

  protected cambiar<K extends 'titulo' | 'texto' | 'visibilidad'>(campo: K, valor: Borrador[K]): void {
    this.borrador.update((b) => (b ? { ...b, [campo]: valor } : b));
  }

  protected agregarCasilla(): void {
    const texto = this.casillaNueva().trim();
    if (!texto) return;
    this.borrador.update((b) => (b ? { ...b, tareas: [...b.tareas, { texto, hecha: false }] } : b));
    this.casillaNueva.set('');
  }

  protected cambiarCasilla(indice: number, texto: string): void {
    this.borrador.update((b) => (b ? { ...b, tareas: b.tareas.map((t, i) => (i === indice ? { ...t, texto } : t)) } : b));
  }

  protected quitarCasilla(indice: number): void {
    this.borrador.update((b) => (b ? { ...b, tareas: b.tareas.filter((_, i) => i !== indice) } : b));
  }

  protected compartirCon(id: string, si: boolean): void {
    this.borrador.update((b) =>
      b ? { ...b, compartidaCon: si ? [...new Set([...b.compartidaCon, id])] : b.compartidaCon.filter((x) => x !== id) } : b,
    );
  }

  protected async guardar(): Promise<void> {
    const b = this.borrador();
    if (!b) return;
    // Lo escrito en "agregar casilla" sin picar "+" tambien cuenta.
    if (this.casillaNueva().trim()) this.agregarCasilla();
    const actual = this.borrador()!;
    const tareas = actual.tareas.filter((t) => t.texto.trim()).map((t) => ({ texto: t.texto.trim(), hecha: t.hecha }));
    if (!actual.titulo.trim() && !actual.texto.trim() && tareas.length === 0) {
      this.errorAccion.set('La nota está vacía: escribe un título, un texto o al menos una casilla.');
      return;
    }
    const mia = this.borradorEsMio(actual);
    this.guardando.set(true);
    this.errorAccion.set(null);

    const datos = {
      titulo: actual.titulo.trim(),
      texto: actual.texto.trim(),
      tareas,
      ...(mia ? { visibilidad: actual.visibilidad } : {}),
    };
    const respuesta = actual.id
      ? await this.sesion.bd.from('notas').update(datos).eq('id', actual.id).select('id').single()
      : await this.sesion.bd.from('notas').insert(datos).select('id').single();
    if (respuesta.error || !respuesta.data) {
      this.guardando.set(false);
      this.errorAccion.set(mensajeDeError(respuesta.error));
      return;
    }

    // Con quien se comparte: solo lo cambia quien la escribio.
    if (mia) {
      const id = respuesta.data.id as string;
      const antes = new Set(this.compartidas().get(id) ?? []);
      const ahora = new Set(actual.visibilidad === 'algunos' ? actual.compartidaCon : []);
      const quitar = [...antes].filter((x) => !ahora.has(x));
      const poner = [...ahora].filter((x) => !antes.has(x));
      const [q, p] = await Promise.all([
        quitar.length ? this.sesion.bd.from('notas_compartidas').delete().eq('nota_id', id).in('user_id', quitar) : null,
        poner.length ? this.sesion.bd.from('notas_compartidas').insert(poner.map((user_id) => ({ nota_id: id, user_id }))) : null,
      ]);
      if (q?.error || p?.error) {
        this.guardando.set(false);
        this.errorAccion.set('La nota se guardó, pero no se pudo cambiar con quién se comparte. Vuelve a intentar.');
        await this.cargar();
        return;
      }
    }

    this.guardando.set(false);
    this.borrador.set(null);
    this.avisos.exito('Nota guardada.');
    await this.cargar();
  }

  protected async borrar(n: Nota): Promise<void> {
    this.guardando.set(true);
    this.errorAccion.set(null);
    const { error, count } = await this.sesion.bd.from('notas').delete({ count: 'exact' }).eq('id', n.id);
    this.guardando.set(false);
    if (error || count === 0) {
      this.errorAccion.set(error ? mensajeDeError(error) : 'Sólo quien escribió la nota la puede borrar.');
      return;
    }
    this.porBorrar.set(null);
    this.avisos.exito('Nota borrada.');
    await this.cargar();
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  protected marcado(evento: Event): boolean {
    return (evento.target as HTMLInputElement).checked;
  }
}
