import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TOKEN_LIST, TokenSymbol } from '../../../core/models/token.model';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-send-modal',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './send-modal.html',
  styleUrl: './send-modal.scss',
})
export class SendModal {
  protected readonly modal = inject(Modal);
  protected readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly token = signal<TokenSymbol>('MAS');
  protected readonly address = signal('');
  protected readonly amount = signal<number | null>(null);
  protected readonly saveChecked = signal(false);
  protected readonly saveName = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly isSending = signal(false);

  /** MAS is always offered; an MRC-20 only when this wallet actually holds some. */
  protected readonly tokens = computed<TokenSymbol[]>(() => {
    const balances = this.store.activeWallet().balances;
    return TOKEN_LIST.map((t) => t.symbol).filter((s) => s === 'MAS' || (balances[s] ?? 0) > 0);
  });

  protected readonly otherWallets = computed(() =>
    this.store.walletList().filter((w) => w.id !== this.store.activeWalletId()),
  );

  protected readonly savedAddresses = this.store.addressBook;

  protected readonly availableBalance = computed(
    () => this.store.activeWallet().balances[this.token()] ?? 0,
  );

  protected readonly isKnownAddress = computed(() =>
    this.store.knownAddresses().has(this.address().trim()),
  );

  protected readonly showSaveOption = computed(
    () => this.address().trim().length > 0 && !this.isKnownAddress(),
  );

  protected pickAddress(value: string): void {
    this.address.set(value);
    this.saveChecked.set(false);
  }

  protected setMax(): void {
    this.amount.set(this.availableBalance());
  }

  protected async submit(): Promise<void> {
    const address = this.address().trim();
    const amount = this.amount() ?? 0;
    this.error.set(null);

    if (!address) {
      this.error.set('Enter a recipient address');
      return;
    }

    this.isSending.set(true);
    try {
      const result = await this.store.send(this.token(), address, amount);

      if (this.saveChecked()) {
        const name = this.saveName().trim() || address;
        this.store.saveAddress(name, address);
      }

      this.toast.show(
        (result.internal ? 'Sent to your wallet: ' : 'Sent ') + `${amount} ${this.token()}`,
      );
      this.reset();
      this.modal.close();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.isSending.set(false);
    }
  }

  private reset(): void {
    this.address.set('');
    this.amount.set(null);
    this.saveChecked.set(false);
    this.saveName.set('');
  }
}
