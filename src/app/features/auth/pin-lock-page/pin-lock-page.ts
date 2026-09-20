import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { VaultAccount } from '../../../core/models/vault.model';
import { MASSA_PROVIDER } from '../../../core/services/massa-provider';
import { AuthStore } from '../../../core/state/auth-store';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';

type Step = 'unlock' | 'set-pin' | 'confirm-pin' | 'key-choice' | 'import-key' | 'generating';

const PIN_LENGTH = 6;

/**
 * Single self-contained auth flow: unlock (vault already exists) or
 * register (no vault yet) → set PIN → confirm PIN → generate a new key
 * or import an existing one → vault saved, session unlocked.
 *
 * Which branch you land on is decided once, from `authStore.hasVault()`
 * — not a manual "log in / sign up" toggle, since that state is a fact
 * about the device, not a choice the user makes each time.
 */
@Component({
  selector: 'app-pin-lock-page',
  imports: [PinPad, FormsModule],
  templateUrl: './pin-lock-page.html',
  styleUrl: './pin-lock-page.scss',
})
export class PinLockPage {
  private readonly authStore = inject(AuthStore);
  private readonly provider = inject(MASSA_PROVIDER);
  private readonly router = inject(Router);

  protected readonly step = signal<Step>(this.authStore.hasVault() ? 'unlock' : 'set-pin');
  protected readonly pin = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly importKeyValue = signal('');
  protected readonly isBusy = signal(false);

  private firstPin = '';

  protected readonly dots = computed(() =>
    Array.from({ length: PIN_LENGTH }, (_, i) => i < this.pin().length),
  );

  protected readonly showPinPad = computed(
    () => this.step() === 'unlock' || this.step() === 'set-pin' || this.step() === 'confirm-pin',
  );

  protected readonly title = computed(() => {
    switch (this.step()) {
      case 'unlock':
        return 'Enter your PIN';
      case 'set-pin':
        return 'Create a PIN';
      case 'confirm-pin':
        return 'Confirm your PIN';
      case 'key-choice':
        return 'Set up your wallet';
      case 'import-key':
        return 'Import a private key';
      case 'generating':
        return 'Creating your wallet';
    }
  });

  protected readonly subtitle = computed(() => {
    switch (this.step()) {
      case 'unlock':
        return 'Unlock your wallet';
      case 'set-pin':
        return 'Set a 6-digit code to secure your wallet';
      case 'confirm-pin':
        return 'Enter it again to confirm';
      case 'key-choice':
        return 'Generate a brand new wallet, or import one you already have';
      case 'import-key':
        return 'Paste an existing Massa private key';
      case 'generating':
        return 'One moment…';
    }
  });

  protected async onDigit(digit: string): Promise<void> {
    if (this.pin().length >= PIN_LENGTH) return;
    this.error.set(null);
    this.pin.update((current) => current + digit);
    if (this.pin().length === PIN_LENGTH) {
      await this.handlePinComplete();
    }
  }

  protected onBackspace(): void {
    this.pin.update((current) => current.slice(0, -1));
  }

  private async handlePinComplete(): Promise<void> {
    const enteredPin = this.pin();

    if (this.step() === 'unlock') {
      this.isBusy.set(true);
      const ok = await this.authStore.unlock(enteredPin);
      this.isBusy.set(false);

      if (ok) {
        await this.router.navigateByUrl('/home');
        return;
      } else {
        this.error.set('Incorrect PIN');
        this.pin.set('');
      }
      return;
    }

    if (this.step() === 'set-pin') {
      this.firstPin = enteredPin;
      this.pin.set('');
      this.step.set('confirm-pin');
      return;
    }

    if (this.step() === 'confirm-pin') {
      if (enteredPin === this.firstPin) {
        this.pin.set('');
        this.step.set('key-choice');
      } else {
        this.error.set("PINs didn't match — start over");
        this.firstPin = '';
        this.pin.set('');
        this.step.set('set-pin');
      }
    }
  }

  protected async generateNewWallet(): Promise<void> {
    this.step.set('generating');
    const { privateKey, address } = await this.provider.generateAccount();
    await this.completeRegistration({ id: 'main', name: 'Main Wallet', address, privateKey });
  }

  protected startImportFlow(): void {
    this.error.set(null);
    this.step.set('import-key');
  }

  protected backToKeyChoice(): void {
    this.error.set(null);
    this.importKeyValue.set('');
    this.step.set('key-choice');
  }

  protected async submitImportedKey(): Promise<void> {
    const privateKey = this.importKeyValue().trim();
    this.error.set(null);

    if (!privateKey) {
      this.error.set('Paste a private key first');
      return;
    }

    this.isBusy.set(true);
    const address = await this.provider.resolveAddress(privateKey);
    this.isBusy.set(false);

    if (!address) {
      this.error.set('That private key looks invalid');
      return;
    }

    await this.completeRegistration({ id: 'main', name: 'Main Wallet', address, privateKey });
  }

  private async completeRegistration(account: VaultAccount): Promise<void> {
    await this.authStore.register(this.firstPin, [account]);
    await this.router.navigateByUrl('/home');
  }
}
