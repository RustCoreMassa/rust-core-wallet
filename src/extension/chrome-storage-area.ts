/// <reference types="chrome" />
import { APP_KEY_PREFIX, KeyValueStore } from '../app/core/platform/app-storage';

type StorageArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove' | 'onChanged'>;

/**
 * KeyValueStore over a chrome.storage area. chrome.storage is async while
 * the app reads storage synchronously, so the app's own keys are loaded
 * into memory once, before Angular starts (`load`, run as an app
 * initializer); writes update memory at once and go to chrome.storage in
 * the background. Changes made by another extension page (the background
 * worker, another popup) flow back in through `onChanged`.
 */
export class ChromeStorageArea implements KeyValueStore {
  private readonly items = new Map<string, string>();

  constructor(private readonly area: StorageArea) {}

  async load(): Promise<void> {
    const all = await this.area.get(null);
    for (const [key, value] of Object.entries(all)) {
      if (isAppItem(key, value)) this.items.set(key, value);
    }
    this.area.onChanged.addListener((changes) => {
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (newValue === undefined) this.items.delete(key);
        else if (isAppItem(key, newValue)) this.items.set(key, newValue);
      }
    });
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
    this.area.set({ [key]: value }).catch((err) => console.warn(`Saving ${key} failed`, err));
  }

  removeItem(key: string): void {
    this.items.delete(key);
    this.area.remove(key).catch((err) => console.warn(`Removing ${key} failed`, err));
  }
}

/** Only the app's own string items — never, e.g., the session key kept beside them. */
function isAppItem(key: string, value: unknown): value is string {
  return key.startsWith(APP_KEY_PREFIX) && typeof value === 'string';
}
