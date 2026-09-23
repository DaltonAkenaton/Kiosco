import { bootstrapApplication } from '@angular/platform-browser';
import { configuracionDeLaApp } from './app/app.config';
import { Raiz } from './app/raiz';

bootstrapApplication(Raiz, configuracionDeLaApp).catch((fallo) => console.error(fallo));
