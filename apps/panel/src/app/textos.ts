/**
 * ============================================================================
 *  LAS PALABRAS DEL PANEL
 * ============================================================================
 *  Cada estado y cada bandera, en palabras de todos los dias y con su
 *  explicacion para el ⓘ. Criterio del proyecto: el jefe no tiene por que
 *  saber que es "reloj_sospechoso".
 */

import { NOMBRES_DE_BANDERAS } from '@kiosko/compartido';

export { NOMBRES_DE_BANDERAS };

export const AYUDA_BANDERAS: Record<string, string> = {
  sin_camara:
    'La cámara no funcionaba cuando esta persona registró. El registro sí cuenta. Si le pasa seguido a ' +
    'la misma persona, conviene revisar.',
  foto_obstruida:
    'La foto salió muy oscura o sin forma, como si alguien tapara la cámara. Para verla hay que ir al ' +
    'kiosco y entrar al modo administrador.',
  foto_no_guardada:
    'La cámara sí funcionaba, pero la computadora del kiosco no pudo guardar la foto (disco lleno o una ' +
    'falla de Windows). El registro sí cuenta. Si se repite, avisa a quien le da soporte al sistema.',
  reloj_sospechoso:
    'La hora de la computadora del kiosco parecía movida en ese momento. La hora de este registro ' +
    'podría no ser la real: compárala con los demás de ese día.',
  dispositivo_revocado:
    'Llegó de un kiosco que ya se había dado de baja. Se guardó apartado ("en cuarentena") para que lo ' +
    'revises.',
  manual: 'No se hizo en el kiosco: lo capturó un administrador a mano, con un motivo.',
  cierre_automatico: 'La persona registró su entrada pero nunca su salida. El sistema no inventa la hora.',
};

/** El estado de la foto de una marca, como lo ve el jefe. La foto NUNCA esta en el panel. */
export const ESTADOS_DE_FOTO: Record<string, { texto: string; color: string; ayuda: string }> = {
  con_foto: {
    texto: 'En el kiosco',
    color: 'var(--kiosko-texto)',
    ayuda:
      'La foto existe y está guardada en el kiosco donde se registró. Por seguridad la foto nunca sale de ' +
      'ahí: para verla hay que ir al kiosco y entrar al modo administrador.',
  },
  conservada: {
    texto: 'En el kiosco · Conservada',
    color: 'var(--kiosko-texto)',
    ayuda:
      'Un administrador la marcó para que NO se borre a los 30 días (por ejemplo, por una queja). Está en ' +
      'el kiosco.',
  },
  obstruida: {
    texto: 'Foto tapada',
    color: 'var(--kiosko-atencion)',
    ayuda: 'Se tomó, pero la cámara parecía tapada. Está en el kiosco por si quieres revisarla.',
  },
  sin_camara: {
    texto: 'Sin foto',
    color: 'var(--kiosko-texto-suave)',
    ayuda: 'Cuando se registró, la cámara no funcionaba. El registro sí cuenta.',
  },
  eliminada_por_antiguedad: {
    texto: 'Borrada (30 días)',
    color: 'var(--kiosko-texto-suave)',
    ayuda: 'La foto se borró sola al cumplir el plazo, para cuidar la privacidad. El registro no se borra.',
  },
  faltante: {
    texto: 'Falta en el kiosco',
    color: 'var(--kiosko-peligro)',
    ayuda:
      'La foto debería estar en el kiosco y no está. Puede que alguien la haya borrado. Avisa a quien le da ' +
      'soporte al sistema.',
  },
  alterada: {
    texto: 'Alterada',
    color: 'var(--kiosko-peligro)',
    ayuda:
      'Alguien modificó la foto en el kiosco: ya no coincide con su huella. No la uses como prueba y avisa a ' +
      'quien le da soporte al sistema.',
  },
};

export const AYUDA_CUARENTENA =
  'Llegó de un kiosco que ya estaba dado de baja, así que se guardó aparte. El registro no se pierde, ' +
  'pero conviene revisarlo antes de tomarlo en cuenta.';

// ----------------------------------------------------------------------------
//  Horas y fechas, siempre en la zona del sistema
// ----------------------------------------------------------------------------

export function fecha(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso),
  );
}

export function hora(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}

