/**
 * ============================================================================
 *  ¿QUE MEMORIAS USB HAY CONECTADAS?
 * ============================================================================
 *
 *  Para exportar, la pantalla muestra botones grandes con cada memoria
 *  ("Guardar en E: KINGSTON") en vez de la ventana de "Guardar como" de
 *  Windows, que a una persona poco acostumbrada la pierde entre carpetas.
 *
 *  Tambien es una proteccion: la pantalla solo puede elegir una LETRA de esta
 *  lista. Nunca manda una ruta, asi que no puede pedir "escribe las fotos en
 *  C:\Users\Public" (CLAUDE.md 3.1: operaciones especificas, nunca genericas).
 *
 *  ¿Como se sabe que una unidad es USB? Se le pregunta a Windows (WMI):
 *  `DriveType = 2` es "disco removible". Node no trae esa pregunta, y un
 *  modulo nativo para hacerla complicaria el instalador (D-013); PowerShell
 *  viene con cualquier Windows y la responde en un segundo.
 *
 *  Limite conocido: algunos discos duros USB grandes se presentan como disco
 *  FIJO. Para ellos esta "Elegir otra carpeta" (EXPORTACION.permitirElegirCarpeta).
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';
import { CONFIG, type MemoriaUsb } from '@kiosko/compartido';

const CONSULTA =
  "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | " +
  'Select-Object DeviceID,VolumeName,FreeSpace,Size | ConvertTo-Json -Compress';

/**
 * Las memorias conectadas ahora mismo. Nunca lanza: si Windows no contesta,
 * devuelve una lista vacia y la pantalla dice "no encuentro ninguna".
 */
export function buscarMemoriasUsb(): Promise<MemoriaUsb[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);

  return new Promise((resolver) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', CONSULTA],
      { timeout: CONFIG.exportacion.segundosParaBuscarMemorias * 1000, windowsHide: true },
      (fallo, salida) => {
        if (fallo) {
          console.warn('[usb] no se pudo preguntar a Windows por las memorias:', fallo.message);
          resolver([]);
          return;
        }
        resolver(interpretarRespuesta(salida));
      },
    );
  });
}

/**
 * Convierte lo que contesta PowerShell en la lista. Separada para probarla.
 *
 * Ojo: con UNA sola memoria, `ConvertTo-Json` devuelve un objeto y no una
 * lista; sin ninguna, no devuelve nada.
 */
export function interpretarRespuesta(salida: string): MemoriaUsb[] {
  const texto = salida.trim();
  if (!texto) return [];

  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return [];
  }

  const lista = Array.isArray(datos) ? datos : [datos];
  const memorias: MemoriaUsb[] = [];
  for (const d of lista) {
    if (typeof d !== 'object' || d === null) continue;
    const { DeviceID, VolumeName, FreeSpace, Size } = d as Record<string, unknown>;
    if (typeof DeviceID !== 'string' || !/^[A-Z]:$/.test(DeviceID)) continue;
    // Un lector de tarjetas SIN tarjeta tambien es "removible", pero sin
    // tamano. No se ofrece: guardar ahi solo daria un error.
    if (typeof Size !== 'number' || Size <= 0) continue;
    memorias.push({
      unidad: DeviceID,
      etiqueta: typeof VolumeName === 'string' ? VolumeName : '',
      bytesLibres: typeof FreeSpace === 'number' ? FreeSpace : null,
    });
  }
  return memorias;
}

/**
 * ¿Esta ruta cae en el disco de ESTA computadora (o en una carpeta de red)?
 *
 * Las fotos exportadas van descifradas. En el disco del kiosco quedarian en
 * claro, justo donde el CLAUDE.md 5.2 dice que nunca debe haber una copia
 * legible. En una carpeta de red, saldrian a otra computadora sin que nadie
 * lo haya decidido.
 */
export function esDiscoDeEstaComputadora(ruta: string): boolean {
  const raiz = (r: string): string => path.win32.parse(path.win32.resolve(r)).root.toUpperCase();
  const destino = raiz(ruta);
  // \\servidor\carpeta: una carpeta de red.
  if (destino.startsWith('\\\\')) return true;

  const propias = new Set<string>([raiz(app.getPath('userData')), raiz(app.getPath('exe'))]);
  const sistema = process.env['SystemDrive'];
  if (sistema) propias.add(raiz(`${sistema}\\`));
  return propias.has(destino);
}
