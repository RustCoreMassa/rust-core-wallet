/// <reference types="chrome" />
import { exportVaultKey, importVaultKey } from '../app/core/services/crypto-vault';
import { SessionKeyStore } from '../app/core/services/session-key-store';
import { AUTO_LOCK_ALARM, AUTO_LOCK_MS, SESSION_KEY_ITEM } from './session-constants';

type SessionArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
type Alarms = Pick<typeof chrome.alarms, 'create' | 'clear'>;
type StorageEvents = Pick<typeof chrome.storage.onChanged, 'addListener' | 'removeListener'>;

interface StoredSessionKey {
  readonly key: string; // base64 raw AES-GCM key
  readonly expiresAt: number; // ms epoch
}

/** User activity extends the session at most this often (each extension is one storage write). */
const TOUCH_EVERY_MS = 30_000;
/** How often an open page checks the session is still there — in case an event was missed. */
const CHECK_EVERY_MS = 30_000;

/**
 * Keeps the unlocked vault key in chrome.storage.session, so reopening the
 * popup doesn't ask for the password every time. That area lives in memory only
 * (never on disk), is emptied when the browser closes, and is out of reach
 * of content scripts (Chrome's default access level).
 *
 * The session ends AUTO_LOCK_MS after the user last did something in any of the wallet's
 * pages (`touch`; opening one counts too) — not merely while one stays open: a side panel left
 * open locks like a closed popup. The background worker's alarm wipes the key then (and when the
 * computer locks); `restore` refuses an expired one regardless, and every open page locks as soon
 * as the key is gone (`watch`), whichever page or event removed it.
 */
export class ChromeSessionKeyStore implements SessionKeyStore {
  readonly keepsKey = true;
  private lastTouch = 0;

  constructor(
    private readonly area: SessionArea,
    private readonly alarms: Alarms,
    private readonly now: () => number = Date.now,
    private readonly events: StorageEvents | null = null,
  ) {}

  async save(key: CryptoKey): Promise<void> {
    await this.write(await exportVaultKey(key));
  }

  async restore(): Promise<CryptoKey | null> {
    const stored = await this.read();
    if (!stored || stored.expiresAt <= this.now()) {
      await this.clear();
      return null;
    }
    const key = await importVaultKey(stored.key);
    await this.write(stored.key);
    return key;
  }

  async clear(): Promise<void> {
    await this.area.remove(SESSION_KEY_ITEM);
    await this.alarms.clear(AUTO_LOCK_ALARM);
  }

  touch(): void {
    const now = this.now();
    if (now - this.lastTouch < TOUCH_EVERY_MS) return;
    this.lastTouch = now;
    this.extend().catch((err) => console.warn('Extending the session failed', err));
  }

  watch(ended: () => void): () => void {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      stop();
      ended();
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (
        areaName === 'session' &&
        changes[SESSION_KEY_ITEM] &&
        !changes[SESSION_KEY_ITEM].newValue
      ) {
        end();
      }
    };
    // Belt and braces: an alarm late after sleep, a missed event — the page checks for itself.
    const check = () => {
      this.read()
        .then(async (stored) => {
          if (stored && stored.expiresAt > this.now()) return;
          await this.clear();
          end();
        })
        .catch((err) => console.warn('Checking the session failed', err));
    };
    this.events?.addListener(onChanged);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const stop = () => {
      done = true;
      clearInterval(timer);
      this.events?.removeListener(onChanged);
    };
    return stop;
  }

  /** Pushes the expiry back — only while the session is still on (never revives an ended one). */
  private async extend(): Promise<void> {
    const stored = await this.read();
    if (stored && stored.expiresAt > this.now()) await this.write(stored.key);
  }

  private async read(): Promise<StoredSessionKey | null> {
    const stored = (await this.area.get(SESSION_KEY_ITEM))[SESSION_KEY_ITEM] as
      StoredSessionKey | undefined;
    return typeof stored?.key === 'string' && typeof stored.expiresAt === 'number' ? stored : null;
  }

  private async write(key: string): Promise<void> {
    const expiresAt = this.now() + AUTO_LOCK_MS;
    await this.area.set({ [SESSION_KEY_ITEM]: { key, expiresAt } satisfies StoredSessionKey });
    await this.alarms.create(AUTO_LOCK_ALARM, { when: expiresAt });
  }
}
