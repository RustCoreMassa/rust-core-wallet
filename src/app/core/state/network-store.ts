import { Injectable, inject, signal } from '@angular/core';
import { KeyValueStore, LOCAL_STORE } from '../platform/app-storage';

export type Network = 'mainnet' | 'buildnet';

const STORAGE_KEY = 'massa-wallet:network';

function loadNetwork(store: KeyValueStore): Network {
  try {
    return store.getItem(STORAGE_KEY) === 'buildnet' ? 'buildnet' : 'mainnet';
  } catch {
    return 'mainnet';
  }
}

/**
 * Which Massa network every chain call targets. Kept apart from
 * WalletStore so MassaProvider can read it without a circular injection
 * (WalletStore itself depends on the provider). The choice is a device
 * preference, not a secret, so it lives in plain LOCAL_STORE.
 */
@Injectable({ providedIn: 'root' })
export class NetworkStore {
  private readonly store = inject(LOCAL_STORE);
  private readonly _network = signal<Network>(loadNetwork(this.store));

  readonly network = this._network.asReadonly();

  set(network: Network): void {
    this._network.set(network);
    try {
      this.store.setItem(STORAGE_KEY, network);
    } catch {
      // Storage unavailable — the choice still holds for this session.
    }
  }

  /** Back to mainnet and forget the saved preference — used on log out. */
  reset(): void {
    this._network.set('mainnet');
    try {
      this.store.removeItem(STORAGE_KEY);
    } catch {
      // Nothing persisted to clear.
    }
  }
}
