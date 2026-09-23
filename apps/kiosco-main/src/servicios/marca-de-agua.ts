/**
 * ============================================================================
 *  MARCA DE AGUA DE LAS FOTOS EXPORTADAS  (D-025)
 * ============================================================================
 *
 *  Al exportar a USB, cada foto lleva GRABADOS (en los pixeles, no encima)
 *  la fecha, la hora, el tipo, el numero de empleado y el kiosco. En la
 *  memoria los archivos viajan sueltos: sin esto, una foto separada del CSV
 *  no dice de quien es ni cuando se tomo.
 *
 *  Las fotos GUARDADAS en el kiosco siguen limpias. Esto solo se hace al
 *  exportar.
 *
 *  ---------------------------------------------------------------------------
 *  ¿Como se escribe texto en una foto sin librerias?
 *  ---------------------------------------------------------------------------
 *  Electron ya sabe abrir y guardar JPEG (`nativeImage`), y abierto un JPEG es
 *  solo una lista de pixeles: 4 bytes por pixel (azul, verde, rojo, alfa).
 *  Lo que falta es la letra, y para eso basta una letra de puntos, como la de
 *  los relojes digitales viejos: cada caracter es una cuadricula de 5 x 7.
 *
 *      "A"   .###.        cada "#" se pinta como un cuadrito de
 *            #...#        EXPORTACION.escalaDeLetra pixeles por lado
 *            #...#
 *            #####
 *            #...#
 *            #...#
 *            #...#
 *
 *  Solo MAYUSCULAS sin acentos (mas la Ñ): es lo que se lee bien a este
 *  tamano, y no hace falta mas para fechas, numeros y nombres de kiosco.
 */

import { nativeImage } from 'electron';
import { quitarAcentos } from '@kiosko/compartido';

const ANCHO_LETRA = 5;
const ALTO_LETRA = 7;
/** Un punto de separacion entre letras. */
const ANCHO_CELDA = ANCHO_LETRA + 1;

const LETRAS: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  Ñ: ['.##.#', '#.##.', '#...#', '##..#', '#.#.#', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '/': ['.....', '....#', '...#.', '..#..', '.#...', '#....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
};

/** Un color como lo guarda la foto: rojo, verde y azul de 0 a 255. */
export interface ColorRgb {
  r: number;
  g: number;
  b: number;
}

/** "#10b981" -> { r: 16, g: 185, b: 129 } */
export function colorDeHex(hex: string): ColorRgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Un renglon de la marca de agua. */
export interface RenglonDeMarca {
  texto: string;
  color: ColorRgb;
}

/**
 * Deja el texto solo con lo que la letra sabe dibujar: mayusculas, sin
 * acentos (la Ñ se respeta) y "?" en lugar de lo desconocido.
 */
export function textoDibujable(texto: string): string {
  return [...texto.toUpperCase()]
    .map((c) => {
      if (c === 'Ñ' || LETRAS[c]) return c;
      const sinAcento = quitarAcentos(c);
      return LETRAS[sinAcento] ? sinAcento : '?';
    })
    .join('');
}

/** Ancho en pixeles de un texto ya dibujable, sin el hueco despues de la ultima letra. */
function anchoDeTexto(texto: string, escala: number): number {
  return texto.length === 0 ? 0 : (texto.length * ANCHO_CELDA - 1) * escala;
}

/**
 * Pinta la franja y el texto sobre los pixeles (formato BGRA de Electron).
 * Modifica `pixeles` en su lugar. Separada de la parte del JPEG para poder
 * probarla sin fotos.
 */
export function pintarMarcaDeAgua(
  pixeles: Buffer,
  ancho: number,
  alto: number,
  renglones: readonly RenglonDeMarca[],
  opciones: { escalaMaxima: number; opacidadDeFranja: number },
): void {
  const textos = renglones.map((r) => textoDibujable(r.texto));
  const margen = 8;

  // La letra mas grande con la que el renglon mas largo todavia cabe.
  const masLargo = textos.reduce((a, t) => (t.length > a.length ? t : a), '');
  let escala = Math.max(1, Math.floor(opciones.escalaMaxima));
  while (escala > 1 && anchoDeTexto(masLargo, escala) > ancho - 2 * margen) escala--;
  // Aun con escala 1 no cabe: se corta el renglon, antes que salirse de la foto.
  const letrasQueCaben = Math.max(1, Math.floor((ancho - 2 * margen + escala) / (ANCHO_CELDA * escala)));

  const altoRenglon = (ALTO_LETRA + 3) * escala;
  const altoFranja = Math.min(alto, renglones.length * altoRenglon + 2 * margen - 3 * escala);
  const inicioFranja = alto - altoFranja;

  // 1. La franja oscura: cada pixel se mezcla con negro.
  const conservar = 1 - Math.min(1, Math.max(0, opciones.opacidadDeFranja));
  for (let y = inicioFranja; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4;
      pixeles[i] = Math.round(pixeles[i]! * conservar);
      pixeles[i + 1] = Math.round(pixeles[i + 1]! * conservar);
      pixeles[i + 2] = Math.round(pixeles[i + 2]! * conservar);
    }
  }

  // 2. El texto, punto por punto.
  textos.forEach((texto, n) => {
    const color = renglones[n]!.color;
    const y0 = inicioFranja + margen + n * altoRenglon;
    [...texto.slice(0, letrasQueCaben)].forEach((caracter, posicion) => {
      const dibujo = LETRAS[caracter] ?? LETRAS['?']!;
      const x0 = margen + posicion * ANCHO_CELDA * escala;
      for (let fila = 0; fila < ALTO_LETRA; fila++) {
        for (let columna = 0; columna < ANCHO_LETRA; columna++) {
          if (dibujo[fila]![columna] !== '#') continue;
          for (let dy = 0; dy < escala; dy++) {
            const y = y0 + fila * escala + dy;
            if (y < 0 || y >= alto) continue;
            for (let dx = 0; dx < escala; dx++) {
              const x = x0 + columna * escala + dx;
              if (x >= ancho) continue;
              const i = (y * ancho + x) * 4;
              pixeles[i] = color.b;
              pixeles[i + 1] = color.g;
              pixeles[i + 2] = color.r;
              pixeles[i + 3] = 255;
            }
          }
        }
      }
    });
  });
}

/**
 * Abre un JPEG, le graba los renglones y lo vuelve a guardar como JPEG.
 * Devuelve `null` si los bytes no son una imagen que Electron sepa abrir.
 */
export function grabarMarcaDeAgua(
  jpeg: Buffer,
  renglones: readonly RenglonDeMarca[],
  opciones: { escalaMaxima: number; opacidadDeFranja: number; calidadJpeg: number },
): Buffer | null {
  const imagen = nativeImage.createFromBuffer(jpeg);
  if (imagen.isEmpty()) return null;

  const { width, height } = imagen.getSize();
  // `toBitmap` devuelve una COPIA de los pixeles: se puede pintar encima sin
  // tocar la imagen original.
  const pixeles = imagen.toBitmap();
  pintarMarcaDeAgua(pixeles, width, height, renglones, opciones);

  return nativeImage.createFromBitmap(pixeles, { width, height }).toJPEG(opciones.calidadJpeg);
}
