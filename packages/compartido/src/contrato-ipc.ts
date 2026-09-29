/**
 * ============================================================================
 *  CONTRATO IPC  (el "menu" de lo que la interfaz le puede pedir al sistema)
 * ============================================================================
 *
 *  ¿Que es IPC?
 *  ------------
 *  Electron parte la aplicacion en DOS programas separados que corren al mismo
 *  tiempo:
 *
 *    - PROCESO PRINCIPAL (main): es Node.js. Puede leer archivos, abrir la base
 *      de datos, hablar con internet. Es el que tiene poder.
 *
 *    - PROCESO DE RENDERIZADO (renderer): es un navegador Chrome con tu app de
 *      Angular adentro. Pinta la pantalla. NO tiene poder ninguno, a proposito.
 *
 *  IPC (Inter-Process Communication) es como se mandan mensajes entre ellos.
 *
 *  ¿Por que tanta separacion?
 *  --------------------------
 *  Porque el renderer muestra contenido web, y el contenido web es la parte
 *  mas facil de atacar. Si el renderer pudiera leer archivos, cualquier fallo
 *  en la interfaz se convertiria en acceso total a la PC del kiosco.
 *
 *  CLAUDE.md 3.1 lo exige asi:
 *    "Exponer operaciones ESPECIFICAS (ej. registrarMarca, obtenerEstado),
 *     jamas genericas (ejecutarSQL, leerArchivo)."
 *
 *  La diferencia es enorme. Compara:
 *
 *    MAL:  api.ejecutarSQL("DELETE FROM marcas")   <- la interfaz puede TODO
 *    BIEN: api.registrarMarca({...})               <- la interfaz solo puede ESTO
 *
 *  Con la version "MAL", quien logre inyectar codigo en la pantalla borra la
 *  asistencia del mes. Con la version "BIEN", lo peor que puede hacer es
 *  registrar una marca... que es justo lo que el kiosco hace de todos modos.
 *
 *  Este archivo define ese menu cerrado de operaciones. Nada fuera de esta
 *  lista existe para la interfaz.
 */

import type {
  EstadoKiosco,
  ResultadoCambioPin,
  ResultadoIdentificacion,
  ResultadoRegistro,
  TipoMarca,
} from './tipos';

/**
 * Nombres de los canales de mensajes.
 *
 * Los ponemos en constantes en vez de escribir el texto a mano en cada lado,
 * porque si te equivocas en una letra ('kiosco:identficar') el programa no
 * falla: simplemente el mensaje nunca llega y te vuelves loco buscando.
 * Con constantes, el editor te autocompleta y el error es imposible.
 *
 * El prefijo `kiosco:` es solo orden, para agrupar los canales por tema.
 */
