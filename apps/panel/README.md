# Panel del jefe

La página web desde la que el jefe revisa la asistencia y administra el sistema
desde su oficina. Angular + Supabase (Auth y RLS). Se publicará en Netlify
cuando exista la cuenta de producción; mientras tanto corre contra el Supabase
local.

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
| Asistencia | Tabla de registros con filtros (fechas, empleado, kiosco, revisión). Estado de la foto, sin la foto. Registrar a mano. | admin y supervisor |
| Empleados | Alta (el sistema da el PIN), corregir datos, PIN nuevo, baja y reactivación, importar lista de Excel (CSV) | admin (supervisor sólo ve) |
| Kioscos | Estado de cada kiosco y alertas; dar de alta (código de 8 caracteres) y de baja | admin (supervisor sólo ve) |
| Configuración | Las reglas del sistema, con su rango permitido | admin (supervisor sólo ve) |
| Bitácora | Quién cambió qué, cuándo y por qué | sólo admin |
| Mi cuenta | Contraseña del panel y usuario/contraseña del modo administrador del kiosco | cada quien |

Cada acción que cambia algo pide **motivo** y pasa por una función de la base
(migración 0015) que revisa el rol. El panel nunca escribe directo en las
tablas. Ver D-033.

## Pruebas

```bash
npm run panel:probar                     # usa el panel en una ventana oculta (19 comprobaciones)
npm run panel:probar -- C:\capturas      # además guarda una captura de cada pantalla
```

Necesita el Supabase local y `npm run panel:servir` corriendo.

## Para publicarlo (al final)

1. En `src/entorno/entorno.produccion.ts` poner la URL del proyecto de
   producción y su llave **anon** (nunca la `service_role`).
2. `npm run panel:compilar` deja la página en `apps/panel/dist`.
3. Subir esa carpeta a Netlify, con la regla de "todas las rutas a
   `index.html"` (es una aplicación de una sola página).
