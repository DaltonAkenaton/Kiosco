/**
 * ============================================================================
 *  MANEJADORES IPC  (lo que el proceso principal hace cuando la pantalla pide algo)
 * ============================================================================
 *
 *  Por cada canal declarado en el contrato (`CANALES`), aqui hay exactamente
 *  un manejador. El patron de todos es el mismo, siempre en este orden:
 *
 *      1. VALIDAR la entrada con zod.
 *      2. HACER el trabajo.
 *      3. RESPONDER con un objeto {ok: true, ...} o {ok: false, mensaje}.
 *
 *  Nunca dejamos que un error se escape sin atender: si el proceso principal
 *  lanza una excepcion, la pantalla se queda colgada esperando... y el
 *  empleado se queda sin checar. Eso rompe la regla de oro del proyecto.
 *
 *  EL REGISTRO VA EN DOS TIEMPOS (bloque 3)
 *  ----------------------------------------
 *  Desde que existe la pantalla de confirmacion, registrar una marca son DOS
 *  mensajes y no uno:
 *
 *      identificar      valida el PIN, lee el reloj, y devuelve un PASE
 *                       (un texto al azar de un solo uso)
 *
 *      registrarMarca   canjea ese pase y guarda la marca con la hora que
 *                       quedo guardada DENTRO del pase
 *
 *      cancelarRegistro tira el pase sin guardar nada
 *
 *  Partirlo en dos no es un capricho de la interfaz: es lo que permite que la
 *  hora registrada sea la del momento en que el empleado tecleo su PIN y no
 *  la de tres segundos despues, y lo que impide que la pantalla registre
 *  marcas a nombre de quien se le antoje. El porque completo esta en
 *  `servicios/identificaciones-pendientes.ts`.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import {
  type BanderaMarca,
  CANALES,
  CONFIG,
  type ConfiguracionParaInterfaz,
  type EmpleadoParaLista,
  type MarcaParaMostrar,
  type EmpleadoEnCache,
  type EstadoKiosco,
  INSTITUCION,
  nombreCompleto,
  type ResultadoIdentificacion,
  type ResultadoPausa,
  type ResultadoRegistro,
} from '@kiosko/compartido';
import { cambiarModoIdentificacion, modoIdentificacionVigente } from '../configuracion-vigente';
import {
  accionSugeridaPara,
  buscarPorId,
  buscarPorNumeroEmpleado,
  buscarPorUsuario,
  listarActivosConUltimaMarca,
} from '../datos/repositorio-empleados';
import {
  contarPendientes,
  guardarMarca,
  horaDeLaUltimaMarca,
  listarMarcasRecientes,
  nuevoIdDeMarca,
} from '../datos/repositorio-marcas';
import { simularVerificacion, verificarPin } from '../servicios/autenticacion';
import {
  canjearPase,
  crearPase,
  descartarPase,
} from '../servicios/identificaciones-pendientes';
import { type FotoGuardada, guardarFoto, pareceObstruida } from '../servicios/fotos';
import { registrarEvento } from '../datos/repositorio-eventos';
import { estadoDePausa, pausar } from '../servicios/pausa';
import { detectarAnomaliasDeReloj, leerReloj } from '../servicios/reloj';
import { ES_DESARROLLO } from '../entorno';
import {
  EsquemaCambioDeModo,
  EsquemaCancelacion,
  EsquemaEstadoCamara,
  EsquemaPausa,
  EsquemaRegistro,
  esquemaIdentificacion,
} from './esquemas';

/**
 * Estado que el proceso principal mantiene en memoria mientras la app corre.
 *
 * Mas adelante varios de estos campos los llenara la base de datos y el
 * sincronizador. Por ahora viven aqui para que la interfaz ya pueda pintar
 * la barra de estado.
 */
const estado: EstadoKiosco = {
  enLinea: false,
  registrosPendientes: 0,
  camaraDisponible: false,
  ultimaSincronizacion: null,
  version: app.getVersion(),
  requiereEnrolamiento: true,
  pausado: false,
  pausaTerminaEn: null,
};