export const CANALES = {
  /** Valida numero de empleado + PIN y devuelve a quien pertenece. */
  identificar: 'kiosco:identificar',
  /** Guarda la marca (entrada o salida) con su foto. */
  registrarMarca: 'kiosco:registrar-marca',
  /** El empleado cancelo en la confirmacion: se tira el pase sin registrar nada. */
  cancelarRegistro: 'kiosco:cancelar-registro',
  prepararRegistro: 'kiosco:preparar-registro',
  cerrarKiosco: 'kiosco:cerrar',
  /** Tras registrar con un PIN temporal: el empleado elige uno propio (D-042). */
  elegirPin: 'kiosco:elegir-pin',
  /** Pide el estado actual: conexion, pendientes, camara. */
  obtenerEstado: 'kiosco:obtener-estado',
  /** Pide la configuracion vigente (la del archivo mezclada con la de la nube). */
  obtenerConfiguracion: 'kiosco:obtener-configuracion',
  /** Pide la lista de empleados activos. Solo se usa en el modo 'lista'. */
  obtenerEmpleadosParaLista: 'kiosco:obtener-empleados-lista',
  /** Cambia el modo de identificacion. SOLO funciona en desarrollo. */
  cambiarModoIdentificacion: 'kiosco:cambiar-modo-identificacion',
  /** La interfaz avisa que la camara se conecto o se desconecto. */
  reportarEstadoCamara: 'kiosco:reportar-estado-camara',
  /** Minimiza el kiosco unos minutos para prestar la computadora. */
  pausarKiosco: 'kiosco:pausar',
  /** Trae los ultimos registros guardados, para la pantalla de consulta. */
  obtenerRegistros: 'kiosco:obtener-registros',
  /** Da de alta este kiosco con el codigo de 8 caracteres del panel. */
  enrolarKiosco: 'kiosco:enrolar',
  /** Canal de un solo sentido: el proceso principal AVISA a la interfaz que algo cambio. */
  estadoActualizado: 'kiosco:estado-actualizado',

  // --- Modo administrador (CLAUDE.md 5.2) --------------------------------
  // Cada canal pide el token de la sesion. Sin sesion viva, no hay datos.
  adminEntrar: 'admin:entrar',
  adminSalir: 'admin:salir',
  /** "Sigo aqui": la persona mueve el raton o teclea, aunque no pida nada. */
  adminSeguirActivo: 'admin:seguir-activo',
  adminBuscarRegistros: 'admin:buscar-registros',
  adminListarEmpleados: 'admin:listar-empleados',
  adminVerFoto: 'admin:ver-foto',
  adminConservarFoto: 'admin:conservar-foto',
  adminDefinirRecuperacion: 'admin:definir-recuperacion',
  /** Que memorias USB hay conectadas. */
  adminBuscarMemoriasUsb: 'admin:buscar-memorias-usb',
  /** Guarda el ZIP en una de esas memorias. */
  adminExportarAUsb: 'admin:exportar-a-usb',
  /** Guarda el ZIP donde el administrador elija con la ventana de Windows. */
  adminExportarACarpeta: 'admin:exportar-a-carpeta',
  /** Version, actualizacion descargada y registros que la oficina no acepto. */
  adminEstadoDelKiosco: 'admin:estado-del-kiosco',
  /** Vuelve a poner en la cola los registros que la oficina rechazo. */
  adminReintentarRechazados: 'admin:reintentar-rechazados',
  adminDescartarRechazados: 'admin:descartar-rechazados',
  /** Abre fotos de una llave anterior con la contrasena de recuperacion. */
  adminRecuperarFotos: 'admin:recuperar-fotos',
  /** Instala la version nueva ya descargada y reinicia el kiosco. */
  adminInstalarActualizacion: 'admin:instalar-actualizacion',
  /** Un solo sentido: la sesion se cerro sola por inactividad. */
  adminSesionCerrada: 'admin:sesion-cerrada',
} as const;

/** Lo que la interfaz manda para identificarse. */
export interface SolicitudIdentificacion {
  /**
   * Con lo que el empleado se identifica.
   *
   * Que contiene depende de `IDENTIFICACION.modo` en la configuracion:
   *   modo 'usuario' -> "dgomez"
   *   modo 'lista'   -> el id del empleado que eligio de la lista
   *   modo 'numero'  -> "0123"
   *
   * Se llama `identificador` y no `usuario` justamente para que el nombre no
   * mienta cuando el modo cambie. Un campo que se llama `numeroEmpleado` y a
   * veces trae letras es una trampa para quien lea el codigo despues.
   */
  identificador: string;
  pin: string;
}

/** Un empleado tal como se muestra en el modo 'lista'. */
export interface EmpleadoParaLista {
  id: string;
  /** Nombre corto para el boton: "Dalton G." */
  nombreParaMostrar: string;

  /**
   * Como esta ahora mismo, segun su ultima marca del dia:
   *
   *   'sin_marcar'  todavia no ha checado hoy
   *   'adentro'     su ultima marca fue ENTRADA
   *   'afuera'      su ultima marca fue SALIDA
   *
   * Sirve para que cada quien vea de un vistazo si ya checo, sin tener que
   * volver a teclear su PIN para averiguarlo. Ese era justamente el problema
   * del lector de huella: "no se si marque, mejor marco otra vez".
   */
  estado: 'sin_marcar' | 'adentro' | 'afuera';

  /** La hora de esa ultima marca ("06:02"), o null si no ha checado. */
  horaUltimaMarca: string | null;

  /**
   * Que accion se sugiere para esta persona. La pantalla la usa para pintar
   * el boton con el color que corresponde ANTES de que teclee nada.
   */
  accionSugerida: TipoMarca;
}

