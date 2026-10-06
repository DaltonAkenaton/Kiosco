/**
 * ============================================================================
 *  SINCRONIZACION CON LA NUBE  (CLAUDE.md 7, bloque 6)
 * ============================================================================
 *
 *  El kiosco trabaja SIEMPRE contra su base local: registrar nunca espera a
 *  la red. Este modulo, por su cuenta y en segundo plano, hace el
 *  intercambio con las Edge Functions (supabase/functions):
 *
 *      cada 30 s   SUBIR   la bandeja de salida      -> recibir-registros
 *      cada 5 min  BAJAR   empleados, admins, config  <- catalogo
 *      cada 1 min  LATIR   "sigo vivo, asi estoy"     -> latido
 *
 *  Y una vez, al instalar: DAR DE ALTA con el codigo del panel -> enrolar-kiosco.
 *
 *  ---------------------------------------------------------------------------
 *  Reglas
 *  ---------------------------------------------------------------------------
 *  - LA RED NUNCA BLOQUEA LA PANTALLA. Todo es asincrono, con tiempo limite,
 *    y ningun error de aqui llega a quien esta checando.
 *  - Si falla la red, se reintenta con espera creciente (2 s, 4 s, 8 s...
 *    hasta 5 min): no se machaca a un servidor caido.
 *  - Nada se borra de la bandeja. Lo enviado se marca como enviado; lo que la
 *    nube rechaza para siempre se marca como rechazado, con su motivo.
 *  - Todo se puede apagar con SINCRONIZACION.activa (CLAUDE.md 7).
 *
 *  ---------------------------------------------------------------------------
 *  El reloj
 *  ---------------------------------------------------------------------------
 *  Cada respuesta trae `servidorAhoraMs`. Comparandolo con el momento en que
 *  salio y llego la peticion, se sabe cuanto se aparta el reloj de Windows
 *  del del servidor. Ese desfase corrige la hora de las marcas siguientes
 *  (CLAUDE.md 6) y se recuerda entre arranques.
 */

import { app } from 'electron';
import { z } from 'zod';
import {
  CONFIG,
  type EstadoKiosco,
  type EstadoNube,
  type ResultadoEnrolamiento,
} from '@kiosko/compartido';
import { contarPendientes } from '../datos/repositorio-marcas';
import {
  CLAVE_CURSOR_CATALOGO,
  aplicarCatalogo,
  anotarFallo,
  armarCuerpo,
  borrarEstadoLocal,
  guardarEstadoLocal,
  leerEstadoLocal,
  marcarEnviados,
  marcarPendientesConRelojSospechoso,
  marcarRechazados,
  type RenglonParaSubir,
  renglonesParaSubir,
} from '../datos/repositorio-sincronizacion';
import { ES_DESARROLLO } from '../entorno';
import { type CredencialKiosco, guardarCredencial, leerCredencial } from './credencial-kiosco';
import { establecerDesfaseServidor } from './reloj';
import { esPcCompartida } from '../configuracion-vigente';
import { configurarArranqueConWindows } from '../arranque-automatico';

const S = CONFIG.sincronizacion;
const CLAVE_DESFASE = 'desfase_servidor_ms';

/** Estados en los que hace falta teclear un codigo de alta. */
const NECESITAN_ALTA: readonly EstadoNube[] = ['sin_alta', 'revocado', 'no_reconocido'];

// ============================================================================
//  ¿Hay nube?
// ============================================================================

/** La direccion de las Edge Functions segun el entorno. Vacia = no hay nube configurada. */
export function urlDeFunciones(): string {
  const url = (ES_DESARROLLO ? S.urlFuncionesDesarrollo : S.urlFuncionesProduccion).trim().replace(/\/+$/, '');
  // Se acepta la "Project URL" tal como se copia de Supabase
  // (https://xxxx.supabase.co): la ruta de las funciones se agrega sola.
  if (url === '' || url.endsWith('/functions/v1')) return url;
  return `${url}/functions/v1`;
}

