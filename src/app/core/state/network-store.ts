import { Injectable, signal } from '@angular/core';

export type Network = 'mainnet' | 'buildnet';

const STORAGE_KEY = 'massa-wallet:network';

function loadNetwork(): Network {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'buildnet' ? 'buildnet' : 'mainnet';
  } catch {
    return 'mainnet';
  }
}

/**
 * Which Massa network every chain call targets. Kept apart from
 * WalletStore so MassaProvider can read it without a circular injection
 * (WalletStore itself depends on the provider). The choice is a device
 * preference, not a secret, so it lives in plain localStorage.
 */
@Injectable({ providedIn: 'root' })
export class NetworkStore {
  private readonly _network = signal<Network>(loadNetwork());

  readonly network = this._network.asReadonly();

  set(network: Network): void {
    this._network.set(network);
    try {
      localStorage.setItem(STORAGE_KEY, network);
    } catch {
      // Storage unavailable — the choice still holds for this session.
    }
  }

  /** Back to mainnet and forget the saved preference — used on log out. */
  reset(): void {
    this._network.set('mainnet');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing persisted to clear.
    }
  }
}