/** Lo que la interfaz manda para registrar la marca, una vez ya identificado. */
export interface SolicitudRegistro {
  /**
   * El pase de un solo uso que devolvio `identificar`.
   *
   * Fijate en lo que NO va aqui: el id del empleado. La pantalla ya no dice
   * a nombre de quien se registra la marca, porque no le corresponde
   * decidirlo. Lo unico que hace es devolver el pase que le dieron, y el
   * proceso principal busca en su memoria a quien pertenece.
   *
   * Antes de esto, un `window.kiosco.registrarMarca({empleadoId: '...'})`
   * escrito en la consola bastaba para registrar la entrada de otra persona
   * sin saber su PIN. Ver `identificaciones-pendientes.ts`.
   */
  tokenRegistro: string;
  /** El tipo definitivo: el sugerido, o el que el empleado eligio con el boton. */
  tipo: TipoMarca;
  /**
   * La foto como texto en formato data URL ("data:image/jpeg;base64,...").
   * `null` si la camara no estaba disponible: el registro se hace igual y se
   * levanta la bandera `sin_camara` (CLAUDE.md 5).
   */
  fotoJpegBase64: string | null;
  /**
   * Medidas del frame para detectar lente tapado. La interfaz las calcula
   * porque es quien tiene el video; el proceso principal solo decide.
   * `null` si no hubo foto.
   */
  medicionesImagen: { brilloPromedio: number; varianza: number } | null;
}

/** Lo que responde un intento de pausar el kiosco. */
/** Como termino el intento de dar de alta el kiosco. `mensaje` se muestra tal cual. */
export type ResultadoEnrolamiento =
  | { ok: true; nombre: string }
  | { ok: false; mensaje: string };

export type ResultadoPausa =
  | { ok: true; minutos: number }
  | { ok: false; mensaje: string };

/**
 * Una marca tal como se ve en la pantalla de registros.
 *
 * Fijate en lo que NO trae: ni el hash del PIN, ni la ruta de la foto, ni el id
 * del empleado. Para pintar una tabla no hacen falta, asi que no viajan
 * (CLAUDE.md 3.1, minimo privilegio). De la foto solo se dice SI existe.
 */
export interface MarcaParaMostrar {
  id: string;
  /** Nombre abreviado, como en la lista: "Dalton G." */
  nombre: string;
  tipo: TipoMarca;
  /** Milisegundos UTC. La pantalla lo convierte con la zona configurada. */
  horaEstimadaMs: number;
  banderas: string[];
  tieneFoto: boolean;
  /** `true` si ya viajo a la nube. Hoy siempre falso: no hay nube todavia. */
  sincronizada: boolean;
}

export interface EstadoCamaraReportado {
  disponible: boolean;
  /** Texto del error del navegador, util para el diagnostico a distancia. */
  detalle?: string;
}

/**
 * ============================================================================
 *  LA API QUE VE ANGULAR
 * ============================================================================
 *
 *  Esta interfaz es EXACTAMENTE lo que aparecera como `window.kiosco` dentro
 *  de la aplicacion de Angular. Ni un metodo mas.
 *
 *  Todo devuelve `Promise` porque los mensajes IPC viajan entre procesos y eso
 *  toma tiempo (poquisimo, pero no es instantaneo). `Promise` es la forma de
 *  JavaScript de decir "esto te lo entrego en un momento".
 */
export interface ApiKiosco {
  identificar(solicitud: SolicitudIdentificacion): Promise<ResultadoIdentificacion>;
  registrarMarca(solicitud: SolicitudRegistro): Promise<ResultadoRegistro>;

  /**
   * Avisa que el empleado cancelo, para que el pase se tire de inmediato.
   *
   * No devuelve nada y no puede fallar: cancelar siempre "funciona". Si el
   * mensaje se perdiera, el pase caducaria solo en un minuto.
   */
  cancelarRegistro(tokenRegistro: string): Promise<void>;
  /** "Alguien eligio su nombre": el kiosco se pone al dia mientras teclea el PIN. */
  prepararRegistro(): Promise<void>;
  /** PC compartida: manda lo pendiente y cierra el kiosco. */
  cerrarKiosco(): Promise<void>;

