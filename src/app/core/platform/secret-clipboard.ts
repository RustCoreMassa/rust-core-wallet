import { InjectionToken } from '@angular/core';
import { copySecret } from '../utils/secret-clipboard';

/** Copies a private key so that it doesn't stay in the clipboard (CLIPBOARD_CLEAR_MS). */
export interface SecretClipboard {
  copy(secret: string): Promise<void>;
}

/**
 * The web app and the extension write the clipboard, then empty it later from the page
 * (`copySecret` — best effort: only while the page is open). The iOS / Android apps hand the
 * secret to the system with an expiry instead, kept on this device only (src/native).
 */
export const SECRET_CLIPBOARD = new InjectionToken<SecretClipboard>('SECRET_CLIPBOARD', {
  providedIn: 'root',
  factory: () => ({ copy: (secret) => copySecret(secret) }),
});
