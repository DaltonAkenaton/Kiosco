/**
 * ============================================================================
 *  PRELOAD: EL UNICO PUENTE ENTRE LA PANTALLA Y EL SISTEMA
 * ============================================================================
 *
 *  Este archivo es especial. Corre en un lugar intermedio:
 *
 *      [ Proceso principal ]  <-- IPC -->  [ PRELOAD ]  <-- puente -->  [ Angular ]
 *          Node.js completo                 puede usar                  no puede
 *          disco, red, SQLite               ipcRenderer                 nada
 *
 *  El preload puede hablar con los dos lados, y por eso es el punto mas
 *  delicado de la aplicacion. Todo lo que exponga aqui queda disponible para
 *  la pagina. Todo lo que NO exponga, no existe para ella.
 *
 *  LA REGLA:
 *  ---------
 *  Exponer VERBOS concretos del negocio ("identificar", "registrarMarca"),
 *  jamas herramientas genericas.
 *
 *  El error clasico, que NUNCA hay que cometer:
 *
 *      // ¡PESIMO! Esto le da a la pagina acceso a TODOS los canales.
 *      contextBridge.exposeInMainWorld('electron', {
 *        invoke: (canal, datos) => ipcRenderer.invoke(canal, datos)
 *      });
 *
 *  Con eso acabas de regalar la casa entera: la pagina puede invocar
 *  cualquier canal interno de Electron. La version correcta es la de abajo:
 *  una funcion por operacion, con el nombre del canal fijo dentro del preload,
 *  donde la pagina no lo puede cambiar.
 *
 *  ¿Como llega esto a Angular?
 *  ---------------------------
 *  `contextBridge.exposeInMainWorld('kiosco', api)` crea `window.kiosco`.
 *  Gracias a `contextIsolation: true`, el puente copia los valores de forma
 *  segura entre los dos universos; la pagina recibe funciones que puede
 *  llamar, pero no puede alcanzar nada de lo que hay detras de ellas.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CANALES,
  type ApiKiosco,
  type ConfiguracionParaInterfaz,
  type EmpleadoParaLista,
  type MarcaParaMostrar,
  type EstadoCamaraReportado,
  type EstadoKiosco,
  type FiltrosAuditoria,
  type ResultadoIdentificacion,
  type ResultadoPausa,
  type ResultadoRegistro,
  type SolicitudIdentificacion,
  type SolicitudRegistro,
} from '@kiosko/compartido';

/**
 * La implementacion del contrato. Fijate que cada funcion:
 *   - tiene el canal escrito DENTRO (la pagina no elige a donde manda),
 *   - pasa los datos tal cual (quien los valida de verdad es el proceso
 *     principal; validar aqui seria falsa seguridad, porque este codigo
 *     comparte ventana con la pagina).
 */
