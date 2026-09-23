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

import { ipcMain } from 'electron';
import {
  CANALES,
  CONFIG,
  type EmpleadoParaFiltro,
  type FotoParaAuditoria,
  type MarcaParaAuditoria,
  type ResultadoAdmin,
  type SesionAdminParaInterfaz,
} from '@kiosko/compartido';
import {
  buscarMarcasParaAuditoria,
  empleadosParaFiltro,
  registrarAccesoFoto,
} from '../datos/repositorio-admin';
import { cambiarConservar, obtenerFoto } from '../datos/repositorio-fotos';
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
}
