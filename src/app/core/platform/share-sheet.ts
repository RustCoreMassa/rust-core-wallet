import { InjectionToken } from '@angular/core';

/** The phone's own share menu (Messages, Mail, Telegram…) — the iOS / Android apps (src/native). */
export interface ShareSheet {
  /** Resolves once the menu is closed, whether or not something was shared. */
  share(text: string): Promise<void>;
}

/** `null` in the web app and the extension: no Share button there. */
export const SHARE_SHEET = new InjectionToken<ShareSheet | null>('SHARE_SHEET', {
  providedIn: 'root',
  factory: () => null,
});
