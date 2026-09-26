/**
 * ============================================================================
 *  LEER UNA HOJA DE EXCEL (.xlsx) SIN LIBRERIAS
 * ============================================================================
 *
 *  El jefe no tiene por que saber que es un "CSV UTF-8". Guarda su lista en
 *  Excel como siempre (.xlsx) y el panel la lee.
 *
 *  Un .xlsx es un ZIP con archivos XML adentro:
 *      xl/sharedStrings.xml     los textos (cada celda de texto apunta aqui)
 *      xl/worksheets/sheet1.xml las celdas de la primera hoja
 *
 *  El navegador ya sabe descomprimir (DecompressionStream) y leer XML
 *  (DOMParser), asi que no hace falta agregar una libreria de Excel entera
 *  (pesadas, y la mas conocida ya no recibe arreglos de seguridad en npm).
 *
 *  Devuelve la PRIMERA hoja como renglones de texto. Si el archivo no es un
 *  Excel valido, lanza un error con un mensaje para personas.
 */

interface EntradaZip {
  nombre: string;
  metodo: number;
  tamanoComprimido: number;
  inicioLocal: number;
}

const NO_ES_EXCEL = 'Ese archivo no parece un Excel (.xlsx). Ábrelo en Excel y guárdalo otra vez como "Libro de Excel".';

export async function leerHojaDeExcel(archivo: File): Promise<string[][]> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const entradas = leerDirectorioZip(bytes);

  const hojas = [...entradas.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(
    (a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]),
  );
  if (hojas.length === 0) throw new Error(NO_ES_EXCEL);

  const textos = entradas.has('xl/sharedStrings.xml')
    ? leerTextosCompartidos(await extraer(bytes, entradas.get('xl/sharedStrings.xml')!))
    : [];
  return leerHoja(await extraer(bytes, entradas.get(hojas[0]!)!), textos);
}

/** El "indice" del ZIP, que esta al final del archivo. */
function leerDirectorioZip(b: Uint8Array): Map<string, EntradaZip> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error(NO_ES_EXCEL);

  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const entradas = new Map<string, EntradaZip>();
  const texto = new TextDecoder();
  for (let i = 0; i < total; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error(NO_ES_EXCEL);
    const metodo = v.getUint16(p + 10, true);
    const tamanoComprimido = v.getUint32(p + 20, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const inicioLocal = v.getUint32(p + 42, true);
    const nombre = texto.decode(b.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { nombre, metodo, tamanoComprimido, inicioLocal });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

/** Saca un archivo del ZIP y lo devuelve como texto. */
async function extraer(b: Uint8Array, e: EntradaZip): Promise<string> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(e.inicioLocal, true) !== 0x04034b50) throw new Error(NO_ES_EXCEL);
  const inicio = e.inicioLocal + 30 + v.getUint16(e.inicioLocal + 26, true) + v.getUint16(e.inicioLocal + 28, true);
  const datos = b.slice(inicio, inicio + e.tamanoComprimido);
  if (e.metodo === 0) return new TextDecoder().decode(datos);
  if (e.metodo !== 8) throw new Error(NO_ES_EXCEL);
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(flujo).text();
}

function leerTextosCompartidos(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagName('si')].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''),
  );
}

/** "C12" -> columna 2 (A = 0). */
function columna(referencia: string): number {
  const letras = referencia.replace(/\d+/g, '');
  let n = 0;
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

function leerHoja(xml: string, textos: string[]): string[][] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const renglones: string[][] = [];
  for (const row of doc.getElementsByTagName('row')) {
    const celdas: string[] = [];
    for (const c of row.getElementsByTagName('c')) {
      const tipo = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let valor: string;
      if (tipo === 's') valor = textos[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
      else valor = v;
      const i = columna(c.getAttribute('r') ?? '');
      celdas[i >= 0 ? i : celdas.length] = valor.trim();
    }
    renglones.push(Array.from(celdas, (x) => x ?? ''));
  }
  return renglones.filter((r) => r.some((x) => x !== ''));
}
