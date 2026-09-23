/**
 * ============================================================================
 *  EMPLEADOS DE PRUEBA
 * ============================================================================
 *
 *  SOLO EN DESARROLLO. En el kiosco instalado esto no corre nunca.
 *
 *  ¿Por que hace falta?
 *  --------------------
 *  Todavia no existe Supabase (bloque 4 del plan), asi que no hay de donde
 *  bajar el catalogo de empleados. Sin datos, no hay forma de probar que la
 *  verificacion del PIN funciona.
 *
 *  ¿Por que no dejarlos tambien en produccion "por si acaso"?
 *  ----------------------------------------------------------
 *  Porque serian cinco cuentas con PIN conocido dentro de un sistema de
 *  asistencia real. Alguien podria checar como "dgomez" con el PIN 1234 y
 *  quedaria registrado a nombre de una persona que existe.
 *
 *  El candado es `app.isPackaged`, el mismo que usa todo lo demas: no una
 *  variable de entorno, que cualquiera puede cambiar desde Windows.
 */

import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { generarUsuario } from '@kiosko/compartido';
import { buscarAdministrador, guardarAdministrador } from './repositorio-admin';
import { buscarPorUsuario, contarEmpleados, guardarEmpleado } from './repositorio-empleados';
import { hashearPin } from '../servicios/autenticacion';
import { leerCredencial } from '../servicios/credencial-kiosco';

/**
 * Personal de prueba.
 *
 * Son veinte, como los ~20 empleados reales que confirmo el cliente
 * (CLAUDE.md 1.1). Con menos, la pantalla de la lista no se parece a la de
 * verdad: con 5 cabe todo con un digito; con 20 hacen falta dos (D-026).
 *
 * Los nombres traen acentos y apellidos compuestos a proposito: asi se
 * comprueba que el generador de usuarios los limpia bien. Y ningun par
 * comparte inicial + apellido, para que cada uno tenga su usuario.
 */
/**
 * TODOS CON EL MISMO PIN, A PROPOSITO.
 *
 * Empezaron con PINes distintos (1234, 1111, 2222...) para que las pruebas
 * automatizadas pudieran comprobar que cada quien tiene el suyo. Pero al
 * probar la pantalla a mano —checar con cinco personas seguidas para ver como
 * se llena la tabla— recordar cinco PINes distintos estorba mas de lo que
 * aporta.
 *
 * Que sea el mismo NO debilita nada: estas cinco cuentas no existen en el
 * kiosco instalado (ver `app.isPackaged` mas abajo), y las pruebas que de
 * verdad verifican el PIN usan sus propios datos.
 */
const PIN_DE_PRUEBA = '1234';

const PERSONAL_DE_PRUEBA = [
  { nombre: 'Dalton Akenaton', paterno: 'Gomez', materno: 'Arellano', pin: PIN_DE_PRUEBA },
  { nombre: 'Maria Jose', paterno: 'Ibanez', materno: 'Ruiz', pin: PIN_DE_PRUEBA },
  { nombre: 'Juan', paterno: 'De la Cruz', materno: 'Mendez', pin: PIN_DE_PRUEBA },
  { nombre: 'Rosa', paterno: 'Munoz', materno: 'Salinas', pin: PIN_DE_PRUEBA },
  { nombre: 'Pedro', paterno: 'Sanchez', materno: 'Lopez', pin: PIN_DE_PRUEBA },
  { nombre: 'Ana Laura', paterno: 'Treviño', materno: 'Garza', pin: PIN_DE_PRUEBA },
  { nombre: 'Carlos Alberto', paterno: 'Hernandez', materno: 'Rios', pin: PIN_DE_PRUEBA },
  { nombre: 'Guadalupe', paterno: 'Martinez', materno: 'Olvera', pin: PIN_DE_PRUEBA },
  { nombre: 'Jose Luis', paterno: 'Ramirez', materno: 'Cantu', pin: PIN_DE_PRUEBA },
  { nombre: 'Leticia', paterno: 'Flores', materno: 'Villarreal', pin: PIN_DE_PRUEBA },
  { nombre: 'Miguel Angel', paterno: 'Torres', materno: 'Salazar', pin: PIN_DE_PRUEBA },
  { nombre: 'Norma Alicia', paterno: 'Castillo', materno: 'Peña', pin: PIN_DE_PRUEBA },
  { nombre: 'Oscar', paterno: 'Rodriguez', materno: 'Lara', pin: PIN_DE_PRUEBA },
  { nombre: 'Patricia', paterno: 'Vazquez', materno: 'Medina', pin: PIN_DE_PRUEBA },
  { nombre: 'Raul', paterno: 'Gonzalez', materno: 'Ochoa', pin: PIN_DE_PRUEBA },
  { nombre: 'Silvia', paterno: 'Moreno', materno: 'Aguilar', pin: PIN_DE_PRUEBA },
  { nombre: 'Tomas', paterno: 'Reyes', materno: 'Cavazos', pin: PIN_DE_PRUEBA },
  { nombre: 'Veronica', paterno: 'Luna', materno: 'Estrada', pin: PIN_DE_PRUEBA },
  { nombre: 'Yolanda', paterno: 'Perez', materno: 'Zamora', pin: PIN_DE_PRUEBA },
  { nombre: 'Francisco Javier', paterno: 'Ortiz', materno: 'Barrera', pin: PIN_DE_PRUEBA },
];

