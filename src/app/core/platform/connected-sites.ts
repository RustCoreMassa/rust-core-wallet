import { InjectionToken, Signal } from '@angular/core';

/** A site connected to the wallet through the browser extension (docs/DAPP-CONNECTION.md). */
export interface ConnectedSite {
  readonly origin: string;
  /**
   * The accounts the site may see and ask to sign with, never empty. The first is the one it
   * uses now: the wallet's most recently active account among them.
   */
  readonly addresses: readonly string[];
  readonly grantedAt: number;
}

/**
 * The extension's connected sites, for Settings → Connected sites and the Home notice. Changes
 * reach the sites themselves (accounts changed, disconnected) through the background worker.
 */
export interface ConnectedSites {
  /** Every connected site, oldest first; follows changes made from any view. */
  readonly sites: Signal<readonly ConnectedSite[]>;
  /** Lets a site see one more account; `current` makes it the one the site uses now. */
  addAccount(origin: string, address: string, current: boolean): Promise<void>;
  /** Takes an account away from a site; the site is disconnected when it was its last one. */
  removeAccount(origin: string, address: string): Promise<void>;
  /** The wallet switched to this account: every site that may see it now uses it. */
  useAccount(address: string): Promise<void>;
  disconnect(origin: string): Promise<void>;
  /** Takes a wallet removed from RustCore away from every site. */
  forgetAccount(address: string): Promise<void>;
  /** Disconnects every site — on log out, when every wallet leaves this device. */
  clear(): Promise<void>;
  /** The site open in the browser's active tab, if dApps can run there; null otherwise. */
  activeTabOrigin(): Promise<string | null>;
  /** Calls `callback` when the active tab may show another site; returns the unsubscribe. */
  watchActiveTab(callback: () => void): () => void;
}

/** `null` in the web app, which has no dApp connections. */
export const CONNECTED_SITES = new InjectionToken<ConnectedSites | null>('CONNECTED_SITES', {
  providedIn: 'root',
  factory: () => null,
});
