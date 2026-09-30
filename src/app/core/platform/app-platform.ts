import { InjectionToken } from '@angular/core';

/** Which build is running: the web app (DeWeb) or the browser extension's popup. */
export type AppPlatform = 'web' | 'extension';

export const APP_PLATFORM = new InjectionToken<AppPlatform>('APP_PLATFORM', {
  providedIn: 'root',
  factory: () => 'web',
});
