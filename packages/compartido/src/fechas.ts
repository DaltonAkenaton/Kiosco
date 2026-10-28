/**
 * ============================================================================
 *  FECHAS EN LA ZONA DEL SISTEMA  (ARQUITECTURA.md 6)
 * ============================================================================
 *
 *  Lo usan el kiosco (auditoria, exportacion) y el panel (filtros de la
 *  tabla de asistencia). Esta aqui, y no copiado en cada uno, porque es justo
 *  el tipo de calculo que falla en silencio dos noches al ano (los cambios de
 *  horario) si una de las copias se desfasa de la otra.
 *
 *  Nada de esto usa la zona de Windows ni la del navegador: siempre la que se
 *  le pasa (America/Matamoros).
 */

/**
 * Convierte "AAAA-MM-DD" (dia local) en el milisegundo UTC en que empieza.
 *
 * No se puede hacer con `new Date('2026-09-22')`: eso es medianoche UTC, que
 * en Nuevo Laredo son las 18:00 o 19:00 del dia ANTERIOR, segun el horario de
 * verano. Aqui se busca el desfase real de esa fecha en la zona indicada.
 */
export function inicioDelDiaLocal(fecha: string, zona: string): number {
  return instanteLocal(fecha, 0, 0, zona);
}

/**
 * "2026-11-01" a las 06:00 en la zona -> milisegundo UTC.
 *
 * NO es "inicio del dia + 6 horas": el dia del cambio de horario, entre la
 * medianoche y las 06:00 pasan 5 o 7 horas de reloj. Se calcula el desfase de
 * ESA hora en ESA fecha. (Una hora que no existe, como las 02:30 del domingo
 * de marzo, se resuelve con el desfase de despues del salto.)
 */
export function instanteLocal(fecha: string, hora: number, minuto: number, zona: string): number {
  const [ano, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  const comoSiFueraUtc = Date.UTC(ano, mes - 1, dia, hora, minuto);

  // Que hora marca el reloj de la zona en ese instante UTC; la diferencia es
  // el desfase. Se calcula dos veces porque cerca del cambio de horario el
  // desfase de "medianoche UTC" y el de "medianoche local" pueden no coincidir.
  const desfase = (ms: number): number => {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const v = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - ms;
  };

  const primera = comoSiFueraUtc - desfase(comoSiFueraUtc);
  return comoSiFueraUtc - desfase(primera);
}

/**
 * "2026-11-01" -> "2026-11-02". Se suma un dia a la FECHA, no 24 horas a los
 * milisegundos: el dia del cambio de horario dura 23 o 25 horas.
 */
export function diaSiguiente(fecha: string): string {
  const [ano, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
}

/** "AAAA-MM-DD" de hoy en la zona indicada. */
export function hoyEn(zona: string, ahoraMs: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date(ahoraMs));
}