export function sincronizacionDisponible(): boolean {
  return S.activa && urlDeFunciones() !== '';
}

// ============================================================================
//  El desfase del reloj
// ============================================================================

/**
 * Desfase = hora de esta PC - hora del servidor, en el MISMO instante.
 *
 * No se sabe en que momento exacto del viaje escribio el servidor su hora,
 * asi que se supone que a la mitad. Si el viaje tardo demasiado, la
 * incertidumbre es tan grande que la medicion no sirve y se descarta.
 *
 *     salida (t0) ─────── servidor escribe S ─────── llegada (t1)
 *                  desfase ≈ (t0 + t1) / 2 - S
 */
export function calcularDesfase(salidaMs: number, llegadaMs: number, servidorMs: number): number | null {
  if (!Number.isFinite(servidorMs) || llegadaMs - salidaMs > S.viajeMaximoParaMedirDesfaseMs) return null;
  return Math.round((salidaMs + llegadaMs) / 2 - servidorMs);
}

let desfaseConocidoMs: number | null = null;
let ultimaMedicionMs = 0;

function registrarDesfase(desfase: number): void {
  // ¿Se movio el reloj desde la ultima vez que se hablo con la nube? Si el
  // salto es grande, lo registrado sin internet en ese rato tiene una hora
  // en la que no se puede confiar (CLAUDE.md 6).
  if (desfaseConocidoMs !== null && Math.abs(desfase - desfaseConocidoMs) > CONFIG.reloj.cambioDesfaseSignificativoMs) {
    const marcadas = marcarPendientesConRelojSospechoso();
    console.warn(
      `[sync] el reloj de Windows cambio ${Math.round((desfase - desfaseConocidoMs) / 1000)} s respecto a la nube; ` +
        `${marcadas} registro(s) sin enviar quedan marcados como hora dudosa`,
    );
  }
  // A la pantalla solo si cambio de verdad: cada llamada a la nube mide un
  // poco distinto (el viaje de ida y vuelta), y el reloj no debe temblar.
  if (desfaseConocidoMs === null || Math.abs(desfase - desfaseConocidoMs) > S.cambioDesfaseParaPantallaMs) {
    avisar({ desfaseRelojMs: desfase });
  }
  ultimaMedicionMs = Date.now();
  desfaseConocidoMs = desfase;
  establecerDesfaseServidor(desfase);
  guardarEstadoLocal(CLAVE_DESFASE, String(desfase));
}

// ============================================================================
//  Llamar a una funcion
// ============================================================================

/** La red o el servidor no respondieron: se reintenta mas tarde. */
class SinConexion extends Error {}

interface Respuesta {
  estado: number;
  cuerpo: Record<string, unknown>;
}

/**
 * Llama a una Edge Function. Lanza `SinConexion` si no hubo respuesta util
 * (sin red, tiempo agotado, servidor caido con 5xx).
 */
async function llamar(
  funcion: string,
  cuerpo: unknown,
  token: string | null,
  segundosLimite: number = S.segundosTiempoLimitePeticion,
): Promise<Respuesta> {
  const salida = Date.now();
  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlDeFunciones()}/${funcion}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-kiosco-token': token } : {}),
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(segundosLimite * 1000),
    });
  } catch (fallo) {
    throw new SinConexion((fallo as Error).message);
  }
  const llegada = Date.now();

  if (respuesta.status >= 500) throw new SinConexion(`el servidor respondio ${respuesta.status}`);

  let json: Record<string, unknown> = {};
  try {
    json = (await respuesta.json()) as Record<string, unknown>;
  } catch {
    throw new SinConexion('respuesta que no es JSON');
  }

  const desfase = calcularDesfase(salida, llegada, Number(json['servidorAhoraMs']));
  if (desfase !== null) registrarDesfase(desfase);

  return { estado: respuesta.status, cuerpo: json };
}

// ============================================================================
//  El estado que ve la pantalla
// ============================================================================

