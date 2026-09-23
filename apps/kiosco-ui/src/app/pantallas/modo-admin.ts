/**
 * ============================================================================
 *  MODO ADMINISTRADOR  (CLAUDE.md 5.2)
 * ============================================================================
 *
 *  La UNICA forma de ver las fotos. Se abre con el boton del engrane de la
 *  barra de abajo.
 *
 *  Dos vistas:
 *
 *    INICIO DE SESION   usuario + contrasena. Si falla, se cierra y la
 *                       pantalla principal muestra "Intento fallido. Quedo
 *                       registrado con fecha y hora." (decision del 22-09-2026:
 *                       regresar en vez de bloquear).
 *
 *    AUDITORIA          filtros, la tabla de registros y, al elegir uno, su
 *                       foto con los datos encima.
 *
 *  Lo que esta pantalla NO decide: si la sesion sigue viva. Eso lo sabe el
 *  proceso principal (servicios/sesion-admin.ts). Aqui solo se obedece: si
 *  una respuesta dice `sesionVencida`, o llega el aviso de cierre por
 *  inactividad, se tapa todo y se regresa.
 *
 *  Pensada para alguien a quien la computadora no se le da: letras grandes,
 *  botones con palabras (no iconos solos), aviso de mayusculas y un boton para
 *  ver lo que se escribio en la contrasena.
 */

import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  NOMBRES_DE_BANDERAS as NOMBRES_DE_BANDERAS_COMPARTIDOS,
  type EmpleadoParaFiltro,
  type FiltrosAuditoria,
  type FotoParaAuditoria,
  type MarcaParaAuditoria,
  type MemoriaUsb,
  type ResultadoAdmin,
  type ResultadoExportacion,
  type SesionAdminParaInterfaz,
} from '@kiosko/compartido';
import { Ayuda } from '../componentes/ayuda';
import { PuenteKiosco } from '../servicios/puente-kiosco';

/** Lo que se le dice a la pantalla principal cuando la sesion se cierra sola. */
const MENSAJE_SESION_CERRADA = 'La sesión de administrador se cerró porque nadie la usó por un rato.';

/** Las banderas, en palabras (compartido/tipos.ts). Las que no esten ahi se muestran tal cual. */
const NOMBRES_DE_BANDERAS: Record<string, string | undefined> = NOMBRES_DE_BANDERAS_COMPARTIDOS;

/**
 * ============================================================================
 *  LAS EXPLICACIONES DE LOS SIMBOLOS ⓘ
 * ============================================================================
 *  Escritas para alguien que no sabe nada de computadoras (regla del
 *  23-09-2026): que es, en palabras de todos los dias, y que hacer.
 *  Van CON acentos: las lee una persona, no un programa.
 */
const AYUDA_BANDERAS: Record<string, string | undefined> = {
  sin_camara:
    'La cámara no funcionaba cuando esta persona registró. Puede ser una falla o que alguien la ' +
    'desconectó. El registro sí cuenta. Si le pasa seguido a la misma persona, conviene revisar.',
  foto_obstruida:
    'La foto salió muy oscura o sin forma, como si alguien tapara la cámara con la mano o con cinta. ' +
    'Abre la foto y revisa si se ve a la persona.',
  reloj_sospechoso:
    'La hora de esta computadora parecía movida (adelantada o atrasada) en ese momento. La hora del ' +
    'registro podría no ser la real. Compárala con los otros registros de ese día.',
  dispositivo_revocado:
    'Este registro llegó de un kiosco que ya se había dado de baja. Se guardó, pero apartado, para ' +
    'que lo revises.',
  manual:
    'Este registro no se hizo en el kiosco: lo capturó un administrador a mano (por ejemplo, un día ' +
    'que no hubo luz).',
  cierre_automatico:
    'La persona registró su entrada, pero nunca su salida. El sistema no inventa la hora de salida: ' +
    'tú decides qué pasó.',
};

