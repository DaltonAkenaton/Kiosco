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
  empleado_de_baja:
    'Esta persona ya estaba dada de baja cuando registró. Pasa cuando el kiosco estaba sin internet y no ' +
    'se había enterado de la baja. El registro se guardó igual, para no perder nada: decide tú si cuenta ' +
    '(déjalo) o no (Corregir → Anular).',
};

/**
 * El estado de la foto de una marca, como lo ve el jefe. La foto NUNCA esta en el panel.
 *
 * COLORES (06-10-2026, tras instalar en la facultad): "Sin foto" iba en gris,
 * igual que "Borrada por antigüedad", y el gris se lee como "nada que ver".
 * Pero desconectar la camara es justo la trampa mas facil. Ahora:
 *   - rojo con ✖   -> no hay foto que sirva (sin foto, tapada): revisar.
 *   - rojo con ⚠   -> alguien toco los archivos (falta, alterada): lo mas grave.
 *   - gris          -> solo "borrada por antigüedad", que es lo normal.
 * Con simbolo y no solo color: hay quien no distingue bien el rojo.
 * El ambar quedo fuera a proposito: es el color de SALIDA y se confundia.
 */
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
      'Un administrador la marcó para que NO se borre sola al cumplir el plazo de Configuración (por ' +
      'ejemplo, por una queja). Está en el kiosco.',
  },
  obstruida: {
    texto: '✖ Foto tapada',
    color: 'var(--kiosko-peligro)',
    ayuda: 'Se tomó, pero la cámara parecía tapada. Está en el kiosco por si quieres revisarla.',
  },
  sin_camara: {
    texto: '✖ Sin foto',
    color: 'var(--kiosko-peligro)',
    ayuda:
      'Cuando se registró, la cámara no funcionaba (desconectada, tapada con algo o descompuesta). El ' +
      'registro sí cuenta, pero no hay foto que lo respalde. Si le pasa seguido a la misma persona, revisa.',
  },
  eliminada_por_antiguedad: {
    texto: 'Borrada por antigüedad',
    color: 'var(--kiosko-texto-suave)',
    ayuda:
      'La foto se borró sola al cumplir los días que dice Configuración ("Días que se guardan las fotos"), ' +
      'para cuidar la privacidad. El registro no se borra.',
  },
  faltante: {
    texto: '⚠ Falta en el kiosco',
    color: 'var(--kiosko-peligro)',
    ayuda:
      'La foto debería estar en el kiosco y no está. Puede que alguien la haya borrado. Avisa a quien le da ' +
      'soporte al sistema.',
  },
  alterada: {
    texto: '⚠ Alterada',
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

// Armar un Intl.DateTimeFormat es caro (carga las reglas de la zona); usarlo
// no. Las tablas llaman fecha() y hora() varias veces por renglon, con 500
// renglones: se arma uno por zona y se reutiliza.
const formatosDeFecha = new Map<string, Intl.DateTimeFormat>();
const formatosDeHora = new Map<string, Intl.DateTimeFormat>();

export function fecha(iso: string, zona: string): string {
  let formato = formatosDeFecha.get(zona);
  if (!formato) {
    formato = new Intl.DateTimeFormat('es-MX', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric' });
    formatosDeFecha.set(zona, formato);
  }
  return formato.format(new Date(iso));
}

export function hora(iso: string, zona: string): string {
  let formato = formatosDeHora.get(zona);
  if (!formato) {
    formato = new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatosDeHora.set(zona, formato);
  }
  return formato.format(new Date(iso));
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
    nombre: 'Minutos tarde para "retardo mayor"',
    explicacion: 'A partir de cuántos minutos tarde el retardo se marca como RETARDO MAYOR. No es falta: la persona sí vino. (Si quieres que llegar así de tarde cuente como falta, enciende la opción de abajo.)',
    seUsaEn: 'Los reportes de asistencia',
  },
  horas_para_cierre_automatico: {
    nombre: 'Horas para "salida no registrada"',
    explicacion: 'Si alguien registra entrada y pasan estas horas sin salida, se marca como "salida no registrada". El sistema NO inventa la hora: lo resuelves tú.',
    seUsaEn: 'Los reportes de asistencia',
  },
  dias_retencion_fotos: {
    nombre: 'Días que se guardan las fotos',
    explicacion: 'Después de estos días, las fotos se borran solas del kiosco para cuidar la privacidad (salvo las marcadas "Conservar"). Los registros de asistencia NO se borran nunca. OJO: si BAJAS este número, en la siguiente limpieza el kiosco borra todas las fotos más viejas que eso, y no se pueden recuperar. Si hay un caso en disputa, márcalo "Conservar" antes.',
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
  camara_desconexiones_alerta: {
    nombre: 'Desconexiones de cámara para avisar',
    explicacion: 'Una cámara que se va a descomponer no se muere de golpe: se desconecta y se vuelve a conectar cada vez más seguido. Si se desconecta esta cantidad de veces (o más) en los días de abajo, el panel avisa para revisarla o cambiarla antes de que falle del todo.',
    seUsaEn: 'Este panel y el correo diario',
  },
  camara_dias_desconexiones: {
    nombre: 'Días en que se cuentan las desconexiones',
    explicacion: 'Cuántos días hacia atrás se cuentan las desconexiones de la cámara. Con 3 desconexiones y 7 días: si la cámara se desconectó 3 veces en la última semana, avisa.',
    seUsaEn: 'Este panel y el correo diario',
  },
  dias_avisos_registros: {
    nombre: 'Días de registros por revisar en los avisos',
    explicacion: 'Los avisos de arriba de Asistencia (registros en cuarentena, y de personas dadas de baja si ésos no se llevan a Pendientes) buscan tantos días hacia atrás. Lo más viejo ya no se avisa, pero sigue en Asistencia → Revisión.',
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
  llegar_muy_tarde_es_falta: {
    nombre: 'Llegar muy tarde cuenta como falta',
    explicacion: 'Con "No" (lo normal), falta es sólo NO venir: quien llega tarde es retardo, y el reporte dice si repuso el tiempo quedándose más. Con "Sí", llegar más tarde que los minutos de "retardo mayor" cuenta como falta aunque haya venido.',
    seUsaEn: 'Los reportes de asistencia',
  },
  minutos_toque_repetido: {
    nombre: 'Minutos para contar un toque repetido',
    explicacion: 'Si alguien registra ENTRADA dos veces seguidas («por si no quedó») en menos de estos minutos, cuenta como una sola. Igual con dos salidas.',
    seUsaEn: 'Los reportes de asistencia',
  },
  minutos_minimos_tiempo_extra: {
    nombre: 'Minutos para contar tiempo extra',
    explicacion: 'Quedarse después de su hora de salida cuenta como tiempo extra a partir de estos minutos. Salir 5 minutos tarde no es tiempo extra. (Si llegó tarde, primero se cuenta lo que repuso.)',
    seUsaEn: 'Los reportes de asistencia',
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
  kiosco_pc_compartida: {
    nombre: 'La PC del kiosco se usa para otras cosas',
    explicacion:
      'Con "Sí" (lo normal aquí): el kiosco se abre con su icono cuando alguien va a checar, tiene un botón "Cerrar kiosco" y, antes de cerrarse, manda los registros a la oficina. Un kiosco cerrado no es alerta, y las versiones nuevas se instalan al cerrarlo. Con "No": la PC es sólo para checar; el kiosco se abre solo al prender, se queda en pantalla completa todo el día y avisa si deja de reportarse.',
    seUsaEn: 'Los kioscos y este panel',
  },
  permitir_datos_demostracion: {
    nombre: 'Permitir datos de demostración',
    explicacion: 'Con "Sí", en Empleados aparece el botón para generar empleados y registros FALSOS, para probar el sistema. Sirve sólo en el sistema de pruebas: en el sistema real debe quedar en "No".',
    seUsaEn: 'Este panel',
  },
  pendientes_minutos_tarde_dia: {
    nombre: 'Minutos tarde en un día',
    explicacion: 'Si alguien llega esta cantidad de minutos tarde (o más) en un solo día, aparece en Pendientes para que lo atiendas. Con 0, esta regla se apaga.',
    seUsaEn: 'Pendientes',
  },
  pendientes_minutos_tarde_semana: {
    nombre: 'Minutos tarde sumados en la semana',
    explicacion: 'Si los minutos tarde de alguien suman esto (o más) de lunes a domingo, aparece en Pendientes. Se cuentan desde su hora de entrada, aunque estén dentro de la tolerancia: quien llega 12 minutos tarde cinco días suma 60. Con 0, esta regla se apaga.',
    seUsaEn: 'Pendientes',
  },
  pendientes_faltas: {
    nombre: 'Las faltas van a Pendientes',
    explicacion: 'Con "Sí", cada falta (le tocaba trabajar, no vino y no tiene permiso registrado) aparece en Pendientes. Si después registras un permiso o vacaciones para ese día, se cierra sola.',
    seUsaEn: 'Pendientes',
  },
  pendientes_salidas_no_registradas: {
    nombre: 'Las salidas no registradas van a Pendientes',
    explicacion: 'Con "Sí", cuando alguien registra su entrada y nunca su salida, aparece en Pendientes. Si registras la salida a mano, se cierra sola.',
    seUsaEn: 'Pendientes',
  },
  pendientes_registros_de_baja: {
    nombre: 'Registros de personas dadas de baja van a Pendientes',
    explicacion: 'Con "Sí", cada registro de alguien que ya estaba dado de baja aparece en Pendientes. Con "No", se avisa en la franja de arriba de Asistencia, como antes.',
    seUsaEn: 'Pendientes',
  },
  pendientes_fotos_tapadas: {
    nombre: 'La cámara tapada va a Pendientes',
    explicacion: 'Con "Sí", cada día que alguien registra con la cámara tapada aparece en Pendientes. Es la trampa más común: conviene revisar la foto en el kiosco.',
    seUsaEn: 'Pendientes',
  },
  pendientes_dias_revision: {
    nombre: 'Días hacia atrás que se revisan',
    explicacion: 'Cuántos días hacia atrás se buscan casos nuevos para Pendientes. Lo que ya está en Pendientes no se borra aunque sea más viejo: sigue ahí hasta que lo atiendas.',
    seUsaEn: 'Pendientes',
  },
  pendientes_revisar_desde: {
    nombre: 'Revisar desde',
    explicacion: 'Lo que pasó antes de esta fecha no se vuelve pendiente. Se puso sola el día en que se instaló esta versión, para no empezar con cientos de casos viejos. Si la mueves hacia adelante, lo pendiente de antes se cierra solo; si la mueves hacia atrás, salen los casos de esos días (hasta los «Días hacia atrás que se revisan»).',
    seUsaEn: 'Pendientes',
  },
  identificar_con_numero: {
    nombre: 'Los empleados checan con su número de empleado',
    explicacion: 'Con "Sí", en el kiosco cada quien escribe su número de empleado (puede llevar letras), Enter, y su PIN. Con "No", cada quien elige su nombre de una lista. Antes de encenderlo, todos los empleados activos deben tener su número en Empleados.',
    seUsaEn: 'Los kioscos',
  },
  zona_horaria: {
    nombre: 'Zona horaria',
    explicacion: 'La hora oficial del sistema. Nuevo Laredo está en "America/Matamoros", que SÍ cambia de horario en verano. No la cambies si no estás seguro.',
    seUsaEn: 'Todo el sistema',
  },
};
