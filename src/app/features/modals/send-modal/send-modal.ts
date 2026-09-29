import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TOKEN_LIST, TOKEN_REGISTRY, TokenSymbol } from '../../../core/models/token.model';
import { NETWORK_FEE_MAS } from '../../../core/services/massa-provider';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { MIN_SEND_AMOUNT, WalletStore } from '../../../core/state/wallet-store';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';
import { Dropdown, DropdownOption } from '../../../shared/ui/dropdown/dropdown';

@Component({
  selector: 'app-send-modal',
  imports: [FormsModule, ConfirmDetails, Dropdown],
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

  /** Asset picker entries: icon, symbol, full name, balance. */
  protected readonly tokenOptions = computed<DropdownOption<TokenSymbol>[]>(() => {
    const balances = this.store.activeWallet().balances;
    return this.tokens().map((symbol) => ({
      value: symbol,
      label: symbol,
      sublabel: TOKEN_REGISTRY[symbol].name,
      icon: TOKEN_REGISTRY[symbol].asset,
      trailing: (balances[symbol] ?? 0).toLocaleString('en-US', { maximumFractionDigits: 6 }),
    }));
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

  protected readonly minAmount = MIN_SEND_AMOUNT;
  protected readonly networkFee = NETWORK_FEE_MAS;

  /** Balance minus the network fee for MAS; the full balance for MRC-20s (fee is paid in MAS). */
  protected setMax(): void {
    this.amount.set(this.store.maxSendable(this.token()));
  }

  /** Amounts are positive decimals — block sign and exponent keys. */
  protected blockNonDecimalKeys(event: KeyboardEvent): void {
    if (['-', '+', 'e', 'E'].includes(event.key)) event.preventDefault();
  }

  /** `form` → fill in; `confirm` → review the details, then Confirm or Cancel. */
  protected readonly step = signal<'form' | 'confirm'>('form');

  protected readonly confirmRows = computed<ConfirmRow[]>(() => {
    const token = this.token();
    const amount = this.amount() ?? 0;
    const wallet = this.store.activeWallet();
    const price = this.store.prices()[token];
    const fee = this.networkFee;
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 9 });
    const recipient = this.store.walletList().find((w) => w.address === this.address().trim());

    return [
      { label: 'From', value: `${wallet.name} · ${shortAddress(wallet.address)}` },
      {
        label: recipient ? `To (${recipient.name})` : 'To',
        value: this.address().trim(),
        mono: true,
      },
      {
        label: 'Amount',
        value:
          `${fmt(amount)} ${token}` +
          (price
            ? ` (≈ $${(amount * price).toLocaleString('en-US', { maximumFractionDigits: 2 })})`
            : ''),
      },
      { label: 'Network fee', value: `${fee} MAS` },
      {
        label: 'Total',
        value:
          token === 'MAS' ? `${fmt(amount + fee)} MAS` : `${fmt(amount)} ${token} + ${fee} MAS`,
        strong: true,
      },
      { label: 'Network', value: this.store.network() === 'mainnet' ? 'Mainnet' : 'Buildnet' },
    ];
  });

  /** Runs every pre-flight check, then shows the confirmation step. */
  protected review(): void {
    this.error.set(null);
    try {
      this.store.validateSend(this.token(), this.address().trim(), this.amount() ?? 0);
      this.step.set('confirm');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  protected async confirm(): Promise<void> {
    const address = this.address().trim();
    const amount = this.amount() ?? 0;
    this.error.set(null);
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
    this.step.set('form');
  }
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
