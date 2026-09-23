/**
 * ============================================================================
 *  REPOSITORIO DE FOTOS  (el ciclo de vida, no los bytes)
 * ============================================================================
 *
 *  Los bytes de la foto viven en disco, cifrados (servicios/fotos.ts). Aqui
 *  se lleva la cuenta de que le ha pasado a cada una: donde quedo, si un
 *  administrador pidio conservarla, y cuando se borro por antiguedad.
 *
 *  La marca NO se toca desde aqui. Es inmutable (CLAUDE.md 8); la foto no.
 *  La unica excepcion es `registrarFotoHeredada`, explicada ahi mismo.
 */

import type { FotoGuardada } from '../servicios/fotos';
import { baseDeDatos, enTransaccion } from './base-de-datos';
import { registrarEstadoDeFoto } from './repositorio-sincronizacion';

export interface FotoRegistrada {
  marcaId: string;
  rutaRelativa: string;
  llaveId: string;
  /** El hash que se guardo con la marca: contra el que se compara al abrirla. */
  hash: string | null;
  conservar: boolean;
  eliminadaEn: string | null;
}

export function obtenerFoto(marcaId: string): FotoRegistrada | null {
  const fila = baseDeDatos()
    .prepare(
      `SELECT f.marca_id, f.ruta_relativa, f.llave_id, f.conservar, f.eliminada_en, m.foto_hash
         FROM fotos f
         JOIN marcas m ON m.id = f.marca_id
        WHERE f.marca_id = ?`,
    )
    .get(marcaId) as
    | {
        marca_id: string;
        ruta_relativa: string;
        llave_id: string;
        conservar: number;
        eliminada_en: string | null;
        foto_hash: string | null;
      }
    | undefined;

  if (!fila) return null;
  return {
    marcaId: fila.marca_id,
    rutaRelativa: fila.ruta_relativa,
    llaveId: fila.llave_id,
    hash: fila.foto_hash,
    conservar: fila.conservar === 1,
    eliminadaEn: fila.eliminada_en,
  };
}

/**
 * Las fotos que ya pasaron el plazo y se pueden borrar.
 *
 * La antiguedad se mide con la hora de la MARCA (el momento de la captura),
 * no con la hora en que se escribio la fila.
 */
export function fotosVencidas(capturadasAntesDeMs: number): { marcaId: string; rutaRelativa: string }[] {
  const filas = baseDeDatos()
    .prepare(
      `SELECT f.marca_id, f.ruta_relativa
         FROM fotos f
         JOIN marcas m ON m.id = f.marca_id
        WHERE f.eliminada_en IS NULL
          AND f.conservar = 0
          AND m.hora_estimada_ms < ?`,
    )
    .all(capturadasAntesDeMs) as { marca_id: string; ruta_relativa: string }[];

  return filas.map((f) => ({ marcaId: f.marca_id, rutaRelativa: f.ruta_relativa }));
}

export function marcarComoEliminada(marcaId: string): void {
  enTransaccion(() => {
    const resultado = baseDeDatos()
      .prepare('UPDATE fotos SET eliminada_en = ? WHERE marca_id = ? AND eliminada_en IS NULL')
      .run(new Date().toISOString(), marcaId);
    // La nube no tiene la foto: solo se entera de que se borro si se le dice.
    if (Number(resultado.changes) === 1) registrarEstadoDeFoto(marcaId, 'eliminada_por_antiguedad');
  });
}

/**
 * Pone o quita la marca "Conservar" (CLAUDE.md 5.1: casos en disputa).
 *
 * Devuelve `false` si no hay foto viva que conservar: una foto ya borrada no
 * se puede "conservar" de vuelta.
 *
 * @param por quien lo pidio (id del administrador). Queda anotado.
 */
export function cambiarConservar(
  marcaId: string,
  conservar: boolean,
  datos: { motivo: string | null; por: string },
): boolean {
  return enTransaccion(() => {
    const resultado = baseDeDatos()
      .prepare(
        `UPDATE fotos
            SET conservar = ?, conservar_motivo = ?, conservar_por = ?, conservar_en = ?
          WHERE marca_id = ? AND eliminada_en IS NULL`,
      )
      .run(conservar ? 1 : 0, datos.motivo, datos.por, new Date().toISOString(), marcaId);
    if (Number(resultado.changes) !== 1) return false;

    // Al quitar "Conservar", la foto vuelve a su estado de origen: la de un
    // lente tapado sigue siendo "obstruida", no pasa a ser una foto normal.
    registrarEstadoDeFoto(marcaId, conservar ? 'conservada' : estadoDeOrigen(marcaId));
    return true;
  });
}

/** 'obstruida' si la foto se tomo con el lente tapado; si no, 'con_foto'. */
function estadoDeOrigen(marcaId: string): 'con_foto' | 'obstruida' {
  const fila = baseDeDatos().prepare('SELECT banderas FROM marcas WHERE id = ?').get(marcaId) as
    | { banderas: string }
    | undefined;
  return fila?.banderas.split(',').includes('foto_obstruida') ? 'obstruida' : 'con_foto';
}

/**
 * Marcas de versiones anteriores al 3.b cuya foto quedo SIN CIFRAR.
 *
 * Se reconocen porque tienen `foto_ruta_local` (la columna vieja) y todavia
 * no tienen fila en `fotos`.
 */
export function marcasConFotoHeredada(): { marcaId: string; rutaAbsoluta: string; horaMs: number }[] {
  const filas = baseDeDatos()
    .prepare(
      `SELECT m.id, m.foto_ruta_local, m.hora_estimada_ms
         FROM marcas m
         LEFT JOIN fotos f ON f.marca_id = m.id
        WHERE m.foto_ruta_local IS NOT NULL AND f.marca_id IS NULL`,
    )
    .all() as { id: string; foto_ruta_local: string; hora_estimada_ms: number }[];

  return filas.map((f) => ({
    marcaId: f.id,
    rutaAbsoluta: f.foto_ruta_local,
    horaMs: f.hora_estimada_ms,
  }));
}

/**
 * Registra una foto heredada ya cifrada.
 *
 * LA UNICA VEZ QUE SE ESCRIBE EN UNA MARCA YA GUARDADA, y por que se permite:
 * esas marcas se crearon antes de que existiera `foto_hash`, asi que la
 * columna esta vacia, no con otro valor. Se llena UNA vez (`WHERE foto_hash IS
 * NULL`) y nunca se sobrescribe. Ademas son marcas de antes de la
 * sincronizacion: la nube nunca ha visto otra version de ellas.
 */
export function registrarFotoHeredada(marcaId: string, foto: FotoGuardada): void {
  const ahoraIso = new Date().toISOString();
  enTransaccion(() => {
    const bd = baseDeDatos();
    bd.prepare(
      `INSERT INTO fotos (marca_id, ruta_relativa, llave_id, creado_en) VALUES (?, ?, ?, ?)`,
    ).run(marcaId, foto.rutaRelativa, foto.llaveId, ahoraIso);
    bd.prepare('UPDATE marcas SET foto_hash = ? WHERE id = ? AND foto_hash IS NULL').run(
      foto.hash,
      marcaId,
    );
  });
}

/** Cuantas fotos siguen en disco. Para diagnostico y pruebas. */
export function contarFotosEnDisco(): number {
  const fila = baseDeDatos()
    .prepare('SELECT COUNT(*) AS total FROM fotos WHERE eliminada_en IS NULL')
    .get() as { total: number };
  return fila.total;
}
