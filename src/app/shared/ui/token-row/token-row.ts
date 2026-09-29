import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { TOKEN_REGISTRY, TokenSymbol } from '../../../core/models/token.model';

/** MRC-20s carry 18 decimals on-chain — far more than a list row can usefully show. */
const MAX_DISPLAY_DECIMALS = 6;

@Component({
  selector: 'app-token-row',
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './token-row.html',
  styleUrl: './token-row.scss',
})
export class TokenRow {
  readonly symbol = input.required<TokenSymbol>();
  readonly balance = input.required<number>();
  /** Missing for tokens without market data — the row then hides price/variation. */
  readonly price = input<number>(0);
  readonly changePct = input<number>(0);

  protected readonly meta = computed(() => TOKEN_REGISTRY[this.symbol()]);
  /** Set when the icon image fails to load — the row falls back to a symbol badge. */
  protected readonly iconFailed = signal(false);
  protected readonly hasPrice = computed(() => this.price() > 0);
  protected readonly usdValue = computed(() => this.balance() * this.price());
  protected readonly amountFormat = computed(
    () => `1.2-${Math.min(this.meta().decimals, MAX_DISPLAY_DECIMALS)}`,
  );
}
