/**
 * ============================================================================
 *  REPOSITORIO DE LA SINCRONIZACION  (CLAUDE.md 7)
 * ============================================================================
 *
 *  Las dos mitades del intercambio con la nube, del lado de la base local:
 *
 *    SUBIR   que hay en la bandeja de salida (outbox), y anotar que paso con
 *            cada renglon: enviado, rechazado para siempre, o fallo y se
 *            reintenta.
 *
 *    BAJAR   aplicar el catalogo (empleados, administradores, configuracion,
 *            ultimas marcas) de una sola vez, en una transaccion: o entra
 *            todo o no entra nada, y el kiosco nunca queda con media lista.
 *
 *  Aqui no hay red. La red esta en servicios/sincronizacion.ts; este archivo
 *  solo lee y escribe SQLite, y por eso se prueba sin servidor.
 */

import { randomUUID } from 'node:crypto';
import { baseDeDatos, enTransaccion } from './base-de-datos';

// ----------------------------------------------------------------------------
//  estado_local: clave/valor para lo que el kiosco recuerda entre arranques
// ----------------------------------------------------------------------------

export function leerEstadoLocal(clave: string): string | null {
  const fila = baseDeDatos().prepare('SELECT valor FROM estado_local WHERE clave = ?').get(clave) as
    | { valor: string }
    | undefined;
  return fila?.valor ?? null;
}

export function guardarEstadoLocal(clave: string, valor: string): void {
  baseDeDatos()
    .prepare(
      `INSERT INTO estado_local (clave, valor) VALUES (?, ?)
       ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`,
    )
    .run(clave, valor);
}

export function borrarEstadoLocal(clave: string): void {
  baseDeDatos().prepare('DELETE FROM estado_local WHERE clave = ?').run(clave);
}

// ----------------------------------------------------------------------------
//  Estados de foto: "se borro", "la conservaron", "falta", "alterada"
// ----------------------------------------------------------------------------

export type EstadoDeFotoParaNube =
  | 'con_foto'
  | 'obstruida'
  | 'eliminada_por_antiguedad'
  | 'conservada'
  | 'faltante'
  | 'alterada';

/**
 * Encola el cambio de estado de una foto para que la nube lo sepa.
 *
 * La nube no tiene la foto (CLAUDE.md 5.1), asi que solo se entera de que le
 * paso si el kiosco se lo dice. Sin esto, el panel mostraria "disponible en
 * el kiosco" una foto que se borro hace un mes.
 */
export function registrarEstadoDeFoto(marcaId: string, estado: EstadoDeFotoParaNube): void {
  const id = randomUUID();
  baseDeDatos()
    .prepare(
      `INSERT INTO outbox (id, tipo_registro, payload, intentos, creado_en)
       VALUES (?, 'estado_foto', ?, 0, ?)`,
    )
    .run(id, JSON.stringify({ id, marcaId, estado }), new Date().toISOString());
}

// ----------------------------------------------------------------------------
//  Subir: lo pendiente y lo que paso con cada renglon
// ----------------------------------------------------------------------------

/** Como se llama cada tipo de renglon de la bandeja en el lote que espera la nube. */
const TIPOS_EN_EL_LOTE = {
  marca: 'marcas',
  evento: 'eventos',
  acceso_foto: 'accesosFoto',
  estado_foto: 'estadosDeFoto',
  cambio_pin: 'cambiosDePin',
} as const;

type CampoDelLote = (typeof TIPOS_EN_EL_LOTE)[keyof typeof TIPOS_EN_EL_LOTE];

/** Un renglon de la bandeja, listo para ir en un lote. */
export interface RenglonParaSubir {
  id: string;
  campo: CampoDelLote;
  payload: unknown;
}

/** El cuerpo que espera la Edge Function `recibir-registros`. */
export type CuerpoDelLote = Record<CampoDelLote, unknown[]>;

/**
 * Lo mas antiguo de la bandeja, hasta `limitePorTipo` de cada tipo.
 *
 * Los payloads se mandan TAL CUAL se guardaron: son exactamente lo que paso
 * en el momento del registro, y la nube los valida por su cuenta.
 */