/**
 * Arma el paquete de configuracion que viaja a la pantalla.
 *
 * Esta en su propia funcion porque lo usan DOS canales: el que la pide y el
 * que cambia el modo. Si el objeto estuviera copiado en los dos lugares,
 * tarde o temprano uno se actualizaria y el otro no, y la pantalla mostraria
 * datos distintos segun por donde llegara.
 *
 * Fijate en que el modo NO sale de `CONFIG` sino de
 * `modoIdentificacionVigente()`: el valor de `CONFIG` es solo el punto de
 * partida, y puede haber cambiado desde que arranco la app.
 */
function configuracionParaInterfaz(): ConfiguracionParaInterfaz {
  return {
    esDesarrollo: ES_DESARROLLO,
    modoIdentificacion: modoIdentificacionVigente(),

    largoUsuarioMinimo: CONFIG.identificacion.largoUsuarioMinimo,
    largoUsuarioMaximo: CONFIG.identificacion.largoUsuarioMaximo,
    largoNumeroEmpleadoMinimo: CONFIG.identificacion.largoNumeroEmpleadoMinimo,
    largoNumeroEmpleadoMaximo: CONFIG.identificacion.largoNumeroEmpleadoMaximo,
    largoPinMinimo: CONFIG.identificacion.largoPinMinimo,
    largoPinMaximo: CONFIG.identificacion.largoPinMaximo,
    validarAutomaticamenteAlCompletarPin:
      CONFIG.identificacion.validarAutomaticamenteAlCompletarPin,

    segundosConfirmacionAutomatica: CONFIG.interfaz.segundosConfirmacionAutomatica,
    sonidosActivos: CONFIG.interfaz.sonidosActivos,
    volumenSonidos: CONFIG.interfaz.volumenSonidos,
    segundosInactividadParaLimpiar: CONFIG.interfaz.segundosInactividadParaLimpiar,
    segundosMensajeExito: CONFIG.interfaz.segundosMensajeExito,
    videoEnEspejo: CONFIG.interfaz.videoEnEspejo,
    mostrarTecladoEnPantalla: CONFIG.interfaz.mostrarTecladoEnPantalla,
    intervaloRelojMs: CONFIG.interfaz.intervaloRelojMs,

    anchoFotoPx: CONFIG.camara.anchoFotoPx,
    calidadJpeg: CONFIG.camara.calidadJpeg,
    intervaloVerificacionCamaraMs: CONFIG.camara.intervaloVerificacionMs,

    mostrarRegistros: CONFIG.interfaz.mostrarRegistrosEnKiosco,
    segundosAvisoModoAdmin: CONFIG.modoAdmin.segundosAvisoIntentoFallido,

    pausaPermitida: CONFIG.pausa.permitida,
    // El LARGO del codigo, nunca el codigo. Ver servicios/pausa.ts.
    largoCodigoDePausa: CONFIG.pausa.codigo.length,
    minutosDePausa: CONFIG.pausa.minutosParaVolver,
    umbralBrilloMinimo: CONFIG.camara.umbralBrilloMinimo,
    umbralVarianzaMinima: CONFIG.camara.umbralVarianzaMinima,

    // Cuando exista la sincronizacion, esta zona vendra de la tabla
    // `configuracion` de Supabase. Mientras, el valor por defecto.
    zonaHoraria: CONFIG.reloj.zonaHorariaPorDefecto,

    // Identidad institucional (solo el texto; los colores van por CSS).
    institucionNombreCorto: INSTITUCION.nombreCorto,
    institucionFacultad: INSTITUCION.facultad,
    institucionMostrarEnKiosco: INSTITUCION.mostrarEnKiosco,
    institucionLogoArchivo: INSTITUCION.logoArchivo,
  };
}

/**
 * Convierte una hora en milisegundos al texto "06:02" en la zona configurada.
 *
 * Se usa SOLO para mostrar. Lo que se guarda siempre son los milisegundos en
 * UTC (CLAUDE.md 6: "todo se guarda en UTC; conversion a hora local solo al
 * mostrar"). Guardar texto ya formateado seria un error: al cambiar de zona
 * horaria, el historico quedaria mintiendo.
 */
function horaLocalDe(milisegundos: number): string {
  return new Date(milisegundos).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CONFIG.reloj.zonaHorariaPorDefecto,
  });
}

