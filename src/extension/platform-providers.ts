/// <reference types="chrome" />
import { EnvironmentProviders, Provider, provideAppInitializer } from '@angular/core';
import { RouterFeatures, withHashLocation } from '@angular/router';
import { APP_PLATFORM, EXTENSION_VIEWS, ExtensionViews } from '../app/core/platform/app-platform';
import { LOCAL_STORE, SESSION_STORE } from '../app/core/platform/app-storage';
import { MOBILE_ONLY, isMobileDevice, readDeviceSignals } from '../app/core/platform/device';
import { SESSION_KEY_STORE } from '../app/core/services/session-key-store';
import { canOpenView, detectViewApis, viewFromUrl } from './browser-views';
import { ChromeSessionKeyStore } from './chrome-session-key-store';
import { ChromeStorageArea } from './chrome-storage-area';

/*
 * The browser extension's replacement for src/app/platform-providers.ts
 * (angular.json → configurations → "extension" → fileReplacements).
 */

const localArea = new ChromeStorageArea(chrome.storage.local);
const sessionArea = new ChromeStorageArea(chrome.storage.session);

// The same page runs as the toolbar popup (index.html), the side panel
// (Chrome side_panel / Firefox sidebar_action: ?view=side-panel) and a
// full-screen tab (?view=tab). Styles key off html[data-view] and
// html[data-device] — see views.scss.
const current = viewFromUrl(location.search);
const isMobile = isMobileDevice(readDeviceSignals());
document.documentElement.dataset['view'] = current;
// On a phone (Firefox for Android) the popup already fills the screen.
document.documentElement.dataset['device'] = isMobile ? 'mobile' : 'desktop';
const apis = detectViewApis(isMobile);

// Both side-panel APIs open only straight from a click, so nothing may be
// awaited before calling them: Chrome's window id is looked up in advance
// (app initializer below).
let windowId: number | undefined;
const views: ExtensionViews = {
  current,
  canOpen: (view) => canOpenView(view, apis),
  open: (view) => {
    let opened: Promise<unknown>;
    if (view === 'tab') {
      opened = chrome.tabs.create({ url: chrome.runtime.getURL('index.html?view=tab') });
    } else if (apis.sidePanel && windowId !== undefined) {
      opened = apis.sidePanel.open({ windowId });
    } else if (apis.sidebarAction) {
      opened = apis.sidebarAction.open();
    } else {
      opened = Promise.reject(new Error('No side panel in this browser'));
    }
    opened
      .then(() => current === 'popup' && window.close())
      .catch((err) => console.warn(`Opening the ${view} view failed`, err));
  },
};

// The popup is always opened at index.html, and an extension has no
// server to fall back to it — so routes live in the hash.
export const routerFeatures: RouterFeatures[] = [withHashLocation()];

export const platformProviders: (Provider | EnvironmentProviders)[] = [
  // The app reads storage synchronously; chrome.storage is async — load it first.
  provideAppInitializer(async () => {
    await Promise.all([localArea.load(), sessionArea.load()]);
    if (apis.sidePanel && current !== 'side-panel') {
      windowId = await chrome.windows
        .getCurrent()
        .then((w) => w.id)
        .catch(() => undefined);
    }
  }),
  { provide: LOCAL_STORE, useValue: localArea },
  { provide: SESSION_STORE, useValue: sessionArea },
  {
    provide: SESSION_KEY_STORE,
    useValue: new ChromeSessionKeyStore(chrome.storage.session, chrome.alarms),
  },
  // Desktop browsers too: no mobile-only gate, no service worker, no install banner.
  { provide: MOBILE_ONLY, useValue: false },
  { provide: APP_PLATFORM, useValue: 'extension' },
  { provide: EXTENSION_VIEWS, useValue: views },
];