  /**
   * Guarda el PIN que eligio el empleado (D-042). El permiso para hacerlo es
   * `tokenCambioPin`, que solo entrega `registrarMarca` a quien acaba de
   * registrar con un PIN temporal correcto.
   */
  elegirPin(tokenCambioPin: string, pinNuevo: string): Promise<ResultadoCambioPin>;
  obtenerEstado(): Promise<EstadoKiosco>;
  obtenerConfiguracion(): Promise<ConfiguracionParaInterfaz>;
  obtenerEmpleadosParaLista(): Promise<EmpleadoParaLista[]>;

  /**
   * Cambia el modo de identificacion en caliente.
   *
   * Es una herramienta de DESARROLLO para poder comparar los tres modos sin
   * recompilar. En produccion el proceso principal la rechaza y devuelve la
   * configuracion sin cambios.
   */
  cambiarModoIdentificacion(modo: 'usuario' | 'lista' | 'numero'): Promise<ConfiguracionParaInterfaz>;
  reportarEstadoCamara(estado: EstadoCamaraReportado): Promise<void>;

  /**
   * Minimiza el kiosco durante unos minutos (CONFIG.pausa).
   *
   * El codigo se comprueba en el proceso principal; la pantalla nunca lo
   * conoce, solo sabe cuantos digitos tiene.
   */
  pausarKiosco(codigo: string): Promise<ResultadoPausa>;

  /** Los ultimos registros guardados, para la pantalla de consulta. */
  obtenerRegistros(): Promise<MarcaParaMostrar[]>;

  /**
   * Da de alta el kiosco con el codigo que genero el jefe en el panel.
   * Solo funciona si el kiosco lo necesita (`EstadoKiosco.requiereEnrolamiento`).
   */
  enrolarKiosco(codigo: string): Promise<ResultadoEnrolamiento>;

  /**
   * Se suscribe a los avisos de cambio de estado.
   * Devuelve una funcion para cancelar la suscripcion; hay que llamarla cuando
   * el componente se destruye, o se acumulan suscripciones y se va la memoria.
   */
  alCambiarEstado(callback: (estado: EstadoKiosco) => void): () => void;

  /** El modo administrador. Ver `ApiAdmin`. */
  admin: ApiAdmin;
}

// ============================================================================
//  MODO ADMINISTRADOR  (CLAUDE.md 5.2)
// ============================================================================
//  La UNICA forma de ver las fotos. Todo pasa por aqui, y todo pide la sesion.

/** Lo que devuelve cualquier operacion del modo administrador. */
export type ResultadoAdmin<T> =
  | { ok: true; datos: T }
  /**
   * `sesionVencida`: la pantalla debe volver al inicio de sesion. Es distinto
   * de un error normal, que se muestra y se sigue.
   */
  | { ok: false; mensaje: string; sesionVencida?: boolean };

export interface SesionAdminParaInterfaz {
  token: string;
  nombre: string;
  rol: 'admin' | 'supervisor';
  minutosDeInactividad: number;
  /** Si es `false`, las fotos dependen solo de este perfil de Windows: hay que avisar. */
  tieneContrasenaDeRecuperacion: boolean;
  largoMinimoContrasenaRecuperacion: number;
  /** Que datos se pintan encima de la foto (configuracion.ts, MODO_ADMIN). */
  datosSobreLaFoto: { fechaHora: boolean; tipo: boolean; numeroEmpleado: boolean; nombre: boolean };
  segundosEntreAvisosDeActividad: number;
  zoomMaximoFoto: number;
  pasoZoomFoto: number;
  /** ¿Se ofrece "Elegir otra carpeta" al exportar? (EXPORTACION.permitirElegirCarpeta) */
  permitirElegirCarpeta: boolean;
  /** Tope de registros por exportacion, para decirlo en pantalla. */
  maximoRegistrosExportacion: number;
}

/** Una memoria USB conectada. La pantalla solo la muestra y la elige por su letra. */
export interface MemoriaUsb {
  /** "E:" */
  unidad: string;
  /** Lo que Windows llama "etiqueta": "KINGSTON". Puede venir vacio. */
  etiqueta: string;
  /** Espacio libre, o `null` si Windows no lo dijo. */
  bytesLibres: number | null;
}

/** Como termino una exportacion. */
export interface ResultadoExportacion {
  /** Nombre del archivo ZIP, sin carpeta. */
  archivo: string;
  /** Donde quedo: "E:" o la carpeta elegida. */
  ubicacion: string;
  registros: number;
  /** Fotos que si van en el ZIP. */
  fotos: number;
  /** Fotos que deberian estar y no se pudieron incluir (faltantes, alteradas...). */
  fotosConProblema: number;
}