/**
 * Busca al empleado usando el identificador que corresponda al modo vigente.
 *
 * Es una sola funcion en vez de tres caminos repartidos por el manejador:
 * asi, el dia que se agregue un cuarto modo, hay un solo lugar que tocar y
 * TypeScript avisa si se olvida un caso.
 */
function buscarSegunModo(identificador: string): EmpleadoEnCache | null {
  switch (modoIdentificacionVigente()) {
    case 'usuario':
      // El identificador ya viene normalizado por el esquema de zod
      // (minusculas, sin espacios), asi que se puede buscar tal cual.
      return buscarPorUsuario(identificador);
    case 'lista':
      return buscarPorId(identificador);
    case 'numero':
      return buscarPorNumeroEmpleado(identificador);
  }
}

/**
 * Registra TODOS los manejadores. Se llama una sola vez al arrancar.
 *
 * `ipcMain.handle(canal, funcion)` = "cuando llegue un mensaje por este canal,
 * corre esta funcion y devuelve su resultado a quien pregunto".
 */
export function registrarManejadoresIpc(): void {
  // ---------------------------------------------------------------------
  //  identificar: usuario (o numero, o id de la lista) + PIN
  // ---------------------------------------------------------------------
  ipcMain.handle(
    CANALES.identificar,
    async (_evento, datosCrudos): Promise<ResultadoIdentificacion> => {
      // El esquema se arma AHORA, no al cargar el archivo: asi respeta el modo
      // de identificacion vigente. Ver esquemas.ts y configuracion-vigente.ts.
      //
      // `safeParse` no lanza excepcion: devuelve {success: true/false}. Asi
      // controlamos nosotros el mensaje de error en vez de que reviente.
      const validacion = esquemaIdentificacion().safeParse(datosCrudos);

      if (!validacion.success) {
        // OJO: no metemos `datosCrudos` en el log. Ahi va el PIN.
        // CLAUDE.md 16: "Nunca registrar PINs, tokens ni fotos en logs".
        console.warn('[ipc] identificar: datos invalidos');
        return {
          ok: false,
          motivo: 'datos_invalidos',
          mensaje: 'Revisa tus datos e intenta de nuevo.',
        };
      }

      const { identificador, pin } = validacion.data;

      try {
        // --- 1. Buscar al empleado, segun el modo vigente -----------------
        const empleado = buscarSegunModo(identificador);

        if (!empleado) {
          // El usuario no existe. Esperamos lo mismo que habria tardado una
          // verificacion real ANTES de responder: si contestaramos al
          // instante, la diferencia de tiempo delataria que ese usuario no
          // esta en el sistema, y con eso se podria averiguar la lista
          // completa de empleados probando nombres.
          await simularVerificacion();
          return {
            ok: false,
            motivo: 'empleado_no_encontrado',
            // El mensaje es el MISMO que el de PIN incorrecto, a proposito.
            // Decir "ese usuario no existe" es regalar informacion.
            mensaje: 'Datos incorrectos. Intenta de nuevo.',
          };
        }

        if (!empleado.activo) {
          return {
            ok: false,
            motivo: 'empleado_inactivo',
            mensaje: 'Tu cuenta esta dada de baja. Avisa a tu jefe.',
          };
        }

        // --- 2. Verificar el PIN ------------------------------------------
        const verificacion = await verificarPin(empleado, pin);

        if (!verificacion.ok) {
          if (verificacion.motivo === 'empleado_bloqueado') {
            return {
              ok: false,
              motivo: 'empleado_bloqueado',
              mensaje:
                `Demasiados intentos. Espera ${verificacion.segundosRestantes} segundos ` +
                `o pide a tu jefe que registre tu asistencia.`,
              segundosRestantesDeBloqueo: verificacion.segundosRestantes,
            };
          }

          return {
            ok: false,
            motivo: 'pin_incorrecto',
            mensaje: 'Datos incorrectos. Intenta de nuevo.',
          };
        }

        // --- 3. LEER EL RELOJ AHORA ---------------------------------------
        //
        // CLAUDE.md 4.3: "Al validar, EN ESE INSTANTE: se captura timestamp,
        // lecturas de reloj y foto."
        //
        // Esta linea es el "instante" del que habla esa regla. A partir de
        // aqui el empleado puede tardar tres segundos o treinta en confirmar:
        // la hora de su marca ya quedo fijada, y es la de cuando llego.
        //
        // (La foto, la otra mitad de la regla, se toma en la pantalla en este
        // mismo momento, antes de que la confirmacion aparezca. Ver
        // `identificar()` en pantalla-principal.ts.)
        const reloj = leerReloj();

        const accionSugerida = accionSugeridaPara(empleado.id);
        const nombreParaMostrar = nombreCompleto(empleado);

        // --- 4. Guardar el pase y entregar solo el numerito ----------------
        const tokenRegistro = crearPase({
          empleadoId: empleado.id,
          usuario: empleado.usuario,
          nombreParaMostrar,
          accionSugerida,
          reloj,
        });

        return {
          ok: true,
          tokenRegistro,
          nombreParaMostrar,
          accionSugerida,
          horaLocalTexto: horaLocalDe(reloj.horaEstimadaMs),
          pinTemporal: empleado.pinTemporal,
        };
      } catch (fallo) {
        // Cualquier error inesperado (base corrupta, disco lleno) se atrapa
        // aqui. La pantalla recibe una respuesta y el empleado ve un mensaje,
        // en vez de quedarse mirando "Verificando..." para siempre.
        console.error('[ipc] identificar: error inesperado', fallo);
        return {
          ok: false,
          motivo: 'error_interno',
          mensaje: 'Hubo un problema. Avisa a tu jefe para que registre tu asistencia.',
        };
      }
    },
  );

  // ---------------------------------------------------------------------
  //  registrarMarca: guarda entrada/salida con su foto
  // ---------------------------------------------------------------------
  ipcMain.handle(
    CANALES.registrarMarca,
    async (_evento, datosCrudos): Promise<ResultadoRegistro> => {
      const validacion = EsquemaRegistro.safeParse(datosCrudos);

      if (!validacion.success) {
        console.warn('[ipc] registrarMarca: datos invalidos');
        return { ok: false, mensaje: 'No se pudo registrar: datos invalidos.' };
      }

      const { tokenRegistro, tipo, fotoJpegBase64, medicionesImagen } = validacion.data;

      try {
        // --- 1. Canjear el pase -------------------------------------------
        //
        // Aqui es donde se comprueba que quien pide registrar DE VERDAD acaba
        // de teclear un PIN correcto. El pase se borra al canjearlo, asi que
        // un segundo mensaje con el mismo pase (un doble clic, un reintento)
        // no puede duplicar la marca.
        const pase = canjearPase(tokenRegistro);

        if (!pase) {
          // Caduco, ya se uso, o nunca existio. Los tres se ven igual desde
          // afuera a proposito (ver identificaciones-pendientes.ts).
          console.warn('[ipc] registrarMarca: pase invalido o vencido');
          return {
            ok: false,
            mensaje: 'Se agoto el tiempo. Vuelve a teclear tu PIN.',
          };
        }

        // --- 2. Confirmar que el empleado sigue existiendo -----------------
        // El pase se creo hace segundos, pero entre medias pudo entrar una
        // sincronizacion y darlo de baja. Es barato comprobarlo.
        const empleado = buscarPorId(pase.empleadoId);
        if (!empleado) {
          console.warn('[ipc] registrarMarca: el empleado del pase ya no existe');
          return { ok: false, mensaje: 'No se pudo registrar. Avisa a tu jefe.' };
        }

        // --- 3. El reloj YA estaba leido ----------------------------------
        //
        // No se vuelve a llamar a `leerReloj()`. Se usan las lecturas que se
        // tomaron al validar el PIN, que es la hora que el empleado vio en la
        // confirmacion y la que corresponde al momento en que llego.
        const reloj = pase.reloj;

        // --- 4. Decidir las banderas --------------------------------------
        // Recuerda: las banderas NUNCA impiden registrar. Solo dejan
        // constancia para que el jefe lo revise despues.
        const banderas: BanderaMarca[] = [];

        // Anomalias de reloj (hora de Windows movida, fecha absurda...)
        banderas.push(...detectarAnomaliasDeReloj(reloj, horaDeLaUltimaMarca()));

        // ¿Hubo foto?
        if (fotoJpegBase64 === null) {
          banderas.push('sin_camara');
        } else if (medicionesImagen && pareceObstruida(medicionesImagen)) {
          // La pantalla MIDE, el proceso principal DECIDE. Si la pantalla
          // decidiera, bastaria con manipularla para que nunca avisara.
          banderas.push('foto_obstruida');
        }

        // --- 5. Huella, cifrado y disco -------------------------------------
        // Se hace ANTES de escribir en la base, porque la marca guarda el
        // hash. Si falla, `guardarFoto` devuelve null y el registro sigue
        // igual: sin foto, con su bandera. La regla de oro manda sobre la
        // evidencia.
        //
        // El id se genera UNA sola vez y se usa para las dos cosas: el
        // nombre del archivo (y su sello de cifrado) y el registro en la base.
        const marcaId = nuevoIdDeMarca();

        let foto: FotoGuardada | null = null;
        if (fotoJpegBase64 !== null) {
          foto = guardarFoto(marcaId, fotoJpegBase64, reloj.horaEstimadaMs);
          if (foto === null && !banderas.includes('sin_camara')) {
            // Habia foto pero no se pudo escribir (disco lleno, permisos).
            banderas.push('sin_camara');
          }
        }

        // --- 6. Guardar la marca ------------------------------------------
        guardarMarca({
          id: marcaId,
          empleadoId: empleado.id,
          usuario: empleado.usuario,
          tipo,
          reloj,
          banderas,
          foto,
        });

        // --- 7. Actualizar la barra de estado -----------------------------
        actualizarEstado({ registrosPendientes: contarPendientes() });

        // --- 8. Responder --------------------------------------------------
        return {
          ok: true,
          marcaId,
          tipo,
          horaLocalTexto: horaLocalDe(reloj.horaEstimadaMs),
          banderas,
        };
      } catch (fallo) {
        // Si algo truena aqui, el empleado se queda sin registro. Se deja
        // constancia con todo el detalle para poder recuperarlo despues.
        console.error('[ipc] registrarMarca: error inesperado', fallo);
        return {
          ok: false,
          mensaje: 'No se pudo guardar tu registro. Avisa a tu jefe de inmediato.',
        };
      }
    },
  );

  // ---------------------------------------------------------------------
  //  cancelarRegistro: el empleado se arrepintio en la confirmacion
  // ---------------------------------------------------------------------
  //  No devuelve nada y no puede fallar. Cancelar siempre "funciona": si el
  //  pase no existiera, el resultado deseado (que no quede un pase vivo) ya
  //  se cumplio de todos modos.
  //
  //  Podriamos no tener este canal y dejar que el pase caduque solo al minuto.
  //  Existe porque "cancele y el sistema se quedo con mi pase vivo" es
  //  exactamente el tipo de cabo suelto que despues nadie sabe explicar.
  ipcMain.handle(CANALES.cancelarRegistro, async (_evento, datosCrudos): Promise<void> => {
    const validacion = EsquemaCancelacion.safeParse(datosCrudos);
    if (!validacion.success) return;

    descartarPase(validacion.data.tokenRegistro);
  });

  // ---------------------------------------------------------------------
  //  obtenerEstado: para la barra de conexion / pendientes / camara
  // ---------------------------------------------------------------------
  ipcMain.handle(CANALES.obtenerEstado, async (): Promise<EstadoKiosco> => {
    // Se devuelve una COPIA (`{...estado}`) y no el objeto original.
    // Si mandaramos el original, un cambio posterior podria viajar sin querer.
    //
    // La pausa se lee de su propio servicio en vez de confiar en la copia
    // guardada: es quien sabe la verdad, y asi no puede quedar desfasada si
    // alguien restauro la ventana a mano.
    return { ...estado, ...estadoDePausa() };
  });

  // ---------------------------------------------------------------------
  //  obtenerConfiguracion
  // ---------------------------------------------------------------------
  ipcMain.handle(CANALES.obtenerConfiguracion, async (): Promise<ConfiguracionParaInterfaz> => {
    return configuracionParaInterfaz();
  });

  // ---------------------------------------------------------------------
  //  cambiarModoIdentificacion: HERRAMIENTA DE DESARROLLO
  // ---------------------------------------------------------------------
  //  Permite comparar los tres modos sin recompilar.
  //  El candado real no esta aqui sino en `cambiarModoIdentificacion()`, que
  //  se niega a hacer nada si la app esta empaquetada. Ponerlo alla y no aqui
  //  es a proposito: la regla vive junto al dato que protege, no junto a la
  //  puerta por la que se entra hoy.
  ipcMain.handle(
    CANALES.cambiarModoIdentificacion,
    async (_evento, datosCrudos): Promise<ConfiguracionParaInterfaz> => {
      const validacion = EsquemaCambioDeModo.safeParse(datosCrudos);

      // Si los datos no sirven, devolvemos la configuracion SIN CAMBIOS en vez
      // de un error: la pantalla se redibuja igual que estaba y nadie se queda
      // atorado por un boton de desarrollo.
      if (validacion.success) {
        cambiarModoIdentificacion(validacion.data.modo);
      }

      return configuracionParaInterfaz();
    },
  );

  // ---------------------------------------------------------------------
  //  obtenerEmpleadosParaLista: solo se usa en el modo 'lista'
  // ---------------------------------------------------------------------
  ipcMain.handle(CANALES.obtenerEmpleadosParaLista, async (): Promise<EmpleadoParaLista[]> => {
    // Se manda SOLO lo que la pantalla necesita para pintar el boton.
    // Nada de hashes de PIN ni de numeros de empleado: minimo privilegio.
    // Ademas el nombre va abreviado ("Dalton G."), para que una pantalla
    // publica no muestre el nombre completo de nadie.
    const ahora = Date.now();
    const ventanaMs = CONFIG.interfaz.horasParaMostrarEstadoEnLista * 60 * 60 * 1000;

    return listarActivosConUltimaMarca().map((empleado) => {
      // El estado solo se muestra si la marca es RECIENTE. Sin este limite,
      // el lunes por la manana la lista seguiria diciendo "Adentro desde las
      // 14:00" de la marca del viernes: una etiqueta vieja no informa,
      // confunde.
      const reciente =
        empleado.ultimaHoraMs !== null && ahora - empleado.ultimaHoraMs < ventanaMs;

      const estado = !reciente
        ? ('sin_marcar' as const)
        : empleado.ultimoTipo === 'entrada'
          ? ('adentro' as const)
          : ('afuera' as const);

      return {
        id: empleado.id,
        nombreParaMostrar: `${empleado.nombre.split(' ')[0]} ${empleado.apellidoPaterno[0]}.`,
        estado,
        horaUltimaMarca: reciente ? horaLocalDe(empleado.ultimaHoraMs!) : null,
        // Sin marca reciente -> entrada. Si esta adentro -> salida.
        accionSugerida: estado === 'adentro' ? ('salida' as const) : ('entrada' as const),
      };
    });
  });

  // ---------------------------------------------------------------------
  //  pausarKiosco: prestar la computadora un rato
  // ---------------------------------------------------------------------
  //  El codigo se comprueba en `pausar()`, no aqui. Este manejador solo se
  //  asegura de que lo que llego tenga forma de codigo (digitos, con un
  //  techo de largo) antes de pasarlo.
  ipcMain.handle(CANALES.pausarKiosco, async (_evento, datosCrudos): Promise<ResultadoPausa> => {
    const validacion = EsquemaPausa.safeParse(datosCrudos);

    if (!validacion.success) {
      /*
        MISMO MENSAJE AFUERA, MENSAJE DISTINTO EN EL LOG.

        Hacia afuera conviene que "formato invalido" y "codigo equivocado" se
        vean igual: quien este probando no tiene por que saber cual de los dos
        fallo.

        Pero DENTRO hay que poder distinguirlos, y esa linea faltaba. Un
        defecto en la validacion (una expresion regular mal escrita) producia
        exactamente el mismo sintoma que teclear mal el codigo — y el sintoma
        decia "Codigo incorrecto" con el codigo correcto. Diagnosticarlo costo
        horas. Ver E-019.

        Ocultar informacion al usuario no tiene por que significar ocultarsela
        tambien a quien da mantenimiento.
      */
      console.warn('[ipc] pausarKiosco: el codigo no tiene forma valida (no es el codigo en si)');
      return { ok: false, mensaje: 'Codigo incorrecto.' };
    }

    return pausar(validacion.data.codigo);
  });

  // ---------------------------------------------------------------------
  //  obtenerRegistros: la pantalla de consulta
  // ---------------------------------------------------------------------
  //  Primera version de la pantalla de auditoria del modo administrador
  //  (CLAUDE.md 5.2). Hoy sirve para ver que los datos se guardan de verdad.
  //
  //  El limite NO lo manda la pantalla: sale de la configuracion. Si lo
  //  eligiera quien llama, un `obtenerRegistros(1000000)` traeria la base
  //  entera a memoria. La pantalla pide "los registros"; cuantos, lo decide
  //  este lado.
  ipcMain.handle(CANALES.obtenerRegistros, async (): Promise<MarcaParaMostrar[]> => {
    if (!CONFIG.interfaz.mostrarRegistrosEnKiosco) return [];

    try {
      return listarMarcasRecientes(CONFIG.interfaz.maximoRegistrosEnPantalla);
    } catch (fallo) {
      // Una pantalla de consulta que falla no debe tumbar el kiosco: lo que
      // importa es que la gente pueda checar, no que se vea la tabla.
      console.error('[ipc] obtenerRegistros: error inesperado', fallo);
      return [];
    }
  });

  // ---------------------------------------------------------------------
  //  reportarEstadoCamara: la interfaz avisa si la camara vive o murio
  // ---------------------------------------------------------------------
  ipcMain.handle(CANALES.reportarEstadoCamara, async (_evento, datosCrudos): Promise<void> => {
    const validacion = EsquemaEstadoCamara.safeParse(datosCrudos);
    if (!validacion.success) return;

    const { disponible, detalle } = validacion.data;

    // Solo nos interesa cuando CAMBIA, no cada 5 segundos.
    if (estado.camaraDisponible !== disponible) {
      estado.camaraDisponible = disponible;
      console.info(
        `[camara] ${disponible ? 'reconectada' : 'desconectada'}${detalle ? ` - ${detalle}` : ''}`,
      );

      // Queda constancia para el panel, que asi puede alertar de una camara
      // caida (CLAUDE.md 5) y, sobre todo, explicar por que las marcas de esa
      // manana salieron sin foto.
      //
      // `detalle` es el mensaje del navegador ("permiso denegado", "en uso por
      // otra app"), que es justo lo que hace falta para diagnosticar a
      // distancia una computadora que nadie va a ir a revisar.
      registrarEvento(disponible ? 'camara_reconectada' : 'camara_desconectada', {
        detalle: detalle ?? null,
      });
    }
  });
}

/**
 * Permite al resto del proceso principal actualizar el estado y que la
 * interfaz se entere sola, sin tener que preguntar cada segundo.
 *
 * `Partial<EstadoKiosco>` significa "un objeto con ALGUNOS de los campos de
 * EstadoKiosco": asi puedes mandar solo `{enLinea: true}` sin repetir lo demas.
 */
export function actualizarEstado(cambios: Partial<EstadoKiosco>): void {
  Object.assign(estado, cambios);

  /**
   * Avisar a la pantalla para que se repinte sola.
   *
   * Sin esto, el contador de "registros pendientes" solo cambiaria cuando la
   * pantalla preguntara, y la pantalla no pregunta: se suscribio a este aviso
   * justamente para no estar consultando cada segundo.
   *
   * Se recorren TODAS las ventanas en vez de guardar una referencia a la
   * principal. Asi no hay que acordarse de actualizar esa referencia cuando
   * la ventana se recrea (por ejemplo si Chromium se cae y se recarga).
   */
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed()) {
      ventana.webContents.send(CANALES.estadoActualizado, { ...estado });
    }
  }
}

/** Lectura del estado actual, para quien lo necesite dentro del main. */
export function estadoActual(): EstadoKiosco {
  return { ...estado };
}
