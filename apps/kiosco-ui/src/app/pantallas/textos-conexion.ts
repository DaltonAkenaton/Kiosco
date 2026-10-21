/**
 * ============================================================================
 *  LA CONEXION CON LA OFICINA, EN PALABRAS
 * ============================================================================
 *
 *  Antes vivia dentro de la pantalla principal, en la barra de abajo. Desde
 *  el 20-10-2026 esa barra ya no la ve el empleado (junta con el jefe): se ve
 *  en el modo administrador. Aqui para que las dos pantallas digan lo mismo.
 */

import type { EstadoNube } from '@kiosko/compartido';

/** `alta` = se ofrece el boton para teclear el codigo de alta. */
export const TEXTOS_DE_CONEXION: Record<EstadoNube, { texto: string; color: string; ayuda: string; alta: boolean }> = {
  apagada: {
    texto: 'Sólo en esta computadora',
    color: 'var(--kiosko-texto-suave)',
    ayuda:
      'Este kiosco está configurado para no conectarse con la oficina. Los registros se guardan ' +
      'aquí y cuentan igual; para verlos hay que venir a esta computadora.',
    alta: false,
  },
  sin_alta: {
    texto: 'Kiosco sin dar de alta',
    color: 'var(--kiosko-atencion)',
    ayuda:
      'Este kiosco todavía no está conectado con la oficina. Los registros SÍ se guardan aquí y se ' +
      'mandarán cuando se dé de alta. Para darlo de alta, el jefe genera un código en el panel y ' +
      'alguien lo teclea con el botón "Dar de alta".',
    alta: true,
  },
  conectando: {
    texto: 'Conectando…',
    color: 'var(--kiosko-texto-suave)',
    ayuda: 'El kiosco está buscando la conexión con la oficina. Puedes registrarte normalmente.',
    alta: false,
  },
  en_linea: {
    texto: 'Con internet',
    color: 'var(--kiosko-entrada)',
    ayuda: 'El kiosco está conectado con la oficina: los registros se mandan solos.',
    alta: false,
  },
  sin_conexion: {
    texto: 'Sin internet',
    color: 'var(--kiosko-texto-suave)',
    ayuda:
      'No hay conexión con la oficina en este momento. Puedes registrarte normalmente: tu registro ' +
      'se guarda aquí y se manda solo cuando vuelva el internet.',
    alta: false,
  },
  revocado: {
    texto: 'Kiosco dado de baja',
    color: 'var(--kiosko-peligro)',
    ayuda:
      'En el panel dieron de baja este kiosco. Los registros se siguen guardando aquí, pero la ' +
      'oficina ya no los recibe. Si fue un error, el jefe genera un código nuevo y alguien lo ' +
      'teclea con "Dar de alta de nuevo".',
    alta: true,
  },
  no_reconocido: {
    texto: 'La oficina no reconoce este kiosco',
    color: 'var(--kiosko-peligro)',
    ayuda:
      'La oficina ya no reconoce la credencial de este kiosco. Los registros se siguen guardando ' +
      'aquí. Para arreglarlo, el jefe genera un código nuevo en el panel y alguien lo teclea con ' +
      '"Dar de alta de nuevo".',
    alta: true,
  },
};

/** El ⓘ de "N por enviar". */
export const AYUDA_POR_ENVIAR =
  'Son los registros que ya quedaron guardados en esta computadora, pero que todavía no se ' +
  'mandan al sistema de la oficina. Se mandan solos cuando hay internet. El registro ya cuenta ' +
  'desde que se ve "ENTRADA" o "SALIDA" en la pantalla.';
