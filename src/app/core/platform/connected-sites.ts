import { InjectionToken, Signal } from '@angular/core';

/** A site connected to the wallet through the browser extension (docs/DAPP-CONNECTION.md). */
export interface ConnectedSite {
  readonly origin: string;
  /** The one account the site sees and can ask to sign with. */
  readonly address: string;
  readonly grantedAt: number;
}

/**
 * The extension's connected sites, for Settings → Connected sites. Changes reach the sites
 * themselves (account changed, disconnected) through the background worker.
 */
export interface ConnectedSites {
  /** Every connected site, oldest first; follows changes made from any view. */
  readonly sites: Signal<readonly ConnectedSite[]>;
  changeAccount(origin: string, address: string): Promise<void>;
  disconnect(origin: string): Promise<void>;
  /** Disconnects the sites of an account removed from the wallet. */
  forgetAccount(address: string): Promise<void>;
  /** Disconnects every site — on log out, when every wallet leaves this device. */
  clear(): Promise<void>;
}

/** `null` in the web app, which has no dApp connections. */
export const CONNECTED_SITES = new InjectionToken<ConnectedSites | null>('CONNECTED_SITES', {
  providedIn: 'root',
  factory: () => null,
});
