import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { UNLOCK_SECRET, secretNoun } from '../../../core/platform/unlock-secret';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { avatarColorsFor } from '../../../shared/ui/avatar-colors';
import { Dropdown, DropdownOption } from '../../../shared/ui/dropdown/dropdown';
import { SecretEntry } from '../../../shared/ui/secret-entry/secret-entry';

type Step = 'confirm-secret' | 'reveal';

@Component({
  selector: 'app-backup-phrase-modal',
  imports: [SecretEntry, ShortAddressPipe, Dropdown],
  templateUrl: './backup-phrase-modal.html',
  styleUrl: './backup-phrase-modal.scss',
})
export class BackupPhraseModal {
  protected readonly modal = inject(Modal);
  private readonly authStore = inject(AuthStore);
  private readonly walletStore = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly accounts = this.authStore.accounts;
  protected readonly secretName = secretNoun(inject(UNLOCK_SECRET));
  protected readonly step = signal<Step>('confirm-secret');
  protected readonly error = signal<string | null>(null);
  protected readonly isBusy = signal(false);
  /** Starts on the wallet currently in use; the picker can still switch to another. */
  protected readonly selectedAccountId = signal(this.walletStore.activeWalletId());

  private readonly entry = viewChild(SecretEntry);

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

  protected async confirmSecret(secret: string): Promise<void> {
    this.error.set(null);
    this.isBusy.set(true);
    try {
      const ok = await this.authStore.verifySecret(secret);
      if (ok) {
        this.step.set('reveal');
      } else {
        this.error.set(`Incorrect ${this.secretName}`);
        this.entry()?.clear();
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
