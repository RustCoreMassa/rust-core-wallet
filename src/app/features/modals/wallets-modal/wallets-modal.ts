import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VaultAccount } from '../../../core/models/vault.model';
import { MASSA_PROVIDER } from '../../../core/services/massa-provider';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { AmountPipe } from '../../../shared/pipes/amount-pipe';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { AVATAR_COLORS } from '../../../shared/ui/avatar-colors';
import { toUserMessage } from '../../../core/utils/user-error';

type Step = 'list' | 'choice' | 'import' | 'generating';

/**
 * "Your wallets" switcher AND the entry point for adding another one.
 * The list is driven by AuthStore (real accounts, real keys); adding a
 * wallet mirrors registration exactly — generate or import, with a
 * name that can't collide with an existing one. WalletStore supplies the
 * on-chain MAS balance shown per row (see `ensureWallet`).
 */
@Component({
  selector: 'app-wallets-modal',
  imports: [ShortAddressPipe, FormsModule, AmountPipe],
  templateUrl: './wallets-modal.html',
  styleUrl: './wallets-modal.scss',
})
export class WalletsModal {
  protected readonly modal = inject(Modal);
  protected readonly store = inject(WalletStore);
  protected readonly authStore = inject(AuthStore);
  private readonly provider = inject(MASSA_PROVIDER);
  private readonly toast = inject(Toast);

  protected readonly step = signal<Step>('list');
  protected readonly importName = signal('');
  protected readonly importKey = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly isBusy = signal(false);

  constructor() {
    // The list shows every wallet's balance — bring them all up to date.
    void this.store.refreshAll();
  }

  protected avatarColors(index: number): readonly [string, string] {
    return AVATAR_COLORS[index % AVATAR_COLORS.length];
  }

  protected initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  /** `null` until the wallet's first chain read — shown as a placeholder, never a fake 0. */
  protected balanceFor(accountId: string): number | null {
    const wallet = this.store.wallets()[accountId];
    return wallet?.loaded ? (wallet.balances.MAS ?? 0) : null;
  }

  protected select(id: string): void {
    this.store.switchWallet(id);
    this.modal.close();
    this.toast.show(`Switched to ${this.store.activeWallet().name}`);
  }

  protected startAddFlow(): void {
    this.error.set(null);
    this.step.set('choice');
  }

  protected backToList(): void {
    this.error.set(null);
    this.importName.set('');
    this.importKey.set('');
    this.step.set('list');
  }

  protected startImportFlow(): void {
    this.error.set(null);
    this.importName.set(this.authStore.suggestWalletName());
    this.step.set('import');
  }

  protected async generateNewWallet(): Promise<void> {
    this.error.set(null);
    this.step.set('generating');
    try {
      const { privateKey, address } = await this.provider.generateAccount();
      const name = this.authStore.suggestWalletName();
      await this.addAccount({ id: crypto.randomUUID(), name, address, privateKey });
    } catch (err) {
      this.error.set(toUserMessage(err));
      this.step.set('choice');
    }
  }

  protected async submitImportedKey(): Promise<void> {
    const privateKey = this.importKey().trim();
    const name = this.importName().trim();
    this.error.set(null);

    if (!privateKey) {
      this.error.set('Paste a private key first');
      return;
    }
    if (!name) {
      this.error.set('Give this wallet a name');
      return;
    }
    if (this.authStore.isNameTaken(name)) {
      this.error.set('That name is already used by another wallet');
      return;
    }

    this.isBusy.set(true);
    try {
      const address = await this.provider.resolveAddress(privateKey);
      if (!address) {
        this.error.set('That private key looks invalid');
        return;
      }
      await this.addAccount({ id: crypto.randomUUID(), name, address, privateKey });
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isBusy.set(false);
    }
  }

  private async addAccount(account: VaultAccount): Promise<void> {
    await this.authStore.saveAccounts([...this.authStore.accounts(), account]);
    this.store.ensureWallet(account.id, account.name, account.address);
    this.store.switchWallet(account.id);
    this.toast.show(`${account.name} added`);
    this.modal.close();
  }
}
