import { InjectionToken } from '@angular/core';

/**
 * What unlocks the vault. The web app (a phone) keeps a 6-digit PIN, quick to type at every
 * unlock. The browser extension asks for a password: a copied vault can be attacked offline,
 * where a PIN's million combinations fall fast and a desktop browser's storage is a common
 * malware target. Both feed the same PBKDF2 → AES-GCM vault (CryptoVault).
 */
export type UnlockSecret = 'pin' | 'password';

export const UNLOCK_SECRET = new InjectionToken<UnlockSecret>('UNLOCK_SECRET', {
  providedIn: 'root',
  factory: () => 'pin',
});

/** How the UI names it: "Enter your PIN" / "Enter your password". */
export function secretNoun(kind: UnlockSecret): string {
  return kind === 'pin' ? 'PIN' : 'password';
}
