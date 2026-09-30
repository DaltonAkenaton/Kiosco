/**
 * ============================================================================
 *  CONFIGURA EL ACCESO AL PANEL (Supabase Auth) SIN ENTRAR A supabase.com
 * ============================================================================
 *
 *  Lo corre "Publicar en Supabase" despues de subir migraciones y funciones.
 *  Hace por la API de administracion de Supabase lo que antes eran clics en
 *  el tablero (manual tecnico, "Correo del panel"), para que PRODUCCION quede
 *  igual que PRUEBAS sin que nadie tenga que acordarse de nada:
 *
 *    1. Nadie se registra solo: los accesos los da un administrador.
 *    2. La direccion del panel, a donde lleva el enlace del correo de
 *       "olvide mi contrasena".
 *    3. El texto de ese correo en espanol (supabase/plantillas/).
 *    4. El envio con el Gmail del sistema, SOLO si existen los secretos
 *       CORREO_USUARIO y CORREO_CONTRASENA_APP. Sin ellos no se toca lo que
 *       ya este puesto (en pruebas se configuro a mano).
 *
 *  Variables (las pone el workflow): SUPABASE_ACCESS_TOKEN, PROYECTO_REF,
 *  DESTINO, AMBIENTE, SUBDOMINIO_CLOUDFLARE y, opcionales, CORREO_*.
 */

import { readFileSync } from 'node:fs';

const {
  SUPABASE_ACCESS_TOKEN: token,
  PROYECTO_REF: ref,
  DESTINO: destino,
  AMBIENTE: ambiente,
  SUBDOMINIO_CLOUDFLARE: subdominio,
  CORREO_USUARIO: correo,
  CORREO_CONTRASENA_APP: contrasenaApp,
} = process.env;

if (!token || !ref || !destino || !subdominio) {
  console.error('::error::Faltan variables (SUPABASE_ACCESS_TOKEN, PROYECTO_REF, DESTINO o SUBDOMINIO_CLOUDFLARE).');
  process.exit(1);
}

// `panel` sigue a AMBIENTE; `panel-pruebas` es siempre de pruebas.
const panel = `https://panel.${subdominio}.workers.dev`;
const panelPruebas = `https://panel-pruebas.${subdominio}.workers.dev`;

let sitio;
let permitidas;
if (destino === 'produccion') {
  sitio = panel;
  permitidas = [`${panel}/**`];
} else if (ambiente === 'pruebas') {
  // Mientras no se enciende produccion, `panel` tambien es de pruebas.
  sitio = panel;
  permitidas = [`${panel}/**`, `${panelPruebas}/**`];
} else {
  sitio = panelPruebas;
  permitidas = [`${panelPruebas}/**`];
}

const cambios = {
  disable_signup: true,
  site_url: sitio,
  uri_allow_list: permitidas.join(','),
  mailer_subjects_recovery: 'Cambiar la contraseña del panel de asistencia',
  mailer_templates_recovery_content: readFileSync('supabase/plantillas/recuperar-contrasena.html', 'utf8'),
};

if (correo && contrasenaApp) {
  Object.assign(cambios, {
    smtp_admin_email: correo,
    smtp_sender_name: 'Control de Asistencia',
    smtp_host: 'smtp.gmail.com',
    smtp_port: '465',
    smtp_user: correo,
    smtp_pass: contrasenaApp,
  });
}

const respuesta = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(cambios),
});

if (!respuesta.ok) {
  // El texto de error de Supabase no lleva secretos; se muestra para diagnosticar.
  console.error(`::error::Supabase no acepto la configuracion de Auth (${respuesta.status}): ${(await respuesta.text()).slice(0, 300)}`);
  process.exit(1);
}

console.log(`Auth de ${destino}: registro abierto = no; panel = ${sitio}`);
console.log(`Direcciones permitidas: ${permitidas.join(', ')}`);
console.log(correo && contrasenaApp
  ? `Correo: se envia con ${correo}.`
  : 'Correo: sin secretos CORREO_*, se deja como estaba.');