export function renglonesParaSubir(limitePorTipo: number): RenglonParaSubir[] {
  const renglones: RenglonParaSubir[] = [];
  const consulta = baseDeDatos().prepare(
    `SELECT id, payload FROM outbox
      WHERE sincronizado_en IS NULL AND rechazado_en IS NULL AND tipo_registro = ?
      ORDER BY creado_en
      LIMIT ?`,
  );

  for (const [tipo, campo] of Object.entries(TIPOS_EN_EL_LOTE)) {
    const filas = consulta.all(tipo, limitePorTipo) as { id: string; payload: string }[];
    for (const fila of filas) {
      try {
        renglones.push({ id: fila.id, campo, payload: JSON.parse(fila.payload) });
      } catch {
        // Un payload ilegible nunca se va a poder mandar: fuera de la cola,
        // pero guardado, igual que un rechazo de la nube.
        marcarRechazados([{ id: fila.id, motivo: 'payload_ilegible' }]);
      }
    }
  }
  return renglones;
}

/** Junta renglones en el cuerpo del lote: { marcas: [...], eventos: [...], ... }. */
export function armarCuerpo(renglones: readonly RenglonParaSubir[]): CuerpoDelLote {
  const cuerpo: CuerpoDelLote = { marcas: [], eventos: [], accesosFoto: [], estadosDeFoto: [], cambiosDePin: [] };
  for (const r of renglones) cuerpo[r.campo].push(r.payload);
  return cuerpo;
}

export function marcarEnviados(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const ahora = new Date().toISOString();
  const orden = baseDeDatos().prepare('UPDATE outbox SET sincronizado_en = ?, ultimo_error = NULL WHERE id = ?');
  enTransaccion(() => {
    for (const id of ids) orden.run(ahora, id);
  });
}

/** Rechazo DEFINITIVO: sale de la cola, pero se queda guardado con su motivo. */
export function marcarRechazados(rechazos: readonly { id: string; motivo: string }[]): void {
  if (rechazos.length === 0) return;
  const ahora = new Date().toISOString();
  const orden = baseDeDatos().prepare(
    'UPDATE outbox SET rechazado_en = ?, ultimo_error = ?, intentos = intentos + 1 WHERE id = ?',
  );
  enTransaccion(() => {
    for (const r of rechazos) orden.run(ahora, r.motivo, r.id);
  });
}

/** Fallo pasajero (sin red, servidor caido): se queda en la cola y se reintenta. */
export function anotarFallo(ids: readonly string[], error: string): void {
  if (ids.length === 0) return;
  const orden = baseDeDatos().prepare('UPDATE outbox SET intentos = intentos + 1, ultimo_error = ? WHERE id = ?');
  enTransaccion(() => {
    for (const id of ids) orden.run(error, id);
  });
}

/** Cuantos renglones rechazo la nube para siempre. Para diagnostico y para el modo admin. */
export function contarRechazados(): number {
  const fila = baseDeDatos()
    .prepare('SELECT COUNT(*) AS n FROM outbox WHERE rechazado_en IS NOT NULL AND descartado_en IS NULL')
    .get() as {
    n: number;
  };
  return fila.n;
}

// ----------------------------------------------------------------------------
//  Bajar: el catalogo
// ----------------------------------------------------------------------------

export interface CatalogoRecibido {
  empleados: {
    id: string;
    usuario: string;
    numero_empleado: string | null;
    nombre: string;
    apellido_paterno: string;
    apellido_materno: string;
    pin_hash: string;
    pin_temporal: boolean;
    activo: boolean;
    actualizado_en: string;
  }[];
  administradores: {
    id: string;
    usuario: string;
    nombre: string;
    contrasena_hash: string;
    rol: 'admin' | 'supervisor';
    activo: boolean;
    actualizado_en: string;
  }[];
  configuracion: Record<string, unknown>;
  ultimasMarcas: { empleadoId: string; tipo: 'entrada' | 'salida'; horaEstimada: string }[];
  cursor: string | null;
}

/**
 * Si en el kiosco ya hay OTRO registro con ese usuario (distinto id), se
 * aparta: se desactiva y se le cambia el usuario para liberar el nombre.
 *
 * Pasa, por ejemplo, con los empleados de prueba que el kiosco crea en
 * desarrollo antes de conectarse, o si en la nube se reasigna un usuario.
 * Manda la nube; pero la fila local NO se borra, porque sus marcas la
 * siguen nombrando.
 */
