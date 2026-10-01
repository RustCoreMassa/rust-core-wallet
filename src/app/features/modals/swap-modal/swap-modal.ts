import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TOKEN_LIST, TOKEN_REGISTRY, TokenSymbol } from '../../../core/models/token.model';
import { SWAP_STORAGE_COST_MAS, SwapQuote } from '../../../core/services/dusa-swap';
import { NETWORK_FEE_MAS } from '../../../core/services/massa-provider';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';
import { fromUnits } from '../../../core/utils/token-amount';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';
import { Dropdown, DropdownOption } from '../../../shared/ui/dropdown/dropdown';
import { formatDisplayAmount } from '../../../core/utils/display-amount';
import { toUserMessage } from '../../../core/utils/user-error';
import { AmountPipe } from '../../../shared/pipes/amount-pipe';

/** Quotes are re-read this long after the user stops typing. */
const QUOTE_DEBOUNCE_MS = 400;
const SLIPPAGE_CHOICES_BPS = [50, 100, 200] as const;

const fmt = (n: number, digits = 6) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

/** Swap any two tokens through Dusa (mainnet), with a review step before signing. */
@Component({
  selector: 'app-swap-modal',
  imports: [FormsModule, ConfirmDetails, Dropdown, AmountPipe],
  templateUrl: './swap-modal.html',
  styleUrl: './swap-modal.scss',
})
export class SwapModal {
  protected readonly modal = inject(Modal);
  protected readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly slippageChoices = SLIPPAGE_CHOICES_BPS;
  protected readonly isMainnet = computed(() => this.store.network() === 'mainnet');

  protected readonly fromToken = signal<TokenSymbol>('MAS');
  protected readonly toToken = signal<TokenSymbol>('USDC.e');
  protected readonly amount = signal<number | null>(null);
  protected readonly slippageBps = signal<number>(SLIPPAGE_CHOICES_BPS[0]);

  protected readonly quote = signal<SwapQuote | null>(null);
  protected readonly quoteError = signal<string | null>(null);
  protected readonly isQuoting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isSwapping = signal(false);
  /** `form` → pick tokens and amount; `confirm` → review, then Confirm or Cancel. */
  protected readonly step = signal<'form' | 'confirm'>('form');

  private quoteTimer: ReturnType<typeof setTimeout> | undefined;
  private quoteRequest = 0;

  /** Pay with: MAS plus any token this wallet holds. */
  protected readonly fromOptions = computed(() => {
    const balances = this.store.activeWallet().balances;
    return this.options(
      TOKEN_LIST.map((t) => t.symbol).filter((s) => s === 'MAS' || (balances[s] ?? 0) > 0),
    );
  });

  /** Receive: any other token. */
  protected readonly toOptions = computed(() =>
    this.options(TOKEN_LIST.map((t) => t.symbol).filter((s) => s !== this.fromToken())),
  );

  protected readonly fromBalance = computed(
    () => this.store.activeWallet().balances[this.fromToken()] ?? 0,
  );

  protected readonly receiveText = computed(() => {
    const q = this.quote();
    return q ? fmt(fromUnits(q.amountOut, TOKEN_REGISTRY[q.to].decimals)) : '';
  });

  protected readonly rateText = computed(() => {
    const q = this.quote();
    if (!q) return '';
    const inAmount = fromUnits(q.amountIn, TOKEN_REGISTRY[q.from].decimals);
    const outAmount = fromUnits(q.amountOut, TOKEN_REGISTRY[q.to].decimals);
    return `1 ${q.from} ≈ ${fmt(outAmount / inAmount, 8)} ${q.to}`;
  });

