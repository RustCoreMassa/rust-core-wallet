import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../core/services/modal';
import { ROLL_PRICE_MAS } from '../../../core/services/massa-provider';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-buy-roll-modal',
  imports: [FormsModule],
  templateUrl: './buy-roll-modal.html',
  styleUrl: './buy-roll-modal.scss',
})
export class BuyRollModal {
  protected readonly modal = inject(Modal);
  private readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly rollPrice = ROLL_PRICE_MAS;
  protected readonly count = signal(1);
  protected readonly error = signal<string | null>(null);
  protected readonly isBuying = signal(false);

  protected readonly cost = computed(() => this.count() * this.rollPrice);

  protected async submit(): Promise<void> {
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
