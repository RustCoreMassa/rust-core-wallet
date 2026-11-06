import { Injectable, inject } from '@angular/core';
import { BIOMETRIC_UNLOCK } from '../platform/biometric-unlock';
import { CONNECTED_SITES } from '../platform/connected-sites';
import { NetworkStore } from './network-store';
import { NftStore } from './nft-store';
import { WalletStore } from './wallet-store';

/**
 * Wipes everything a wallet leaves on this device besides the vault itself: wallets, history,
 * address book, custom tokens, NFTs read so far, the network choice, (extension) the connected
 * sites and (apps) the PIN kept for Face ID / Touch ID. Shared
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
  private readonly nftStore = inject(NftStore);
  /** Extension only: no site stays connected to wallets that left the device. */
  private readonly connectedSites = inject(CONNECTED_SITES);
  /** Apps only: the kept PIN belongs to the vault that just went. */
  private readonly biometricUnlock = inject(BIOMETRIC_UNLOCK);

  async erase(): Promise<void> {
    this.walletStore.reset();
    this.nftStore.reset();
    this.networkStore.reset();
    await this.biometricUnlock?.disable();
    await this.connectedSites
      ?.clear()
      .catch((err) => console.warn('Disconnecting the sites failed', err));
  }
}