const AYUDA = {
  conservada:
    'Esta foto NO se borrará sola. Normalmente las fotos se borran a los 30 días, para cuidar la ' +
    'privacidad del personal. Si hay una queja o una duda sobre un registro, se marca "Conservar" ' +
    'para guardarla como prueba. Cuando el asunto se resuelva, quítale la marca y volverá a borrarse ' +
    'sola.',
  disponible:
    'La foto está guardada en esta computadora. Da clic en el renglón para verla. Se borrará sola ' +
    'cuando cumpla 30 días, a menos que la marques como "Conservar".',
  borrada:
    'La foto se borró sola porque ya pasaron 30 días. Es normal: así se cuida la privacidad. El ' +
    'registro de entrada o salida NO se borra, solo la foto.',
  sinFoto:
    'Cuando esta persona registró, la cámara no funcionaba o estaba desconectada. El registro sí ' +
    'cuenta; solo que no hay foto.',
  revision:
    'Registros en los que el sistema notó algo raro y te pide echarles un ojo. No quiere decir que ' +
    'alguien hizo trampa: quiere decir que algo no cuadró.',
  soloConFoto: 'Muestra solo los registros cuya foto todavía está guardada en esta computadora.',
  huella:
    'Es como la huella digital de la foto: un código que cambia si alguien modifica la foto, aunque ' +
    'sea un poquito. Si coincide, la foto es exactamente la que se tomó al registrar.',
  recuperacion:
    'Es la llave de emergencia de las fotos. Si esta computadora se descompone o se reinstala ' +
    'Windows, solo con esta contraseña se pueden abrir las fotos en otra. Escríbela en la hoja de ' +
    'credenciales y guárdala en un lugar seguro. Nadie puede recuperarla si se pierde.',
  inactividad:
    'Si nadie toca la computadora durante unos minutos, el modo administrador se cierra solo. Así, ' +
    'si te levantas y lo dejas abierto, nadie más puede ver las fotos.',
  zoom:
    'Para ver mejor la cara: usa "+ Acercar" y "− Alejar", o la rueda del ratón. Cuando la foto está ' +
    'acercada, arrástrala con el ratón para moverte.',
  exportar:
    'Copia a una memoria USB los registros que cumplen los filtros de arriba (fechas, empleado, ' +
    'revisión), con sus fotos, en un solo archivo. Cada foto lleva escritos la fecha, la hora, si ' +
    'fue entrada o salida, el número de empleado y el kiosco. Los registros van en una tabla que ' +
    'se abre con Excel. Queda anotado quién lo hizo y cuándo.',
  sinCandado:
    'En esta computadora las fotos están guardadas con candado: nadie puede abrirlas fuera de este ' +
    'programa. En la memoria salen SIN candado: cualquiera que la tenga puede verlas. Por eso ' +
    'guárdala bajo llave, no la prestes y borra los archivos cuando ya no los necesites.',
  otraCarpeta:
    'Algunos discos USB grandes no aparecen en la lista de memorias. Con este botón se abre la ' +
    'ventana de Windows para elegirlos a mano. No deja guardar en el disco de esta computadora.',
} as const;

/** Lo que significa cada estado de una foto que no se pudo mostrar. */
const EXPLICACION_SIN_FOTO: Record<Exclude<FotoParaAuditoria['estado'], 'con_foto'>, string> = {
  sin_foto: 'Este registro no tiene foto: la cámara no funcionaba cuando se registró.',
  eliminada_por_antiguedad:
    'La foto se borró sola porque ya pasaron 30 días. El registro de entrada o salida sigue guardado.',
  faltante:
    'La foto debería estar en esta computadora y no está. Avisa a quien le da soporte al sistema.',
  alterada:
    'Alguien modificó esta foto: ya no coincide con su huella. No la uses como prueba y avisa a ' +
    'quien le da soporte al sistema.',
  llave_no_disponible:
    'Esta foto se guardó con una llave anterior de este kiosco. Para abrirla hace falta la ' +
    'contraseña de recuperación.',
};

@Component({
  selector: 'kiosco-modo-admin',
  imports: [NgTemplateOutlet, Ayuda],
  templateUrl: './modo-admin.html',
})
export class ModoAdmin implements OnInit, OnDestroy {
  private readonly puente = inject(PuenteKiosco);

  /**
   * Se cierra el modo administrador. Lleva el mensaje que la pantalla
   * principal debe mostrar, o `null` si no hay nada que decir.
   */
  readonly cerrar = output<string | null>();

  protected readonly zona = computed(
    () => this.puente.configuracion()?.zonaHoraria ?? 'America/Matamoros',
  );

