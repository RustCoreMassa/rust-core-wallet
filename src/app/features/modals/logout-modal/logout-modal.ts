import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CONNECTED_SITES } from '../../../core/platform/connected-sites';
import { Modal } from '../../../core/services/modal';
import { AuthStore } from '../../../core/state/auth-store';
import { NetworkStore } from '../../../core/state/network-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';

type Step = 'warn' | 'confirm-pin';
const PIN_LENGTH = 6;

/**
 * Full log out: removes the encrypted vault from this device and wipes
 * every piece of in-memory state (wallets, history, address book,
 * network choice), then returns to the create/import screen. Gated
 * behind the PIN because it can't be undone without the private keys.
 */
@Component({
  selector: 'app-logout-modal',
  imports: [PinPad],
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

  protected readonly step = signal<Step>('warn');
  protected readonly pin = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly isBusy = signal(false);

  protected readonly dots = computed(() =>
    Array.from({ length: PIN_LENGTH }, (_, i) => i < this.pin().length),
  );

  protected continueToPin(): void {
    this.step.set('confirm-pin');
  }

  protected async onDigit(digit: string): Promise<void> {
    if (this.pin().length >= PIN_LENGTH || this.isBusy()) return;
    this.error.set(null);
    this.pin.update((current) => current + digit);
    if (this.pin().length === PIN_LENGTH) {
      await this.confirmPin();
    }
  }

  protected onBackspace(): void {
    this.pin.update((current) => current.slice(0, -1));
  }

  private async confirmPin(): Promise<void> {
    this.isBusy.set(true);
    try {
      const ok = await this.authStore.verifyPin(this.pin());
      if (!ok) {
        this.error.set('Incorrect PIN');
        this.pin.set('');
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