type Avisar = (cambios: Partial<EstadoKiosco>) => void;
let avisar: Avisar = () => {};
let obtenerEstado: () => EstadoKiosco = () => {
  throw new Error('sincronizacion sin iniciar');
};

let nube: EstadoNube = 'apagada';

function cambiarNube(nuevo: EstadoNube, extra: Partial<EstadoKiosco> = {}): void {
  if (nuevo !== nube) console.info(`[sync] ${nube} -> ${nuevo}`);
  nube = nuevo;
  avisar({
    nube,
    enLinea: nube === 'en_linea',
    requiereEnrolamiento: NECESITAN_ALTA.includes(nube),
    nombreKiosco: leerCredencial()?.nombre ?? null,
    registrosPendientes: contarPendientes(),
    ...extra,
  });
}

export function estadoDeLaNube(): EstadoNube {
  return nube;
}

/**
 * ¿La nube dijo "no" a este kiosco (revocado o token desconocido)?
 *
 * Es funcion y no una comparacion suelta porque `nube` cambia DENTRO de las
 * llamadas asincronas del ciclo, y TypeScript no lo ve: tras un `if` creeria
 * que ya no puede valer 'revocado'.
 */
function sinPermisoDeLaNube(): boolean {
  return nube === 'revocado' || nube === 'no_reconocido';
}

// ============================================================================
//  SUBIR: la bandeja de salida
// ============================================================================

const RespuestaDeRecepcion = z.object({
  aceptados: z.array(z.string()),
  rechazados: z.array(z.object({ id: z.string(), motivo: z.string() })),
  dispositivoRevocado: z.boolean().optional(),
});

/**
 * Manda un grupo de renglones. Si la nube rechaza el lote ENTERO por forma
 * invalida (400) y trae varios, se mandan de uno en uno: asi un renglon malo
 * no atora a los demas para siempre, y solo el malo queda rechazado.
 */
async function mandar(credencial: CredencialKiosco, renglones: RenglonParaSubir[]): Promise<void> {
  const ids = renglones.map((r) => r.id);
  let r: Respuesta;
  try {
    r = await llamar('recibir-registros', armarCuerpo(renglones), credencial.token);
  } catch (fallo) {
    anotarFallo(ids, (fallo as Error).message);
    throw fallo;
  }

  if (r.estado === 401) {
    anotarFallo(ids, 'kiosco no reconocido');
    cambiarNube('no_reconocido');
    return;
  }

  if (r.estado === 400) {
    if (renglones.length === 1) {
      marcarRechazados([{ id: ids[0]!, motivo: String(r.cuerpo['mensaje'] ?? 'datos_invalidos') }]);
      return;
    }
    for (const renglon of renglones) await mandar(credencial, [renglon]);
    return;
  }

  const resultado = RespuestaDeRecepcion.safeParse(r.cuerpo);
  if (r.estado !== 200 || !resultado.success) {
    anotarFallo(ids, `respuesta inesperada (${r.estado})`);
    throw new SinConexion(`respuesta inesperada de recibir-registros (${r.estado})`);
  }

  marcarEnviados(resultado.data.aceptados);
  marcarRechazados(resultado.data.rechazados);
  if (resultado.data.rechazados.length > 0) {
    console.warn(`[sync] la nube rechazo ${resultado.data.rechazados.length} renglon(es)`);
  }
  if (resultado.data.dispositivoRevocado) cambiarNube('revocado');
}

/** Vacia la bandeja por tandas. Tope de vueltas por ciclo para no acaparar el proceso. */
async function subir(credencial: CredencialKiosco): Promise<void> {
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const renglones = renglonesParaSubir(S.tamanoLote);
    if (renglones.length === 0) return;
    await mandar(credencial, renglones);
    if (nube === 'no_reconocido') return;
  }
}

// ============================================================================
//  BAJAR: el catalogo
// ============================================================================

/**
 * La forma del catalogo. Se valida aunque venga de "nuestro" servidor: un
 * PIN sin forma de bcrypt, por ejemplo, nunca debe llegar a la base local.
 */
