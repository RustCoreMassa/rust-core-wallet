import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { MOBILE_ONLY } from './core/platform/device';
import { MASSA_PROVIDER } from './core/services/massa-provider';
import { Web3MassaProvider } from './core/services/web3-massa-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // The app only ever talks to MassaProvider; this binding picks the
    // massa-web3 implementation. (The app is zoneless — there's no zone.js.)
    { provide: MASSA_PROVIDER, useClass: Web3MassaProvider },
    // Installable app: caches the app's own files (never chain/explorer
    // calls). Production builds only — `ng serve` stays uncached.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Phone UI: refuse to run on desktop. The browser-extension build sets this to false.
    { provide: MOBILE_ONLY, useValue: true },
  ],
};
