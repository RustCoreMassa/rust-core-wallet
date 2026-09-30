/// <reference types="chrome" />
import { EnvironmentProviders, Provider, provideAppInitializer } from '@angular/core';
import { RouterFeatures, withHashLocation } from '@angular/router';
import { APP_PLATFORM } from '../app/core/platform/app-platform';
import { LOCAL_STORE, SESSION_STORE } from '../app/core/platform/app-storage';
import { MOBILE_ONLY } from '../app/core/platform/device';
import { SESSION_KEY_STORE } from '../app/core/services/session-key-store';
import { ChromeSessionKeyStore } from './chrome-session-key-store';
import { ChromeStorageArea } from './chrome-storage-area';

/*
 * The browser extension's replacement for src/app/platform-providers.ts
 * (angular.json → configurations → "extension" → fileReplacements).
 */

const localArea = new ChromeStorageArea(chrome.storage.local);
const sessionArea = new ChromeStorageArea(chrome.storage.session);

// The popup is always opened at index.html, and an extension has no
// server to fall back to it — so routes live in the hash.
export const routerFeatures: RouterFeatures[] = [withHashLocation()];

export const platformProviders: (Provider | EnvironmentProviders)[] = [
  // The app reads storage synchronously; chrome.storage is async — load it first.
  provideAppInitializer(async () => {
    await Promise.all([localArea.load(), sessionArea.load()]);
  }),
  { provide: LOCAL_STORE, useValue: localArea },
  { provide: SESSION_STORE, useValue: sessionArea },
  {
    provide: SESSION_KEY_STORE,
    useValue: new ChromeSessionKeyStore(chrome.storage.session, chrome.alarms),
  },
  // A desktop browser: no mobile-only gate, no service worker, no install banner.
  { provide: MOBILE_ONLY, useValue: false },
  { provide: APP_PLATFORM, useValue: 'extension' },
];