/** "hace 3 minutos", "hace 2 horas", "hace 5 días". */
export function haceCuanto(iso: string | null, ahoraMs: number = Date.now()): string {
  if (!iso) return 'nunca';
  const minutos = Math.round((ahoraMs - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `hace ${horas} hora${horas === 1 ? '' : 's'}`;
  return `hace ${Math.round(horas / 24)} días`;
}

// ----------------------------------------------------------------------------
//  La configuracion, en palabras (Configuracion y Bitacora)
// ----------------------------------------------------------------------------

/**
 * Cada opcion en palabras. `explicacion` va en el ⓘ; `seUsaEn` dice a quien
 * afecta. Las que no esten aqui se muestran con la descripcion de la base.
 */
export const PALABRAS_CONFIGURACION: Record<string, { nombre: string; explicacion: string; seUsaEn: string }> = {
  tolerancia_retardo_minutos: {
    nombre: 'Tolerancia para llegar tarde',
    explicacion: 'Minutos después de la hora de entrada en que todavía NO se cuenta retardo. Con 10, quien entra a las 6:00 y llega a las 6:09 llegó a tiempo.',
    seUsaEn: 'Los reportes de asistencia',
  },
  minutos_para_falta: {
    nombre: 'Minutos tarde para contar falta',
    explicacion: 'A partir de cuántos minutos tarde ya no es retardo sino falta.',
    seUsaEn: 'Los reportes de asistencia',
  },
  horas_para_cierre_automatico: {
    nombre: 'Horas para "salida no registrada"',
    explicacion: 'Si alguien registra entrada y pasan estas horas sin salida, se marca como "salida no registrada". El sistema NO inventa la hora: lo resuelves tú.',
    seUsaEn: 'Los reportes de asistencia',
  },
  dias_retencion_fotos: {
    nombre: 'Días que se guardan las fotos',
    explicacion: 'Después de estos días, las fotos se borran solas del kiosco para cuidar la privacidad (salvo las marcadas "Conservar"). Los registros de asistencia NO se borran nunca.',
    seUsaEn: 'Los kioscos',
  },
  intentos_pin_maximos: {
    nombre: 'Intentos de PIN antes de bloquear',
    explicacion: 'Cuántas veces seguidas puede alguien equivocarse de PIN antes de que el kiosco lo haga esperar.',
    seUsaEn: 'Los kioscos',
  },
  segundos_bloqueo_pin: {
    nombre: 'Tiempo de espera tras equivocarse',
    explicacion: 'Cuánto tiene que esperar alguien que se equivocó de PIN demasiadas veces.',
    seUsaEn: 'Los kioscos',
  },
  minutos_olvidar_intentos: {
    nombre: 'Minutos para olvidar los errores de PIN',
    explicacion: 'Si pasan estos minutos sin errores, el conteo de intentos vuelve a cero.',
    seUsaEn: 'Los kioscos',
  },
  umbral_brillo_minimo: {
    nombre: 'Brillo mínimo de la foto',
    explicacion: 'Si la foto sale más oscura que esto, se marca "cámara tapada". Súbelo si se cuelan fotos tapadas; bájalo si marca como tapadas fotos normales de un pasillo oscuro.',
    seUsaEn: 'Los kioscos',
  },
  umbral_varianza_minima: {
    nombre: 'Detalle mínimo de la foto',
    explicacion: 'Mide qué tanto "dibujo" tiene la foto. Una hoja de papel o una mano encima tienen muy poco. Por debajo de esto, se marca "cámara tapada".',
    seUsaEn: 'Los kioscos',
  },
  minutos_camara_caida_alerta: {
    nombre: 'Minutos de cámara caída para avisar',
    explicacion: 'Tras cuántos minutos con la cámara sin funcionar se muestra una alerta aquí.',
    seUsaEn: 'Este panel',
  },
  umbral_desfase_reloj_ms: {
    nombre: 'Diferencia de reloj sospechosa',
    explicacion: 'Si la hora de la computadora del kiosco se mueve más que esto de golpe, el registro se marca "hora dudosa". Está en milisegundos: 60000 es un minuto.',
    seUsaEn: 'Los kioscos',
  },
  minutos_kiosco_sin_conexion_alerta: {
    nombre: 'Minutos sin reportarse para avisar',
    explicacion: 'Si un kiosco pasa estos minutos sin avisar "sigo aquí", aparece una alerta en la página de Kioscos.',
    seUsaEn: 'Este panel',
  },
  minutos_vigencia_codigo_enrolamiento: {
    nombre: 'Minutos que dura un código de alta',
    explicacion: 'Cuánto tiempo sirve el código para dar de alta un kiosco nuevo.',
    seUsaEn: 'Este panel',
  },
  minutos_anticipacion_entrada: {
    nombre: 'Minutos antes de la entrada que cuentan',
    explicacion: 'Qué tan temprano puede llegar alguien y que su registro cuente para ESE turno. Con 240 (4 horas), una entrada a las 2:30 cuenta para el turno de las 6:00. Más temprano, se ve como «fuera de horario».',
    seUsaEn: 'Los reportes de asistencia',
  },
  intentos_enrolamiento_por_hora: {
    nombre: 'Códigos equivocados permitidos por hora',
    explicacion: 'Al dar de alta un kiosco, cuántos códigos equivocados se aceptan en una hora desde el mismo lugar antes de pedir que espere. Frena a quien intente adivinar códigos.',
    seUsaEn: 'Los kioscos',
  },
  minutos_inactividad_panel: {
    nombre: 'Minutos sin uso para cerrar la sesión',
    explicacion: 'Si nadie usa este panel durante estos minutos, la sesión se cierra sola y hay que volver a entrar. Protege la computadora que se queda abierta (por ejemplo, toda la noche). Un minuto antes aparece un aviso.',
    seUsaEn: 'Este panel',
  },
  permitir_datos_demostracion: {
    nombre: 'Permitir datos de demostración (1 = sí, 0 = no)',
    explicacion: 'Con 1, en Empleados aparece el botón para generar empleados y registros FALSOS, para probar el sistema. Sirve sólo en el sistema de pruebas: en el sistema real debe quedar en 0.',
    seUsaEn: 'Este panel',
  },
  zona_horaria: {
    nombre: 'Zona horaria',
    explicacion: 'La hora oficial del sistema. Nuevo Laredo está en "America/Matamoros", que SÍ cambia de horario en verano. No la cambies si no estás seguro.',
    seUsaEn: 'Todo el sistema',
  },
};
