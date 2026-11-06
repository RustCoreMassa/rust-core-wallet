import { EnvironmentProviders, Provider } from '@angular/core';
import { RouterFeatures } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { APP_PLATFORM, SWAP_AVAILABLE } from '../app/core/platform/app-platform';
import { MOBILE_ONLY } from '../app/core/platform/device';
import { MOVED_TO } from '../app/core/platform/gateway';

/*
 * The iOS / Android apps' replacement for src/app/platform-providers.ts
 * (angular.json → configurations → "native" → fileReplacements). One web bundle runs inside
 * both native shells (Capacitor: ios/, later android/), served from the files packed into the
 * app — never loaded from DeWeb or any server.
 *
 * Still at the web defaults, to be replaced before any store release:
 * - LOCAL_STORE: the web view's localStorage, which iOS may clear when the phone runs low on
 *   space — the vault moves to the Keychain (Android: Keystore).
 * - SESSION_KEY_STORE / auto-lock: the web behaviour (15 min idle, hidden time counts).
 */

// 'web' when the native bundle is opened in a browser (development, `npm run smoke:native`):
// it then poses as the iOS app.
const os = Capacitor.getPlatform();

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
];
