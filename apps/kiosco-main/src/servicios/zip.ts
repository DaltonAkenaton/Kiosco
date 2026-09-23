/**
 * ============================================================================
 *  ESCRITOR DE ARCHIVOS ZIP  (lo minimo que hace falta)
 * ============================================================================
 *
 *  ¿Por que no una libreria? Porque lo que se necesita es poquito: meter
 *  archivos que YA estan comprimidos (los JPEG no se achican mas) y un CSV
 *  chico. Eso es el metodo "store" del formato ZIP: los bytes van tal cual,
 *  sin comprimir. Son ~100 lineas que se pueden leer completas, contra una
 *  dependencia mas que actualizar y revisar.
 *
 *  Como es un ZIP por dentro:
 *
 *      ┌───────────────┬──────────┬───────────────┬──────────┬─────┬──────────────────┬─────┐
 *      │ encabezado 1  │ datos 1  │ encabezado 2  │ datos 2  │ ... │ directorio final │ fin │
 *      └───────────────┴──────────┴───────────────┴──────────┴─────┴──────────────────┴─────┘
 *
 *  El "directorio final" repite la lista de archivos y DONDE empieza cada
 *  uno. Windows lo lee primero para mostrar el contenido.
 *
 *  Se escribe directo al disco, archivo por archivo: nunca se junta el ZIP
 *  entero en memoria (un mes de fotos pesa decenas de megas).
 *
 *  Limites: menos de 65 535 archivos y menos de 4 GB (sin "ZIP64"). Con el
 *  tope de EXPORTACION.maximoRegistros no se llega ni cerca.
 */

import fs from 'node:fs';
import { crc32 } from 'node:zlib';

const FIRMA_ENCABEZADO_LOCAL = 0x04034b50;
const FIRMA_DIRECTORIO = 0x02014b50;
const FIRMA_FIN = 0x06054b50;
/** Version 2.0 del formato: la que entiende cualquier programa. */
const VERSION = 20;
/** Bit 11: los nombres van en UTF-8 (para que "Año" no salga como "AÃ±o"). */
const NOMBRES_UTF8 = 1 << 11;
/** Metodo 0: "store", sin comprimir. */
const SIN_COMPRIMIR = 0;

interface EntradaEscrita {
  nombre: Buffer;
  crc: number;
  tamano: number;
  desplazamiento: number;
  horaDos: number;
  fechaDos: number;
}

/**
 * Fecha y hora en el formato de MS-DOS, que es el que usa ZIP: sin zona y con
 * segundos de 2 en 2. Se le pasa la hora LOCAL ya separada en partes.
 */
function fechaDos(p: { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number }): {
  horaDos: number;
  fechaDos: number;
} {
  return {
    horaDos: (p.hora << 11) | (p.minuto << 5) | Math.floor(p.segundo / 2),
    fechaDos: ((Math.max(p.ano, 1980) - 1980) << 9) | (p.mes << 5) | p.dia,
  };
}

export class EscritorZip {
  private readonly descriptor: number;
  private readonly entradas: EntradaEscrita[] = [];
  private posicion = 0;
  private cerrado = false;

  /**
   * @param ruta          donde se crea el ZIP (si existe, se reemplaza)
   * @param horaLocal     fecha y hora local que llevaran los archivos de adentro
   */
  constructor(
    ruta: string,
    private readonly horaLocal: {
      ano: number;
      mes: number;
      dia: number;
      hora: number;
      minuto: number;
      segundo: number;
    },
  ) {
    this.descriptor = fs.openSync(ruta, 'w');
  }

  private escribir(bytes: Buffer): void {
    let escritos = 0;
    while (escritos < bytes.length) {
      escritos += fs.writeSync(this.descriptor, bytes, escritos, bytes.length - escritos);
    }
    this.posicion += bytes.length;
  }