function apartarUsuarioAjeno(tabla: 'empleados_cache' | 'administradores_cache', usuario: string, id: string): void {
  baseDeDatos()
    .prepare(
      `UPDATE ${tabla}
          SET activo = 0, usuario = usuario || '.anterior.' || substr(id, 1, 8)
        WHERE usuario = ? AND id <> ?`,
    )
    .run(usuario, id);
}

export const CLAVE_CURSOR_CATALOGO = 'cursor_catalogo';

/**
 * ¿Ese empleado eligio PIN aqui y todavia no sube? (D-042)
 *
 * Mientras tanto, la nube aun trae su PIN TEMPORAL: si el catalogo lo pisara,
 * su PIN propio dejaria de servir en este kiosco hasta la siguiente vuelta.
 * Se conserva el local; en cuanto la nube acepta el cambio, llega igual.
 */
const PIN_PROPIO_SIN_SUBIR = `EXISTS (
  SELECT 1 FROM outbox o
   WHERE o.tipo_registro = 'cambio_pin' AND o.sincronizado_en IS NULL AND o.rechazado_en IS NULL
     AND json_extract(o.payload, '$.empleadoId') = excluded.id)`;

/** Aplica el catalogo completo en una sola transaccion. */
export function aplicarCatalogo(catalogo: CatalogoRecibido): void {
  const bd = baseDeDatos();

  enTransaccion(() => {
    // --- Empleados (incluidas las bajas, que llegan con activo = false) ---
    const empleado = bd.prepare(
      `INSERT INTO empleados_cache
         (id, usuario, numero_empleado, nombre, apellido_paterno, apellido_materno,
          pin_hash, pin_temporal, activo, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         usuario = excluded.usuario, numero_empleado = excluded.numero_empleado,
         nombre = excluded.nombre, apellido_paterno = excluded.apellido_paterno,
         apellido_materno = excluded.apellido_materno,
         pin_hash = CASE WHEN ${PIN_PROPIO_SIN_SUBIR} THEN empleados_cache.pin_hash ELSE excluded.pin_hash END,
         pin_temporal = CASE WHEN ${PIN_PROPIO_SIN_SUBIR} THEN empleados_cache.pin_temporal ELSE excluded.pin_temporal END,
         activo = excluded.activo, actualizado_en = excluded.actualizado_en`,
    );
    for (const e of catalogo.empleados) {
      apartarUsuarioAjeno('empleados_cache', e.usuario, e.id);
      empleado.run(
        e.id, e.usuario, e.numero_empleado, e.nombre, e.apellido_paterno, e.apellido_materno,
        e.pin_hash, e.pin_temporal ? 1 : 0, e.activo ? 1 : 0, e.actualizado_en,
      );
    }

    // --- Administradores con credenciales de kiosco ---
    const admin = bd.prepare(
      `INSERT INTO administradores_cache (id, usuario, nombre, contrasena_hash, rol, activo, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         usuario = excluded.usuario, nombre = excluded.nombre,
         contrasena_hash = excluded.contrasena_hash, rol = excluded.rol,
         activo = excluded.activo, actualizado_en = excluded.actualizado_en`,
    );
    for (const a of catalogo.administradores) {
      apartarUsuarioAjeno('administradores_cache', a.usuario, a.id);
      admin.run(a.id, a.usuario, a.nombre, a.contrasena_hash, a.rol, a.activo ? 1 : 0, a.actualizado_en);
    }

    // --- Configuracion: llega COMPLETA, se reemplaza completa ---
    // Guardada como JSON (texto): '30', '"America/Matamoros"'. Quien la lea
    // la interpreta con JSON.parse (ver configuracion-vigente.ts).
    bd.prepare('DELETE FROM configuracion_cache').run();
    const clave = bd.prepare('INSERT INTO configuracion_cache (clave, valor) VALUES (?, ?)');
    for (const [nombre, valor] of Object.entries(catalogo.configuracion)) {
      clave.run(nombre, JSON.stringify(valor));
    }

    // --- Ultima marca de cada quien, SOLO si la de la nube es mas nueva ---
    // Si alguien acaba de checar aqui y esa marca aun no sube, la de la nube
    // es mas vieja y no debe pisarla: la sugerencia de ENTRADA/SALIDA
    // quedaria al reves.
    const ultima = bd.prepare(
      `INSERT INTO ultimas_marcas_cache (empleado_id, tipo, hora_estimada_ms) VALUES (?, ?, ?)
       ON CONFLICT (empleado_id) DO UPDATE SET
         tipo = excluded.tipo, hora_estimada_ms = excluded.hora_estimada_ms
       WHERE excluded.hora_estimada_ms > ultimas_marcas_cache.hora_estimada_ms`,
    );
    for (const u of catalogo.ultimasMarcas) {
      ultima.run(u.empleadoId, u.tipo, new Date(u.horaEstimada).getTime());
    }

    if (catalogo.cursor) guardarEstadoLocal(CLAVE_CURSOR_CATALOGO, catalogo.cursor);
  });
}

