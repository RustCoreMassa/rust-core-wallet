import { EnvironmentProviders, Provider, isDevMode } from '@angular/core';
import { RouterFeatures } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { MOBILE_ONLY } from './core/platform/device';

/*
 * What differs between the web app and the browser extension. This file is
 * the web app's; the extension build swaps it for
 * src/extension/platform-providers.ts (angular.json → "extension").
 * Everything left at its default here (storage, session keys, APP_PLATFORM)
 * is the web behaviour.
 */

export const routerFeatures: RouterFeatures[] = [];

export const platformProviders: (Provider | EnvironmentProviders)[] = [
  // Installable app: caches the app's own files (never chain/explorer
  // calls). Production builds only — `ng serve` stays uncached.
  provideServiceWorker('ngsw-worker.js', {
    enabled: !isDevMode(),
    registrationStrategy: 'registerWhenStable:30000',
  }),
  // Phone UI: refuse to run on desktop.
  { provide: MOBILE_ONLY, useValue: true },
];
