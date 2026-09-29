import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { MASSA_PROVIDER } from './core/services/massa-provider';
import { Web3MassaProvider } from './core/services/web3-massa-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // The app only ever talks to MassaProvider; this binding picks the
    // massa-web3 implementation. (The app is zoneless — there's no zone.js.)
    { provide: MASSA_PROVIDER, useClass: Web3MassaProvider },
  ],
};