/**
 * Carga los empleados de prueba que FALTEN.
 *
 * Completa, no reemplaza: a quien ya existe (por su usuario) no se le toca,
 * asi no se pierden sus marcas ni se cambia su numero. Por eso una base de
 * desarrollo que venia con 5 recibe los otros 15 sin que haya que borrarla,
 * y la funcion se puede llamar en cada arranque sin pensarlo.
 */
export function sembrarEmpleadosDePrueba(): void {
  if (app.isPackaged) return;
  // Dado de alta, los empleados vienen de la nube (el Supabase local trae
  // los mismos 20, en supabase/seed.sql). Sembrar aqui los duplicaria con
  // otros ids.
  if (leerCredencial()) return;

  const ahora = new Date().toISOString();
  const usuariosCreados: string[] = [];

  for (const [indice, persona] of PERSONAL_DE_PRUEBA.entries()) {
    const usuario = generarUsuario(persona.nombre, persona.paterno);
    if (!usuario || buscarPorUsuario(usuario)) continue;

    guardarEmpleado({
      id: randomUUID(),
      usuario,
      // Numero de gafete inventado, para poder probar tambien el modo 'numero'.
      // El numero sale de la POSICION en la lista, no de cuantos se han
      // creado en esta vuelta: asi el numero de cada quien es siempre el
      // mismo, se siembre de una vez o en dos tandas.
      numeroEmpleado: String(1001 + indice),
      nombre: persona.nombre,
      apellidoPaterno: persona.paterno,
      apellidoMaterno: persona.materno,
      // Se guarda el HASH, nunca el PIN. Ni siquiera en datos de prueba:
      // las malas costumbres se copian solas al codigo de produccion.
      pinHash: hashearPin(persona.pin),
      pinTemporal: false,
      activo: true,
      actualizadoEn: ahora,
    });

    usuariosCreados.push(usuario);
  }

  if (usuariosCreados.length === 0) {
    console.info(`[semilla] ya estan los ${contarEmpleados()} empleados de prueba`);
    return;
  }
  console.info(`[semilla] ${usuariosCreados.length} empleados de prueba creados`);
  console.info('[semilla] ---------------------------------------------------');
  console.info('[semilla]  DATOS PARA PROBAR (solo en desarrollo)');

  /**
   * EXCEPCION CONSCIENTE a la regla "nunca registrar PINs en logs"
   * (CLAUDE.md seccion 16).
   *
   * Esa regla existe para proteger el PIN de PERSONAS REALES. Estos
   * empleados son inventados, viven solo en tu maquina de desarrollo, y sus
   * PINes ya estan escritos unas lineas mas arriba en este mismo archivo.
   * Imprimirlos no filtra nada que no este a la vista.
   *
   * Y no puede colarse a produccion: la funcion entera se corta al inicio si
   * `app.isPackaged` es verdadero.
   *
   * Se deja escrito el porque, igual que las excepciones de contraste del
   * tema: una regla que se rompe sin explicacion es una regla que a los tres
   * meses ya no la respeta nadie.
   */
  console.info(`[semilla]    todos con el PIN ${PIN_DE_PRUEBA}; nuevos: ${usuariosCreados.join(', ')}`);
  console.info('[semilla] ---------------------------------------------------');
}

/**
 * ============================================================================
 *  ADMINISTRADOR DE PRUEBA  (solo en desarrollo)
 * ============================================================================
 *
 *  En el kiosco real, las credenciales de administrador bajan de la nube con
 *  la sincronizacion (CLAUDE.md 5.2), igual que los PINes. Mientras no exista
 *  la sincronizacion (bloques 5 y 6), esta es la unica forma de entrar al modo
 *  administrador para probarlo.
 *
 *  Mismo candado que los empleados: `app.isPackaged`. En el .exe no existe.
 */
export const ADMIN_DE_PRUEBA = {
  usuario: 'admin',
  contrasena: 'admin-de-prueba',
  nombre: 'Administrador de prueba',
} as const;

export function sembrarAdministradorDePrueba(): void {
  if (app.isPackaged) return;
  if (buscarAdministrador(ADMIN_DE_PRUEBA.usuario)) return;

  guardarAdministrador({
    id: randomUUID(),
    usuario: ADMIN_DE_PRUEBA.usuario,
    nombre: ADMIN_DE_PRUEBA.nombre,
    // El hash, nunca la contrasena. Ni en datos de prueba.
    contrasenaHash: hashearPin(ADMIN_DE_PRUEBA.contrasena),
    rol: 'admin',
    activo: true,
  });

  // Misma excepcion consciente que con los PINes de prueba (ver arriba).
  console.info(
    `[semilla] administrador de prueba: ${ADMIN_DE_PRUEBA.usuario} / ${ADMIN_DE_PRUEBA.contrasena}` +
      '  (boton del engrane para entrar)',
  );
}
