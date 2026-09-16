import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../core/services/modal';
import { ROLL_PRICE_MAS } from '../../../core/services/mock-massa-provider';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-sell-roll-modal',
  imports: [FormsModule],
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

  protected readonly maxRolls = computed(() => this.store.activeWallet().rolls.active);
  protected readonly proceeds = computed(() => this.count() * this.rollPrice);

  protected async submit(): Promise<void> {
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
