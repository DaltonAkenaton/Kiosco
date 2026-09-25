/**
 * Puerta de entrada SOLO PARA PRUEBAS.
 *
 * Reexporta lo que la prueba automatizada necesita, para poder empaquetarlo
 * con esbuild y correrlo dentro de Electron. No lo importa nadie mas.
 */
export { abrirBaseDeDatos, cerrarBaseDeDatos } from './datos/base-de-datos';
export { sembrarEmpleadosDePrueba } from './datos/semilla';
export {
  accionSugeridaPara,
  buscarPorId,
  buscarPorNumeroEmpleado,
  buscarPorUsuario,
  listarActivos,
} from './datos/repositorio-empleados';
export {
  verificarPin,
  hashearPin,
  estadoDeBloqueo,
  envejecerIntentos,
  simularVerificacion,
} from './servicios/autenticacion';
export { leerReloj, detectarAnomaliasDeReloj } from './servicios/reloj';
export {
  nuevoIdDeMarca,
  guardarMarca,
  contarPendientes,
  contarMarcas,
  horaDeLaUltimaMarca,
  marcasPendientes,
} from './datos/repositorio-marcas';
export {
  guardarFoto,
  leerFoto,
  hashDeFoto,
  bytesDeDataUrl,
  cifrarFoto,
  descifrarFoto,
  rutaAbsolutaDeFoto,
  borrarArchivoDeFoto,
  pareceObstruida,
} from './servicios/fotos';
export {
  prepararLlaveDeFotos,
  tieneContrasenaDeRecuperacion,
  definirContrasenaDeRecuperacion,
  abrirLlaveConRecuperacion,
  rutaDeLaLlave,
  olvidarLlaveEnMemoria,
} from './servicios/llave-fotos';
export {
  obtenerFoto,
  cambiarConservar,
  contarFotosEnDisco,
} from './datos/repositorio-fotos';
export {
  depurarFotosVencidas,
  migrarFotosHeredadas,
  diasDeRetencion,
} from './servicios/retencion-fotos';
export { baseDeDatos } from './datos/base-de-datos';
export {
  crearPase,
  canjearPase,
  descartarPase,
  pasesVivos,
} from './servicios/identificaciones-pendientes';
export {
  registrarEvento,
  contarEventosPendientes,
  eventosPendientes,
} from './datos/repositorio-eventos';
export { EsquemaPausa, EsquemaRegistro, EsquemaCancelacion } from './ipc/esquemas';
export { sembrarAdministradorDePrueba, ADMIN_DE_PRUEBA } from './datos/semilla';
export { contarEmpleados } from './datos/repositorio-empleados';
export {
  buscarMarcasParaAuditoria,
  empleadosParaFiltro,
  registrarAccesoFoto,
  accesosDeFoto,
  inicioDelDiaLocal,
} from './datos/repositorio-admin';
export {
  entrarModoAdmin,
  validarSesionAdmin,
  cerrarSesionAdmin,
  vencerSesionAdminParaPrueba,
  segundosDeEsperaTras,
  MENSAJE_INTENTO_FALLIDO,
} from './servicios/sesion-admin';
export { buscarMarcasParaExportar, registrarAccesosFoto } from './datos/repositorio-admin';
export { EscritorZip, leerZipSinComprimir } from './servicios/zip';
export { pintarMarcaDeAgua, grabarMarcaDeAgua, textoDibujable } from './servicios/marca-de-agua';
export { exportarRegistros, renglonesDeMarca } from './servicios/exportacion';
export { interpretarRespuesta, esDiscoDeEstaComputadora } from './servicios/memorias-usb';
export { EsquemaExportarAUsb } from './ipc/esquemas';
export {
  renglonesParaSubir,
  armarCuerpo,
  marcarEnviados,
  marcarRechazados,
  anotarFallo,
  contarRechazados,
  aplicarCatalogo,
  registrarEstadoDeFoto,
  guardarEstadoLocal,
  listarRechazados,
  reintentarRechazados,
  leerEstadoLocal,
} from './datos/repositorio-sincronizacion';
export { reglasDelPin, umbralesDeCamara, numeroConfigurado } from './configuracion-vigente';
export {
  calcularDesfase,
  enrolar,
  ciclo,
  iniciarSincronizacion,
  estadoDeLaNube,
  reiniciarSincronizacionParaPrueba,
} from './servicios/sincronizacion';
export { leerCredencial, rutaDeLaCredencial, olvidarCredencialEnMemoria } from './servicios/credencial-kiosco';
export { EsquemaEnrolamiento } from './ipc/esquemas';
export { instanteLocal } from '@kiosko/compartido';
export { contarFotosConLlaveAnterior, recuperarFotosConContrasena } from './servicios/recuperacion-fotos';