/**
 * CLAUDE.md 6: "Un cambio grande de desfase marca las marcas offline de ese
 * periodo."
 *
 * Si al volver la conexion el reloj de Windows resulta muy distinto de como
 * estaba la ultima vez que se hablo con la nube, alguien (o la pila del BIOS)
 * lo movio mientras no habia internet. Las marcas que se hicieron en ese rato
 * —las que siguen en la bandeja sin enviar— se marcan `reloj_sospechoso`
 * ANTES de salir del kiosco. En la nube son inmutables; aqui todavia no.
 *
 * Devuelve cuantas marco. Nunca quita banderas, solo agrega.
 */
export function marcarPendientesConRelojSospechoso(): number {
  const bd = baseDeDatos();
  const filas = bd
    .prepare(
      `SELECT id, payload FROM outbox
        WHERE tipo_registro = 'marca' AND sincronizado_en IS NULL AND rechazado_en IS NULL`,
    )
    .all() as { id: string; payload: string }[];

  let marcadas = 0;
  enTransaccion(() => {
    for (const fila of filas) {
      let paquete: { banderas?: string[] };
      try {
        paquete = JSON.parse(fila.payload);
      } catch {
        continue;
      }
      const banderas = Array.isArray(paquete.banderas) ? paquete.banderas : [];
      if (banderas.includes('reloj_sospechoso')) continue;
      paquete.banderas = [...banderas, 'reloj_sospechoso'];
      bd.prepare('UPDATE outbox SET payload = ? WHERE id = ?').run(JSON.stringify(paquete), fila.id);
      bd.prepare(
        `UPDATE marcas SET banderas = CASE WHEN banderas = '' THEN 'reloj_sospechoso'
                                           ELSE banderas || ',reloj_sospechoso' END
          WHERE id = ?`,
      ).run(fila.id);
      marcadas++;
    }
  });
  return marcadas;
}

/** Los rechazados mas recientes, para mostrarlos en el modo administrador. */
export function listarRechazados(limite: number): { id: string; tipo: string; creadoEn: string; motivo: string }[] {
  return baseDeDatos()
    .prepare(
      `SELECT id, tipo_registro AS tipo, creado_en AS creadoEn, COALESCE(ultimo_error, '') AS motivo
         FROM outbox WHERE rechazado_en IS NOT NULL AND descartado_en IS NULL
        ORDER BY creado_en DESC LIMIT ?`,
    )
    .all(limite) as { id: string; tipo: string; creadoEn: string; motivo: string }[];
}

/**
 * Vuelve a poner en la cola todo lo rechazado. Sirve cuando el problema ya se
 * arreglo en la oficina (por ejemplo, la persona que "no existia" ya se dio
 * de alta en el panel). Lo que la nube vuelva a rechazar, regresa aqui solo.
 */
export function reintentarRechazados(): number {
  return Number(
    baseDeDatos()
      .prepare(
        'UPDATE outbox SET rechazado_en = NULL, ultimo_error = NULL WHERE rechazado_en IS NOT NULL AND descartado_en IS NULL',
      )
      .run().changes,
  );
}

/**
 * Descarta TODO lo rechazado que sigue a la vista: deja de mostrarse y de
 * poder reenviarse. NO borra nada (ver la migracion 5). Devuelve cuantos.
 * Quien llama es responsable de avisar a la oficina (evento).
 */
export function descartarRechazados(motivo: string): number {
  return Number(
    baseDeDatos()
      .prepare(
        `UPDATE outbox SET descartado_en = ?, descartado_motivo = ?
          WHERE rechazado_en IS NOT NULL AND descartado_en IS NULL`,
      )
      .run(new Date().toISOString(), motivo).changes,
  );
}