  // --------------------------------------------------------------------------
  //  Inicio de sesion
  // --------------------------------------------------------------------------
  protected readonly usuario = signal('');
  protected readonly contrasena = signal('');
  protected readonly mostrarContrasena = signal(false);
  protected readonly mayusculasActivadas = signal(false);
  protected readonly entrando = signal(false);

  protected readonly sesion = signal<SesionAdminParaInterfaz | null>(null);

  // --------------------------------------------------------------------------
  //  Auditoria
  // --------------------------------------------------------------------------
  protected readonly filtros = signal<FiltrosAuditoria>({
    desde: this.hoy(),
    hasta: this.hoy(),
    empleadoId: null,
    bandera: null,
    soloConFoto: false,
  });
  protected readonly empleados = signal<EmpleadoParaFiltro[]>([]);
  protected readonly registros = signal<MarcaParaAuditoria[]>([]);
  protected readonly buscando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly seleccionada = signal<MarcaParaAuditoria | null>(null);
  protected readonly foto = signal<FotoParaAuditoria | null>(null);
  protected readonly cargandoFoto = signal(false);

  /** "Conservar" pide motivo: es para casos en disputa, y el caso se anota. */
  protected readonly pidiendoMotivo = signal(false);
  protected readonly motivo = signal('');

  // --------------------------------------------------------------------------
  //  Contrasena de recuperacion (D-024)
  // --------------------------------------------------------------------------
  protected readonly definiendoRecuperacion = signal(false);
  protected readonly recuperacion1 = signal('');
  protected readonly recuperacion2 = signal('');
  protected readonly mensajeRecuperacion = signal<string | null>(null);

  // --------------------------------------------------------------------------
  //  Exportacion a USB
  // --------------------------------------------------------------------------
  /** `null`: el panel esta cerrado. */
  protected readonly exportacion = signal<'eligiendo' | 'guardando' | 'lista' | null>(null);
  /** `null` mientras se busca. */
  protected readonly memorias = signal<MemoriaUsb[] | null>(null);
  protected readonly resultadoExportacion = signal<ResultadoExportacion | null>(null);
  protected readonly errorExportacion = signal<string | null>(null);

  protected readonly NOMBRES_DE_BANDERAS = NOMBRES_DE_BANDERAS;
  protected readonly AYUDA_BANDERAS = AYUDA_BANDERAS;
  protected readonly AYUDA = AYUDA;
  protected readonly BANDERAS = Object.keys(NOMBRES_DE_BANDERAS);

  private cancelarAvisoDeCierre: (() => void) | null = null;
  private ultimoAvisoDeActividadMs = 0;

  ngOnInit(): void {
    this.cancelarAvisoDeCierre =
      this.puente.admin?.alCerrarSesion(() => this.terminar(MENSAJE_SESION_CERRADA)) ?? null;
  }

  ngOnDestroy(): void {
    this.cancelarAvisoDeCierre?.();
    // La foto descifrada se suelta al cerrar: vive solo mientras se mira.
    this.foto.set(null);
  }

  // --------------------------------------------------------------------------
  //  Teclado y actividad
  // --------------------------------------------------------------------------

  /**
   * Cualquier movimiento cuenta como "sigo aqui". Sin esto, quien se queda
   * mirando una foto dos minutos sin tocar nada seria sacado a media revision.
   * Se avisa como mucho cada N segundos: mas seguido no aporta nada.
   */
  @HostListener('window:mousemove')
  @HostListener('window:keydown')
  @HostListener('window:click')
  protected hayActividad(): void {
    const sesion = this.sesion();
    if (!sesion) return;
    const ahora = Date.now();
    if (ahora - this.ultimoAvisoDeActividadMs < sesion.segundosEntreAvisosDeActividad * 1000) return;
    this.ultimoAvisoDeActividadMs = ahora;
    void this.puente.admin?.seguirActivo(sesion.token);
  }

  @HostListener('window:keydown.escape')
  protected alPresionarEscape(): void {
    if (!this.sesion()) {
      this.terminar(null);
    } else if (this.exportacion()) {
      this.cerrarExportacion();
    } else if (this.ampliada()) {
      this.cerrarAmpliada();
    } else if (this.seleccionada()) {
      this.cerrarFoto();
    }
  }

  /** El aviso de mayusculas se revisa con cada tecla del campo de contrasena. */
  protected revisarMayusculas(evento: KeyboardEvent): void {
    // `getModifierState` dice si el bloqueo de mayusculas esta puesto aunque
    // la tecla presionada no sea una letra.
    this.mayusculasActivadas.set(evento.getModifierState?.('CapsLock') ?? false);
  }

