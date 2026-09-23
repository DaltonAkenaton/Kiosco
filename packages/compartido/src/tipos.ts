/**
 * ============================================================================
 *  TIPOS DEL DOMINIO
 * ============================================================================
 *
 *  Un "tipo" en TypeScript es un contrato: describe que forma tiene un dato.
 *  No existe cuando el programa corre (no pesa nada, no se ejecuta); sirve
 *  para que el editor te avise ANTES de correr el programa si te equivocaste
 *  de nombre de campo o de tipo de valor.
 *
 *  Estos tipos son compartidos: los usa el kiosco, el panel y las Edge
 *  Functions. Asi los tres hablan exactamente el mismo idioma y es imposible
 *  que uno mande `tipo: "Entrada"` y el otro espere `tipo: "entrada"`.
 *
 *  Nombres de dominio en espanol (CLAUDE.md seccion 16).
 */

// ----------------------------------------------------------------------------
//  Marcas (los registros de entrada/salida)
// ----------------------------------------------------------------------------

/**
 * Los dos unicos valores posibles para el tipo de marca.
 * Esto se llama "union de literales": es como un menu cerrado. Si escribes
 * `tipo = 'entradaa'` el editor te lo marca en rojo de inmediato.
 */
export type TipoMarca = 'entrada' | 'salida';

/** De donde salio la marca: del kiosco o capturada a mano por el jefe. */
export type OrigenMarca = 'kiosco' | 'manual';

/**
 * Banderas = etiquetas de "esto hay que revisarlo".
 * CLAUDE.md es muy claro: las banderas NUNCA impiden registrar. Solo dejan
 * constancia para que el jefe lo revise despues en el panel.
 */
export type BanderaMarca =
  /** No habia camara disponible al momento de registrar. */
  | 'sin_camara'
  /** La foto salio negra o sin textura: lente tapado o cuarto a oscuras. */
  | 'foto_obstruida'
  /** El reloj de Windows no cuadra con el cronometro interno: posible manipulacion. */
  | 'reloj_sospechoso'
  /** La marca vino de un kiosco que ya habia sido dado de baja. */
  | 'dispositivo_revocado'
  /** La capturo el jefe a mano desde el panel. */
  | 'manual'
  /** La genero el sistema al cerrar una jornada que quedo abierta. */
  | 'cierre_automatico';

/**
 * Cada bandera en palabras, para quien no sabe que es "reloj_sospechoso".
 * Las usan la pantalla de auditoria y el CSV que se exporta a USB: asi el
 * archivo dice lo mismo que la pantalla.
 */
export const NOMBRES_DE_BANDERAS: Record<BanderaMarca, string> = {
  sin_camara: 'Sin cámara',
  foto_obstruida: 'Foto tapada',
  reloj_sospechoso: 'Hora dudosa',
  dispositivo_revocado: 'Kiosco dado de baja',
  manual: 'Captura manual',
  cierre_automatico: 'Sin salida',
};

/**
 * Las lecturas de tiempo que se guardan JUNTO a cada marca (CLAUDE.md 6).
 * La idea de fondo: no confiamos en la hora de Windows, asi que guardamos
 * varias mediciones distintas para poder detectar despues si alguien la movio.
 */
export interface LecturasDeReloj {
  /** `Date.now()` del kiosco al momento exacto del evento (milisegundos desde 1970, UTC). */
  horaDispositivoMs: number;

  /**
   * Cronometro interno que SOLO avanza y no se puede modificar desde Windows.
   * Por si solo no dice la hora; sirve para comparar: si pasaron 10 minutos de
   * cronometro pero 3 horas de reloj de pared, alguien movio el reloj.
   */
  monotonicoMs: number;

  /**
   * Identificador aleatorio de esta "sesion" de la app (se genera al arrancar).
   * El monotonico se reinicia en cada arranque, asi que solo se pueden comparar
   * dos lecturas si comparten el mismo `arranqueId`.
   */
  arranqueId: string;

  /** Ultimo desfase conocido entre el reloj de Windows y el del servidor, en ms. */
  desfaseServidorMs: number;

  /** La hora del dispositivo ya corregida con el desfase: la mejor estimacion que tenemos. */
  horaEstimadaMs: number;
}

/** Una marca tal como la crea el kiosco, antes de viajar a la nube. */
export interface MarcaLocal {
  /**
   * UUID generado EN EL KIOSCO (no en el servidor).
   * Es lo que permite reintentar la subida mil veces sin duplicar: el servidor
   * inserta con "ON CONFLICT DO NOTHING" sobre este id. A eso se le llama
   * operacion "idempotente" (repetirla no cambia el resultado).
   */
  id: string;
  empleadoId: string;
  usuario: string;
  dispositivoId: string;
  tipo: TipoMarca;
  origen: OrigenMarca;
  reloj: LecturasDeReloj;
  banderas: BanderaMarca[];
  /**
   * SHA-256 (hex) del JPEG, calculado ANTES de cifrarlo. `null` si no hubo foto.
   * Es lo unico de la foto que viaja a la nube (CLAUDE.md 5.1).
   */
  fotoHash: string | null;
}

// ----------------------------------------------------------------------------
//  Empleados (copia local para poder validar sin internet)
// ----------------------------------------------------------------------------

/**
 * Lo que el kiosco guarda de cada empleado en su SQLite.
 * OJO: aqui viaja el hash del PIN, no el PIN. Un hash es un resultado
 * irreversible: sirve para comprobar si un PIN es correcto, pero no se puede
 * "des-hashear" para averiguar cual era.
 */
