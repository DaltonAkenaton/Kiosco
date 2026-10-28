/**
 * ============================================================================
 *  IDENTIDAD VISUAL DEL SISTEMA
 * ============================================================================
 *
 *  Los VALORES viven en `tema.json` (al lado de este archivo).
 *  Este archivo sólo los documenta y les pone tipos.
 *
 *  ---------------------------------------------------------------------------
 *  ¿Por que los colores estan en un .json y no aqui mismo?
 *  ---------------------------------------------------------------------------
 *  Porque los necesitan DOS mundos que no se hablan entre si:
 *
 *    - TypeScript (Electron, y manana el panel) -> lo importa como objeto
 *    - CSS (la pantalla del kiosco)             -> no entiende TypeScript
 *
 *  Un archivo JSON lo pueden leer los dos. Un pequeño generador
 *  (`apps/kiosco-ui/generar-tema.mjs`) convierte este JSON en variables CSS
 *  automaticamente, cada vez que arrancas o compilas la interfaz.
 *
 *  Resultado: UN SOLO LUGAR manda sobre el color. Cambias `tema.json`,
 *  guardas, y cambia la ventana de Electron y la pantalla completa.
 *
 *  ---------------------------------------------------------------------------
 *  [PENDIENTE] Los colores institucionales de abajo son PROVISIONALES.
 *  ---------------------------------------------------------------------------
 *  Hay que pedir el MANUAL DE IDENTIDAD GRAFICA oficial de la UAT (lo emite
 *  Comunicacion Social / Rectoria) y poner ahi los codigos exactos.
 *
 *  Importa de verdad: la identidad de una institucion publica suele
 *  actualizarse con cada administracion. Por eso el color NO puede estar
 *  escrito dentro del codigo. Cambiarlo debe costar treinta segundos, no un
 *  rediseño.
 */

import tema from './tema.json';

// ============================================================================
//  1. DATOS DE LA INSTITUCION
// ============================================================================
/**
 * `nombre`          Nombre completo. Se usa en documentos y en el panel.
 * `nombreCorto`     Siglas. Es lo que se muestra en el kiosco (cabe mejor).
 * `facultad`        Nombre de la facultad. Dejalo vacio ("") si no quieres
 *                   que aparezca. [PENDIENTE] confirmar cual es.
 * `mostrarEnKiosco` Si es false, la pantalla del kiosco no muestra ningun
 *                   nombre institucional. Util si el cliente prefiere una
 *                   pantalla limpia.
 * `logoArchivo`     Nombre del archivo del logo dentro de
 *                   `apps/kiosco-ui/public/`. `null` = sin logo.
 *                   [PENDIENTE] pedir el logo en version oficial (PNG con
 *                   fondo transparente o SVG).
 */
export const INSTITUCION = tema.institucion;

// ============================================================================
//  2. COLORES
// ============================================================================
/**
 * Los colores estan divididos en TRES grupos, y la division no es decorativa:
 * es la regla que evita que un cambio de identidad rompa la usabilidad.
 *
 * --- GRUPO A: colores INSTITUCIONALES -------------------------------------
 *   `institucionPrimario`    color principal de la universidad
 *   `institucionSecundario`  color de acento
 *
 *   Estos SI cambian cuando cambia la identidad de la UAT.
 *   Se usan en adornos: cabecera, bordes, detalles. Nunca en algo donde
 *   equivocarse tenga consecuencias.
 *
 * --- GRUPO B: colores de SUPERFICIE ---------------------------------------
 *   `fondo`, `superficie`, `borde`, `texto`, `textoSuave`
 *
 *   El esqueleto de la pantalla. Deliberadamente oscuro: el kiosco se usa a
 *   las 6 de la mañana, en un pasillo con poca luz, y una pantalla blanca a
 *   esa hora deslumbra.
 *
 * --- GRUPO C: colores SEMANTICOS  ★ estos NO se tocan por identidad -------
 *   `entrada`   verde
 *   `salida`    ambar
 *   `peligro`   rojo
 *   `atencion`  amarillo
 *
 *   Aqui el color NO es decoracion: es INFORMACION.
 *
 *   El ARQUITECTURA.md (seccion 4) pide "la mayor distincion visual posible entre
 *   ENTRADA y SALIDA". Si manana el color institucional fuera verde y
 *   pintaramos toda la pantalla de verde, el boton de ENTRADA dejaria de
 *   destacar, y alguien medio dormido registraria salida creyendo que entro.
 *
 *   Por eso ENTRADA y SALIDA son independientes de la identidad.
 *
 *   ¿Y si el color oficial de la UAT resulta parecido a uno de estos?
 *   Pasa, y el generador te avisa cuando ocurre. No se resuelve cambiando el
 *   color de la universidad (ese no es negociable). Se resuelve asi, en orden:
 *
 *     1. Reducir DONDE aparece el color institucional: una franja delgada
 *        arriba, un borde, un detalle. Nunca areas grandes ni botones.
 *     2. Si aun asi compite, mover el tono SEMANTICO. Que "salida" sea ambar
 *        es costumbre, no ley; puede ser violeta o azul intenso si hace falta.
 *
 *   Lo que nunca se hace es dejar la ambiguedad ahi.
 *
 *   (De todos modos, el color nunca viaja solo: cada accion lleva ademas
 *   TEXTO e ICONO. Una persona daltonica debe poder usar el kiosco.)
 */
export const COLORES = tema.colores;

/** Todo junto, por comodidad. */
export const TEMA = tema;

export type Tema = typeof tema;
export type NombreDeColor = keyof typeof tema.colores;