const api: ApiKiosco = {
  identificar(solicitud: SolicitudIdentificacion): Promise<ResultadoIdentificacion> {
    return ipcRenderer.invoke(CANALES.identificar, solicitud);
  },

  registrarMarca(solicitud: SolicitudRegistro): Promise<ResultadoRegistro> {
    return ipcRenderer.invoke(CANALES.registrarMarca, solicitud);
  },

  cancelarRegistro(tokenRegistro: string): Promise<void> {
    // Se envuelve en un objeto en vez de mandar el texto suelto. Todos los
    // canales de este puente mandan objetos, y el esquema de zod del otro
    // lado espera uno: mantener la forma pareja evita el clasico "este canal
    // es distinto y nadie se acuerda de por que".
    return ipcRenderer.invoke(CANALES.cancelarRegistro, { tokenRegistro });
  },

  obtenerEstado(): Promise<EstadoKiosco> {
    return ipcRenderer.invoke(CANALES.obtenerEstado);
  },

  obtenerConfiguracion(): Promise<ConfiguracionParaInterfaz> {
    return ipcRenderer.invoke(CANALES.obtenerConfiguracion);
  },

  obtenerEmpleadosParaLista(): Promise<EmpleadoParaLista[]> {
    return ipcRenderer.invoke(CANALES.obtenerEmpleadosParaLista);
  },

  cambiarModoIdentificacion(
    modo: 'usuario' | 'lista' | 'numero',
  ): Promise<ConfiguracionParaInterfaz> {
    return ipcRenderer.invoke(CANALES.cambiarModoIdentificacion, { modo });
  },

  obtenerRegistros(): Promise<MarcaParaMostrar[]> {
    return ipcRenderer.invoke(CANALES.obtenerRegistros);
  },

  pausarKiosco(codigo: string): Promise<ResultadoPausa> {
    return ipcRenderer.invoke(CANALES.pausarKiosco, { codigo });
  },

  reportarEstadoCamara(estado: EstadoCamaraReportado): Promise<void> {
    return ipcRenderer.invoke(CANALES.reportarEstadoCamara, estado);
  },

  /**
   * Suscripcion a avisos del proceso principal.
   *
   * Detalle importante de seguridad: NO le pasamos a Angular el objeto
   * `evento` que trae Electron. Ese objeto incluye referencias internas
   * (como `evento.sender`) que serian otra puerta trasera. Solo le
   * entregamos el dato limpio.
   */
  alCambiarEstado(callback: (estado: EstadoKiosco) => void): () => void {
    const escucha = (_evento: IpcRendererEvent, estado: EstadoKiosco) => callback(estado);

    ipcRenderer.on(CANALES.estadoActualizado, escucha);

    // Devolvemos la funcion para darse de baja. Angular debe llamarla cuando
    // el componente se destruye; si no, cada recarga deja una escucha viva
    // y con el tiempo la app se llena de memoria basura.
    return () => {
      ipcRenderer.removeListener(CANALES.estadoActualizado, escucha);
    };
  },

  /**
   * Modo administrador (CLAUDE.md 5.2). Operaciones CONCRETAS, igual que
   * arriba: "ver la foto de esta marca", nunca "leer este archivo".
   */
  admin: {
    entrar(usuario: string, contrasena: string) {
      return ipcRenderer.invoke(CANALES.adminEntrar, { usuario, contrasena });
    },
    salir(token: string) {
      return ipcRenderer.invoke(CANALES.adminSalir, { token });
    },
    seguirActivo(token: string) {
      return ipcRenderer.invoke(CANALES.adminSeguirActivo, { token });
    },
    buscarRegistros(token: string, filtros: FiltrosAuditoria) {
      return ipcRenderer.invoke(CANALES.adminBuscarRegistros, { token, filtros });
    },
    listarEmpleados(token: string) {
      return ipcRenderer.invoke(CANALES.adminListarEmpleados, { token });
    },
    verFoto(token: string, marcaId: string) {
      return ipcRenderer.invoke(CANALES.adminVerFoto, { token, marcaId });
    },
    conservarFoto(token: string, marcaId: string, conservar: boolean, motivo: string) {
      return ipcRenderer.invoke(CANALES.adminConservarFoto, { token, marcaId, conservar, motivo });
    },
    definirRecuperacion(token: string, contrasena: string) {
      return ipcRenderer.invoke(CANALES.adminDefinirRecuperacion, { token, contrasena });
    },
    buscarMemoriasUsb(token: string) {
      return ipcRenderer.invoke(CANALES.adminBuscarMemoriasUsb, { token });
    },
    exportarAUsb(token: string, filtros: FiltrosAuditoria, unidad: string) {
      return ipcRenderer.invoke(CANALES.adminExportarAUsb, { token, filtros, unidad });
    },
    exportarACarpeta(token: string, filtros: FiltrosAuditoria) {
      return ipcRenderer.invoke(CANALES.adminExportarACarpeta, { token, filtros });
    },
    alCerrarSesion(callback: () => void): () => void {
      const escucha = (): void => callback();
      ipcRenderer.on(CANALES.adminSesionCerrada, escucha);
      return () => ipcRenderer.removeListener(CANALES.adminSesionCerrada, escucha);
    },
  },
};

// Aqui nace `window.kiosco` dentro de Angular. Es lo ultimo que hace este
// archivo, y es la unica cosa que la pagina llegara a ver de todo Electron.
contextBridge.exposeInMainWorld('kiosco', api);
