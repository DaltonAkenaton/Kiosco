/**
 * ============================================================================
 *  A QUE SUPABASE SE CONECTA EL PANEL  (el publicado en Cloudflare)
 * ============================================================================
 *
 *  VACIO a proposito hasta que exista la cuenta de produccion (se decidio
 *  conectar las cuentas al final, ver docs/curso/estado-actual.md). Con los
 *  campos vacios, el panel lo dice en pantalla en vez de fallar raro.
 *
 *  Cuando exista el proyecto: Supabase -> Project Settings -> API. Copiar la
 *  "Project URL" y la llave "anon public". NUNCA la `service_role`.
 */
export const ENTORNO = {
  produccion: true,
  supabaseUrl: '',
  supabaseLlavePublica: '',
};
