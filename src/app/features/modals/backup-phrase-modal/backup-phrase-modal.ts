import { Component, computed, inject, signal } from '@angular/core';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { avatarColorsFor } from '../../../shared/ui/avatar-colors';
import { Dropdown, DropdownOption } from '../../../shared/ui/dropdown/dropdown';

type Step = 'confirm-pin' | 'reveal';
const PIN_LENGTH = 6;

@Component({
  selector: 'app-backup-phrase-modal',
  imports: [PinPad, ShortAddressPipe, Dropdown],
  templateUrl: './backup-phrase-modal.html',
  styleUrl: './backup-phrase-modal.scss',
})
export class BackupPhraseModal {
  protected readonly modal = inject(Modal);
  private readonly authStore = inject(AuthStore);
  private readonly walletStore = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly accounts = this.authStore.accounts;
  protected readonly step = signal<Step>('confirm-pin');
  protected readonly pin = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly isBusy = signal(false);
  /** Starts on the wallet currently in use; the picker can still switch to another. */
  protected readonly selectedAccountId = signal(this.walletStore.activeWalletId());

  protected readonly dots = computed(() =>
    Array.from({ length: PIN_LENGTH }, (_, i) => i < this.pin().length),
  );

  protected readonly selectedAccount = computed(
    () => this.accounts().find((a) => a.id === this.selectedAccountId()) ?? null,
  );

  /** Wallet picker entries: letter avatar, name, short address. */
  protected readonly accountOptions = computed<DropdownOption[]>(() =>
    this.accounts().map((account) => {
      const [from, to] = avatarColorsFor(account.name);
      return {
        value: account.id,
        label: account.name,
        sublabel: `${account.address.slice(0, 6)}…${account.address.slice(-4)}`,
        avatar: {
          background: `linear-gradient(155deg, ${from}, ${to})`,
          text: account.name.slice(0, 2).toUpperCase(),
        },
      };
    }),
  );

  protected async onDigit(digit: string): Promise<void> {
    if (this.pin().length >= PIN_LENGTH) return;
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
      if (ok) {
        this.step.set('reveal');
      } else {
        this.error.set('Incorrect PIN');
        this.pin.set('');
      }
    } finally {
      this.isBusy.set(false);
    }
  }

  protected copyPrivateKey(): void {
    const account = this.selectedAccount();
    if (!account) return;
    navigator.clipboard
      .writeText(account.privateKey)
      .then(() => this.toast.show('Private key copied — keep it secret'))
      .catch(() => this.toast.show('Could not copy — copy manually'));
  }
}
