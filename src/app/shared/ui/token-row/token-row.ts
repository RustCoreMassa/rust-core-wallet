import { Component, computed, input } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { TOKEN_REGISTRY, TokenSymbol } from '../../../core/models/token.model';

const ICON_LABEL: Record<TokenSymbol, string> = { MAS: 'MAS', USDC: '$', WETH: 'Ξ' };

@Component({
  selector: 'app-token-row',
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './token-row.html',
  styleUrl: './token-row.scss',
})
export class TokenRow {
  readonly symbol = input.required<TokenSymbol>();
  readonly balance = input.required<number>();
  readonly price = input.required<number>();
  readonly changePct = input.required<number>();

  protected readonly meta = computed(() => TOKEN_REGISTRY[this.symbol()]);
  protected readonly iconLabel = computed(() => ICON_LABEL[this.symbol()]);
  protected readonly iconClass = computed(() => this.symbol().toLowerCase());
  protected readonly usdValue = computed(() => this.balance() * this.price());
  protected readonly amountFormat = computed(() => `1.2-${this.meta().decimals}`);
}
