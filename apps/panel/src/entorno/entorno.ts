/**
 * ============================================================================
 *  A QUE SUPABASE SE CONECTA EL PANEL  (desarrollo)
 * ============================================================================
 *
 *  En desarrollo, el Supabase LOCAL (`npx supabase start`). Al compilar para
 *  publicar (`ng build`), Angular cambia este archivo por
 *  `entorno.produccion.ts` (ver `fileReplacements` en angular.json).
 *
 *  ¿No es peligroso tener la llave aqui? No: es la llave PUBLICA ("anon"), la
 *  que Supabase hace para ir en el navegador. Por si sola no deja ver nada:
 *  todas las tablas tienen RLS y exigen una sesion de administrador
 *  (CLAUDE.md 3.2). La llave peligrosa, `service_role`, NUNCA va en el panel.
 *
 *  Esta en particular es la llave de demostracion que trae TODO Supabase local:
 *  no sirve para nada fuera de tu computadora.
 */
export const ENTORNO = {
  produccion: false,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseLlavePublica:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};
