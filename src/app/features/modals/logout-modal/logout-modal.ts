import { Component, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { UNLOCK_SECRET, secretNoun } from '../../../core/platform/unlock-secret';
import { Modal } from '../../../core/services/modal';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletDataEraser } from '../../../core/state/wallet-data-eraser';
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
  private readonly eraser = inject(WalletDataEraser);
  private readonly router = inject(Router);

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
    await this.eraser.erase();
  }
}
