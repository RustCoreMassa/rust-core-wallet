import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Modal } from '../../../core/services/modal';
import { WalletStore } from '../../../core/state/wallet-store';
import { HistoryRow } from '../../../shared/ui/history-row/history-row';
import { TokenRow } from '../../../shared/ui/token-row/token-row';

type HomeTab = 'tokens' | 'history';

/** Tokens worth less than this (USD) count as "low balance" and are hidden by default. */
const LOW_BALANCE_USD = 1;
const SHOW_ALL_KEY = 'massa-wallet:show-all-tokens';

function loadShowAll(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === 'true';
  } catch {
    return false;
  }
}

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

  protected readonly showAllTokens = signal(loadShowAll());

  /** Tokens on this network worth under LOW_BALANCE_USD — MAS is never one. */
  private readonly lowBalanceTokens = computed(() => {
    const balances = this.wallet().balances;
    const prices = this.store.prices();
    return new Set(
      this.store
        .availableTokens()
        .filter((s) => s !== 'MAS' && (balances[s] ?? 0) * (prices[s] ?? 0) < LOW_BALANCE_USD),
    );
  });

  protected readonly hiddenCount = computed(() =>
    this.showAllTokens() ? 0 : this.lowBalanceTokens().size,
  );

  /** Registry order; low-balance tokens only when "show all" is on. */
  protected readonly tokenSymbols = computed(() => {
    const low = this.lowBalanceTokens();
    return this.store
      .availableTokens()
      .filter((symbol) => this.showAllTokens() || !low.has(symbol));
  });

  protected setTab(tab: HomeTab): void {
    this.activeTab.set(tab);
  }

  protected toggleShowAllTokens(): void {
    const next = !this.showAllTokens();
    this.showAllTokens.set(next);
    try {
      localStorage.setItem(SHOW_ALL_KEY, String(next));
    } catch {
      // Storage unavailable — the choice still holds until reload.
    }
  }
}
