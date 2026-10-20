import { Injectable, inject } from '@angular/core';
import { CONNECTED_SITES } from '../platform/connected-sites';
import { NetworkStore } from './network-store';
import { WalletStore } from './wallet-store';

/**
 * Wipes everything a wallet leaves on this device besides the vault itself: wallets, history,
 * address book, custom tokens, the network choice and (extension) the connected sites. Shared
 * by log out and "Forgot your PIN/password?" on the lock screen, so both leave the device
 * equally clean.
 *
 * Call it after `AuthStore.logout()` and outside the shell: the shell's pages read
 * `activeWallet()`, which throws once the store is empty.
 */
@Injectable({ providedIn: 'root' })
export class WalletDataEraser {
  private readonly walletStore = inject(WalletStore);
  private readonly networkStore = inject(NetworkStore);
  /** Extension only: no site stays connected to wallets that left the device. */
  private readonly connectedSites = inject(CONNECTED_SITES);

  async erase(): Promise<void> {
    this.walletStore.reset();
    this.networkStore.reset();
    await this.connectedSites
      ?.clear()
      .catch((err) => console.warn('Disconnecting the sites failed', err));
  }
}
