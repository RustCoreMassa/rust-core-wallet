import { Injectable, inject } from '@angular/core';
import { SESSION_STORE } from '../platform/app-storage';
import { SavedAddress } from '../models/saved-address.model';
import { TokenPrices } from '../models/token.model';
import { WalletState } from '../models/wallet.model';
import { AuthStore } from '../state/auth-store';
import { Network } from '../state/network-store';
import { Ciphertext } from './crypto-vault';

const STORAGE_KEY = 'massa-wallet:cache';
/** Bump when the snapshot shape changes — older caches are then ignored. */
const CACHE_VERSION = 4;

export interface WalletCacheSnapshot {
  readonly version: number;
  readonly activeWalletId: string;
  readonly addressBook: readonly SavedAddress[];
  readonly prices: TokenPrices;
  readonly wallets: Record<Network, Record<string, WalletState>>;
}

/**
 * Last-known wallet state (balances, rolls, history, MNS domains, address
 * book, token prices) for the current browser tab, so a page reload doesn't start from
 * empty: after unlock the UI paints these values immediately and
 * refreshes them in the background.
 *
 * SESSION_STORE, not LOCAL_STORE: on the web it's sessionStorage, which lives
 * only as long as the tab; in the extension, chrome.storage.session, gone
 * when the browser closes. Still encrypted under the vault's
 * session key (via AuthStore) — in plain text it would reveal which
 * addresses this device holds. A cache written under another vault
 * simply fails to decrypt and is ignored.
 */
@Injectable({ providedIn: 'root' })
export class WalletCache {
  private readonly auth = inject(AuthStore);
  private readonly store = inject(SESSION_STORE);

  async save(snapshot: Omit<WalletCacheSnapshot, 'version'>): Promise<void> {
    const payload = await this.auth.encryptForSession(
      JSON.stringify({ ...snapshot, version: CACHE_VERSION }),
    );
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota exceeded or storage unavailable — the cache is best-effort.
    }
  }

  /** `null` when there's no cache, it's from another vault, or it's outdated/corrupt. */
  async load(): Promise<WalletCacheSnapshot | null> {
    try {
      const raw = this.store.getItem(STORAGE_KEY);
      if (!raw) return null;
      const plaintext = await this.auth.decryptForSession(JSON.parse(raw) as Ciphertext);
      const snapshot = JSON.parse(plaintext, reviveInfinity) as WalletCacheSnapshot;
      return snapshot.version === CACHE_VERSION ? snapshot : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      this.store.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }
}

/**
 * JSON turns `Infinity` into `null`; history paging uses `oldest: Infinity`
 * for "nothing loaded from this stream yet", so restore it on the way in.
 */
function reviveInfinity(key: string, value: unknown): unknown {
  return key === 'oldest' && value === null ? Infinity : value;
}