  // --------------------------------------------------------------------------
  //  Entrar y salir
  // --------------------------------------------------------------------------

  protected async entrar(): Promise<void> {
    const admin = this.puente.admin;
    if (!admin || this.entrando()) return;
    if (!this.usuario().trim() || !this.contrasena()) return;

    this.entrando.set(true);
    const resultado = await admin.entrar(this.usuario().trim(), this.contrasena());
    // La contrasena no se queda en memoria ni un segundo mas de lo necesario.
    this.contrasena.set('');
    this.entrando.set(false);

    if (!resultado.ok) {
      // Decision del 22-09-2026: un fallo REGRESA a la pantalla principal.
      this.terminar(resultado.mensaje);
      return;
    }

    this.sesion.set(resultado.datos);
    this.ultimoAvisoDeActividadMs = Date.now();
    await Promise.all([this.cargarEmpleados(), this.buscar()]);
  }

  protected async salir(): Promise<void> {
    const sesion = this.sesion();
    if (sesion) await this.puente.admin?.salir(sesion.token);
    this.terminar(null);
  }

  private terminar(mensaje: string | null): void {
    this.sesion.set(null);
    this.foto.set(null);
    this.seleccionada.set(null);
    this.cerrar.emit(mensaje);
  }

  /**
   * Revisa una respuesta del proceso principal. Si la sesion se vencio, cierra
   * todo; si fue otro error, lo muestra. Devuelve los datos o `null`.
   */
  private atender<T>(resultado: ResultadoAdmin<T> | undefined): T | null {
    if (!resultado) return null;
    if (resultado.ok) {
      this.error.set(null);
      return resultado.datos;
    }
    if (resultado.sesionVencida) {
      this.terminar(MENSAJE_SESION_CERRADA);
      return null;
    }
    this.error.set(resultado.mensaje);
    return null;
  }

  // --------------------------------------------------------------------------
  //  Busqueda
  // --------------------------------------------------------------------------

  private async cargarEmpleados(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    const lista = this.atender(await this.puente.admin?.listarEmpleados(sesion.token));
    if (lista) this.empleados.set(lista);
  }

  protected cambiarFiltro<K extends keyof FiltrosAuditoria>(campo: K, valor: FiltrosAuditoria[K]): void {
    this.filtros.update((actual) => ({ ...actual, [campo]: valor }));
    void this.buscar();
  }

  protected async buscar(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.buscando.set(true);
    const lista = this.atender(await this.puente.admin?.buscarRegistros(sesion.token, this.filtros()));
    this.buscando.set(false);
    if (lista) this.registros.set(lista);
  }

  // --------------------------------------------------------------------------
  //  La foto
  // --------------------------------------------------------------------------

  protected async abrirFoto(registro: MarcaParaAuditoria): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;

    this.seleccionada.set(registro);
    this.foto.set(null);
    this.pidiendoMotivo.set(false);
    this.motivo.set('');

    // Sin foto en disco no hay nada que pedir (ni que anotar en la bitacora).
    if (registro.fotoEstado === 'sin_foto' || registro.fotoEstado === 'eliminada_por_antiguedad') {
      this.foto.set({ estado: registro.fotoEstado });
      return;
    }

