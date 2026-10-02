import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VaultAccount } from '../../../core/models/vault.model';
import { CONNECTED_SITES } from '../../../core/platform/connected-sites';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { toUserMessage } from '../../../core/utils/user-error';

/** `edit` → rename; `remove-warn` → explain what removal means; `remove-pin` → confirm with the PIN. */
type Step = 'edit' | 'remove-warn' | 'remove-pin';
const PIN_LENGTH = 6;

@Component({
  selector: 'app-rename-account-modal',
  imports: [FormsModule, ShortAddressPipe, PinPad],
  templateUrl: './rename-account-modal.html',
  styleUrl: './rename-account-modal.scss',
})
export class RenameAccountModal {
  protected readonly modal = inject(Modal);
  private readonly authStore = inject(AuthStore);
  private readonly walletStore = inject(WalletStore);
  private readonly toast = inject(Toast);
  /** Extension only: sites connected to a removed account are disconnected with it. */
  private readonly connectedSites = inject(CONNECTED_SITES);

  protected readonly account = computed(() => this.modal.payload<VaultAccount>());
  protected readonly name = signal(this.account()?.name ?? '');
  protected readonly error = signal<string | null>(null);
  protected readonly isSaving = signal(false);

  protected readonly step = signal<Step>('edit');
  protected readonly pin = signal('');
  protected readonly isRemoving = signal(false);

  /** The vault must keep at least one wallet — the last one goes via Log out. */
  protected readonly canRemove = computed(() => this.authStore.accounts().length > 1);

  protected readonly dots = computed(() =>
    Array.from({ length: PIN_LENGTH }, (_, i) => i < this.pin().length),
  );

  protected startRemove(): void {
    this.error.set(null);
    this.step.set('remove-warn');
  }

  protected cancelRemove(): void {
    this.error.set(null);
    this.pin.set('');
    this.step.set('edit');
  }

  protected async onDigit(digit: string): Promise<void> {
    if (this.pin().length >= PIN_LENGTH || this.isRemoving()) return;
    this.error.set(null);
    this.pin.update((current) => current + digit);
    if (this.pin().length === PIN_LENGTH) await this.removeWithPin();
  }

  protected onBackspace(): void {
    this.pin.update((current) => current.slice(0, -1));
  }

  private async removeWithPin(): Promise<void> {
    const account = this.account();
    if (!account) return;
    this.isRemoving.set(true);
    try {
      if (!(await this.authStore.verifyPin(this.pin()))) {
        this.error.set('Incorrect PIN');
        this.pin.set('');
        return;
      }
      await this.authStore.removeAccount(account.id);
      this.walletStore.removeWallet(account.id);
      // The account is gone already; a failure here mustn't read as if removing it failed.
      await this.connectedSites
        ?.forgetAccount(account.address)
        .catch((err) => console.warn('Disconnecting its sites failed', err));
      this.toast.show(`${account.name} removed`);
      this.modal.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
      this.pin.set('');
    } finally {
      this.isRemoving.set(false);
    }
  }

  protected copyPrivateKey(): void {
    const account = this.account();
    if (!account) return;
    navigator.clipboard
      .writeText(account.privateKey)
      .then(() => this.toast.show('Private key copied — keep it secret'))
      .catch(() => this.toast.show('Could not copy — copy manually'));
  }

  protected async save(): Promise<void> {
    const account = this.account();
    if (!account) return;

    const trimmed = this.name().trim();
    this.error.set(null);

    if (!trimmed) {
      this.error.set('Name cannot be empty');
      return;
    }
    if (this.authStore.isNameTaken(trimmed, account.id)) {
      this.error.set('That name is already used by another wallet');
      return;
    }

    this.isSaving.set(true);
    try {
      await this.authStore.renameAccount(account.id, trimmed);
      this.toast.show('Wallet renamed');
      this.modal.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isSaving.set(false);
    }
  }
}
