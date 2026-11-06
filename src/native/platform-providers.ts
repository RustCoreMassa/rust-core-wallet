import { EnvironmentProviders, Provider, inject, provideAppInitializer } from '@angular/core';
import { RouterFeatures } from '@angular/router';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { APP_PLATFORM, SWAP_AVAILABLE } from '../app/core/platform/app-platform';
import { LOCAL_STORE } from '../app/core/platform/app-storage';
import { MOBILE_ONLY } from '../app/core/platform/device';
import { MOVED_TO } from '../app/core/platform/gateway';
import { Toast } from '../app/core/services/toast';
import { VAULT_STORAGE_KEY } from '../app/core/services/vault-storage';
import { NativeStorageArea, NativeStorePlugin } from './native-storage-area';

/*
 * The iOS / Android apps' replacement for src/app/platform-providers.ts
 * (angular.json → configurations → "native" → fileReplacements). One web bundle runs inside
 * both native shells (Capacitor: ios/, later android/), served from the files packed into the
 * app — never loaded from DeWeb or any server.
 *
 * Still at the web defaults, to be replaced before any store release:
 * - SESSION_KEY_STORE / auto-lock: the web behaviour (15 min idle, hidden time counts).
 */

// 'web' when the native bundle is opened in a browser (development, `npm run smoke:native`):
// it then poses as the iOS app.
const os = Capacitor.getPlatform();

// The vault and device preferences: the Keychain (ios/App/App/NativeStorePlugin.swift). In a
// browser there is no native side — the web view's own storage stands in.
const nativeStore = Capacitor.isNativePlatform()
  ? new NativeStorageArea(registerPlugin<NativeStorePlugin>('NativeStore'), localStorage)
  : null;

/** Long enough to still be on screen after the lock page has moved on to Home. */
const WRITE_ERROR_TOAST_MS = 10_000;

// Routes stay in the path: Capacitor serves index.html for any path without a file extension.
export const routerFeatures: RouterFeatures[] = [];

export const platformProviders: (Provider | EnvironmentProviders)[] = [
  { provide: APP_PLATFORM, useValue: os === 'android' ? 'android' : 'ios' },
  // An installed app: no desktop gate (an iPad or a Mac running the iPhone app included),
  // no install banner (APP_PLATFORM isn't 'web'), no service worker (angular.json).
  { provide: MOBILE_ONLY, useValue: false },
  // Not served from a gateway, so there's no old address to move away from.
  { provide: MOVED_TO, useValue: null },
  // No exchange in the store apps (App Store guideline 3.1.5(iii)).
  { provide: SWAP_AVAILABLE, useValue: false },
  ...(nativeStore
    ? [
        { provide: LOCAL_STORE, useValue: nativeStore },
        // The app reads storage synchronously; the native store is async — load it first.
        provideAppInitializer(async () => {
          const toast = inject(Toast);
          nativeStore.onWriteError = (key) => {
            if (key === VAULT_STORAGE_KEY) {
              toast.show(
                "Your wallet couldn't be saved on this phone. Back up your private key now.",
                WRITE_ERROR_TOAST_MS,
              );
            }
          };
          await nativeStore.load();
        }),
      ]
    : []),
];
