import { EnvironmentProviders, Provider, inject, provideAppInitializer } from '@angular/core';
import { RouterFeatures } from '@angular/router';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { APP_PLATFORM, SWAP_AVAILABLE } from '../app/core/platform/app-platform';
import { LOCAL_STORE } from '../app/core/platform/app-storage';
import { BIOMETRIC_UNLOCK } from '../app/core/platform/biometric-unlock';
import { MOBILE_ONLY } from '../app/core/platform/device';
import { MOVED_TO } from '../app/core/platform/gateway';
import { SECRET_CLIPBOARD } from '../app/core/platform/secret-clipboard';
import { Toast } from '../app/core/services/toast';
import { VAULT_STORAGE_KEY } from '../app/core/services/vault-storage';
import { BACKGROUND_LOCK_MS } from '../app/core/state/auto-lock';
import { APP_BACKGROUND_LOCK_MS } from '../app/core/utils/auto-lock-time';
import { CLIPBOARD_CLEAR_MS } from '../app/core/utils/secret-clipboard';
import { BiometricUnlockPlugin, NativeBiometricUnlock } from './native-biometric-unlock';
import { NativeStorageArea, NativeStorePlugin } from './native-storage-area';

/*
 * The iOS / Android apps' replacement for src/app/platform-providers.ts
 * (angular.json → configurations → "native" → fileReplacements). One web bundle runs inside
 * both native shells (Capacitor: ios/, later android/), served from the files packed into the
 * app — never loaded from DeWeb or any server.
 *
 * Locking: the web's rules (15 min idle, a lock in one window locks the others) plus a lock when
 * the app comes back after APP_BACKGROUND_LOCK_MS in the background; while it isn't active, the
 * native side covers the screen (ios/App/App/SceneDelegate.swift) so the app switcher's snapshot
 * shows no balances or addresses.
 */

// 'web' when the native bundle is opened in a browser (development, `npm run smoke:native`):
// it then poses as the iOS app.
const os = Capacitor.getPlatform();

// The vault and device preferences: the Keychain (ios/App/App/NativeStorePlugin.swift). In a
// browser there is no native side — the web view's own storage stands in.
const nativeStore = Capacitor.isNativePlatform()
  ? new NativeStorageArea(registerPlugin<NativeStorePlugin>('NativeStore'), localStorage)
  : null;

/** ios/App/App/SecretClipboardPlugin.swift: the system clears the copy, on this device only. */
interface SecretClipboardPlugin {
  copy(options: { text: string; seconds: number }): Promise<void>;
}

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
  { provide: BACKGROUND_LOCK_MS, useValue: APP_BACKGROUND_LOCK_MS },
  ...(nativeStore
    ? [
        { provide: LOCAL_STORE, useValue: nativeStore },
        // Face ID / Touch ID instead of typing the PIN (ios/App/App/BiometricUnlockPlugin.swift).
        {
          provide: BIOMETRIC_UNLOCK,
          useFactory: () =>
            new NativeBiometricUnlock(
              registerPlugin<BiometricUnlockPlugin>('BiometricUnlock'),
              nativeStore,
            ),
        },
        {
          provide: SECRET_CLIPBOARD,
          useFactory: () => {
            const plugin = registerPlugin<SecretClipboardPlugin>('SecretClipboard');
            return {
              copy: (secret: string) =>
                plugin.copy({ text: secret, seconds: CLIPBOARD_CLEAR_MS / 1000 }),
            };
          },
        },
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
