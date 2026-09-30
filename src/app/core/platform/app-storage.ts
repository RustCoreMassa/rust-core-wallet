import { InjectionToken } from '@angular/core';

/** The slice of the Web Storage API the app uses — every key starts with APP_KEY_PREFIX. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const APP_KEY_PREFIX = 'massa-wallet:';

/**
 * Where the app keeps its data. The web build uses the page's own storage;
 * the browser-extension build swaps in chrome.storage (see src/extension),
 * so the popup and the extension's background share one vault.
 *
 * - LOCAL_STORE: survives restarts (the encrypted vault, device preferences).
 * - SESSION_STORE: gone when the browser session ends (the encrypted wallet cache).
 *
 * Calls may throw (storage blocked or full) — callers already treat storage as best-effort.
 */
export const LOCAL_STORE = new InjectionToken<KeyValueStore>('LOCAL_STORE', {
  providedIn: 'root',
  factory: () => webStorage(() => localStorage),
});

export const SESSION_STORE = new InjectionToken<KeyValueStore>('SESSION_STORE', {
  providedIn: 'root',
  factory: () => webStorage(() => sessionStorage),
});

/** Resolved on every call, so a blocked storage throws where the caller can catch it. */
function webStorage(storage: () => Storage): KeyValueStore {
  return {
    getItem: (key) => storage().getItem(key),
    setItem: (key, value) => storage().setItem(key, value),
    removeItem: (key) => storage().removeItem(key),
  };
}
