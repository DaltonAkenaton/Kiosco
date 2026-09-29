# Panel administrativo

La página web desde la que el jefe revisa la asistencia y administra el sistema
desde su oficina. Angular + Supabase (Auth y RLS). Publicado en Cloudflare
(<https://panel.mi-cuenta.workers.dev>); en desarrollo corre contra
el Supabase local.

## Cómo verlo en tu computadora

```bash
npx supabase start          # la base local (necesita Docker)
npm run supabase:aplicar    # migraciones + datos de prueba (seed.sql)
npm run panel:servir        # el panel en http://localhost:4300
```

Entra con **`jefe@prueba.local` / `panel-de-prueba`** (sólo existe en local).

## Qué tiene

| Sección | Qué se hace | Quién |
|---|---|---|
| Asistencia | Tabla de registros con filtros (fechas, empleado, kiosco, revisión). Estado de la foto, sin la foto. Registrar a mano y corregir (anular o cambiar tipo). | admin y supervisor |
| Reportes | A tiempo, retardos, faltas, horas: resumen por persona y día por día. Descargar para Excel. | admin y supervisor |
| Empleados | Alta (el sistema da el PIN), corregir datos, PIN nuevo, baja y reactivación, importar lista de Excel (CSV), derechos ARCO (exportar sus datos, suprimirlos) | admin (supervisor sólo ve) |
| Horarios | Turnos y el horario de cada persona (días y horas propias por día) | admin (supervisor sólo ve) |
| Ausencias | Vacaciones, incapacidades, permisos; días festivos | registrar: admin y supervisor; quitar: admin |
| Kioscos | Estado de cada kiosco y alertas; dar de alta (código de 8 caracteres) y de baja | admin (supervisor sólo ve) |
| Configuración | Las reglas del sistema, con su rango permitido | admin (supervisor sólo ve) |
| Accesos | Quién entra al panel: dar acceso (contraseña temporal), cambiar rol, quitar acceso | sólo admin |
| Bitácora | Quién cambió qué, cuándo y por qué | sólo admin |
| Mi cuenta | Contraseña del panel y usuario/contraseña del modo administrador del kiosco | cada quien |

Cada acción que cambia algo pide **motivo** y pasa por una función de la base
(migración 0015) que revisa el rol. El panel nunca escribe directo en las
tablas. Ver D-033.

## Pruebas

```bash
npm run panel:probar                     # usa el panel en una ventana oculta
npm run panel:probar -- C:\capturas      # además guarda una captura de cada pantalla
```

Necesita el Supabase local y `npm run panel:servir` corriendo.

## Para publicarlo

La GitHub Action "Publicar el panel" (`.github/workflows/panel-cloudflare.yml`)
lo arma con los secretos `PANEL_SUPABASE_URL` y `PANEL_SUPABASE_LLAVE_PUBLICA`
(la **publishable/anon**, nunca la secreta: si se pega esa, la compilación se
detiene) y lo sube a Cloudflare con `wrangler` (`wrangler.jsonc`, cabeceras en
`public/_headers`). `escribir-entorno.mjs` arma `entorno.produccion.ts`.
Paso a paso: [manual técnico, "Publicar el panel"](../../docs/manual-tecnico.md#publicar-el-panel).
