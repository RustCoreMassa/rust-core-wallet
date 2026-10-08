import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TokenMeta } from '../../../core/models/token.model';
import { KeyValueStore, LOCAL_STORE } from '../../../core/platform/app-storage';
import { Modal } from '../../../core/services/modal';
import { WalletStore } from '../../../core/state/wallet-store';
import { AmountPipe } from '../../../shared/pipes/amount-pipe';
import { HistoryRow } from '../../../shared/ui/history-row/history-row';
import { TokenRow } from '../../../shared/ui/token-row/token-row';

type HomeTab = 'tokens' | 'history';

/** Tokens worth less than this (USD) count as "low balance" and are hidden by default. */
const LOW_BALANCE_USD = 0.1;
const SHOW_ALL_KEY = 'massa-wallet:show-all-tokens';
/** Distance from the bottom of the list (px) at which the next history page loads. */
const NEAR_BOTTOM_PX = 120;

function loadShowAll(store: KeyValueStore): boolean {
  try {
    return store.getItem(SHOW_ALL_KEY) === 'true';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-home-page',
  imports: [CurrencyPipe, AmountPipe, TokenRow, HistoryRow],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);
  private readonly localStore = inject(LOCAL_STORE);

  protected readonly activeTab = signal<HomeTab>('tokens');

  protected readonly wallet = this.store.activeWallet;
  /** All tokens with a Dusa price — shown as the Tokens tab total. */
  protected readonly totalUsd = this.store.portfolioValueUsd;

  /** The header shows MAS only, so its USD line is MAS only too. */
  protected readonly masUsd = computed(
    () => (this.wallet().balances.MAS ?? 0) * (this.store.prices().MAS ?? 0),
  );

  protected readonly showAllTokens = signal(loadShowAll(this.localStore));

  /**
   * Tokens on this network worth under LOW_BALANCE_USD — MAS and tokens the
   * user added never are. A held token with no Dusa price can't be valued,
   * so only an empty one counts as low; hiding a real holding just for
   * lacking a price would be wrong.
   */
  private readonly lowBalanceTokens = computed(() => {
    const balances = this.wallet().balances;
    const prices = this.store.prices();
    return new Set(
      this.store
        .availableTokens()
        .filter((t) => {
          if (t.id === 'MAS' || t.custom) return false;
          const balance = balances[t.id] ?? 0;
          const price = prices[t.id];
          return price === undefined ? balance === 0 : balance * price < LOW_BALANCE_USD;
        })
        .map((t) => t.id),
    );
  });

  protected readonly hiddenCount = computed(() =>
    this.showAllTokens() ? 0 : this.lowBalanceTokens().size,
  );

  /**
   * MAS first, then the MRC-20s by USD value, highest first. Tokens
   * without a Dusa price (value unknown — custom tokens among them) come
   * after the priced ones; ties keep catalog order (built-in, then custom as
   * added). Low-balance tokens only when "show all" is on.
   */
  protected readonly tokens = computed(() => {
    const low = this.lowBalanceTokens();
    const balances = this.wallet().balances;
    const prices = this.store.prices();
    const usdValue = ({ id }: TokenMeta) => {
      const price = prices[id];
      return price === undefined ? -1 : (balances[id] ?? 0) * price;
    };

    const [mas, ...others] = this.store
      .availableTokens()
      .filter((t) => this.showAllTokens() || !low.has(t.id));
    // Array.prototype.sort is stable, so equal values keep catalog order.
    return [mas, ...others.sort((a, b) => usdValue(b) - usdValue(a))];
  });

  /** Low-balance toggle: only when there's something besides MAS that could be hidden. */
  protected readonly hasBuiltinTokens = computed(() =>
    this.store.availableTokens().some((t) => t.isErc20 && !t.custom),
  );

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
      this.localStore.setItem(SHOW_ALL_KEY, String(next));
    } catch {
      // Storage unavailable — the choice still holds until reload.
    }
  }
}