export interface FiltrosAuditoria {
  /** Dia inicial y final, "AAAA-MM-DD", en la zona configurada. Ambos incluidos. */
  desde: string | null;
  hasta: string | null;
  empleadoId: string | null;
  /** Solo las marcas con esta bandera. */
  bandera: string | null;
  soloConFoto: boolean;
}

/** Donde esta la foto de una marca, sin abrirla. */
export type EstadoFotoLocal =
  | 'disponible'
  | 'conservada'
  | 'sin_foto'
  | 'eliminada_por_antiguedad';

/** Un renglon de la pantalla de auditoria. Aqui SI va el nombre completo: es para el administrador. */
export interface MarcaParaAuditoria {
  id: string;
  empleadoId: string;
  nombreCompleto: string;
  numeroEmpleado: string | null;
  usuario: string;
  tipo: TipoMarca;
  horaEstimadaMs: number;
  banderas: string[];
  fotoEstado: EstadoFotoLocal;
}

export interface EmpleadoParaFiltro {
  id: string;
  nombreCompleto: string;
  numeroEmpleado: string | null;
}

/**
 * Una foto abierta. `jpegDataUrl` vive SOLO en memoria de la pantalla: no se
 * guarda en ningun lado, y al cerrar la foto se tira.
 */
export type FotoParaAuditoria =
  | { estado: 'con_foto'; jpegDataUrl: string; hashCorto: string }
  | { estado: 'sin_foto' | 'eliminada_por_antiguedad' | 'faltante' | 'alterada' | 'llave_no_disponible' };

/** Un registro que la oficina (la nube) no acepto. Se queda guardado en el kiosco. */
export interface RenglonRechazado {
  id: string;
  /** 'marca', 'evento', 'acceso_foto'... */
  tipo: string;
  creadoEn: string;
  /** El motivo que dio la nube ('empleado_desconocido', 'dispositivo_revocado'...). */
  motivo: string;
}

/** Lo que el modo administrador muestra del propio kiosco. */
export interface EstadoDelKioscoParaAdmin {
  version: string;
  /** Version nueva ya descargada, lista para instalar; `null` si no hay. */
  actualizacionLista: string | null;
  rechazados: RenglonRechazado[];
  totalRechazados: number;
  /** Fotos cifradas con una llave anterior (Windows ya no la abre): se recuperan con la contrasena. */
  fotosConLlaveAnterior: number;
}

export interface ResultadoRecuperacionFotos {
  llavesAbiertas: number;
  recuperadas: number;
  pendientes: number;
}

export interface ApiAdmin {
  entrar(usuario: string, contrasena: string): Promise<ResultadoAdmin<SesionAdminParaInterfaz>>;
  salir(token: string): Promise<void>;
  seguirActivo(token: string): Promise<void>;
  buscarRegistros(token: string, filtros: FiltrosAuditoria): Promise<ResultadoAdmin<MarcaParaAuditoria[]>>;
  listarEmpleados(token: string): Promise<ResultadoAdmin<EmpleadoParaFiltro[]>>;
  verFoto(token: string, marcaId: string): Promise<ResultadoAdmin<FotoParaAuditoria>>;
  conservarFoto(
    token: string,
    marcaId: string,
    conservar: boolean,
    motivo: string,
  ): Promise<ResultadoAdmin<{ conservar: boolean }>>;
  definirRecuperacion(token: string, contrasena: string): Promise<ResultadoAdmin<null>>;
  buscarMemoriasUsb(token: string): Promise<ResultadoAdmin<MemoriaUsb[]>>;
  /** Exporta lo que cumpla los filtros a la memoria de esa letra. */
  exportarAUsb(
    token: string,
    filtros: FiltrosAuditoria,
    unidad: string,
  ): Promise<ResultadoAdmin<ResultadoExportacion>>;
  /** Igual, pero la carpeta se elige en la ventana de Windows. `null` si se cancelo. */
  exportarACarpeta(
    token: string,
    filtros: FiltrosAuditoria,
  ): Promise<ResultadoAdmin<ResultadoExportacion | null>>;
  estadoDelKiosco(token: string): Promise<ResultadoAdmin<EstadoDelKioscoParaAdmin>>;
  reintentarRechazados(token: string): Promise<ResultadoAdmin<{ reintentados: number }>>;
  descartarRechazados(token: string, motivo: string): Promise<ResultadoAdmin<{ descartados: number }>>;
  instalarActualizacion(token: string): Promise<ResultadoAdmin<null>>;
  recuperarFotos(token: string, contrasena: string): Promise<ResultadoAdmin<ResultadoRecuperacionFotos>>;
  /** La sesion se cerro sola (inactividad). */
  alCerrarSesion(callback: () => void): () => void;
}

