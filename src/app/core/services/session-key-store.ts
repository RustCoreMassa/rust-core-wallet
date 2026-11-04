import { InjectionToken } from '@angular/core';

/**
 * Keeps the unlocked session's vault key beyond the page that derived it, and tells each page
 * when the session ended elsewhere.
 *
 * The web app keeps no key (WebSessionKeyStore): it lives only in AuthStore's memory and a
 * reload asks for the PIN again. The extension's popup is torn down every time it closes, so it
 * keeps the key in chrome.storage.session (memory only, never written to disk) until the
 * auto-lock — see src/extension/chrome-session-key-store.ts.
 */
export interface SessionKeyStore {
  /** When true, AuthStore derives an extractable key so `save` can keep it. */
  readonly keepsKey: boolean;
  save(key: CryptoKey): Promise<void>;
  /** `null` when there's no session to resume (never saved, locked or expired). */
  restore(): Promise<CryptoKey | null>;
  /** Ends the session — for every page of the wallet, which `watch` tells. */
  clear(): Promise<void>;
  /**
   * The user did something in this page: a kept session lasts AUTO_LOCK_MS from now. Cheap to
   * call on every input event (throttled inside). Nothing to do where no key is kept.
   */
  touch(): void;
  /**
   * Calls `ended` when the session ends outside this page: locked in another tab or view, or
   * (extension) expired or wiped by the auto-lock. Returns the function that stops watching.
   */
  watch(ended: () => void): () => void;
}

/** Channel the web app's tabs announce a lock on. */
const SESSION_CHANNEL = 'rustcore-wallet:session';

/**
 * The web app's: keeps nothing, so a reload needs the PIN. A lock in one tab locks the wallet's
 * other tabs too (BroadcastChannel, same origin only).
 */
export class WebSessionKeyStore implements SessionKeyStore {
  readonly keepsKey = false;
  private channel: BroadcastChannel | null = null;

  async save(): Promise<void> {}

  async restore(): Promise<CryptoKey | null> {
    return null;
  }

  async clear(): Promise<void> {
    this.open()?.postMessage('ended');
  }

  touch(): void {}

  watch(ended: () => void): () => void {
    // A channel of its own: postMessage never reaches the channel object that sent it.
    const channel =
      typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSION_CHANNEL) : null;
    if (!channel) return () => {};
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'ended') ended();
    };
    return () => channel.close();
  }

  private open(): BroadcastChannel | null {
    if (!this.channel && typeof BroadcastChannel === 'function') {
      this.channel = new BroadcastChannel(SESSION_CHANNEL);
    }
    return this.channel;
  }
}

export const SESSION_KEY_STORE = new InjectionToken<SessionKeyStore>('SESSION_KEY_STORE', {
  providedIn: 'root',
  factory: () => new WebSessionKeyStore(),
});
