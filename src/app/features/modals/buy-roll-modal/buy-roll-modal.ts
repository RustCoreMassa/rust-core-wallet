import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../core/services/modal';
import { NETWORK_FEE_MAS, ROLL_PRICE_MAS } from '../../../core/services/massa-provider';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';

@Component({
  selector: 'app-buy-roll-modal',
  imports: [FormsModule, ConfirmDetails],
  templateUrl: './buy-roll-modal.html',
  styleUrl: './buy-roll-modal.scss',
})
export class BuyRollModal {
  protected readonly modal = inject(Modal);
  private readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly rollPrice = ROLL_PRICE_MAS;
  protected readonly networkFee = NETWORK_FEE_MAS;
  protected readonly count = signal(1);
  protected readonly error = signal<string | null>(null);
  protected readonly isBuying = signal(false);
  /** `form` → pick a count; `confirm` → review, then Confirm or Cancel. */
  protected readonly step = signal<'form' | 'confirm'>('form');

  protected readonly cost = computed(() => this.count() * this.rollPrice);

  protected readonly confirmRows = computed<ConfirmRow[]>(() => {
    const count = this.count();
    const balance = this.store.activeWallet().balances.MAS ?? 0;
    const total = this.cost() + NETWORK_FEE_MAS;
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 9 });
    return [
      { label: 'Rolls', value: `${count}` },
      { label: 'Price per roll', value: `${this.rollPrice} MAS` },
      { label: 'Cost', value: `${fmt(this.cost())} MAS` },
      { label: 'Network fee', value: `${NETWORK_FEE_MAS} MAS` },
      { label: 'Total', value: `${fmt(total)} MAS`, strong: true },
      { label: 'Balance after', value: `${fmt(Math.max(0, balance - total))} MAS` },
      { label: 'Activation', value: 'after 3 cycles (~1 h 40 min)' },
    ];
  });

  /** Blocks sign/exponent keys — roll counts are positive whole numbers. */
  protected blockNonDigitKeys(event: KeyboardEvent): void {
    if (['-', '+', 'e', 'E', '.', ','].includes(event.key)) event.preventDefault();
  }

  protected review(): void {
    this.error.set(null);
    try {
      this.store.validateBuyRolls(this.count());
      this.step.set('confirm');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  protected async confirm(): Promise<void> {
    const count = this.count();
    this.error.set(null);
    this.isBuying.set(true);
    try {
      await this.store.buyRolls(count);
      this.toast.show(`Bought ${count} roll${count > 1 ? 's' : ''}`);
      this.modal.close();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.isBuying.set(false);
    }
  }
}