export interface EmpleadoEnCache {
  id: string;
  /**
   * Con lo que el empleado se identifica en el kiosco: "dgomez".
   * Es UNICO y siempre en minusculas (ver usuarios.ts).
   */
  usuario: string;
  /**
   * El numero del gafete, si la facultad lo tiene registrado.
   * Es OPCIONAL a proposito: en la practica casi nadie se lo sabe, por eso no
   * sirve para identificarse. Se guarda solo como referencia administrativa.
   */
  numeroEmpleado: string | null;
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  /** Hash bcrypt. NUNCA debe salir de aqui ni aparecer en un log. */
  pinHash: string;
  /** Si es `true`, el jefe le reseteo el PIN y deberia cambiarlo. */
  pinTemporal: boolean;
  activo: boolean;
  actualizadoEn: string;
}

/** Nombre completo listo para mostrar en pantalla. */
export function nombreCompleto(empleado: EmpleadoEnCache): string {
  return `${empleado.nombre} ${empleado.apellidoPaterno} ${empleado.apellidoMaterno}`.trim();
}

// ----------------------------------------------------------------------------
//  Resultados que el proceso principal devuelve a la interfaz
// ----------------------------------------------------------------------------

/**
 * Resultado de teclear numero de empleado + PIN.
 *
 * Fijate en el patron: en lugar de "lanzar un error", devolvemos SIEMPRE un
 * objeto que dice `ok: true` u `ok: false`. TypeScript entonces te obliga a
 * revisar el caso de error antes de leer los datos. Se llama "union
 * discriminada" y evita pantallazos en blanco por errores no atendidos.
 */
export type ResultadoIdentificacion =
  | {
      ok: true;

      /**
       * EL PASE PARA REGISTRAR.  <-- la pieza central del bloque 3
       *
       * Un texto aleatorio, de un solo uso, que el proceso principal acaba de
       * guardar en su memoria junto con TRES cosas que la pantalla nunca ve:
       * quien es el empleado, la hora exacta del evento y las lecturas de
       * reloj de ese instante.
       *
       * ¿Por que no mandar el `empleadoId` y ya?
       *
       *   1. SEGURIDAD. Si la pantalla mandara el id del empleado al
       *      registrar, entonces cualquiera que logre ejecutar codigo en la
       *      pantalla podria registrar marcas de CUALQUIER empleado sin saber
       *      su PIN. Con el pase no: para tener uno hay que haber pasado por
       *      la verificacion de PIN, y solo sirve una vez.
       *
       *   2. LA HORA CORRECTA. CLAUDE.md 4.3 pide que el timestamp sea el del
       *      instante de la validacion, no el de cuando el empleado termino de
       *      leer la confirmacion tres segundos despues. Como la hora viaja
       *      dentro del pase (en el proceso principal), la espera de la
       *      confirmacion no mueve ni un milisegundo lo que se guarda.
       *
       * Caduca solo (SEGURIDAD_PIN.segundosDeVidaDeLaIdentificacion).
       */
      tokenRegistro: string;

      nombreParaMostrar: string;
      /** Que accion sugiere el sistema segun la ultima marca conocida. */
      accionSugerida: TipoMarca;

      /**
       * La hora del evento ya formateada ("06:02"), para la confirmacion.
       *
       * Viene calculada desde el proceso principal, con la zona horaria
       * configurada, en vez de que la pantalla haga `new Date()`. Asi la hora
       * que el empleado LEE es exactamente la que se va a GUARDAR, salida del
       * mismo reloj y de la misma zona. Dos relojes distintos para la misma
       * marca es como empiezan las discusiones de "yo llegue a las 6".
       */
      horaLocalTexto: string;

      /** `true` si el jefe le puso un PIN temporal y conviene avisarle. */
      pinTemporal: boolean;
    }
  | {
      ok: false;
      motivo: MotivoRechazo;
      /** Mensaje ya redactado en espanol, listo para mostrar en la pantalla. */
      mensaje: string;
      /** Si esta bloqueado, cuantos segundos le faltan para poder reintentar. */
      segundosRestantesDeBloqueo?: number;
    };

export type MotivoRechazo =
  | 'empleado_no_encontrado'
  | 'empleado_inactivo'
  | 'pin_incorrecto'
  | 'empleado_bloqueado'
  | 'datos_invalidos'
  | 'error_interno';

/** Resultado de guardar la marca. */
export type ResultadoRegistro =
  | { ok: true; marcaId: string; tipo: TipoMarca; horaLocalTexto: string; banderas: BanderaMarca[] }
  | { ok: false; mensaje: string };

// ----------------------------------------------------------------------------
//  Estado del kiosco (lo que se pinta en la barra de estado)
// ----------------------------------------------------------------------------

export interface EstadoKiosco {
  /** `true` si logro hablar con Supabase recientemente. */
  enLinea: boolean;
  /** Cuantas marcas esperan subir. CLAUDE.md 4.1 pide mostrarlo de forma discreta. */
  registrosPendientes: number;
  /** `false` si la camara esta caida: la interfaz muestra el aviso grande. */
  camaraDisponible: boolean;
  /** Fecha ISO de la ultima sincronizacion exitosa, o `null` si nunca. */
  ultimaSincronizacion: string | null;
  /** Version de la app, util para el soporte a distancia. */
  version: string;
  /** `true` mientras el kiosco no ha sido enrolado contra el panel. */
  requiereEnrolamiento: boolean;

  /**
   * `true` si alguien pauso el kiosco para usar la computadora.
   *
   * Mientras dure, la pantalla esta minimizada y NADIE PUEDE CHECAR. Por eso
   * la pausa vuelve sola y queda registrada como evento: ver
   * `servicios/pausa.ts`.
   */
  pausado: boolean;

  /** Cuando vuelve sola la pantalla (fecha ISO), o `null` si no hay pausa. */
  pausaTerminaEn: string | null;
}
