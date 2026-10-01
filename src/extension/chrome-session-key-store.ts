/// <reference types="chrome" />
import { exportVaultKey, importVaultKey } from '../app/core/services/crypto-vault';
import { SessionKeyStore } from '../app/core/services/session-key-store';
import { AUTO_LOCK_ALARM, AUTO_LOCK_MS, SESSION_KEY_ITEM } from './session-constants';

type SessionArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
type Alarms = Pick<typeof chrome.alarms, 'create' | 'clear'>;

interface StoredSessionKey {
  readonly key: string; // base64 raw AES-GCM key
  readonly expiresAt: number; // ms epoch
}

/** While the popup stays open the session is extended this often. */
const KEEP_ALIVE_MS = 60_000;

/**
 * Keeps the unlocked vault key in chrome.storage.session, so reopening the
 * popup doesn't ask for the PIN every time. That area lives in memory only
 * (never on disk), is emptied when the browser closes, and is out of reach
 * of content scripts (Chrome's default access level). The session ends
 * AUTO_LOCK_MS after the popup was last open: the background worker's alarm
 * wipes the key then, and `restore` refuses an expired one regardless.
 */
export class ChromeSessionKeyStore implements SessionKeyStore {
  readonly keepsKey = true;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly area: SessionArea,
    private readonly alarms: Alarms,
    private readonly now: () => number = Date.now,
  ) {}

  async save(key: CryptoKey): Promise<void> {
    await this.write(await exportVaultKey(key));
    this.keepAlive();
  }

  async restore(): Promise<CryptoKey | null> {
    const stored = await this.read();
    if (!stored || stored.expiresAt <= this.now()) {
      await this.clear();
      return null;
    }
    const key = await importVaultKey(stored.key);
    await this.write(stored.key);
    this.keepAlive();
    return key;
  }

  async clear(): Promise<void> {
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
    await this.area.remove(SESSION_KEY_ITEM);
    await this.alarms.clear(AUTO_LOCK_ALARM);
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

  private keepAlive(): void {
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      this.read()
        .then((stored) => stored && this.write(stored.key))
        .catch((err) => console.warn('Extending the session failed', err));
    }, KEEP_ALIVE_MS);
  }
}
