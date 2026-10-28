/**
 * ============================================================================
 *  EXPORTACION A MEMORIA USB  (ARQUITECTURA.md 5.2, cierre del bloque 3.b)
 * ============================================================================
 *
 *  El UNICO camino por el que una foto sale del kiosco. Arma un ZIP con:
 *
 *      asistencia_2026-09-01_a_2026-09-23_hecho-2026-09-23_1530.zip
 *      ├── LEEME.txt           que es esto y como cuidarlo
 *      ├── registros.csv       todos los registros de los filtros (abre en Excel)
 *      └── fotos/
 *          └── 2026-09-23_06-02-15_entrada_<uuid>.jpg   con marca de agua grabada
 *
 *  ---------------------------------------------------------------------------
 *  El orden importa (igual que en "ver foto")
 *  ---------------------------------------------------------------------------
 *    1. Se anota en la bitacora `accesos_foto` cada foto que va a salir.
 *    2. DESPUES se escriben.
 *  Si anotar falla, no sale nada. Una foto que sale sin rastro es justo lo
 *  que la bitacora existe para impedir (ARQUITECTURA.md 12). Si la escritura falla
 *  a la mitad, la bitacora dira que se exporto algo que no llego a la
 *  memoria: sobra una anotacion, pero nunca falta una.
 *
 *  ---------------------------------------------------------------------------
 *  Nombres de archivo
 *  ---------------------------------------------------------------------------
 *  Fecha, hora, tipo y el UUID de la marca: se ordenan solos por fecha y el
 *  UUID los liga al CSV. El numero y el nombre del empleado NO van en el
 *  nombre del archivo (mismo criterio que en el kiosco, ARQUITECTURA.md 5.1): van
 *  grabados en la foto y en el CSV.
 *
 *  ---------------------------------------------------------------------------
 *  La huella (SHA-256) y la marca de agua
 *  ---------------------------------------------------------------------------
 *  Al grabar la marca de agua la foto cambia, y su huella tambien. Por eso el
 *  kiosco comprueba la huella de la ORIGINAL antes de exportarla (lo hace
 *  `leerFoto`), y el CSV lleva la huella original, que es la que tiene la
 *  nube. Quien necesite comprobarla fuera del kiosco puede pedir las
 *  originales con EXPORTACION.incluirOriginales (D-030).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COLORES,
  CONFIG,
  NOMBRES_DE_BANDERAS,
  type BanderaMarca,
  type FiltrosAuditoria,
  type ResultadoExportacion,
} from '@kiosko/compartido';
import {
  buscarMarcasParaExportar,
  type MarcaParaExportar,
  registrarAccesosFoto,
} from '../datos/repositorio-admin';
import { zonaHorariaVigente } from '../configuracion-vigente';
import { registrarEvento } from '../datos/repositorio-eventos';
import { leerCredencial } from './credencial-kiosco';
import { leerFoto } from './fotos';
import { colorDeHex, grabarMarcaDeAgua, type RenglonDeMarca } from './marca-de-agua';
import { EscritorZip } from './zip';

export type ResultadoDeExportar =
  | { ok: true; resultado: ResultadoExportacion }
  /** `mensaje` se puede mostrar tal cual en pantalla. */
  | { ok: false; mensaje: string };

/** Lo que dice la columna "foto" del CSV, en palabras. */
type EstadoEnCsv =
  | 'incluida'
  | 'sin foto'
  | 'borrada (30 días)'
  | 'no está en el kiosco'
  | 'alterada'
  | 'necesita la contraseña de recuperación'
  | 'no se pudo marcar';

// ----------------------------------------------------------------------------
//  Fechas en la zona configurada (nunca la de Windows, ARQUITECTURA.md 6)
// ----------------------------------------------------------------------------

interface PartesDeFecha {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partesLocales(ms: number): PartesDeFecha {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHorariaVigente(),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const v = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value);
  return { ano: v('year'), mes: v('month'), dia: v('day'), hora: v('hour'), minuto: v('minute'), segundo: v('second') };
}

