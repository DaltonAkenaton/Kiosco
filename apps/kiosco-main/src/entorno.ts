/**
 * ============================================================================
 *  ENTORNO: ¿estamos desarrollando o esto ya esta instalado en el kiosco?
 * ============================================================================
 *
 *  Muchas decisiones de seguridad dependen de esta pregunta. Por ejemplo:
 *  las herramientas de desarrollador (DevTools) son indispensables mientras
 *  programas, y son un agujero de seguridad en el kiosco real, donde el
 *  personal tiene acceso fisico al teclado.
 *
 *  En vez de esparcir `if (algo) ...` por todo el proyecto, lo resolvemos
 *  UNA sola vez aqui y el resto del codigo pregunta `if (ES_DESARROLLO)`.
 */

import { app } from 'electron';
import path from 'node:path';

/**
 * `app.isPackaged` es de Electron y es la forma confiable de saberlo:
 *   - false -> estas corriendo `npm run dev` desde el codigo fuente
 *   - true  -> la app se instalo desde el .exe generado por electron-builder
 *
 * No usamos variables de entorno tipo NODE_ENV porque cualquiera puede
 * cambiarlas desde Windows, y eso reactivaria las DevTools en el kiosco real.
 */
export const ES_DESARROLLO = !app.isPackaged;
export const ES_PRODUCCION = app.isPackaged;

/**
 * ----------------------------------------------------------------------------
 *  MODO PRUEBA: la app empaquetada, pero usable desde tu escritorio
 * ----------------------------------------------------------------------------
 *
 *  ¿QUE PROBLEMA RESUELVE?
 *
 *  Entre "programando" y "instalado en el kiosco" faltaba un escalon, y por
 *  ese hueco se colo el error E-015: la pantalla se veia perfecta en
 *  desarrollo y salia SIN ESTILOS en el .exe, porque la CSP estricta y las
 *  rutas `file://` solo existen cuando la app esta empaquetada.
 *
 *  Reproducirlo exigia generar un instalador de 107 MB e instalarlo. Nadie
 *  hace eso mientras prueba una idea, asi que el error vivio hasta la primera
 *  instalacion real.
 *
 *  Con `npm run probar:empaquetado` se genera la app empaquetada de verdad
 *  (10 segundos, sin instalador) y se abre con esta bandera.
 *
 *  ---------------------------------------------------------------------------
 *  QUE APAGA  (y, sobre todo, QUE NO)
 *  ---------------------------------------------------------------------------
 *  APAGA solo lo que estorba para probar en tu propia computadora:
 *
 *    - el registro de arranque automatico con Windows;
 *    - la pantalla completa (asi ves tu editor al lado);
 *    - el bloqueo de Alt+F4.
 *
 *  NO TOCA NADA DE SEGURIDAD. La Content-Security-Policy sigue siendo la
 *  estricta, las DevTools siguen apagadas, el sandbox sigue puesto y la
 *  interfaz se sigue cargando desde `file://`. Si asi no fuera, este modo no
 *  serviria para nada: seria un cuarto entorno que tampoco se parece al real,
 *  y volveriamos a tener el mismo hueco un escalon mas arriba.
 *
 *  Por eso la bandera es inofensiva aunque alguien la descubra: lo unico que
 *  consigue es que el kiosco no se ponga en pantalla completa. Los accesos
 *  directos que crea el instalador nunca la pasan.
 */
export const MODO_PRUEBA = process.argv.includes('--modo-prueba');

/**
 * Direccion donde Angular sirve la interfaz mientras desarrollas.
 * 4200 es el puerto por defecto del `ng serve`.
 */
export const URL_DESARROLLO = 'http://localhost:4200';

/**
 * Ruta del index.html ya compilado, para produccion.
 * `__dirname` es la carpeta donde quedo este archivo compilado (dist/).
 */
export const RUTA_INTERFAZ_COMPILADA = path.join(__dirname, 'interfaz', 'index.html');

/**
 * Carpeta privada de la aplicacion dentro del perfil de Windows.
 * Queda en algo como:
 *   C:\Users\<usuario>\AppData\Roaming\Control de Asistencia\
 *
 * Aqui van la base de datos SQLite y las fotos pendientes de subir.
 *
 * ¿Por que ahi y no junto al .exe? Porque en el kiosco la app corre con una
 * cuenta de Windows SIN privilegios (ARQUITECTURA.md 13), y esa cuenta no puede
 * escribir dentro de "Archivos de programa". AppData siempre es escribible.
 *
 * Es una funcion y no una constante porque `app.getPath` solo se puede
 * llamar despues de que Electron esta listo.
 */
export function carpetaDeDatos(): string {
  return app.getPath('userData');
}
