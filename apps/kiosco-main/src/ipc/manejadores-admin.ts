/**
 * ============================================================================
 *  MANEJADORES DEL MODO ADMINISTRADOR  (CLAUDE.md 5.2)
 * ============================================================================
 *
 *  Mismo patron que manejadores.ts —validar, hacer, responder—, con un paso
 *  mas al principio de cada uno: COMPROBAR LA SESION. Sin sesion viva no sale
 *  ni un nombre.
 *
 *  Van en su propio archivo porque son otra cosa: aquellos sirven a
 *  cualquiera que pase por el pasillo; estos solo a un administrador. Tenerlos
 *  separados hace facil revisar de un vistazo que ninguno se salte la sesion.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  CANALES,
  CONFIG,
  type EmpleadoParaFiltro,
  type FotoParaAuditoria,
  type MarcaParaAuditoria,
  type MemoriaUsb,
  type ResultadoAdmin,
  type EstadoDelKioscoParaAdmin,
  type ResultadoExportacion,
  type ResultadoRecuperacionFotos,
  type SesionAdminParaInterfaz,
} from '@kiosko/compartido';
import { ES_DESARROLLO } from '../entorno';
import { exportarRegistros } from '../servicios/exportacion';
import { buscarMemoriasUsb, esDiscoDeEstaComputadora } from '../servicios/memorias-usb';
import {
  buscarMarcasParaAuditoria,
  empleadosParaFiltro,
  registrarAccesoFoto,
} from '../datos/repositorio-admin';
import { cambiarConservar, obtenerFoto } from '../datos/repositorio-fotos';
import {
  contarRechazados,
  listarRechazados,
  registrarEstadoDeFoto,
  reintentarRechazados,
  descartarRechazados,
} from '../datos/repositorio-sincronizacion';
import { actualizacionLista, instalarActualizacionYReiniciar, versionActual } from '../actualizaciones';
import { sincronizarAhora, sincronizarPronto } from '../servicios/sincronizacion';
import { copiarDiagnostico } from '../servicios/diagnostico';
import { estadoActual } from './manejadores';
import { registrarEvento } from '../datos/repositorio-eventos';
import { contarFotosConLlaveAnterior, recuperarFotosConContrasena } from '../servicios/recuperacion-fotos';
import { leerFoto } from '../servicios/fotos';
import {
  definirContrasenaDeRecuperacion,
  tieneContrasenaDeRecuperacion,
} from '../servicios/llave-fotos';
import {
  cerrarSesionAdmin,
  entrarModoAdmin,
  MENSAJE_INTENTO_FALLIDO,
  type SesionAdmin,
  validarSesionAdmin,
} from '../servicios/sesion-admin';
import {
  EsquemaBusquedaAuditoria,
  EsquemaConservarFoto,
  EsquemaDefinirRecuperacion,
  EsquemaEntradaAdmin,
  EsquemaExportarACarpeta,
  EsquemaExportarAUsb,
  EsquemaDescartarRechazados,
  EsquemaRecuperarFotos,
  EsquemaSoloToken,
  EsquemaVerFoto,
} from './esquemas';

const SESION_VENCIDA = {
  ok: false as const,
  mensaje: 'La sesión se cerró. Vuelve a entrar con tu usuario y contraseña.',
  sesionVencida: true,
};

const DATOS_INVALIDOS = { ok: false as const, mensaje: 'Algo no se entendió. Intenta de nuevo.' };

/**
 * Un error cuyo mensaje SI se puede mostrar tal cual en pantalla. Cualquier
 * otro error sale como un "hubo un problema" generico: un mensaje interno
 * (una ruta, un SQL) no tiene por que llegar a la pantalla.
 */
class ErrorParaMostrar extends Error {}

/**
 * Envuelve un manejador: valida con zod, comprueba la sesion y atrapa
 * cualquier error. Asi ningun manejador de este archivo puede olvidar la
 * sesion: no hay forma de escribir uno que no pase por aqui.
 */