/**
 * Subconjunto de la configuracion que la interfaz necesita conocer.
 *
 * Fijate que NO le mandamos toda la configuracion: la interfaz no tiene por
 * que enterarse del costo de bcrypt ni de los intervalos de sincronizacion.
 * Principio de minimo privilegio: cada parte recibe solo lo que usa.
 */
export interface ConfiguracionParaInterfaz {
  /**
   * `true` si la app corre desde el codigo fuente (npm run kiosco:dev).
   * La pantalla lo usa para mostrar herramientas que NO deben existir en el
   * kiosco real, como el selector de modo de identificacion.
   */
  esDesarrollo: boolean;

  /** Como se identifica el empleado. Ver IDENTIFICACION.modo en configuracion.ts */
  modoIdentificacion: 'usuario' | 'lista' | 'numero';
  largoUsuarioMinimo: number;
  largoUsuarioMaximo: number;
  largoNumeroEmpleadoMinimo: number;
  largoNumeroEmpleadoMaximo: number;
  largoPinMinimo: number;
  largoPinMaximo: number;
  validarAutomaticamenteAlCompletarPin: boolean;
  segundosConfirmacionAutomatica: number;
  sonidosActivos: boolean;
  volumenSonidos: number;
  segundosInactividadParaLimpiar: number;
  segundosParaElegirSiHayDuda: number;
  /** Sin teclear en "Elige tu PIN" estos segundos: se cierra como "Ahora no". */
  segundosSinTeclearAlElegirPin: number;
  segundosMensajeExito: number;
  videoEnEspejo: boolean;
  mostrarTecladoEnPantalla: boolean;
  intervaloRelojMs: number;
  anchoFotoPx: number;
  calidadJpeg: number;
  intervaloVerificacionCamaraMs: number;

  /**
   * ¿Se muestra el boton de "Usar esta PC"? (CONFIG.pausa.permitida)
   * Si el kiosco esta en una computadora dedicada, se apaga y desaparece.
   */
  /** ¿Se muestra el boton "Ver registros"? (INTERFAZ.mostrarRegistrosEnKiosco) */
  mostrarRegistros: boolean;

  /** Cuanto dura el aviso "Intento fallido..." al regresar del modo administrador. */
  segundosAvisoModoAdmin: number;

  pausaPermitida: boolean;

  /**
   * Cuantos digitos tiene el codigo de pausa.
   *
   * El LARGO, no el codigo. La pantalla necesita saber cuantos puntos dibujar
   * y cuando dejar de esperar teclas; quien comprueba si el codigo es correcto
   * es el proceso principal.
   */
  largoCodigoDePausa: number;

  /** Cuantos minutos dura la pausa, para poder avisarlo antes de pausar. */
  minutosDePausa: number;
  /**
   * Umbrales de "camara tapada". Viajan a la pantalla SOLO para el medidor
   * de desarrollo, que los muestra en vivo para poder calibrarlos.
   *
   * La decision de verdad —la que levanta la bandera en la marca— la sigue
   * tomando el proceso principal. Si la tomara la pantalla, bastaria con
   * manipularla para que nunca avisara de una camara tapada.
   */
  umbralBrilloMinimo: number;
  umbralVarianzaMinima: number;
  zonaHoraria: string;

  /**
   * Identidad institucional que la pantalla debe mostrar.
   *
   * Los COLORES no viajan por aqui: llegan como variables CSS generadas a
   * partir de `tema.json` (ver `apps/kiosco-ui/generar-tema.mjs`). Por este
   * canal viaja solo el TEXTO, que si es dato y no estilo.
   */
  institucionNombreCorto: string;
  institucionFacultad: string;
  institucionMostrarEnKiosco: boolean;
  institucionLogoArchivo: string | null;
}
