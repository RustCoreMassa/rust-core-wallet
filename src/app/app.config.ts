import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { MASSA_PROVIDER } from './core/services/massa-provider';
import { Web3MassaProvider } from './core/services/web3-massa-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Swap this single binding for a `Web3MassaProvider` (backed by
    // `@massalabs/massa-web3`) to go from mock data to a live chain —
    // nothing else in the app depends on the concrete implementation.
    { provide: MASSA_PROVIDER, useClass: Web3MassaProvider },
    // provideZonelessChangeDetection()
  ],
};
