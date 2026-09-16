import { CurrencyPipe, DecimalPipe, KeyValuePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TokenSymbol } from '../../../core/models/token.model';
import { Modal } from '../../../core/services/modal';
import { WalletStore } from '../../../core/state/wallet-store';
import { HistoryRow } from '../../../shared/ui/history-row/history-row';
import { TokenRow } from '../../../shared/ui/token-row/token-row';

type HomeTab = 'tokens' | 'history';

@Component({
  selector: 'app-home-page',
  imports: [CurrencyPipe, DecimalPipe, KeyValuePipe, TokenRow, HistoryRow],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);

  protected readonly activeTab = signal<HomeTab>('tokens');

  protected readonly wallet = this.store.activeWallet;
  protected readonly totalUsd = this.store.portfolioValueUsd;

  protected readonly changePct = computed(() => this.store.dayChangePct().MAS);

  protected readonly tokenSymbols = computed(
    () => Object.keys(this.wallet().balances) as TokenSymbol[],
  );

  protected setTab(tab: HomeTab): void {
    this.activeTab.set(tab);
  }
}