    this.cargandoFoto.set(true);
    const foto = this.atender(await this.puente.admin?.verFoto(sesion.token, registro.id));
    this.cargandoFoto.set(false);
    // Si mientras cargaba se eligio otro renglon, esta respuesta ya no aplica.
    if (foto && this.seleccionada()?.id === registro.id) this.foto.set(foto);
  }

  protected cerrarFoto(): void {
    this.cerrarAmpliada();
    this.seleccionada.set(null);
    this.foto.set(null);
    this.pidiendoMotivo.set(false);
  }

  // --------------------------------------------------------------------------
  //  Visor ampliado con zoom
  // --------------------------------------------------------------------------
  //  La foto a pantalla completa. Se acerca con los botones o la rueda del
  //  raton, y ya acercada se mueve arrastrandola. Doble clic: acercar/volver.
  //  Los datos de la foto se quedan fijos abajo, sin agrandarse con el zoom.

  protected readonly ampliada = signal(false);
  protected readonly zoom = signal(1);
  protected readonly desplazamiento = signal({ x: 0, y: 0 });
  protected readonly arrastrando = signal(false);
  private inicioArrastre: { x: number; y: number; desdeX: number; desdeY: number } | null = null;

  protected abrirAmpliada(): void {
    this.restablecerZoom();
    this.ampliada.set(true);
  }

  protected cerrarAmpliada(): void {
    this.ampliada.set(false);
    this.restablecerZoom();
  }

  protected acercar(): void {
    const s = this.sesion();
    if (!s) return;
    this.zoom.update((z) => Math.min(z + s.pasoZoomFoto, s.zoomMaximoFoto));
  }

  protected alejar(): void {
    const s = this.sesion();
    if (!s) return;
    this.zoom.update((z) => Math.max(z - s.pasoZoomFoto, 1));
    // De vuelta a tamaño normal, la foto regresa al centro.
    if (this.zoom() === 1) this.desplazamiento.set({ x: 0, y: 0 });
  }

  protected restablecerZoom(): void {
    this.zoom.set(1);
    this.desplazamiento.set({ x: 0, y: 0 });
  }

  protected alternarZoom(): void {
    if (this.zoom() > 1) this.restablecerZoom();
    else this.zoom.set(Math.min(2, this.sesion()?.zoomMaximoFoto ?? 2));
  }

  protected alGirarRueda(evento: WheelEvent): void {
    evento.preventDefault();
    if (evento.deltaY < 0) this.acercar();
    else this.alejar();
  }

  protected empezarArrastre(evento: PointerEvent): void {
    if (this.zoom() === 1) return;
    const { x, y } = this.desplazamiento();
    this.inicioArrastre = { x: evento.clientX, y: evento.clientY, desdeX: x, desdeY: y };
    this.arrastrando.set(true);
    (evento.target as Element).setPointerCapture?.(evento.pointerId);
  }

  protected moverArrastre(evento: PointerEvent): void {
    const inicio = this.inicioArrastre;
    if (!inicio) return;
    // Se divide entre el zoom para que la foto siga al raton a la misma
    // velocidad, este acercada 2x o 4x.
    this.desplazamiento.set({
      x: inicio.desdeX + (evento.clientX - inicio.x) / this.zoom(),
      y: inicio.desdeY + (evento.clientY - inicio.y) / this.zoom(),
    });
  }

  protected soltarArrastre(): void {
    this.inicioArrastre = null;
    this.arrastrando.set(false);
  }

  protected explicacion(estado: FotoParaAuditoria['estado']): string {
    return estado === 'con_foto' ? '' : EXPLICACION_SIN_FOTO[estado];
  }

  /** "Conservar" o "quitar Conservar", segun como este. */
  protected async confirmarConservar(): Promise<void> {
    const sesion = this.sesion();
    const registro = this.seleccionada();
    if (!sesion || !registro || this.motivo().trim().length < 3) return;

    const conservar = registro.fotoEstado !== 'conservada';
    const hecho = this.atender(
      await this.puente.admin?.conservarFoto(sesion.token, registro.id, conservar, this.motivo().trim()),
    );
    if (!hecho) return;

    const actualizado: MarcaParaAuditoria = {
      ...registro,
      fotoEstado: hecho.conservar ? 'conservada' : 'disponible',
    };
    this.seleccionada.set(actualizado);
    this.registros.update((lista) => lista.map((r) => (r.id === registro.id ? actualizado : r)));
    this.pidiendoMotivo.set(false);
    this.motivo.set('');
  }

  // --------------------------------------------------------------------------
  //  Contrasena de recuperacion
  // --------------------------------------------------------------------------

  protected async guardarRecuperacion(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;

    if (this.recuperacion1().length < sesion.largoMinimoContrasenaRecuperacion) {
      this.mensajeRecuperacion.set(
        `Debe tener al menos ${sesion.largoMinimoContrasenaRecuperacion} letras o números. ` +
          'Sirve una frase de varias palabras, por ejemplo: "el perro come tortillas".',
      );
      return;
    }
    if (this.recuperacion1() !== this.recuperacion2()) {
      this.mensajeRecuperacion.set('Las dos no son iguales. Escríbelas otra vez.');
      return;
    }

    const resultado = await this.puente.admin?.definirRecuperacion(sesion.token, this.recuperacion1());
    if (!resultado) return;
    if (!resultado.ok) {
      if (resultado.sesionVencida) this.terminar(MENSAJE_SESION_CERRADA);
      else this.mensajeRecuperacion.set(resultado.mensaje);
      return;
    }

    this.recuperacion1.set('');
    this.recuperacion2.set('');
    this.definiendoRecuperacion.set(false);
    this.mensajeRecuperacion.set(null);
    this.sesion.update((s) => (s ? { ...s, tieneContrasenaDeRecuperacion: true } : s));
  }

  // --------------------------------------------------------------------------
  //  Exportacion a USB
  // --------------------------------------------------------------------------
  //  La pantalla nunca manda una ruta: elige una LETRA de la lista que le dio
  //  el proceso principal, o le pide a este que abra la ventana de Windows.

  protected abrirExportacion(): void {
    this.resultadoExportacion.set(null);
    this.errorExportacion.set(null);
    this.exportacion.set('eligiendo');
    void this.buscarMemorias();
  }

  protected cerrarExportacion(): void {
    // Mientras se escribe no se cierra: la persona tiene que ver como termino.
    if (this.exportacion() === 'guardando') return;
    this.exportacion.set(null);
  }

  protected async buscarMemorias(): Promise<void> {
    const sesion = this.sesion();
    if (!sesion) return;
    this.memorias.set(null);
    const resultado = await this.puente.admin?.buscarMemoriasUsb(sesion.token);
    if (resultado && !resultado.ok && resultado.sesionVencida) {
      this.terminar(MENSAJE_SESION_CERRADA);
      return;
    }
    this.memorias.set(resultado?.ok ? resultado.datos : []);
  }

  protected exportarAUsb(unidad: string): Promise<void> {
    return this.exportar((token, filtros) => this.puente.admin?.exportarAUsb(token, filtros, unidad));
  }

  protected exportarACarpeta(): Promise<void> {
    return this.exportar((token, filtros) => this.puente.admin?.exportarACarpeta(token, filtros));
  }

  private async exportar(
    pedir: (
      token: string,
      filtros: FiltrosAuditoria,
    ) => Promise<ResultadoAdmin<ResultadoExportacion | null>> | undefined,
  ): Promise<void> {
    const sesion = this.sesion();
    if (!sesion || this.exportacion() === 'guardando') return;

    this.errorExportacion.set(null);
    this.exportacion.set('guardando');
    const resultado = await pedir(sesion.token, this.filtros());

    if (!resultado) {
      this.exportacion.set('eligiendo');
      return;
    }
    if (!resultado.ok) {
      if (resultado.sesionVencida) {
        this.exportacion.set(null);
        this.terminar(MENSAJE_SESION_CERRADA);
        return;
      }
      this.errorExportacion.set(resultado.mensaje);
      this.exportacion.set('eligiendo');
      return;
    }
    // `null`: cerro la ventana de Windows sin elegir. Se regresa a la lista.
    if (!resultado.datos) {
      this.exportacion.set('eligiendo');
      return;
    }
    this.resultadoExportacion.set(resultado.datos);
    this.exportacion.set('lista');
  }

  /** 15 032 385 536 -> "14 GB" */
  protected espacio(bytes: number | null): string {
    if (bytes === null) return '';
    const gb = bytes / 1024 ** 3;
    return gb >= 1 ? `${Math.floor(gb)} GB libres` : `${Math.floor(bytes / 1024 ** 2)} MB libres`;
  }

  /** "22/09/2026" a partir de "2026-09-22", para repetir los filtros con palabras. */
  protected fechaDeFiltro(fecha: string | null): string {
    if (!fecha) return '';
    const [ano, mes, dia] = fecha.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  protected nombreDeEmpleado(id: string | null): string {
    return this.empleados().find((e) => e.id === id)?.nombreCompleto ?? '';
  }

  // --------------------------------------------------------------------------
  //  Formato (siempre con la zona configurada, nunca la de Windows)
  // --------------------------------------------------------------------------

  private hoy(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.puente.configuracion()?.zonaHoraria ?? 'America/Matamoros',
    }).format(new Date());
  }

  protected fecha(ms: number): string {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: this.zona(),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(ms));
  }

  protected hora(ms: number): string {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: this.zona(),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  }

  protected valorDe(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
