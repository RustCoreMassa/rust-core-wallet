import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VaultAccount } from '../../../core/models/vault.model';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { AuthStore } from '../../../core/state/auth-store';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';

@Component({
  selector: 'app-rename-account-modal',
  imports: [FormsModule, ShortAddressPipe],
  templateUrl: './rename-account-modal.html',
  styleUrl: './rename-account-modal.scss',
})
export class RenameAccountModal {
  protected readonly modal = inject(Modal);
  private readonly authStore = inject(AuthStore);
  private readonly toast = inject(Toast);

  protected readonly account = computed(() => this.modal.payload<VaultAccount>());
  protected readonly name = signal(this.account()?.name ?? '');
  protected readonly error = signal<string | null>(null);
  protected readonly isSaving = signal(false);

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
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.isSaving.set(false);
    }
  }
}