const EsquemaCatalogo = z.object({
  empleados: z.array(
    z.object({
      id: z.uuid(),
      usuario: z.string().min(1).max(40),
      numero_empleado: z.string().max(40).nullable(),
      nombre: z.string().max(100),
      apellido_paterno: z.string().max(100),
      apellido_materno: z.string().max(100),
      pin_hash: z.string().startsWith('$2'),
      pin_temporal: z.boolean(),
      activo: z.boolean(),
      actualizado_en: z.string(),
    }),
  ),
  administradores: z.array(
    z.object({
      id: z.uuid(),
      usuario: z.string().min(1).max(40),
      nombre: z.string().max(100),
      contrasena_hash: z.string().startsWith('$2'),
      rol: z.enum(['admin', 'supervisor']),
      activo: z.boolean(),
      actualizado_en: z.string(),
    }),
  ),
  configuracion: z.record(z.string(), z.unknown()),
  ultimasMarcas: z.array(
    z.object({ empleadoId: z.uuid(), tipo: z.enum(['entrada', 'salida']), horaEstimada: z.string() }),
  ),
  cursor: z.string().nullable(),
});

async function bajar(credencial: CredencialKiosco, segundosLimite?: number): Promise<void> {
  const r = await llamar(
    'catalogo',
    { desde: leerEstadoLocal(CLAVE_CURSOR_CATALOGO) },
    credencial.token,
    segundosLimite,
  );
  if (r.estado === 401) return cambiarNube('no_reconocido');
  if (r.estado === 403) return cambiarNube('revocado');

  const catalogo = EsquemaCatalogo.safeParse(r.cuerpo);
  if (r.estado !== 200 || !catalogo.success) {
    throw new SinConexion(`catalogo con forma inesperada (${r.estado})`);
  }

  aplicarCatalogo(catalogo.data);
  ultimaBajadaOkMs = Date.now();
  // El jefe pudo cambiar "PC compartida" en el panel: la pantalla y el inicio
  // con Windows se ajustan sin reiniciar.
  avisar({ pcCompartida: esPcCompartida() });
  configurarArranqueConWindows();
  if (catalogo.data.empleados.length > 0 || catalogo.data.administradores.length > 0) {
    console.info(
      `[sync] catalogo: ${catalogo.data.empleados.length} empleado(s), ` +
        `${catalogo.data.administradores.length} administrador(es)`,
    );
  }
  // La pantalla recarga la lista de empleados cuando cambia esta fecha.
  cambiarNube('en_linea', { ultimaSincronizacion: new Date().toISOString() });
}

/**
 * Baja el catalogo sin encimarse: si ya hay una bajada en camino (la vuelta
 * normal o una consulta por PIN), se espera esa en vez de lanzar otra. Dos a
 * la vez leerian el mismo cursor y aplicarian el mismo catalogo dos veces.
 */
let bajadaEnCamino: Promise<void> | null = null;
function bajarSinEncimar(credencial: CredencialKiosco, segundosLimite?: number): Promise<void> {
  bajadaEnCamino ??= bajar(credencial, segundosLimite).finally(() => {
    bajadaEnCamino = null;
  });
  return bajadaEnCamino;
}

/** Cuando se bajo el catalogo completo por ultima vez (con exito). */
let ultimaBajadaOkMs = 0;

/**
 * Ponerse al dia con la nube AHORA, sin esperar la vuelta normal.
 *
 * Dos usos (ver `segundosLimiteConsultaRapida` en configuracion.ts):
 *   - al elegir nombre: el ultimo registro de esa persona pudo hacerse en
 *     OTRO kiosco hace un minuto, y hay que sugerir bien ENTRADA o SALIDA;
 *   - con un PIN incorrecto: el jefe pudo cambiarlo hace un minuto. Sin
 *     esto, quien recibe su PIN temporal falla, reintenta y queda bloqueado
 *     (CLAUDE.md 1: la regla de oro).
 *
 * Devuelve `true` si lo que hay en el kiosco esta al dia (recien bajado, o
 * bajado hace menos de `segundosEntreConsultasRapidas`). Nunca lanza, y sin
 * internet ni siquiera intenta: ahi el kiosco sigue como siempre.
 */
