import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../core/services/modal';
import { NETWORK_FEE_MAS, ROLL_PRICE_MAS } from '../../../core/services/massa-provider';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';

@Component({
  selector: 'app-sell-roll-modal',
  imports: [FormsModule, ConfirmDetails],
  templateUrl: './sell-roll-modal.html',
  styleUrl: './sell-roll-modal.scss',
})
export class SellRollModal {
  protected readonly modal = inject(Modal);
  private readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly rollPrice = ROLL_PRICE_MAS;
  protected readonly count = signal(1);
  protected readonly error = signal<string | null>(null);
  protected readonly isSelling = signal(false);
  /** `form` → pick a count; `confirm` → review, then Confirm or Cancel. */
  protected readonly step = signal<'form' | 'confirm'>('form');

  protected readonly maxRolls = computed(() => this.store.activeWallet().rolls.active);
  protected readonly proceeds = computed(() => this.count() * this.rollPrice);

  protected readonly confirmRows = computed<ConfirmRow[]>(() => {
    const count = this.count();
    return [
      { label: 'Rolls to sell', value: `${count}` },
      { label: 'You receive', value: `${this.proceeds().toLocaleString('en-US')} MAS`, strong: true },
      { label: 'Paid out', value: 'a few cycles after the sale' },
      { label: 'Network fee', value: `${NETWORK_FEE_MAS} MAS` },
      { label: 'Rolls left', value: `${Math.max(0, this.maxRolls() - count)}` },
    ];
  });

  /** Blocks sign/exponent keys — roll counts are positive whole numbers. */
  protected blockNonDigitKeys(event: KeyboardEvent): void {
    if (['-', '+', 'e', 'E', '.', ','].includes(event.key)) event.preventDefault();
  }

  protected review(): void {
    this.error.set(null);
    try {
      this.store.validateSellRolls(this.count());
      this.step.set('confirm');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  protected async confirm(): Promise<void> {
    const count = this.count();
    this.error.set(null);
    this.isSelling.set(true);
    try {
      await this.store.sellRolls(count);
      this.toast.show(`Selling ${count} roll${count > 1 ? 's' : ''} — unstaking`);
      this.modal.close();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.isSelling.set(false);
    }
  }
}
