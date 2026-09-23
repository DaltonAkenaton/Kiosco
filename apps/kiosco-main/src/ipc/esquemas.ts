/**
 * ============================================================================
 *  VALIDACION DE LO QUE LLEGA DESDE LA PANTALLA
 * ============================================================================
 *
 *  CLAUDE.md 3.1: "Todo handler ipcMain.handle valida tipos y rangos de
 *  entrada (usar zod o validacion equivalente)."
 *
 *  ¿Por que validar si el mensaje viene de mi propia interfaz?
 *  ----------------------------------------------------------
 *  Porque ESO NO SE PUEDE DAR POR HECHO. El mensaje viene del proceso de la
 *  pantalla, que es la parte menos confiable del sistema. Si alguien logra
 *  ejecutar codigo ahi (o simplemente abre la consola en una PC mal
 *  configurada), puede mandar lo que se le antoje:
 *
 *      window.kiosco.identificar({ numeroEmpleado: 'x'.repeat(10_000_000), pin: null })
 *
 *  Sin validacion, eso puede tumbar el proceso principal, o peor, colarse
 *  hasta una consulta SQL. Con validacion, rebota en la puerta.
 *
 *  Regla general de seguridad: "no confies en la entrada", y el proceso
 *  principal considera ENTRADA todo lo que venga del renderer.
 *
 *  ¿Que es zod?
 *  ------------
 *  Una libreria para describir la forma esperada de un dato y comprobarla en
 *  tiempo de ejecucion. TypeScript solo revisa ANTES de correr; zod revisa
 *  MIENTRAS corre, que es cuando llegan los datos de verdad.
 */

import { z } from 'zod';
import { CONFIG, PATRON_USUARIO } from '@kiosko/compartido';
import { modoIdentificacionVigente } from '../configuracion-vigente';

/**
 * Los limites salen de la configuracion central, NO estan escritos a mano.
 * Si manana cambias `largoPinMaximo` a 6, esta validacion se ajusta sola.
 */
const { identificacion } = CONFIG;

/**
 * Cadena de puros digitos, con largo minimo y maximo.
 * `^\d+$` significa: de principio (^) a fin ($), solo digitos (\d).
 * Esto ya descarta letras, espacios, comillas y cualquier intento de
 * inyeccion de codigo.
 */
function soloDigitos(minimo: number, maximo: number) {
  return z
    .string()
    .min(minimo)
    .max(maximo)
    .regex(/^\d+$/, 'Solo se permiten digitos');
}

/**
 * El identificador cambia de forma segun el modo configurado.
 *
 * Fijate en algo importante: el esquema se ARMA a partir de la configuracion,
 * no hay tres esquemas escritos a mano. Si manana cambias el modo a 'lista',
 * la validacion se ajusta sola y no queda un esquema viejo aceptando cosas
 * que ya no deberian pasar.
 */
function esquemaDelIdentificador() {
  switch (modoIdentificacionVigente()) {
    case 'usuario':
      return z
        .string()
        .min(identificacion.largoUsuarioMinimo)
        .max(identificacion.largoUsuarioMaximo)
        // El mismo patron que usa el generador de usuarios: minusculas,
        // empieza con letra, sin acentos ni espacios.
        .regex(PATRON_USUARIO, 'Usuario invalido');

    case 'lista':
      // En el modo lista, el identificador es el id del empleado que se eligio
      // en pantalla. Es un UUID que salio del propio sistema.
      return z.uuid();

    case 'numero':
      return soloDigitos(
        identificacion.largoNumeroEmpleadoMinimo,
        identificacion.largoNumeroEmpleadoMaximo,
      );
  }
}

/**
 * Lo que debe traer un intento de identificacion.
 *
 * ES UNA FUNCION, no una constante. Eso es a proposito:
 *
 * Si fuera una constante, el esquema se armaria UNA sola vez al cargar el
 * archivo, con la configuracion que hubiera en ese instante. El dia que la
 * configuracion cambie en caliente (el modo de identificacion ahora, y los
 * valores de Supabase cuando exista la sincronizacion), el validador seguiria
 * usando la regla vieja y rechazaria datos validos sin que nadie entienda
 * por que.
 *
 * Armarlo en cada peticion cuesta microsegundos y elimina esa familia
 * completa de errores. Ver `configuracion-vigente.ts`.
 *
 * `z.strictObject` (en vez de `z.object`) rechaza campos de mas: si llega
 * {identificador, pin, admin: true}, el mensaje entero se rechaza en lugar
 * de ignorar el campo extra en silencio. Preferimos fallar ruidosamente.
 */
export function esquemaIdentificacion() {
  return z.strictObject({
    identificador: esquemaDelIdentificador(),
    pin: soloDigitos(identificacion.largoPinMinimo, identificacion.largoPinMaximo),
  });
}

/** Modos validos, para validar el canal que los cambia (solo en desarrollo). */
export const EsquemaCambioDeModo = z.strictObject({
  modo: z.enum(['usuario', 'lista', 'numero']),
});

/**
 * Tamano maximo que aceptamos para la foto, en caracteres del texto base64.
 *
 * Una foto de 480 px con calidad 0.7 pesa 30-50 KB. En base64 crece ~33%,
 * asi que ~70 KB. Damos margen de sobra con 1 MB, pero ponemos un techo:
 * sin el, la pantalla podria mandar 500 MB y tumbar el proceso principal.
 */