export async function ponerseAlDia(): Promise<boolean> {
  if (!sincronizacionDisponible() || nube !== 'en_linea') return false;
  const credencial = leerCredencial();
  if (!credencial) return false;

  if (Date.now() - ultimaBajadaOkMs < S.segundosEntreConsultasRapidas * 1000) return true;

  // Si ya iba una bajada normal (con su limite largo), tampoco se le espera
  // mas de lo que se esperaria a una propia.
  let temporizadorLimite: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizadorLimite = setTimeout(
      () => rechazar(new SinConexion('consulta rapida: tiempo agotado')),
      S.segundosLimiteConsultaRapida * 1000,
    );
  });

  try {
    await Promise.race([bajarSinEncimar(credencial, S.segundosLimiteConsultaRapida), limite]);
    ultimoPullMs = Date.now();
    return !sinPermisoDeLaNube();
  } catch {
    // Red lenta o caida: se queda como PIN incorrecto. La vuelta normal
    // (que si sabe reintentar) se encarga del resto.
    return false;
  } finally {
    clearTimeout(temporizadorLimite);
  }
}

/**
 * Si hay una bajada en camino (la que empezo al elegir el nombre), la espera
 * como mucho `msMaximo`. Asi la sugerencia de ENTRADA/SALIDA sale con lo
 * recien bajado, sin que la red pueda hacer esperar mas de eso.
 */
export async function esperarBajadaEnCamino(msMaximo: number): Promise<void> {
  const enCamino = bajadaEnCamino;
  if (!enCamino) return;
  let temporizador: NodeJS.Timeout | undefined;
  await Promise.race([
    enCamino.catch(() => {}),
    new Promise<void>((listo) => {
      temporizador = setTimeout(listo, msMaximo);
    }),
  ]);
  clearTimeout(temporizador);
}

/**
 * Antes de cerrar el kiosco (PC compartida): manda lo pendiente, esperando
 * como mucho `msMaximo`. Sin internet no espera. Devuelve cuantos quedaron.
 */
export async function enviarAntesDeCerrar(msMaximo: number): Promise<number> {
  if (!sincronizacionDisponible() || !leerCredencial() || sinPermisoDeLaNube()) return contarPendientes();
  const limite = Date.now() + msMaximo;
  while (contarPendientes() > 0 && Date.now() < limite) {
    if (nube === 'sin_conexion') break;
    const restante = limite - Date.now();
    if (enCurso) {
      await new Promise((listo) => setTimeout(listo, 200));
    } else {
      await Promise.race([ciclo(), new Promise((listo) => setTimeout(listo, restante))]);
    }
  }
  return contarPendientes();
}

/** Solo pruebas: como si la ultima bajada hubiera sido hace mucho. */
export function olvidarUltimaBajadaParaPrueba(): void {
  ultimaBajadaOkMs = 0;
}

// ============================================================================
//  LATIR
// ============================================================================

async function latir(credencial: CredencialKiosco): Promise<void> {
  const r = await llamar(
    'latido',
    {
      versionApp: app.getVersion(),
      camaraOk: obtenerEstado().camaraDisponible,
      pendientes: contarPendientes(),
      desfaseRelojMs: desfaseConocidoMs,
    },
    credencial.token,
  );
  if (r.estado === 401) return cambiarNube('no_reconocido');
  if (r.estado === 403) return cambiarNube('revocado');
  if (r.estado === 200) cambiarNube('en_linea');
}

// ============================================================================
//  EL CICLO
// ============================================================================

let temporizador: NodeJS.Timeout | null = null;
let proximoCicloEnMs = 0;
let enCurso = false;
let fallosSeguidos = 0;
let ultimoPullMs = 0;
let ultimoLatidoMs = 0;

