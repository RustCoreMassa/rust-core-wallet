import { InjectionToken, Signal } from '@angular/core';

/**
 * Whether the browser lets the extension's dApp scripts run on websites. Without it, sites
 * never see window.rustcore and can't connect. Firefox lets users turn it off on the
 * extension's page; Chromium browsers under "Site access" (docs/DAPP-CONNECTION.md).
 */
export interface SiteAccess {
  /** true/false once known; null while checking or where the browser can't tell. */
  readonly granted: Signal<boolean | null>;
  /** Asks the browser for access. Must run straight from a click (the browser's rule). */
  request(): Promise<boolean>;
}

/** `null` in the web app, which has no dApp connections. */
export const SITE_ACCESS = new InjectionToken<SiteAccess | null>('SITE_ACCESS', {
  providedIn: 'root',
  factory: () => null,
});