const MAXIMO_CARACTERES_FOTO = 1_000_000;

/** Una foto valida es un data URL de JPEG, o `null` si no habia camara. */
const EsquemaFoto = z
  .string()
  .max(MAXIMO_CARACTERES_FOTO)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, 'Formato de foto invalido')
  .nullable();

/** Mediciones de brillo y varianza que manda la interfaz. */
const EsquemaMediciones = z
  .strictObject({
    // El brillo de un pixel va de 0 (negro) a 255 (blanco).
    brilloPromedio: z.number().min(0).max(255),
    // La varianza no puede ser negativa por definicion matematica.
    varianza: z.number().min(0),
  })
  .nullable();

/**
 * El pase de un solo uso que `identificar` entrego a la pantalla.
 *
 * Son 32 bytes al azar escritos en hexadecimal, asi que siempre mide
 * exactamente 64 caracteres y solo trae 0-9 y a-f. Comprobar la FORMA aqui
 * no prueba que el pase sea valido —eso lo decide `canjearPase`— pero corta
 * de raiz cualquier intento de mandar por este campo algo que no sea un
 * pase: un texto de un megabyte, comillas, una consulta SQL.
 */
const EsquemaPase = z.string().regex(/^[0-9a-f]{64}$/, 'Pase invalido');

/** Lo que debe traer una solicitud de registro de marca. */
export const EsquemaRegistro = z.strictObject({
  tokenRegistro: EsquemaPase,
  // Solo estos dos valores. Cualquier otro texto se rechaza.
  tipo: z.enum(['entrada', 'salida']),
  fotoJpegBase64: EsquemaFoto,
  medicionesImagen: EsquemaMediciones,
});

/** Aviso de la interfaz sobre el estado de la camara. */
export const EsquemaEstadoCamara = z.strictObject({
  disponible: z.boolean(),
  // Recortamos el detalle: es un mensaje de error, no un ensayo.
  detalle: z.string().max(500).optional(),
});

/** Lo que debe traer una cancelacion: nada mas el pase que se va a tirar. */
export const EsquemaCancelacion = z.strictObject({
  tokenRegistro: EsquemaPase,
});

/**
 * El codigo para pausar el kiosco.
 *
 * Solo digitos, y con un techo de largo. El techo importa: sin el, la pantalla
 * podria mandar un texto de un megabyte por este campo, y compararlo contra el
 * codigo real seria trabajo regalado para nadie.
 */
export const EsquemaPausa = z.strictObject({
  codigo: z
    .string()
    .min(1)
    .max(16)
    /*
      `[0-9]` y no `\d`, a proposito.

      Aqui decia `/^d+$/` — sin la barra invertida— y por lo tanto solo aceptaba
      la LETRA d. El codigo `1234` rebotaba siempre, y como el manejador
      responde lo mismo ante un formato invalido que ante un codigo equivocado,
      el sintoma era "Codigo incorrecto" con el codigo correcto. Ver E-019.

      La barra invertida se perdio al generar este archivo desde un script: en
      una plantilla de JavaScript, `\d` se convierte en `d`. Escribir `[0-9]`
      dice exactamente lo mismo y no tiene nada que se pueda perder por el
      camino.
    */
    .regex(/^[0-9]+$/, 'Solo se permiten digitos'),
});

// ============================================================================
//  MODO ADMINISTRADOR  (CLAUDE.md 5.2)
// ============================================================================
//  Aqui entra quien quiere ver fotos. Cada campo tiene techo de largo: un
//  texto de un megabyte en el campo "usuario" no debe llegar ni a la base.

/** El token de sesion: 64 caracteres hexadecimales, igual que el pase. */
const EsquemaToken = z.string().regex(/^[0-9a-f]{64}$/, 'Sesion invalida');

/** "AAAA-MM-DD". La fecha la interpreta el proceso principal en la zona configurada. */
const EsquemaFecha = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Fecha invalida')
  .nullable();

export const EsquemaEntradaAdmin = z.strictObject({
  usuario: z.string().min(1).max(100),
  // bcrypt solo mira los primeros 72 bytes; mas largo no agrega nada.
  contrasena: z.string().min(1).max(72),
});

export const EsquemaSoloToken = z.strictObject({ token: EsquemaToken });

export const EsquemaBusquedaAuditoria = z.strictObject({
  token: EsquemaToken,
  filtros: z.strictObject({
    desde: EsquemaFecha,
    hasta: EsquemaFecha,
    empleadoId: z.uuid().nullable(),
    // Solo banderas que existen: nada de texto libre dentro de un LIKE.
    bandera: z
      .enum([
        'sin_camara',
        'foto_obstruida',
        'reloj_sospechoso',
        'dispositivo_revocado',
        'manual',
        'cierre_automatico',
      ])
      .nullable(),
    soloConFoto: z.boolean(),
  }),
});

export const EsquemaVerFoto = z.strictObject({
  token: EsquemaToken,
  marcaId: z.uuid(),
});

export const EsquemaConservarFoto = z.strictObject({
  token: EsquemaToken,
  marcaId: z.uuid(),
  conservar: z.boolean(),
  // Obligatorio: "Conservar" es para casos en disputa, y el caso se anota.
  motivo: z.string().trim().min(3).max(300),
});

export const EsquemaDefinirRecuperacion = z.strictObject({
  token: EsquemaToken,
  contrasena: z.string().max(200),
});
