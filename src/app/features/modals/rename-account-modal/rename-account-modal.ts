import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VaultAccount } from '../../../core/models/vault.model';
import { CONNECTED_SITES } from '../../../core/platform/connected-sites';
import { UNLOCK_SECRET, secretNoun } from '../../../core/platform/unlock-secret';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { SecretEntry } from '../../../shared/ui/secret-entry/secret-entry';
import { toUserMessage } from '../../../core/utils/user-error';
import { copySecret } from '../../../core/utils/secret-clipboard';

/**
 * `edit` → rename; `remove-warn` → explain what removal means; `remove-confirm` → confirm with
 * the PIN/password; `key-confirm` → the PIN/password before the private key can be copied (from
 * `edit` or `remove-warn`, where it goes back to).
 */
type Step = 'edit' | 'remove-warn' | 'remove-confirm' | 'key-confirm';

@Component({
  selector: 'app-rename-account-modal',
  imports: [FormsModule, ShortAddressPipe, SecretEntry],
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

  protected readonly secretName = secretNoun(inject(UNLOCK_SECRET));
  protected readonly step = signal<Step>('edit');
  protected readonly isRemoving = signal(false);
  protected readonly isCheckingKey = signal(false);
  /**
   * The secret was confirmed in this modal: the key may be copied. Like the Backup screen, the
   * private key never leaves the wallet without the PIN/password — whoever holds an unlocked
   * phone must not get it in two taps.
   */
  private readonly keyUnlocked = signal(false);
  private keyReturnStep: Step = 'edit';

  /** The vault must keep at least one wallet — the last one goes via Log out. */
  protected readonly canRemove = computed(() => this.authStore.accounts().length > 1);

  private readonly entry = viewChild(SecretEntry);

  protected startRemove(): void {
    this.error.set(null);
    this.step.set('remove-warn');
  }

  protected cancelRemove(): void {
    this.error.set(null);
    this.step.set('edit');
  }

  protected async removeWithSecret(secret: string): Promise<void> {
    const account = this.account();
    if (!account) return;
    this.error.set(null);
    this.isRemoving.set(true);
    try {
      if (!(await this.authStore.verifySecret(secret))) {
        this.error.set(`Incorrect ${this.secretName}`);
        this.entry()?.clear();
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
      this.entry()?.clear();
    } finally {
      this.isRemoving.set(false);
    }
  }

  /** Copies the key once the PIN/password was confirmed here; asks for it first otherwise. */
  protected copyPrivateKey(): void {
    if (!this.account()) return;
    if (!this.keyUnlocked()) {
      this.error.set(null);
      this.keyReturnStep = this.step();
      this.step.set('key-confirm');
      return;
    }
    this.copyKeyNow();
  }

  protected async confirmKeySecret(secret: string): Promise<void> {
    this.error.set(null);
    this.isCheckingKey.set(true);
    try {
      if (!(await this.authStore.verifySecret(secret))) {
        this.error.set(`Incorrect ${this.secretName}`);
        this.entry()?.clear();
        return;
      }
      this.keyUnlocked.set(true);
      this.step.set(this.keyReturnStep);
      // Still within the tap on most browsers; where the clipboard needs a fresh one, the
      // toast asks for it — the next tap copies without the secret.
      this.copyKeyNow('Confirmed — tap Copy private key again');
    } catch (err) {
      // TooManyAttemptsError: its message says how long to wait.
      this.error.set(toUserMessage(err));
      this.entry()?.clear();
    } finally {
      this.isCheckingKey.set(false);
    }
  }

  protected cancelKey(): void {
    this.error.set(null);
    this.step.set(this.keyReturnStep);
  }

  private copyKeyNow(onFailure = 'Could not copy — copy manually'): void {
    const account = this.account();
    if (!account || !this.keyUnlocked()) return;
    copySecret(account.privateKey)
      .then(() => this.toast.show('Private key copied — the clipboard is emptied in 60 s'))
      .catch(() => this.toast.show(onFailure));
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
