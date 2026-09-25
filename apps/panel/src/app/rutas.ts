import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes } from '@angular/router';
import { Sesion } from './servicios/sesion';

/**
 * Sin sesion de administrador, a la pantalla de entrada. Es comodidad, no
 * seguridad: la seguridad esta en la base (RLS), que sin sesion no entrega
 * nada aunque alguien escriba la direccion a mano.
 */
const requiereSesion: CanActivateFn = async () => {
  // Los dos `inject` ANTES del `await`: despues de esperar, Angular ya no
  // deja pedir nada (error NG0203).
  const sesion = inject(Sesion);
  const router = inject(Router);
  await sesion.iniciar();
  return sesion.admin() ? true : router.parseUrl('/entrar');
};

/**
 * Con contrasena temporal, solo se puede estar en Mi cuenta hasta cambiarla.
 * Asi una contrasena que alguien mas vio (el jefe que la dio) no se queda.
 */
const contrasenaPropia: CanActivateFn = (_ruta, estado) => {
  const sesion = inject(Sesion);
  const router = inject(Router);
  return !sesion.debeCambiarContrasena() || estado.url.startsWith('/mi-cuenta') ? true : router.parseUrl('/mi-cuenta');
};

/** Pantallas solo para el rol admin (la base tambien lo exige). */
const soloAdmin: CanActivateFn = () => {
  const sesion = inject(Sesion);
  const router = inject(Router);
  return sesion.esAdmin() ? true : router.parseUrl('/asistencia');
};

export const RUTAS: Routes = [
  { path: 'entrar', loadComponent: () => import('./paginas/entrar').then((m) => m.Entrar) },
  {
    path: '',
    canActivate: [requiereSesion],
    canActivateChild: [contrasenaPropia],
    loadComponent: () => import('./paginas/marco').then((m) => m.Marco),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'asistencia' },
      { path: 'asistencia', loadComponent: () => import('./paginas/asistencia').then((m) => m.Asistencia) },
      { path: 'reportes', loadComponent: () => import('./paginas/reportes').then((m) => m.Reportes) },
      { path: 'empleados', loadComponent: () => import('./paginas/empleados').then((m) => m.Empleados) },
      { path: 'horarios', loadComponent: () => import('./paginas/horarios').then((m) => m.Horarios) },
      { path: 'ausencias', loadComponent: () => import('./paginas/ausencias').then((m) => m.Ausencias) },
      { path: 'kioscos', loadComponent: () => import('./paginas/kioscos').then((m) => m.Kioscos) },
      { path: 'configuracion', loadComponent: () => import('./paginas/configuracion').then((m) => m.Configuracion) },
      { path: 'accesos', canActivate: [soloAdmin], loadComponent: () => import('./paginas/accesos').then((m) => m.Accesos) },
      { path: 'bitacora', loadComponent: () => import('./paginas/bitacora').then((m) => m.Bitacora) },
      { path: 'mi-cuenta', loadComponent: () => import('./paginas/mi-cuenta').then((m) => m.MiCuenta) },
    ],
  },
  { path: '**', redirectTo: '' },
];