function conSesion<E extends { token: string }, T>(
  esquema: { safeParse(datos: unknown): { success: true; data: E } | { success: false } },
  trabajo: (datos: E, sesion: SesionAdmin) => T | Promise<T>,
) {
  return async (_evento: unknown, datosCrudos: unknown): Promise<ResultadoAdmin<T>> => {
    const validacion = esquema.safeParse(datosCrudos);
    if (!validacion.success) return DATOS_INVALIDOS;

    const sesion = validarSesionAdmin(validacion.data.token);
    if (!sesion) return SESION_VENCIDA;

    try {
      return { ok: true, datos: await trabajo(validacion.data, sesion) };
    } catch (fallo) {
      if (fallo instanceof ErrorParaMostrar) return { ok: false, mensaje: fallo.message };
      console.error('[admin] error inesperado', fallo);
      return { ok: false, mensaje: 'Hubo un problema. Intenta de nuevo.' };
    }
  };
}

export function registrarManejadoresAdmin(): void {
  // ---------------------------------------------------------------------
  //  entrar: usuario + contrasena de administrador del sistema
  // ---------------------------------------------------------------------
  ipcMain.handle(
    CANALES.adminEntrar,
    async (_evento, datosCrudos): Promise<ResultadoAdmin<SesionAdminParaInterfaz>> => {
      const validacion = EsquemaEntradaAdmin.safeParse(datosCrudos);
      // Nunca `datosCrudos` en el log: ahi va la contrasena.
      if (!validacion.success) return { ok: false, mensaje: MENSAJE_INTENTO_FALLIDO };

      try {
        const resultado = await entrarModoAdmin(validacion.data.usuario, validacion.data.contrasena);
        if (!resultado.ok) return resultado;

        return {
          ok: true,
          datos: {
            token: resultado.sesion.token,
            nombre: resultado.sesion.nombre,
            rol: resultado.sesion.rol,
            minutosDeInactividad: CONFIG.modoAdmin.minutosDeInactividad,
            tieneContrasenaDeRecuperacion: tieneContrasenaDeRecuperacion(),
            largoMinimoContrasenaRecuperacion: CONFIG.fotos.largoMinimoContrasenaRecuperacion,
            datosSobreLaFoto: { ...CONFIG.modoAdmin.datosSobreLaFoto },
            segundosEntreAvisosDeActividad: CONFIG.modoAdmin.segundosEntreAvisosDeActividad,
            zoomMaximoFoto: CONFIG.modoAdmin.zoomMaximoFoto,
            pasoZoomFoto: CONFIG.modoAdmin.pasoZoomFoto,
            permitirElegirCarpeta: CONFIG.exportacion.permitirElegirCarpeta,
            maximoRegistrosExportacion: CONFIG.exportacion.maximoRegistros,
          },
        };
      } catch (fallo) {
        console.error('[admin] error al entrar', fallo);
        return { ok: false, mensaje: 'Hubo un problema. Intenta de nuevo.' };
      }
    },
  );

  // ---------------------------------------------------------------------
  //  salir / seguirActivo
  // ---------------------------------------------------------------------
  ipcMain.handle(CANALES.adminSalir, async (_evento, datosCrudos): Promise<void> => {
    const validacion = EsquemaSoloToken.safeParse(datosCrudos);
    // Solo quien tiene el token puede cerrar SU sesion.
    if (validacion.success && validarSesionAdmin(validacion.data.token)) {
      cerrarSesionAdmin('salida');
    }
  });

  ipcMain.handle(CANALES.adminSeguirActivo, async (_evento, datosCrudos): Promise<void> => {
    const validacion = EsquemaSoloToken.safeParse(datosCrudos);
    // Validar la sesion ES renovarla: no hace falta nada mas.
    if (validacion.success) validarSesionAdmin(validacion.data.token);
  });

  // ---------------------------------------------------------------------
  //  buscarRegistros / listarEmpleados
  // ---------------------------------------------------------------------
  ipcMain.handle(
    CANALES.adminBuscarRegistros,
    conSesion(EsquemaBusquedaAuditoria, (datos): MarcaParaAuditoria[] =>
      buscarMarcasParaAuditoria(datos.filtros),
    ),
  );

  ipcMain.handle(
    CANALES.adminListarEmpleados,
    conSesion(EsquemaSoloToken, (): EmpleadoParaFiltro[] => empleadosParaFiltro()),
  );

  // ---------------------------------------------------------------------
  //  verFoto: LA RAZON DE SER DEL MODO ADMINISTRADOR
  // ---------------------------------------------------------------------
  //  El orden importa: primero se anota en la bitacora, DESPUES se entrega.
  //  Si anotar falla, la foto no sale. Una foto vista sin rastro es justo lo
  //  que la bitacora existe para impedir (CLAUDE.md 12).
  ipcMain.handle(
    CANALES.adminVerFoto,
    conSesion(EsquemaVerFoto, (datos, sesion): FotoParaAuditoria => {
      const foto = obtenerFoto(datos.marcaId);
      if (!foto) return { estado: 'sin_foto' };
      if (foto.eliminadaEn) return { estado: 'eliminada_por_antiguedad' };

      const lectura = leerFoto(foto.rutaRelativa, foto.marcaId, foto.hash);
      if (lectura.estado !== 'con_foto') {
        // faltante / alterada / llave_no_disponible: se informa sin mostrar nada.
        console.warn(`[admin] foto en estado ${lectura.estado}`);
        // Faltante y alterada son evidencia de que algo paso: la nube tiene
        // que saberlo para que el panel lo muestre (CLAUDE.md 5.1). "Llave no
        // disponible" no: la foto esta bien, solo falta con que abrirla.
        if (lectura.estado === 'faltante' || lectura.estado === 'alterada') {
          registrarEstadoDeFoto(foto.marcaId, lectura.estado);
        }
        return { estado: lectura.estado };
      }

      registrarAccesoFoto(datos.marcaId, sesion.adminId, 'ver');

      return {
        estado: 'con_foto',
        // Descifrada solo en memoria: viaja a la pantalla y ahi se queda
        // mientras este abierta. Nunca se escribe en disco (CLAUDE.md 5.2).
        jpegDataUrl: `data:image/jpeg;base64,${lectura.jpeg.toString('base64')}`,
        hashCorto: (foto.hash ?? '').slice(0, 12),
      };
    }),
  );

  // ---------------------------------------------------------------------
  //  conservarFoto: "Conservar" / quitarlo, con motivo
  // ---------------------------------------------------------------------
  ipcMain.handle(
    CANALES.adminConservarFoto,
    conSesion(EsquemaConservarFoto, (datos, sesion): { conservar: boolean } => {
      const hecho = cambiarConservar(datos.marcaId, datos.conservar, {
        motivo: datos.motivo,
        por: sesion.adminId,
      });
      if (!hecho) throw new ErrorParaMostrar('Esa foto ya se borró: no hay nada que conservar.');

      registrarAccesoFoto(datos.marcaId, sesion.adminId, datos.conservar ? 'conservar' : 'quitar_conservar');
      return { conservar: datos.conservar };
    }),
  );

  // ---------------------------------------------------------------------
  //  definirRecuperacion: la contrasena que rescata las fotos (D-024)
  // ---------------------------------------------------------------------
  //  Solo el rol 'admin'. Un supervisor puede ver fotos, pero no decidir con
  //  que se rescatan: quien la cambia, cambia quien puede abrir el disco.
  ipcMain.handle(
    CANALES.adminDefinirRecuperacion,
    conSesion(EsquemaDefinirRecuperacion, async (datos, sesion): Promise<null> => {
      if (sesion.rol !== 'admin') {
        throw new ErrorParaMostrar('Solo el administrador principal puede definir la contraseña de recuperación.');
      }
      const resultado = await definirContrasenaDeRecuperacion(datos.contrasena);
      if (!resultado.ok) throw new ErrorParaMostrar(resultado.mensaje);
      return null;
    }),
  );

  // ---------------------------------------------------------------------
  //  Estado del propio kiosco: version, actualizacion y rechazados
  // ---------------------------------------------------------------------
  ipcMain.handle(
    CANALES.adminEstadoDelKiosco,
    conSesion(EsquemaSoloToken, (): EstadoDelKioscoParaAdmin => ({
      version: versionActual(),
      actualizacionLista: actualizacionLista(),
      rechazados: listarRechazados(CONFIG.modoAdmin.rechazadosAMostrar),
      totalRechazados: contarRechazados(),
      fotosConLlaveAnterior: contarFotosConLlaveAnterior(),
    })),
  );

  ipcMain.handle(
    CANALES.adminRecuperarFotos,
    conSesion(EsquemaRecuperarFotos, async (datos, sesion): Promise<ResultadoRecuperacionFotos> => {
      if (sesion.rol !== 'admin') throw new ErrorParaMostrar('Sólo un administrador puede recuperar fotos.');
      const resultado = await recuperarFotosConContrasena(datos.contrasena);
      if (!resultado) throw new ErrorParaMostrar('Windows no ofrece cifrado en esta computadora. Avisa a soporte.');
      if (resultado.llavesAbiertas === 0) {
        throw new ErrorParaMostrar(
          'Esa contraseña no abre ninguna llave anterior. Revisa la hoja de credenciales (mayúsculas incluidas).',
        );
      }
      return resultado;
    }),
  );

  ipcMain.handle(
    CANALES.adminReintentarRechazados,
    conSesion(EsquemaSoloToken, (): { reintentados: number } => {
      const reintentados = reintentarRechazados();
      if (reintentados > 0) sincronizarPronto();
      return { reintentados };
    }),
  );

  // Descartar lo rechazado: se oculta (no se borra) y se avisa a la oficina.
  // Solo el rol admin: es quitar algo de la vista, y eso se responde.
  ipcMain.handle(
    CANALES.adminDescartarRechazados,
    conSesion(EsquemaDescartarRechazados, (datos, sesion): { descartados: number } => {
      if (sesion.rol !== 'admin') throw new ErrorParaMostrar('Sólo un administrador puede descartar registros.');
      const descartados = descartarRechazados(datos.motivo);
      if (descartados > 0) {
        registrarEvento('registros_descartados', { adminId: sesion.adminId, cantidad: descartados, motivo: datos.motivo });
        sincronizarPronto();
        console.info(`[admin] ${descartados} registro(s) rechazados descartados`);
      }
      return { descartados };
    }),
  );

  ipcMain.handle(
    CANALES.adminInstalarActualizacion,
    conSesion(EsquemaSoloToken, (_datos, sesion): null => {
      if (sesion.rol !== 'admin') throw new ErrorParaMostrar('Sólo un administrador puede instalar versiones nuevas.');
      if (!actualizacionLista()) throw new ErrorParaMostrar('No hay ninguna versión nueva descargada.');
      console.info(`[admin] ${sesion.nombre} instala la version ${actualizacionLista()}`);
      // Un momento para que la respuesta llegue a la pantalla antes de cerrar.
      setTimeout(() => instalarActualizacionYReiniciar(), 1500);
      return null;
    }),
  );

  // "Sincronizar ahora": el jefe cambio algo en el panel (una baja, un PIN)
  // y no quiere esperar el minuto. Cualquier rol: solo trae y manda datos.
  ipcMain.handle(
    CANALES.adminSincronizarAhora,
    conSesion(EsquemaSoloToken, (): Promise<{ ok: boolean; pendientes: number }> => sincronizarAhora()),
  );

  // "Guardar diagnostico" (servicios/diagnostico.ts): copia el diario del
  // kiosco a donde se elija, para mandarlo a quien da soporte. No lleva
  // fotos ni PINes, asi que, a diferencia de las fotos, puede ir a cualquier
  // carpeta. La ruta la elige Windows y nunca pasa por la pantalla.
  ipcMain.handle(
    CANALES.adminGuardarDiagnostico,
    conSesion(EsquemaSoloToken, async (_datos, sesion): Promise<{ carpeta: string; archivos: number } | null> => {
      const ventana = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const opciones: Electron.OpenDialogOptions = {
        title: 'Elige la memoria USB (o la carpeta) donde guardar el diagnóstico',
        buttonLabel: 'Guardar aquí',
        properties: ['openDirectory', 'createDirectory'],
      };
      const eleccion = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones);
      const destino = eleccion.filePaths[0];
      if (eleccion.canceled || !destino) return null;

      const e = estadoActual();
      const resumen = [
        'DIAGNOSTICO DEL KIOSCO DE ASISTENCIA',
        `Guardado: ${new Date().toISOString()} (UTC) por ${sesion.nombre}`,
        `Kiosco: ${e.nombreKiosco ?? '(sin dar de alta)'}`,
        `Version del programa: ${versionActual()}`,
        `Conexion con la oficina: ${e.nube}`,
        `Registros sin enviar: ${e.registrosPendientes}`,
        `Camara: ${e.camaraDisponible ? 'funcionando' : 'NO disponible'}`,
        `PC compartida: ${e.pcCompartida ? 'si' : 'no'}`,
        `Desfase del reloj: ${e.desfaseRelojMs} ms`,
        '',
        'Los archivos kiosco-AAAA-MM-DD.log son el diario de cada dia (hora de Nuevo Laredo).',
        'No contienen fotos, PINes ni contraseñas.',
      ].join('\r\n'); // el Bloc de notas viejo de Windows no entiende un salto solo
      try {
        const r = copiarDiagnostico(destino, resumen);
        console.info(`[admin] diagnostico guardado (${r.archivos} archivo(s))`);
        return r;
      } catch (fallo) {
        console.error('[admin] no se pudo guardar el diagnostico:', (fallo as Error).message);
        throw new ErrorParaMostrar('No se pudo escribir ahí. ¿La memoria sigue conectada? Prueba con otra carpeta.');
      }
    }),
  );

  // ---------------------------------------------------------------------
  //  Exportacion a USB: la unica salida de las fotos (CLAUDE.md 5.2)
  // ---------------------------------------------------------------------
  ipcMain.handle(
    CANALES.adminBuscarMemoriasUsb,
    conSesion(EsquemaSoloToken, (): Promise<MemoriaUsb[]> => buscarMemoriasUsb()),
  );

  ipcMain.handle(
    CANALES.adminExportarAUsb,
    conSesion(EsquemaExportarAUsb, async (datos, sesion): Promise<ResultadoExportacion> => {
      // La letra llego de la pantalla: se vuelve a preguntar a Windows si de
      // verdad es una memoria USB conectada, en vez de creerle.
      const memorias = await buscarMemoriasUsb();
      if (!memorias.some((m) => m.unidad === datos.unidad)) {
        throw new ErrorParaMostrar('Esa memoria ya no está conectada. Pulsa "Buscar otra vez".');
      }
      return exportarOMostrarError(datos.filtros, `${datos.unidad}\\`, sesion, 'usb');
    }),
  );

  ipcMain.handle(
    CANALES.adminExportarACarpeta,
    conSesion(EsquemaExportarACarpeta, async (datos, sesion): Promise<ResultadoExportacion | null> => {
      if (!CONFIG.exportacion.permitirElegirCarpeta) throw new ErrorParaMostrar('Esta opción está apagada.');

      // La ventana de Windows la abre el proceso principal, y la ruta elegida
      // nunca pasa por la pantalla (CLAUDE.md 3.1).
      const ventana = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const opciones: Electron.OpenDialogOptions = {
        title: 'Elige la memoria o el disco USB donde guardar',
        buttonLabel: 'Guardar aquí',
        properties: ['openDirectory', 'createDirectory'],
      };
      const eleccion = ventana
        ? await dialog.showOpenDialog(ventana, opciones)
        : await dialog.showOpenDialog(opciones);
      const carpeta = eleccion.filePaths[0];
      if (eleccion.canceled || !carpeta) return null;

      if (!ES_DESARROLLO && esDiscoDeEstaComputadora(carpeta)) {
        throw new ErrorParaMostrar(
          'Esa carpeta está en esta misma computadora. Las fotos salen sin candado y no deben ' +
            'quedarse aquí. Elige la memoria o el disco USB.',
        );
      }
      return exportarOMostrarError(datos.filtros, carpeta, sesion, 'carpeta');
    }),
  );
}

async function exportarOMostrarError(
  filtros: Parameters<typeof exportarRegistros>[0],
  carpeta: string,
  sesion: SesionAdmin,
  destino: 'usb' | 'carpeta',
): Promise<ResultadoExportacion> {
  const resultado = await exportarRegistros(filtros, carpeta, { id: sesion.adminId, nombre: sesion.nombre }, destino);
  if (!resultado.ok) throw new ErrorParaMostrar(resultado.mensaje);
  // Exportar un mes puede tardar: se cuenta como actividad, para que la
  // sesion no se venza justo mientras la persona espera el resultado.
  validarSesionAdmin(sesion.token);
  return resultado.resultado;
}
