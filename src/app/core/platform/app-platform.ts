import { InjectionToken } from '@angular/core';

/** Which build is running: the web app (DeWeb) or the browser extension's popup. */
export type AppPlatform = 'web' | 'extension';

export const APP_PLATFORM = new InjectionToken<AppPlatform>('APP_PLATFORM', {
  providedIn: 'root',
  factory: () => 'web',
});

/** The extension's full-height side panel, offered from its popup. */
export interface SidePanel {
  /** Opens the side panel and closes the popup. Must run from a click. */
  open(): void;
}

/** `null` wherever there's nothing to open: the web app, or already in the side panel. */
export const SIDE_PANEL = new InjectionToken<SidePanel | null>('SIDE_PANEL', {
  providedIn: 'root',
  factory: () => null,
});
