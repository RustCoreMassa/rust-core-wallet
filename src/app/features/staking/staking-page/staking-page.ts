import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Modal } from '../../../core/services/modal';
import { ROLL_PRICE_MAS } from '../../../core/services/mock-massa-provider';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-staking-page',
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './staking-page.html',
  styleUrl: './staking-page.scss',
})
export class StakingPage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);

  protected readonly wallet = this.store.activeWallet;

  protected readonly finalMas = computed(() => this.wallet().balances.MAS);

  protected readonly stakedMas = computed(() => {
    const rolls = this.wallet().rolls;
    return (rolls.active + rolls.candidate + rolls.deferred) * ROLL_PRICE_MAS;
  });

  protected readonly totalMas = computed(() => this.finalMas() + this.stakedMas());

  protected readonly masPrice = computed(() => this.store.prices().MAS);
}
