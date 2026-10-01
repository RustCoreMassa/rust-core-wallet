import { InjectionToken } from '@angular/core';

/**
 * Keeps the unlocked session's vault key beyond the page that derived it.
 *
 * The web app keeps nothing (NO_SESSION_KEY_STORE): the key lives only in
 * AuthStore's memory and a reload asks for the PIN again. The extension's
 * popup is torn down every time it closes, so it keeps the key in
 * chrome.storage.session (memory only, never written to disk) until the
 * auto-lock timer ends — see src/extension/chrome-session-key-store.ts.
 */
export interface SessionKeyStore {
  /** When true, AuthStore derives an extractable key so `save` can keep it. */
  readonly keepsKey: boolean;
  save(key: CryptoKey): Promise<void>;
  /** `null` when there's no session to resume (never saved, locked or expired). */
  restore(): Promise<CryptoKey | null>;
  clear(): Promise<void>;
}

const NO_SESSION_KEY_STORE: SessionKeyStore = {
  keepsKey: false,
  save: async () => {},
  restore: async () => null,
  clear: async () => {},
};

export const SESSION_KEY_STORE = new InjectionToken<SessionKeyStore>('SESSION_KEY_STORE', {
  providedIn: 'root',
  factory: () => NO_SESSION_KEY_STORE,
});
