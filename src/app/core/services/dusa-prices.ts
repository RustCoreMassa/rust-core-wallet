import { Injectable } from '@angular/core';
import { JsonRpcPublicProvider } from '@massalabs/massa-web3';
import { TOKEN_LIST, TOKEN_REGISTRY, TokenMeta, TokenPrices } from '../models/token.model';
import { fromUnits } from '../utils/token-amount';
import { DUSA, decodeQuote, quoteArgs } from './dusa-contracts';

interface QuoteSource {
  readonly quoter: string;
  /** Also consider legacy (pre-V2) pools. */
  readonly checkLegacy: boolean;
}

/**
 * Where to read a price from, most trustworthy first. Liquidity lives in
 * the V2 pools; legacy pools are largely abandoned and their prices go
 * stale (e.g. MAS reading $0.0127 there while trading at ~$0.0032), so
 * they're only a fallback for tokens with no V2 pool at all — never
 * mixed in with a V2 price.
 */
const QUOTE_SOURCES: readonly QuoteSource[] = [
  { quoter: DUSA.v2Quoter, checkLegacy: false },
  { quoter: DUSA.v2Quoter, checkLegacy: true },
  { quoter: DUSA.v1Quoter, checkLegacy: true },
];
const WMAS = DUSA.wmas;
const WMAS_DECIMALS = DUSA.wmasDecimals;
const USDC = TOKEN_REGISTRY['USDC.e'];

/**
 * USD prices for the wallet's tokens, read on-chain from Dusa's quoter
 * contracts (read-only calls, no fee, no key).
 *
 * For each token the quoter is asked what selling exactly one unit
 * would return, taking the spot amount (`virtualAmountsWithoutSlippage`)
 * of the best pool, from the first source in QUOTE_SOURCES that has one:
 *  - MAS: WMAS → USDC.e directly;
 *  - MRC-20s: → USDC.e directly, and → WMAS priced at the MAS rate;
 *    the better of the two wins. (A single two-hop X → WMAS → USDC.e
 *    quote under-reports thin pools, so the hop is done in two steps.)
 *
 * Tokens with no Dusa liquidity get no price rather than a made-up one.
 * Always mainnet: these are mainnet token contracts.
 */
@Injectable({ providedIn: 'root' })
export class DusaPrices {
  private readonly provider = JsonRpcPublicProvider.mainnet();

  async getUsdPrices(): Promise<TokenPrices> {
    const masUsd = await this.firstPrice((source) =>
      this.quoteOne(source, WMAS, WMAS_DECIMALS, USDC.contract, USDC.decimals),
    );
    const prices: TokenPrices = { 'USDC.e': 1 };
    if (masUsd > 0) prices.MAS = masUsd;

    // One token at a time (≤ 2 calls in flight): the public mainnet RPC
    // node starts rejecting requests at ~30 concurrent ones, and balance
    // reads run alongside.
    for (const token of TOKEN_LIST.filter((t) => t.isErc20 && t.symbol !== 'USDC.e')) {
      const usd = await this.tokenUsd(token, masUsd);
      if (usd > 0) prices[token.symbol] = usd;
    }
    return prices;
  }

  private tokenUsd(token: TokenMeta, masUsd: number): Promise<number> {
    return this.firstPrice(async (source) => {
      const [direct, inMas] = await Promise.all([
        this.quoteOne(source, token.contract, token.decimals, USDC.contract, USDC.decimals),
        this.quoteOne(source, token.contract, token.decimals, WMAS, WMAS_DECIMALS),
      ]);
      return Math.max(direct, inMas * masUsd);
    });
  }

  /** Walks QUOTE_SOURCES in order; the first positive price wins, 0 if none has one. */
  private async firstPrice(priceFrom: (source: QuoteSource) => Promise<number>): Promise<number> {
    for (const source of QUOTE_SOURCES) {
      const price = await priceFrom(source);
      if (price > 0) return price;
    }
    return 0;
  }

  /** Output (human units) for selling 1 `from`; 0 without liquidity or on a failed read. */
  private async quoteOne(
    source: QuoteSource,
    from: string,
    fromDecimals: number,
    to: string,
    toDecimals: number,
  ): Promise<number> {
    try {
      const out = await this.quote(source, [from, to], 10n ** BigInt(fromDecimals));
      return fromUnits(out, toDecimals);
    } catch {
      return 0;
    }
  }

  /** Spot output amount (smallest units) of the best path for `route`. */
  private async quote(source: QuoteSource, route: string[], amountIn: bigint): Promise<bigint> {
    const result = await this.provider.readSC({
      target: source.quoter,
      func: 'findBestPathFromAmountIn',
      parameter: quoteArgs(route, amountIn, source.checkLegacy),
    });
    if (result.info.error || !result.value?.length)
      throw new Error(result.info.error || 'No quote');
    const spot = decodeQuote(result.value).virtualAmountsWithoutSlippage;
    return spot.at(-1) ?? 0n;
  }
}
