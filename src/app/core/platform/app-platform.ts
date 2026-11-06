import { InjectionToken } from '@angular/core';

/**
 * Which build is running: the web app (DeWeb), the browser extension's popup, or the
 * iOS / Android app (one web bundle inside both native shells — see src/native).
 */
export type AppPlatform = 'web' | 'extension' | 'ios' | 'android';

/**
 * Whether this build offers token swaps (Dusa). Off in the iOS / Android apps: the app stores
 * treat in-app crypto exchange as a licensed service (App Store guideline 3.1.5(iii)), so the
 * store builds ship without it. A build-time choice — never switched remotely.
 */
export const SWAP_AVAILABLE = new InjectionToken<boolean>('SWAP_AVAILABLE', {
  providedIn: 'root',
  factory: () => true,
});

export const APP_PLATFORM = new InjectionToken<AppPlatform>('APP_PLATFORM', {
  providedIn: 'root',
  factory: () => 'web',
});

/**
 * Where the extension's page is showing: the toolbar popup (fixed 380×600),
 * Chrome's side panel (full height), a browser tab (full screen, like
 * MetaMask's "Expand view"), or the window that asks the user to approve a
 * dApp's request (opened by the background worker, never by the user).
 */
export type ExtensionView = 'popup' | 'side-panel' | 'tab' | 'approve';

/** The views the user can open from Settings. */
export type OpenableView = 'side-panel' | 'tab';

export interface ExtensionViews {
  readonly current: ExtensionView;
  /** Whether this browser offers `view` (no side panel in Safari or on phones, say). */
  canOpen(view: OpenableView): boolean;
  /** Opens the app in another view; the popup then closes. Must run from a click. */
  open(view: OpenableView): void;
}

/** `null` in the web app — it has only the one view. */
export const EXTENSION_VIEWS = new InjectionToken<ExtensionViews | null>('EXTENSION_VIEWS', {
  providedIn: 'root',
  factory: () => null,
});
