/**
 * ============================================================================
 *  NOMBRES DE USUARIO
 * ============================================================================
 *
 *  Convierte "Dalton Akenaton Gomez Arellano" en "dgomez".
 *
 *  Regla: primera letra del primer nombre + apellido paterno completo,
 *  todo en minusculas y sin acentos.
 *
 *  ---------------------------------------------------------------------------
 *  ¿Por que un nombre de usuario y no el numero de empleado?
 *  ---------------------------------------------------------------------------
 *  Porque en la practica la gente NO se sabe su numero de empleado. Alguien
 *  con dos anos en su trabajo puede no saberlo, y pedirselo a las 6 de la
 *  manana es garantizar que no pueda checar.
 *
 *  Su nombre, en cambio, se lo sabe siempre.
 *
 *  El costo es que hace falta teclado completo. Ver `IDENTIFICACION.modo` en
 *  configuracion.ts para las tres alternativas y sus compromisos.
 */

import { IDENTIFICACION } from './configuracion';

/**
 * Las "marcas de acento" de Unicode.
 *
 * ¿Que es esto y por que esta escrito de una forma tan rara?
 * ----------------------------------------------------------
 * En Unicode, la letra "ó" se puede guardar de DOS formas distintas:
 *
 *   1. Como un solo caracter: "ó"        (forma compuesta, se llama NFC)
 *   2. Como dos caracteres: "o" + tilde  (forma descompuesta, se llama NFD)
 *
 * Las dos se ven IGUAL en pantalla, pero para la computadora son diferentes.
 * Es la causa de un bug clasico: dos textos que se ven identicos y el
 * programa insiste en que no son iguales.
 *
 * Para quitar acentos, el truco es pasar todo a la forma 2 (que separa la
 * letra de su acento) y luego borrar los acentos sueltos. Esos acentos
 * sueltos viven en el rango de Unicode que va del numero 0x0300 al 0x036F.
 *
 * ¿Y por que no escribirlos directamente en la expresion regular?
 * Porque son caracteres INVISIBLES. Si los pegaras aqui, verias los corchetes
 * vacios y nadie entenderia que hace la funcion. Peor: cualquier editor o
 * herramienta podria "limpiarlos" al guardar y romper esto en silencio.
 *
 * Por eso se construye con `String.fromCharCode`, que convierte un numero en
 * su caracter. Asi los numeros quedan a la vista y el codigo se puede leer.
 *
 * (`0x` al inicio significa que el numero esta en hexadecimal, que es como
 * Unicode numera sus caracteres.)
 */
const MARCAS_DE_ACENTO = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g',
);

/**
 * Quita los acentos de un texto.
 *
 *     "Gómez"  ->  "Gomez"
 *     "Muñoz"  ->  "Munoz"
 *     "Ibáñez" ->  "Ibanez"
 *
 * OJO con la enie: la "ñ" NO es una "n" con acento, es una letra propia del
 * espanol. Pero Unicode la descompone igual que las demas, asi que "Muñoz"
 * se convierte en "munoz". Para un nombre de usuario eso es justo lo que
 * queremos: la enie no existe en muchos teclados.
 */
export function quitarAcentos(texto: string): string {
  return texto.normalize('NFD').replace(MARCAS_DE_ACENTO, '');
}

/**
 * Genera el nombre de usuario a partir del nombre y el apellido paterno.
 *
 *     generarUsuario('Dalton Akenaton', 'Gomez')  ->  'dgomez'
 *     generarUsuario('María José', 'Ibáñez')      ->  'mibanez'
 *     generarUsuario('Juan', 'De la Cruz')        ->  'jdelacruz'
 *
 * Devuelve `null` si no hay datos suficientes. Quien lo llame decide que hacer
 * en ese caso (el panel pedira que se escriba a mano).
 */