function programar(esperaMs: number): void {
  if (temporizador) clearTimeout(temporizador);
  proximoCicloEnMs = Date.now() + esperaMs;
  temporizador = setTimeout(() => void ciclo(), esperaMs);
  // Que un temporizador pendiente no impida que la app se cierre.
  temporizador.unref?.();
}

/** Una vuelta completa: subir, bajar si toca, latir si toca. Nunca lanza. */
export async function ciclo(): Promise<void> {
  if (!sincronizacionDisponible() || enCurso) return;
  const credencial = leerCredencial();
  if (!credencial || nube === 'no_reconocido') return;

  enCurso = true;
  let espera: number = S.intervaloPushMs;
  try {
    // Antes de subir registros hechos sin conexion, medir el reloj con el
    // latido (una llamada chica): si Windows se movio mientras no habia
    // internet, esos registros deben salir ya marcados. Medirlo con la propia
    // subida seria tarde: la respuesta llega cuando ya se fueron.
    if (contarPendientes() > 0 && Date.now() - ultimaMedicionMs > S.intervaloPushMs && !sinPermisoDeLaNube()) {
      await latir(credencial);
      ultimoLatidoMs = Date.now();
    }
    await subir(credencial);

    const ahora = Date.now();
    if (!sinPermisoDeLaNube()) {
      if (ahora - ultimoPullMs >= S.intervaloPullMs) {
        await bajarSinEncimar(credencial);
        ultimoPullMs = ahora;
      }
      if (ahora - ultimoLatidoMs >= S.intervaloHeartbeatMs) {
        await latir(credencial);
        ultimoLatidoMs = ahora;
      }
    }
    fallosSeguidos = 0;
    if (nube === 'conectando' || nube === 'sin_conexion') cambiarNube('en_linea');
  } catch (fallo) {
    if (!(fallo instanceof SinConexion)) console.error('[sync] error inesperado:', fallo);
    // Espera creciente: 2 s, 4 s, 8 s... hasta el tope.
    espera = Math.min(S.reintentoBaseMs * 2 ** fallosSeguidos, S.reintentoMaximoMs);
    fallosSeguidos++;
    if (!sinPermisoDeLaNube()) cambiarNube('sin_conexion');
  } finally {
    enCurso = false;
    avisar({ registrosPendientes: contarPendientes() });
    programar(espera);
  }
}

/**
 * El boton "Sincronizar ahora" del modo administrador (06-10-2026).
 *
 * Una vuelta COMPLETA en el momento: subir lo pendiente, bajar el catalogo
 * (bajas, PINes, configuracion) y avisar al panel como esta la camara, sin
 * esperar a que toque cada cosa. Sirve al jefe que acaba de cambiar algo en
 * el panel y no quiere esperar el minuto. Sin internet no hace milagros:
 * lo dice y ya.
 */
export async function sincronizarAhora(): Promise<{ ok: boolean; pendientes: number }> {
  if (!sincronizacionDisponible() || !leerCredencial()) return { ok: false, pendientes: contarPendientes() };
  // Si ya hay una vuelta en camino, se espera a que acabe y se da otra.
  const limite = Date.now() + S.segundosTiempoLimitePeticion * 1000;
  while (enCurso && Date.now() < limite) await new Promise((listo) => setTimeout(listo, 200));
  ultimoPullMs = 0;
  ultimoLatidoMs = 0;
  await ciclo();
  return { ok: nube === 'en_linea', pendientes: contarPendientes() };
}

/**
 * Pide una vuelta pronto (tras guardar una marca). No es inmediata a
 * proposito: junta en un solo viaje las marcas que llegan seguidas.
 */
export function sincronizarPronto(): void {
  if (!sincronizacionDisponible() || !leerCredencial()) return;
  const esperaMs = S.segundosTrasUnaMarca * 1000;
  if (proximoCicloEnMs - Date.now() > esperaMs) programar(esperaMs);
}

// ============================================================================
//  DAR DE ALTA
// ============================================================================