  protected readonly confirmRows = computed<ConfirmRow[]>(() => {
    const q = this.quote();
    if (!q) return [];
    const inDec = TOKEN_REGISTRY[q.from].decimals;
    const outDec = TOKEN_REGISTRY[q.to].decimals;
    const fees =
      q.from === 'MAS'
        ? `${NETWORK_FEE_MAS} MAS`
        : `${fmt(2 * NETWORK_FEE_MAS)} MAS (approval + swap)`;
    return [
      { label: 'You pay', value: `${fmt(fromUnits(q.amountIn, inDec))} ${q.from}` },
      {
        label: 'You receive',
        value: `≈ ${fmt(fromUnits(q.amountOut, outDec))} ${q.to}`,
        strong: true,
      },
      { label: 'Minimum received', value: `${fmt(fromUnits(q.minAmountOut, outDec))} ${q.to}` },
      { label: 'Rate', value: this.rateText() },
      { label: 'Price impact', value: `${fmt(q.priceImpactPct, 2)}%` },
      { label: 'Slippage tolerance', value: `${q.slippageBps / 100}%` },
      { label: 'Route', value: q.path.join(' → ') },
      { label: 'Swap deposit', value: `${SWAP_STORAGE_COST_MAS} MAS (router storage)` },
      { label: 'Network fee', value: fees },
    ];
  });

  constructor() {
    // Re-quote (debounced) whenever the pair, amount or slippage changes.
    effect(() => {
      const from = this.fromToken();
      const to = this.toToken();
      const amount = this.amount();
      const slippage = this.slippageBps();
      untracked(() => this.scheduleQuote(from, to, amount, slippage));
    });
  }

  protected setFromToken(token: TokenSymbol): void {
    if (token === this.toToken()) this.toToken.set(this.fromToken());
    this.fromToken.set(token);
  }

  protected flip(): void {
    const from = this.fromToken();
    this.fromToken.set(this.toToken());
    this.toToken.set(from);
    this.amount.set(null);
  }

  protected setMax(): void {
    this.amount.set(this.store.maxSwappable(this.fromToken()));
  }

  /** Amounts are positive decimals — block sign and exponent keys. */
  protected blockNonDecimalKeys(event: KeyboardEvent): void {
    if (['-', '+', 'e', 'E'].includes(event.key)) event.preventDefault();
  }

  protected review(): void {
    this.error.set(null);
    try {
      this.store.validateSwap(this.fromToken(), this.toToken(), this.amount() ?? 0);
      if (!this.quote()) throw new Error(this.quoteError() ?? 'Waiting for a quote…');
      this.step.set('confirm');
    } catch (err) {
      this.error.set(toUserMessage(err));
    }
  }

  protected async confirm(): Promise<void> {
    const q = this.quote();
    if (!q) return;
    this.error.set(null);
    this.isSwapping.set(true);
    try {
      await this.store.swap(q);
      this.toast.show(`Swapped ${this.fromText(q)} → ${this.receiveText()} ${q.to}`);
      this.modal.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isSwapping.set(false);
    }
  }

  private fromText(q: SwapQuote): string {
    return `${fmt(fromUnits(q.amountIn, TOKEN_REGISTRY[q.from].decimals))} ${q.from}`;
  }

  private scheduleQuote(
    from: TokenSymbol,
    to: TokenSymbol,
    amount: number | null,
    slippage: number,
  ): void {
    clearTimeout(this.quoteTimer);
    const request = ++this.quoteRequest;
    this.quote.set(null);
    this.quoteError.set(null);
    if (!this.isMainnet() || !amount || amount <= 0 || from === to) {
      this.isQuoting.set(false);
      return;
    }
    this.isQuoting.set(true);
    this.quoteTimer = setTimeout(async () => {
      try {
        const q = await this.store.quoteSwap(from, to, amount, slippage);
        if (request === this.quoteRequest) this.quote.set(q);
      } catch (err) {
        if (request === this.quoteRequest) {
          this.quoteError.set(toUserMessage(err));
        }
      } finally {
        if (request === this.quoteRequest) this.isQuoting.set(false);
      }
    }, QUOTE_DEBOUNCE_MS);
  }

  private options(symbols: TokenSymbol[]): DropdownOption<TokenSymbol>[] {
    const balances = this.store.activeWallet().balances;
    return symbols.map((symbol) => ({
      value: symbol,
      label: symbol,
      sublabel: TOKEN_REGISTRY[symbol].name,
      icon: TOKEN_REGISTRY[symbol].asset,
      trailing: formatDisplayAmount(balances[symbol] ?? 0),
    }));
  }
}
