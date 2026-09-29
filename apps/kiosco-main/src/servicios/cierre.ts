/**
 * ============================================================================
 *  CERRAR EL KIOSCO EN UNA PC COMPARTIDA  (29-09-2026)
 * ============================================================================
 *
 *  Con `kiosco_pc_compartida` (tabla configuracion, lo decide el jefe), el
 *  kiosco no vive abierto: el personal lo abre, registra y lo cierra (con el
 *  boton "Cerrar kiosco" o con Alt+F4). Cerrar no puede ser "matar el
 *  programa", por dos razones:
 *
 *    1. Lo recien registrado se manda a la oficina unos segundos despues.
 *       Si se cierra de inmediato, se quedaria en esta PC hasta la proxima vez
 *       que alguien abra el kiosco (que puede ser mañana). Por eso, antes de
 *       salir, se intenta mandar lo pendiente, con un tope de espera.
 *
 *    2. Las versiones nuevas se instalan de madrugada con el kiosco ABIERTO,
 *       y aqui nunca lo esta. Por eso, si hay una descargada, se instala al
 *       cerrar (en silencio y sin volver a abrir el kiosco).
 *
 *  Sin internet no se espera nada: lo pendiente se manda la proxima vez.
 */

import { CONFIG } from '@kiosko/compartido';
import { actualizacionLista, instalarAlCerrar } from '../actualizaciones';
import { permitirSalir } from '../arranque-automatico';
import { contarPendientes } from '../datos/repositorio-marcas';
import { enviarAntesDeCerrar } from './sincronizacion';

let cerrando = false;

/** ¿Ya se esta cerrando? (Para no empezar dos veces si pican el boton y Alt+F4.) */
export function seEstaCerrando(): boolean {
  return cerrando;
}

export async function cerrarKiosco(): Promise<void> {
  if (cerrando) return;
  cerrando = true;

  const antes = contarPendientes();
  const quedan = antes > 0 ? await enviarAntesDeCerrar(CONFIG.pausa.segundosMaximosParaEnviarAlCerrar * 1000) : 0;
  console.info(`[cierre] cerrando el kiosco: ${antes - quedan} enviado(s), ${quedan} pendiente(s) para la proxima vez`);

  if (actualizacionLista()) {
    console.info(`[cierre] se instala la version ${actualizacionLista()} al cerrar`);
    instalarAlCerrar();
    return;
  }
  permitirSalir();
}