const RespuestaDeAlta = z.object({
  dispositivoId: z.uuid(),
  nombre: z.string().max(200),
  ubicacion: z.string().max(200),
  token: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function enrolar(codigo: string): Promise<ResultadoEnrolamiento> {
  if (!sincronizacionDisponible()) {
    return { ok: false, mensaje: 'Este kiosco está configurado para trabajar sin conexión con la oficina.' };
  }
  if (!NECESITAN_ALTA.includes(nube)) {
    return { ok: false, mensaje: 'Este kiosco ya está dado de alta.' };
  }

  let r: Respuesta;
  try {
    r = await llamar('enrolar-kiosco', { codigo, versionApp: app.getVersion() }, null);
  } catch {
    return { ok: false, mensaje: 'No hay conexión con la oficina. Revisa el internet y vuelve a intentar.' };
  }

  if (r.estado === 429) {
    return {
      ok: false,
      mensaje: 'Se escribieron demasiados códigos equivocados. Espera una hora y vuelve a intentar con un código nuevo.',
    };
  }
  if (r.estado === 400) {
    return {
      ok: false,
      mensaje: 'Ese código no sirve: puede estar mal escrito, ya se usó o ya venció. Pide uno nuevo en el panel.',
    };
  }
  const alta = RespuestaDeAlta.safeParse(r.cuerpo);
  if (r.estado !== 200 || !alta.success) {
    return { ok: false, mensaje: 'La oficina respondió algo inesperado. Intenta de nuevo en un momento.' };
  }

  try {
    guardarCredencial(alta.data);
  } catch (fallo) {
    console.error('[sync] no se pudo guardar la credencial:', (fallo as Error).message);
    return {
      ok: false,
      mensaje: 'Windows no deja guardar la credencial de forma segura en esta computadora. Avisa a soporte.',
    };
  }

  // Kiosco "nuevo" ante la nube: el catalogo baja completo otra vez. El
  // cursor viejo podria ser de otra base (por ejemplo, tras un reinicio de
  // la nube de pruebas) y dejaria al kiosco sin empleados.
  borrarEstadoLocal(CLAVE_CURSOR_CATALOGO);
  ultimoPullMs = 0;
  ultimoLatidoMs = 0;
  fallosSeguidos = 0;
  console.info(`[sync] kiosco dado de alta como "${alta.data.nombre}"`);
  cambiarNube('conectando');
  programar(0);
  return { ok: true, nombre: alta.data.nombre };
}

// ============================================================================
//  ARRANQUE
// ============================================================================

/**
 * Se llama una vez al arrancar, con la ventana ya en pantalla.
 *
 * @param opciones.avisar         como avisar a la pantalla (actualizarEstado)
 * @param opciones.obtenerEstado  el estado actual (para la camara del latido)
 */
export function iniciarSincronizacion(opciones: { avisar: Avisar; obtenerEstado: () => EstadoKiosco }): void {
  avisar = opciones.avisar;
  obtenerEstado = opciones.obtenerEstado;

  // El ultimo desfase conocido, para que las marcas de antes de la primera
  // conexion ya salgan corregidas.
  const guardado = Number(leerEstadoLocal(CLAVE_DESFASE));
  if (leerEstadoLocal(CLAVE_DESFASE) !== null && Number.isFinite(guardado)) {
    desfaseConocidoMs = guardado;
    establecerDesfaseServidor(guardado);
    avisar({ desfaseRelojMs: guardado });
  }

  if (!sincronizacionDisponible()) {
    cambiarNube('apagada');
    return;
  }
  if (!leerCredencial()) {
    cambiarNube('sin_alta');
    return;
  }
  cambiarNube('conectando');
  programar(0);
}

/** Solo para pruebas: deja el modulo como recien cargado. */
export function reiniciarSincronizacionParaPrueba(): void {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  nube = 'apagada';
  enCurso = false;
  fallosSeguidos = 0;
  ultimoPullMs = 0;
  ultimoLatidoMs = 0;
  ultimaMedicionMs = 0;
  desfaseConocidoMs = null;
  bajadaEnCamino = null;
  ultimaBajadaOkMs = 0;
}
