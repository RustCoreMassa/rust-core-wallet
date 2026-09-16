import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { WalletStore } from '../../../core/state/wallet-store';

type LockMode = 'login' | 'register';

const PIN_LENGTH = 6;

@Component({
  selector: 'app-pin-lock-page',
  imports: [PinPad],
  templateUrl: './pin-lock-page.html',
  styleUrl: './pin-lock-page.scss',
})
export class PinLockPage {
  private readonly store = inject(WalletStore);
  private readonly router = inject(Router);

  // Prefilled on purpose so the screen previews in its "filled" state.
  protected readonly pin = signal('555555');
  protected readonly mode = signal<LockMode>('login');

  protected readonly dots = computed(() =>
    Array.from({ length: PIN_LENGTH }, (_, i) => i < this.pin().length),
  );

  protected readonly title = computed(() =>
    this.mode() === 'login' ? 'Enter your PIN' : 'Create a PIN',
  );

  protected readonly subtitle = computed(() =>
    this.mode() === 'login'
      ? `Unlock ${this.store.activeWallet().name}`
      : 'Set a 6-digit code to secure your wallet',
  );

  protected readonly switchLabel = computed(() =>
    this.mode() === 'login' ? 'New here? Create a wallet' : 'Already have a wallet? Log in',
  );

  protected toggleMode(): void {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.pin.set('');
  }

  protected onDigit(digit: string): void {
    this.pin.update((current) => (current.length >= PIN_LENGTH ? digit : current + digit));
    if (this.pin().length === PIN_LENGTH) {
      setTimeout(() => this.tryUnlock(), 350);
    }
  }

  protected onBackspace(): void {
    this.pin.update((current) => current.slice(0, -1));
  }

  private tryUnlock(): void {
    if (this.store.unlock(this.pin())) {
      this.router.navigateByUrl('/home');
    }
  }
}
