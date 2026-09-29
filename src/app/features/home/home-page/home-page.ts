import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TOKEN_LIST } from '../../../core/models/token.model';
import { Modal } from '../../../core/services/modal';
import { WalletStore } from '../../../core/state/wallet-store';
import { HistoryRow } from '../../../shared/ui/history-row/history-row';
import { TokenRow } from '../../../shared/ui/token-row/token-row';

type HomeTab = 'tokens' | 'history';

@Component({
  selector: 'app-home-page',
  imports: [CurrencyPipe, DecimalPipe, TokenRow, HistoryRow],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);

  protected readonly activeTab = signal<HomeTab>('tokens');

  protected readonly wallet = this.store.activeWallet;
  protected readonly totalUsd = this.store.portfolioValueUsd;

  protected readonly changePct = computed(() => this.store.dayChangePct().MAS ?? 0);

  /** MAS always; an MRC-20 only when this wallet holds some — registry order. */
  protected readonly tokenSymbols = computed(() => {
    const balances = this.wallet().balances;
    return TOKEN_LIST.map((t) => t.symbol).filter(
      (symbol) => symbol === 'MAS' || (balances[symbol] ?? 0) > 0,
    );
  });

  protected setTab(tab: HomeTab): void {
    this.activeTab.set(tab);
  }
}