const dos = (n: number): string => String(n).padStart(2, '0');
const fechaIso = (p: PartesDeFecha): string => `${p.ano}-${dos(p.mes)}-${dos(p.dia)}`;
const horaCompleta = (p: PartesDeFecha): string => `${dos(p.hora)}:${dos(p.minuto)}:${dos(p.segundo)}`;

/**
 * Como se llama este kiosco en la foto: el nombre que le dio el jefe en el
 * panel al darlo de alta ("Entrada principal"). Sin alta, el nombre de la
 * computadora en Windows.
 */
function nombreDelKiosco(): string {
  return leerCredencial()?.nombre ?? os.hostname();
}

// ----------------------------------------------------------------------------
//  Lo que se graba en cada foto
// ----------------------------------------------------------------------------

/** Los renglones de la marca de agua de una marca, segun EXPORTACION.datosGrabados. */
export function renglonesDeMarca(marca: MarcaParaExportar, kiosco: string): RenglonDeMarca[] {
  const datos = CONFIG.exportacion.datosGrabados;
  const blanco = colorDeHex('#ffffff');
  const renglones: RenglonDeMarca[] = [];

  const primero: string[] = [];
  if (datos.tipo) primero.push(marca.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA');
  if (datos.fechaHora) {
    const p = partesLocales(marca.horaEstimadaMs);
    primero.push(`${dos(p.dia)}/${dos(p.mes)}/${p.ano} ${horaCompleta(p)}`);
  }
  if (primero.length > 0) {
    renglones.push({
      texto: primero.join('  '),
      // Mismo color que en la pantalla: verde entrada, ambar salida.
      color: datos.tipo ? colorDeHex(marca.tipo === 'entrada' ? COLORES.entrada : COLORES.salida) : blanco,
    });
  }

  const quien: string[] = [];
  if (datos.numeroEmpleado) {
    // Sin numero de empleado se graba el usuario: una foto suelta no debe
    // quedar sin decir de quien es.
    quien.push(marca.numeroEmpleado ? `EMPLEADO #${marca.numeroEmpleado}` : `USUARIO ${marca.usuario}`);
  }
  if (datos.nombre) quien.push(marca.nombreCompleto);
  if (quien.length > 0) renglones.push({ texto: quien.join('  '), color: blanco });

  if (datos.kiosco) renglones.push({ texto: `KIOSCO: ${kiosco}`, color: blanco });

  return renglones;
}

// ----------------------------------------------------------------------------
//  El CSV
// ----------------------------------------------------------------------------

/**
 * Una celda de CSV. Entre comillas si hace falta, y con un apostrofo delante
 * si empieza como una formula: Excel ejecutaria `=HIPERVINCULO(...)` escrito
 * en el nombre de alguien.
 */
function celda(valor: string): string {
  let texto = valor;
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const COLUMNAS = [
  'registro',
  'fecha',
  'hora',
  'tipo',
  'numero_empleado',
  'usuario',
  'nombre',
  'revision',
  'foto',
  'archivo_foto',
  'huella_sha256_original',
  'hora_utc',
];

function renglonCsv(marca: MarcaParaExportar, estado: EstadoEnCsv, archivo: string): string {
  const p = partesLocales(marca.horaEstimadaMs);
  return [
    marca.id,
    fechaIso(p),
    horaCompleta(p),
    marca.tipo,
    marca.numeroEmpleado ?? '',
    marca.usuario,
    marca.nombreCompleto,
    marca.banderas.map((b) => NOMBRES_DE_BANDERAS[b as BanderaMarca] ?? b).join('; '),
    estado,
    archivo,
    marca.fotoHash ?? '',
    new Date(marca.horaEstimadaMs).toISOString(),
  ]
    .map(celda)
    .join(',');
}

function textoLeeme(kiosco: string, cuando: PartesDeFecha, adminNombre: string): string {
  const incluyeOriginales = CONFIG.exportacion.incluirOriginales;
  return [
    'CONTROL DE ASISTENCIA - REGISTROS Y FOTOS EXPORTADOS',
    '',
    `Kiosco: ${kiosco}`,
    `Exportado: ${fechaIso(cuando)} ${horaCompleta(cuando)} (hora de ${zonaHorariaVigente()})`,
    `Por: ${adminNombre}`,
    '',
    'QUÉ HAY AQUÍ',
    '- registros.csv: los registros de entrada y salida. Se abre con Excel.',
    '- fotos/: la foto de cada registro, con la fecha, la hora, el tipo, el',
    '  empleado y el kiosco escritos en la parte de abajo.',
    ...(incluyeOriginales
      ? ['- originales/: las mismas fotos, sin nada escrito encima.']
      : []),
    '',
    'CUIDADO: SON DATOS PERSONALES',
    'Estas fotos NO tienen candado: cualquiera que tenga esta memoria puede',
    'verlas. Úsalas solo para el control de asistencia, no las compartas y',
    'bórralas de la memoria cuando ya no las necesites.',
    '',
    'LA HUELLA (SHA-256)',
    'La columna "huella_sha256_original" es la huella de la foto tal como se',
    'tomó. El kiosco la comprobó antes de exportarla. Las fotos de la carpeta',
    'fotos/ tienen texto encima, así que su huella ya es otra.',
    ...(incluyeOriginales
      ? ['Las de la carpeta originales/ sí deben tener exactamente esa huella.']
      : []),
    '',
  ].join('\r\n');
}

// ----------------------------------------------------------------------------
//  Exportar
// ----------------------------------------------------------------------------

/** Un nombre que no pise a otro archivo que ya este en la memoria. */
function nombreLibre(carpeta: string, base: string): string {
  let nombre = `${base}.zip`;
  for (let n = 2; fs.existsSync(path.join(carpeta, nombre)); n++) nombre = `${base} (${n}).zip`;
  return nombre;
}

/** Deja respirar al proceso principal entre foto y foto: la pantalla sigue respondiendo. */
const respirar = (): Promise<void> => new Promise((resolver) => setImmediate(resolver));

/**
 * Exporta lo que cumpla los filtros a `carpeta`.
 *
 * Quien llama ya comprobo la sesion y que `carpeta` sea un destino permitido
 * (una memoria USB, nunca el disco del kiosco).
 */
export async function exportarRegistros(
  filtros: FiltrosAuditoria,
  carpeta: string,
  admin: { id: string; nombre: string },
  destino: 'usb' | 'carpeta',
): Promise<ResultadoDeExportar> {
  const marcas = buscarMarcasParaExportar(filtros);
  if (marcas.length === 0) {
    return { ok: false, mensaje: 'No hay registros con estos filtros. Cambia las fechas y vuelve a intentar.' };
  }

  // Las fotos que deberian estar en el disco.
  const conFoto = new Set(
    marcas
      .filter((m) => m.fotoRutaRelativa && (m.fotoEstado === 'disponible' || m.fotoEstado === 'conservada'))
      .map((m) => m.id),
  );

  // 1. PRIMERO la bitacora. Si esto falla, lanza y no sale nada.
  registrarAccesosFoto([...conFoto], admin.id, 'exportar');

  const kiosco = nombreDelKiosco();
  const ahora = partesLocales(Date.now());
  const { prefijoDelArchivo, incluirOriginales, escalaDeLetra, opacidadDeFranja, calidadJpeg } =
    CONFIG.exportacion;
  const base = `${prefijoDelArchivo}_${filtros.desde ?? 'inicio'}_a_${filtros.hasta ?? 'hoy'}_hecho-${fechaIso(ahora)}_${dos(ahora.hora)}${dos(ahora.minuto)}`;
  const archivo = nombreLibre(carpeta, base);
  const rutaFinal = path.join(carpeta, archivo);
  // Se escribe con otro nombre y se renombra al final: si alguien quita la
  // memoria a la mitad, no queda un .zip roto que parezca bueno.
  const rutaParcial = `${rutaFinal}.incompleto`;

  let fotos = 0;
  let fotosConProblema = 0;
  let zip: EscritorZip | null = null;

  try {
    zip = new EscritorZip(rutaParcial, ahora);
    const renglones: string[] = [COLUMNAS.join(',')];

    for (const marca of marcas) {
      let estado: EstadoEnCsv = marca.fotoEstado === 'eliminada_por_antiguedad' ? 'borrada (30 días)' : 'sin foto';
      let nombreFoto = '';

      if (conFoto.has(marca.id)) {
        const lectura = leerFoto(marca.fotoRutaRelativa!, marca.id, marca.fotoHash);
        if (lectura.estado === 'con_foto') {
          const marcada = grabarMarcaDeAgua(lectura.jpeg, renglonesDeMarca(marca, kiosco), {
            escalaMaxima: escalaDeLetra,
            opacidadDeFranja,
            calidadJpeg,
          });
          if (marcada) {
            const p = partesLocales(marca.horaEstimadaMs);
            nombreFoto = `${fechaIso(p)}_${dos(p.hora)}-${dos(p.minuto)}-${dos(p.segundo)}_${marca.tipo}_${marca.id}.jpg`;
            zip.agregar(`fotos/${nombreFoto}`, marcada);
            if (incluirOriginales) zip.agregar(`originales/${nombreFoto}`, lectura.jpeg);
            nombreFoto = `fotos/${nombreFoto}`;
            estado = 'incluida';
            fotos++;
          } else {
            estado = 'no se pudo marcar';
            fotosConProblema++;
          }
        } else {
          estado =
            lectura.estado === 'faltante'
              ? 'no está en el kiosco'
              : lectura.estado === 'alterada'
                ? 'alterada'
                : 'necesita la contraseña de recuperación';
          fotosConProblema++;
        }
        await respirar();
      }

      renglones.push(renglonCsv(marca, estado, nombreFoto));
    }

    // Con BOM y fin de linea de Windows: asi Excel reconoce los acentos.
    zip.agregar('registros.csv', Buffer.from(`﻿${renglones.join('\r\n')}\r\n`, 'utf8'));
    zip.agregar('LEEME.txt', Buffer.from(`﻿${textoLeeme(kiosco, ahora, admin.nombre)}`, 'utf8'));
    zip.cerrar();
    fs.renameSync(rutaParcial, rutaFinal);
  } catch (fallo) {
    zip?.abandonar();
    fs.rmSync(rutaParcial, { force: true });
    registrarEvento('exportacion_usb', {
      adminId: admin.id,
      registros: marcas.length,
      fotos,
      fotosConProblema,
      destino,
      completa: false,
    });
    // La ruta NO va al log: puede llevar el nombre de una carpeta personal.
    const codigo = (fallo as NodeJS.ErrnoException).code;
    console.error('[exportacion] fallo al escribir:', codigo ?? fallo);
    return {
      ok: false,
      mensaje:
        codigo === 'ENOSPC'
          ? 'La memoria se llenó. Libera espacio o usa otra memoria, y vuelve a intentar.'
          : 'No se pudo guardar en la memoria. Revisa que siga conectada y vuelve a intentar.',
    };
  }

  registrarEvento('exportacion_usb', {
    adminId: admin.id,
    registros: marcas.length,
    fotos,
    fotosConProblema,
    destino,
    completa: true,
  });
  console.info(`[exportacion] ${marcas.length} registros, ${fotos} fotos`);

  return {
    ok: true,
    resultado: { archivo, ubicacion: carpeta, registros: marcas.length, fotos, fotosConProblema },
  };
}
