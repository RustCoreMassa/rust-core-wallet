import { CurrencyPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { TOKEN_REGISTRY, TokenSymbol } from '../../../core/models/token.model';
import { AmountPipe } from '../../pipes/amount-pipe';

@Component({
  selector: 'app-token-row',
  imports: [CurrencyPipe, AmountPipe],
  templateUrl: './token-row.html',
  styleUrl: './token-row.scss',
})
export class TokenRow {
  readonly symbol = input.required<TokenSymbol>();
  readonly balance = input.required<number>();
  /** USD price from Dusa; 0 for tokens without Dusa liquidity — the row then hides it. */
  readonly price = input<number>(0);

  protected readonly meta = computed(() => TOKEN_REGISTRY[this.symbol()]);
  /** Set when the icon image fails to load — the row falls back to a symbol badge. */
  protected readonly iconFailed = signal(false);
  protected readonly hasPrice = computed(() => this.price() > 0);
  protected readonly usdValue = computed(() => this.balance() * this.price());

  /** Sub-dollar prices keep 4 significant digits (MAS ≈ $0.01266, not $0.01). */
  protected readonly priceText = computed(() => {
    const price = this.price();
    return price >= 1
      ? price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      : `$${price.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`;
  });
}
