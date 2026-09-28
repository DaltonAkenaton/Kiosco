/**
 * ============================================================================
 *  ¿CUANDO FUE LA ULTIMA VEZ QUE ALGUIEN USO EL KIOSCO?
 * ============================================================================
 *
 *  Lo necesita la instalacion automatica de versiones nuevas
 *  (actualizaciones.ts): el kiosco se reinicia para instalar, y eso NUNCA
 *  debe pasar mientras alguien esta a media identificacion.
 *
 *  "Uso" es cualquier tecla sobre la ventana y cualquier paso del registro
 *  (elegir nombre, PIN, confirmar). Se anota solo la hora: nada de quien ni
 *  que tecleo.
 */

let ultimoUsoMs = Date.now();

export function anotarUso(): void {
  ultimoUsoMs = Date.now();
}

export function minutosSinUso(): number {
  return (Date.now() - ultimoUsoMs) / 60_000;
}
