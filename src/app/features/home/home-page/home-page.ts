import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TokenSymbol } from '../../../core/models/token.model';
import { Modal } from '../../../core/services/modal';
import { WalletStore } from '../../../core/state/wallet-store';
import { HistoryRow } from '../../../shared/ui/history-row/history-row';
import { TokenRow } from '../../../shared/ui/token-row/token-row';

type HomeTab = 'tokens' | 'history';

/** Tokens worth less than this (USD) count as "low balance" and are hidden by default. */
const LOW_BALANCE_USD = 0.1;
const SHOW_ALL_KEY = 'massa-wallet:show-all-tokens';
/** Distance from the bottom of the list (px) at which the next history page loads. */
const NEAR_BOTTOM_PX = 120;

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

  protected readonly showAllTokens = signal(loadShowAll());

  /**
   * Tokens on this network worth under LOW_BALANCE_USD — MAS is never one.
   * A held token with no Dusa price can't be valued, so only an empty one
   * counts as low; hiding a real holding just for lacking a price would
   * be wrong.
   */
  private readonly lowBalanceTokens = computed(() => {
    const balances = this.wallet().balances;
    const prices = this.store.prices();
    return new Set(
      this.store.availableTokens().filter((s) => {
        if (s === 'MAS') return false;
        const balance = balances[s] ?? 0;
        const price = prices[s];
        return price === undefined ? balance === 0 : balance * price < LOW_BALANCE_USD;
      }),
    );
  });

  protected readonly hiddenCount = computed(() =>
    this.showAllTokens() ? 0 : this.lowBalanceTokens().size,
  );

  /**
   * MAS first, then the MRC-20s by USD value, highest first. Tokens
   * without a Dusa price (value unknown) come after the priced ones;
   * ties keep registry order. Low-balance tokens only when "show all" is on.
   */
  protected readonly tokenSymbols = computed(() => {
    const low = this.lowBalanceTokens();
    const balances = this.wallet().balances;
    const prices = this.store.prices();
    const usdValue = (s: TokenSymbol) =>
      prices[s] === undefined ? -1 : (balances[s] ?? 0) * prices[s];

    const [mas, ...others] = this.store
      .availableTokens()
      .filter((symbol) => this.showAllTokens() || !low.has(symbol));
    // Array.prototype.sort is stable, so equal values keep registry order.
    return [mas, ...others.sort((a, b) => usdValue(b) - usdValue(a))];
  });

  protected setTab(tab: HomeTab): void {
    this.activeTab.set(tab);
  }

  protected loadMoreHistory(): void {
    this.store.loadMoreHistory().catch((err) => console.warn('Loading more history failed', err));
  }

  /** Infinite scroll for History: fetch the next page near the bottom. */
  protected onListScroll(event: Event): void {
    if (this.activeTab() !== 'history' || !this.store.hasMoreHistory()) return;
    const el = event.target as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) this.loadMoreHistory();
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