export function generarUsuario(nombre: string, apellidoPaterno: string): string | null {
  // Si el empleado tiene dos nombres ("Dalton Akenaton"), usamos solo el
  // primero: la inicial del segundo no aporta y alarga el usuario.
  const primerNombre = quitarAcentos(nombre.trim()).split(/\s+/)[0] ?? '';

  // El apellido puede traer espacios ("De la Cruz"). Se quitan todos, porque
  // un nombre de usuario con espacios es un dolor de cabeza en todos lados.
  const apellido = quitarAcentos(apellidoPaterno.trim()).replace(/\s+/g, '');

  if (primerNombre.length === 0 || apellido.length === 0) return null;

  const usuario = (primerNombre[0] + apellido).toLowerCase();

  // Solo letras y numeros. Limpia apostrofes y guiones de apellidos como
  // "O'Brien" o "Sanchez-Lopez".
  const limpio = usuario.replace(/[^a-z0-9]/g, '');

  return limpio.length > 0 ? limpio : null;
}

/**
 * Si dos empleados generan el mismo usuario, hay que desempatar.
 *
 * Con 5 empleados es casi imposible, pero "casi imposible" no es "imposible",
 * y el dia que pase el sistema no puede quedarse trabado: dos personas con el
 * mismo usuario significa que una de las dos no puede checar.
 *
 *     dgomez ya existe  ->  dgomez2
 *     dgomez2 tambien   ->  dgomez3
 *
 * Se agrega un numero al final, que es lo que hace todo el mundo y lo que la
 * gente entiende sin que nadie se lo explique. La alternativa (meter la
 * inicial del segundo apellido: "dgomeza") produce usuarios que nadie
 * recuerda, que es justo el problema que estamos evitando.
 */
export function desempatarUsuario(usuarioBase: string, yaUsados: readonly string[]): string {
  const ocupados = new Set(yaUsados.map((u) => u.toLowerCase()));

  if (!ocupados.has(usuarioBase)) return usuarioBase;

  let sufijo = 2;
  while (ocupados.has(`${usuarioBase}${sufijo}`)) sufijo++;

  return `${usuarioBase}${sufijo}`;
}

/**
 * Como debe verse un nombre de usuario valido.
 *
 *   ^[a-z]        empieza con letra (no con numero: "2dgomez" confunde)
 *   [a-z0-9.]*    despues: letras, numeros o punto
 *   $             y nada mas
 *
 * NO se permiten mayusculas. Asi "DGomez" y "dgomez" no pueden existir como
 * dos usuarios distintos — ese es un error clasico que termina con dos
 * cuentas para la misma persona y la asistencia partida entre las dos.
 *
 * El largo se valida aparte, con los valores de la configuracion central.
 */
export const PATRON_USUARIO = /^[a-z][a-z0-9.]*$/;

/**
 * Limpia lo que el empleado teclea antes de compararlo.
 *
 * Si escribe " DGomez " con mayuscula y espacios de mas, igual debe entrar.
 * Ser estricto aqui no aporta seguridad: solo deja gente fuera a las 6 AM.
 * La seguridad la da el PIN, y sobre todo la foto.
 */
export function normalizarUsuarioTecleado(texto: string): string {
  return quitarAcentos(texto).trim().toLowerCase();
}

// ============================================================================
//  NUMERO DE EMPLEADO  (20-10-2026)
// ============================================================================
//  Los de la universidad pueden llevar letras ("A12345"). Para que "a12345"
//  y "A12345" sean el mismo, se guardan y se comparan en MAYUSCULAS y sin
//  espacios a los lados. Lo usan el panel (al guardar) y el kiosco (al buscar
//  a quien teclea): si cada uno lo hiciera a su manera, un dia no coincidirian.

/**
 * "  a12345 " -> "A12345". Los espacios de EN MEDIO se quedan, y entonces el
 * numero no pasa la validacion: "no tiene" no debe guardarse como "NOTIENE".
 */
export function normalizarNumeroEmpleado(texto: string): string {
  return texto.trim().toUpperCase();
}

/**
 * ¿Es un numero de empleado que se puede teclear en el kiosco? Letras sin
 * acento, digitos y guion, con el largo de IDENTIFICACION. Recibe el texto
 * YA normalizado.
 */
export function numeroDeEmpleadoValido(numero: string): boolean {
  return (
    /^[A-Z0-9-]+$/.test(numero) &&
    numero.length >= IDENTIFICACION.largoNumeroEmpleadoMinimo &&
    numero.length <= IDENTIFICACION.largoNumeroEmpleadoMaximo
  );
}