  /** Agrega un archivo. `nombre` usa "/" para carpetas: "fotos/foto.jpg". */
  agregar(nombre: string, datos: Buffer): void {
    if (this.cerrado) throw new Error('El ZIP ya se cerro');

    const nombreBytes = Buffer.from(nombre, 'utf8');
    const { horaDos, fechaDos: fecha } = fechaDos(this.horaLocal);
    const entrada: EntradaEscrita = {
      nombre: nombreBytes,
      crc: crc32(datos),
      tamano: datos.length,
      desplazamiento: this.posicion,
      horaDos,
      fechaDos: fecha,
    };

    const encabezado = Buffer.alloc(30);
    encabezado.writeUInt32LE(FIRMA_ENCABEZADO_LOCAL, 0);
    encabezado.writeUInt16LE(VERSION, 4);
    encabezado.writeUInt16LE(NOMBRES_UTF8, 6);
    encabezado.writeUInt16LE(SIN_COMPRIMIR, 8);
    encabezado.writeUInt16LE(entrada.horaDos, 10);
    encabezado.writeUInt16LE(entrada.fechaDos, 12);
    encabezado.writeUInt32LE(entrada.crc, 14);
    encabezado.writeUInt32LE(entrada.tamano, 18); // comprimido (= original: no se comprime)
    encabezado.writeUInt32LE(entrada.tamano, 22); // original
    encabezado.writeUInt16LE(nombreBytes.length, 26);
    encabezado.writeUInt16LE(0, 28); // sin campos extra

    this.escribir(encabezado);
    this.escribir(nombreBytes);
    this.escribir(datos);
    this.entradas.push(entrada);
  }

  /** Escribe el directorio final y cierra el archivo. Sin esto, el ZIP no abre. */
  cerrar(): void {
    if (this.cerrado) return;
    const inicioDirectorio = this.posicion;

    for (const e of this.entradas) {
      const registro = Buffer.alloc(46);
      registro.writeUInt32LE(FIRMA_DIRECTORIO, 0);
      registro.writeUInt16LE(VERSION, 4); // hecho con
      registro.writeUInt16LE(VERSION, 6); // necesita
      registro.writeUInt16LE(NOMBRES_UTF8, 8);
      registro.writeUInt16LE(SIN_COMPRIMIR, 10);
      registro.writeUInt16LE(e.horaDos, 12);
      registro.writeUInt16LE(e.fechaDos, 14);
      registro.writeUInt32LE(e.crc, 16);
      registro.writeUInt32LE(e.tamano, 20);
      registro.writeUInt32LE(e.tamano, 24);
      registro.writeUInt16LE(e.nombre.length, 28);
      // 30: extra, 32: comentario, 34: disco, 36: atributos internos,
      // 38: atributos externos -> todo en cero.
      registro.writeUInt32LE(e.desplazamiento, 42);
      this.escribir(registro);
      this.escribir(e.nombre);
    }

    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(FIRMA_FIN, 0);
    fin.writeUInt16LE(this.entradas.length, 8); // entradas en este disco
    fin.writeUInt16LE(this.entradas.length, 10); // entradas en total
    fin.writeUInt32LE(this.posicion - inicioDirectorio, 12);
    fin.writeUInt32LE(inicioDirectorio, 16);
    this.escribir(fin);

    // Que llegue de verdad a la memoria antes de decir "ya puedes quitarla".
    fs.fsyncSync(this.descriptor);
    fs.closeSync(this.descriptor);
    this.cerrado = true;
  }

  /** Cierra sin terminar (algo fallo). El archivo queda inservible: hay que borrarlo. */
  abandonar(): void {
    if (this.cerrado) return;
    this.cerrado = true;
    try {
      fs.closeSync(this.descriptor);
    } catch {
      // Ya estaba cerrado o la memoria se quito: nada que hacer.
    }
  }
}

/**
 * Lee la lista de archivos de un ZIP hecho por `EscritorZip`. Existe para las
 * PRUEBAS: comprobar que lo escrito se puede volver a leer, byte por byte.
 */
export function leerZipSinComprimir(zip: Buffer): Map<string, Buffer> {
  const archivos = new Map<string, Buffer>();
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin === -1) throw new Error('No es un ZIP');
  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);

  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(p) !== FIRMA_DIRECTORIO) throw new Error('Directorio roto');
    const crc = zip.readUInt32LE(p + 16);
    const tamano = zip.readUInt32LE(p + 24);
    const largoNombre = zip.readUInt16LE(p + 28);
    const largoExtra = zip.readUInt16LE(p + 30);
    const largoComentario = zip.readUInt16LE(p + 32);
    const desplazamiento = zip.readUInt32LE(p + 42);
    const nombre = zip.subarray(p + 46, p + 46 + largoNombre).toString('utf8');

    const largoNombreLocal = zip.readUInt16LE(desplazamiento + 26);
    const largoExtraLocal = zip.readUInt16LE(desplazamiento + 28);
    const inicio = desplazamiento + 30 + largoNombreLocal + largoExtraLocal;
    const datos = zip.subarray(inicio, inicio + tamano);
    if (crc32(datos) !== crc) throw new Error(`CRC incorrecto en ${nombre}`);

    archivos.set(nombre, datos);
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}
