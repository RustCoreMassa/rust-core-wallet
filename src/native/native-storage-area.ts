import { APP_KEY_PREFIX, KeyValueStore } from '../app/core/platform/app-storage';

/** The native side: ios/App/App/NativeStorePlugin.swift (the iOS Keychain). */
export interface NativeStorePlugin {
  getAll(): Promise<{ items: Record<string, string> }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

/**
 * LOCAL_STORE in the iOS / Android apps: the phone's own secure storage (the Keychain on iOS)
 * instead of the web view's localStorage, which the system may clear when space runs low.
 *
 * Like the extension's ChromeStorageArea: the native store is async while the app reads storage
 * synchronously, so the app's items are loaded into memory once, before Angular starts (`load`,
 * run as an app initializer); writes update memory at once and reach the native store in the
 * background — one at a time, in order. A write that fails is reported through `onWriteError`.
 */
export class NativeStorageArea implements KeyValueStore {
  private readonly items = new Map<string, string>();
  private writes: Promise<void> = Promise.resolve();

  /** Called with the key of a write that didn't reach the native store. */
  onWriteError: (key: string) => void = () => {};

  /**
   * @param webStorage where builds before the native store kept the app's items (the web
   *   view's localStorage): moved over at load, then emptied.
   */
  constructor(
    private readonly plugin: NativeStorePlugin,
    private readonly webStorage: Storage | null,
  ) {}

  async load(): Promise<void> {
    const { items } = await this.plugin.getAll();
    for (const [key, value] of Object.entries(items)) {
      if (isAppItem(key, value)) this.items.set(key, value);
    }
    await this.moveFromWebStorage();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
    this.write(key, () => this.plugin.set({ key, value }));
  }

  removeItem(key: string): void {
    this.items.delete(key);
    // A copy still waiting to move (an earlier move failed) must not come back next start.
    this.webStorage?.removeItem(key);
    this.write(key, () => this.plugin.remove({ key }));
  }

  /** Resolves once every write made so far has been tried. */
  settled(): Promise<void> {
    return this.writes;
  }

  private write(key: string, run: () => Promise<void>): void {
    this.writes = this.writes.then(run).catch((err) => {
      console.error(`Saving ${key} on this device failed`, err);
      this.onWriteError(key);
    });
  }

  /**
   * The app's items left in the web view's storage: copied over unless the native store
   * already has that key (it is newer), then deleted from the web view — but only once every
   * copy succeeded, so a failed move is simply tried again at the next start.
   */
  private async moveFromWebStorage(): Promise<void> {
    const web = this.webStorage;
    if (!web) return;
    const keys = Array.from({ length: web.length }, (_, i) => web.key(i)).filter(
      (key): key is string => key !== null && key.startsWith(APP_KEY_PREFIX),
    );
    if (keys.length === 0) return;
    try {
      for (const key of keys) {
        const value = web.getItem(key);
        if (value === null || this.items.has(key)) continue;
        await this.plugin.set({ key, value });
        this.items.set(key, value);
      }
    } catch (err) {
      console.error('Moving the wallet into secure storage failed — trying again next start', err);
      // Still usable meanwhile: what couldn't move is read from the web view's copy.
      for (const key of keys) {
        const value = web.getItem(key);
        if (value !== null && !this.items.has(key)) this.items.set(key, value);
      }
      return;
    }
    for (const key of keys) web.removeItem(key);
  }
}

function isAppItem(key: string, value: unknown): value is string {
  return key.startsWith(APP_KEY_PREFIX) && typeof value === 'string';
}
