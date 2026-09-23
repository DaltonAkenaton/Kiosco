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

export const RUTAS: Routes = [
  { path: 'entrar', loadComponent: () => import('./paginas/entrar').then((m) => m.Entrar) },
  {
    path: '',
    canActivate: [requiereSesion],
    loadComponent: () => import('./paginas/marco').then((m) => m.Marco),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'asistencia' },
      { path: 'asistencia', loadComponent: () => import('./paginas/asistencia').then((m) => m.Asistencia) },
      { path: 'empleados', loadComponent: () => import('./paginas/empleados').then((m) => m.Empleados) },
      { path: 'kioscos', loadComponent: () => import('./paginas/kioscos').then((m) => m.Kioscos) },
      { path: 'configuracion', loadComponent: () => import('./paginas/configuracion').then((m) => m.Configuracion) },
      { path: 'bitacora', loadComponent: () => import('./paginas/bitacora').then((m) => m.Bitacora) },
      { path: 'mi-cuenta', loadComponent: () => import('./paginas/mi-cuenta').then((m) => m.MiCuenta) },
    ],
  },
  { path: '**', redirectTo: '' },
];
