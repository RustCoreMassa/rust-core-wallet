/// <reference types="chrome" />
import { EnvironmentProviders, Provider, provideAppInitializer } from '@angular/core';
import { RouterFeatures, withHashLocation } from '@angular/router';
import { APP_PLATFORM, SIDE_PANEL, SidePanel } from '../app/core/platform/app-platform';
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

// The same page runs as the toolbar popup and as the side panel (manifest →
// side_panel.default_path adds ?view=side-panel). The popup has a fixed size,
// the side panel fills the browser's height — see popup.scss.
const inSidePanel = new URLSearchParams(location.search).get('view') === 'side-panel';
document.documentElement.classList.toggle('side-panel', inSidePanel);

// Chrome opens a side panel only straight from a click, so the window is
// looked up in advance (app initializer below), not after the click.
let windowId: number | undefined;
const sidePanel: SidePanel = {
  open: () => {
    if (windowId === undefined) return;
    chrome.sidePanel
      .open({ windowId })
      .then(() => window.close())
      .catch((err) => console.warn('Opening the side panel failed', err));
  },
};

// The popup is always opened at index.html, and an extension has no
// server to fall back to it — so routes live in the hash.
export const routerFeatures: RouterFeatures[] = [withHashLocation()];

export const platformProviders: (Provider | EnvironmentProviders)[] = [
  // The app reads storage synchronously; chrome.storage is async — load it first.
  provideAppInitializer(async () => {
    await Promise.all([localArea.load(), sessionArea.load()]);
    if (!inSidePanel) windowId = (await chrome.windows.getCurrent()).id;
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
  { provide: SIDE_PANEL, useValue: inSidePanel ? null : sidePanel },
];
