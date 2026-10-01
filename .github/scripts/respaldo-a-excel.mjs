/**
 * ============================================================================
 *  EL RESPALDO EN UN EXCEL DE VERDAD (.xlsx), UNA HOJA POR TABLA
 * ============================================================================
 *
 *  Lo corre "Respaldo de la base de datos" despues de sacar un CSV por tabla.
 *
 *  Por que: el Excel en espanol espera PUNTO Y COMA y el CSV de PostgreSQL usa
 *  comas, asi que al abrirlo metia todo en una sola columna (lo encontro el
 *  autor, 01-10-2026; el mismo problema que el panel ya habia tenido). Un
 *  .xlsx se ve bien en cualquier Excel, sin importar el idioma.
 *
 *  Reusa el mismo escritor de Excel del panel (escribir-excel.ts, sin
 *  librerias): Node 24 lo ejecuta directo, quitandole los tipos.
 *
 *  Uso: node respaldo-a-excel.mjs <carpeta-con-csv> <archivo.xlsx>
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armarExcel } from '../../apps/panel/src/app/servicios/escribir-excel.ts';

const [carpeta, salida] = process.argv.slice(2);
if (!carpeta || !salida) {
  console.error('Uso: node respaldo-a-excel.mjs <carpeta-con-csv> <archivo.xlsx>');
  process.exit(1);
}

/** CSV como lo escribe PostgreSQL (comillas dobles, "" para una comilla, saltos de linea dentro de comillas). */
function leerCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// Las tablas que mas se consultan, primero; las demas, en orden alfabetico.
const PRIMERO = ['marcas', 'empleados', 'incidencias', 'correcciones', 'turnos', 'asignaciones_turno'];
const nombres = readdirSync(carpeta).filter((n) => n.endsWith('.csv')).map((n) => n.slice(0, -4));
nombres.sort((a, b) => {
  const pa = PRIMERO.indexOf(a), pb = PRIMERO.indexOf(b);
  if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  return a.localeCompare(b);
});

const hojas = nombres.map((nombre) => {
  const filas = leerCsv(readFileSync(join(carpeta, `${nombre}.csv`), 'utf8').replace(/^﻿/, ''));
  // Una tabla vacia igual lleva sus titulos (PostgreSQL los escribe siempre).
  return { nombre: nombre.slice(0, 31), filas: filas.length ? filas : [['(vacia)']] };
});

writeFileSync(salida, armarExcel(hojas));
console.log(`${salida}: ${hojas.length} hojas (${hojas.map((h) => `${h.nombre} ${h.filas.length - 1}`).join(', ')})`);
