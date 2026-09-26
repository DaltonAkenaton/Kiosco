/**
 * ============================================================================
 *  ESCRIBIR UN EXCEL (.xlsx) DE VERDAD, SIN LIBRERIAS
 * ============================================================================
 *
 *  Antes el panel descargaba CSV ("texto separado por comas"). El Excel en
 *  español de Mexico espera PUNTO Y COMA, asi que al abrirlo metia todo en una
 *  sola columna (lo encontro el autor, 26-09-2026). Un .xlsx de verdad se ve
 *  bien en cualquier Excel, sin importar el idioma, y ademas lleva:
 *    - titulos en negritas con fondo, y la primera fila fija al desplazarse;
 *    - filtros en los titulos;
 *    - anchos de columna;
 *    - varias hojas en un mismo archivo.
 *
 *  Un .xlsx es un ZIP con archivos XML (el formato "Office Open XML"). Aqui se
 *  arma el ZIP sin comprimir (metodo "store"): mas grande, pero mucho mas
 *  simple, y con los tamaños de este sistema no importa.
 *
 *  Uso:
 *    descargarExcel('asistencia.xlsx', [
 *      { nombre: 'Resumen', filas: [['Nombre', 'Horas'], ['Ana', 8]] },
 *    ]);
 *  La PRIMERA fila de cada hoja son los titulos.
 */

export type Celda = string | number | null | undefined;

export interface Hoja {
  nombre: string;
  filas: Celda[][];
  /** Ancho de cada columna, en "caracteres". Si falta, se calcula. */
  anchos?: number[];
  /** Sin titulos en negritas ni filtros (para una hoja de instrucciones). */
  sinTitulos?: boolean;
}

export function descargarExcel(nombreArchivo: string, hojas: Hoja[]): void {
  const bytes = armarExcel(hojas);
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

/** El archivo completo, como bytes. Separado para poder probarlo. */
export function armarExcel(hojas: Hoja[]): Uint8Array<ArrayBuffer> {
  const archivos: [string, string][] = [
    ['[Content_Types].xml', tiposDeContenido(hojas.length)],
    ['_rels/.rels', RELS_RAIZ],
    ['xl/workbook.xml', libro(hojas)],
    ['xl/_rels/workbook.xml.rels', relsDelLibro(hojas.length)],
    ['xl/styles.xml', ESTILOS],
    ...hojas.map((h, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, hoja(h)]),
  ];
  return zipSinComprimir(archivos.map(([nombre, texto]) => [nombre, new TextEncoder().encode(texto)]));
}

// ----------------------------------------------------------------------------
//  Las partes del libro
// ----------------------------------------------------------------------------

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function tiposDeContenido(numeroDeHojas: number): string {
  const hojas = Array.from(
    { length: numeroDeHojas },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    hojas +
    '</Types>'
  );
}

const RELS_RAIZ =
  XML +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

function libro(hojas: Hoja[]): string {
  const lista = hojas
    .map((h, i) => `<sheet name="${escapar(nombreDeHojaValido(h.nombre))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  const filtros = hojas
    .map((h, i) =>
      h.sinTitulos || h.filas.length === 0
        ? ''
        : `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapar(nombreDeHojaValido(h.nombre)).replace(/'/g, "''")}'!$A$1:$${letra(anchoDe(h) - 1)}$${h.filas.length}</definedName>`,
    )
    .join('');
  return (
    XML +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${lista}</sheets>` +
    (filtros ? `<definedNames>${filtros}</definedNames>` : '') +
    '</workbook>'
  );
}

function relsDelLibro(numeroDeHojas: number): string {
  const hojas = Array.from(
    { length: numeroDeHojas },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return (
    XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    hojas +
    `<Relationship Id="rId${numeroDeHojas + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>'
  );
}

/** Estilo 0 = normal; 1 = titulo (negritas, fondo azul claro, borde abajo); 2 = texto con ajuste de linea. */
const ESTILOS =
  XML +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E7F0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FF003D5C"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function hoja(h: Hoja): string {
  const columnas = anchoDe(h);
  const anchos = Array.from({ length: columnas }, (_, c) => h.anchos?.[c] ?? anchoAutomatico(h, c));
  const cols = anchos.map((a, c) => `<col min="${c + 1}" max="${c + 1}" width="${a}" customWidth="1"/>`).join('');

  const filas = h.filas
    .map((fila, f) => {
      const estilo = h.sinTitulos ? 2 : f === 0 ? 1 : 0;
      const celdas = fila
        .map((valor, c) => {
          const ref = `${letra(c)}${f + 1}`;
          if (valor === null || valor === undefined || valor === '') return '';
          if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
          return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapar(String(valor))}</t></is></c>`;
        })
        .join('');
      return `<row r="${f + 1}">${celdas}</row>`;
    })
    .join('');

  const congelar = h.sinTitulos
    ? ''
    : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  const filtro =
    h.sinTitulos || h.filas.length === 0 ? '' : `<autoFilter ref="A1:${letra(columnas - 1)}${h.filas.length}"/>`;

  return (
    XML +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    congelar +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${filas}</sheetData>` +
    filtro +
    '</worksheet>'
  );
}

// ----------------------------------------------------------------------------
//  Ayudas
// ----------------------------------------------------------------------------

function anchoDe(h: Hoja): number {
  return Math.max(1, ...h.filas.map((f) => f.length));
}

/** El ancho segun el texto mas largo de la columna, entre 8 y 60. */
function anchoAutomatico(h: Hoja, c: number): number {
  const largo = Math.max(...h.filas.map((f) => String(f[c] ?? '').length));
  return Math.min(60, Math.max(8, largo + 2));
}

/** 0 -> A, 25 -> Z, 26 -> AA */
function letra(indice: number): string {
  let n = indice + 1;
  let texto = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    texto = String.fromCharCode(65 + r) + texto;
    n = Math.floor((n - 1) / 26);
  }
  return texto;
}

/** Excel no acepta ciertos caracteres ni nombres de mas de 31 letras en las hojas. */
function nombreDeHojaValido(nombre: string): string {
  return nombre.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja';
}

function escapar(texto: string): string {
  return texto
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // caracteres que el XML no permite
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------------------
//  El ZIP (sin comprimir)
// ----------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of datos) crc = TABLA_CRC[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipSinComprimir(archivos: [string, Uint8Array][]): Uint8Array<ArrayBuffer> {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let posicion = 0;

  for (const [nombre, datos] of archivos) {
    const nombreBytes = new TextEncoder().encode(nombre);
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version necesaria
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // metodo: store
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true); // fecha: 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nombreBytes.length, true);
    local.setUint16(28, 0, true);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, 0, true);
    dir.setUint16(14, 0x21, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, datos.length, true);
    dir.setUint32(24, datos.length, true);
    dir.setUint16(28, nombreBytes.length, true);
    dir.setUint32(42, posicion, true);

    partes.push(new Uint8Array(local.buffer), nombreBytes, datos);
    central.push(new Uint8Array(dir.buffer), nombreBytes);
    posicion += 30 + nombreBytes.length + datos.length;
  }

  const tamanoCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamanoCentral, true);
  fin.setUint32(16, posicion, true);

  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of todo) {
    salida.set(p, i);
    i += p.length;
  }
  return salida;
}
