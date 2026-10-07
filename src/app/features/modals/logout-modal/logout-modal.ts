import { Component, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CONNECTED_SITES } from '../../../core/platform/connected-sites';
import { UNLOCK_SECRET, secretNoun } from '../../../core/platform/unlock-secret';
import { Modal } from '../../../core/services/modal';
import { AuthStore } from '../../../core/state/auth-store';
import { NetworkStore } from '../../../core/state/network-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { SecretEntry } from '../../../shared/ui/secret-entry/secret-entry';

type Step = 'warn' | 'confirm-secret';

/**
 * Full log out: removes the encrypted vault from this device and wipes
 * every piece of in-memory state (wallets, history, address book,
 * network choice), then returns to the create/import screen. Gated
 * behind the PIN/password because it can't be undone without the private keys.
 */
@Component({
  selector: 'app-logout-modal',
  imports: [SecretEntry],
  templateUrl: './logout-modal.html',
  styleUrl: './logout-modal.scss',
})
export class LogoutModal {
  protected readonly modal = inject(Modal);
  private readonly authStore = inject(AuthStore);
  private readonly walletStore = inject(WalletStore);
  private readonly networkStore = inject(NetworkStore);
  private readonly router = inject(Router);
  /** Extension only: no site stays connected to wallets that left the device. */
  private readonly connectedSites = inject(CONNECTED_SITES);

  protected readonly secretName = secretNoun(inject(UNLOCK_SECRET));
  protected readonly step = signal<Step>('warn');
  protected readonly error = signal<string | null>(null);
  protected readonly isBusy = signal(false);

  private readonly entry = viewChild(SecretEntry);

  protected continueToSecret(): void {
    this.step.set('confirm-secret');
  }

  protected async confirmSecret(secret: string): Promise<void> {
    this.error.set(null);
    this.isBusy.set(true);
    try {
      const ok = await this.authStore.verifySecret(secret);
      if (!ok) {
        this.error.set(`Incorrect ${this.secretName}`);
        this.entry()?.clear();
        return;
      }
      await this.logOut();
    } finally {
      this.isBusy.set(false);
    }
  }

  private async logOut(): Promise<void> {
    this.modal.close();
    // Vault goes first: PinLockPage picks create-vs-unlock from
    // `hasVault()` when it's constructed during the navigation below.
    this.authStore.logout();
    await this.router.navigateByUrl('/login');
    // Wallet state only after leaving the shell — its pages read
    // `activeWallet()`, which throws once the store is empty.
    this.walletStore.reset();
    this.networkStore.reset();
    await this.connectedSites
      ?.clear()
      .catch((err) => console.warn('Disconnecting the sites failed', err));
  }
}
