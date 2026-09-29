import { Injectable } from '@angular/core';
import { Args, ArrayTypes, JsonRpcPublicProvider } from '@massalabs/massa-web3';
import { TOKEN_LIST, TOKEN_REGISTRY, TokenMeta, TokenPrices } from '../models/token.model';
import { fromUnits } from '../utils/token-amount';

/** Dusa (Liquidity Book DEX) mainnet quoters, as published in @dusalabs/sdk. */
const V2_QUOTER = 'AS1d3DvZeqTo3Uq7mfAAUmNggjFXqEfGGpSUv6uTYvikVVW8EybN'; // V2_LB_QUOTER_ADDRESS
const V1_QUOTER = 'AS12VBT5xeL3XdXhLwnpyMVB8re5RcMuW4Z8ragCKEKnDDCEkYjXL'; // LB_QUOTER_ADDRESS

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
  { quoter: V2_QUOTER, checkLegacy: false },
  { quoter: V2_QUOTER, checkLegacy: true },
  { quoter: V1_QUOTER, checkLegacy: true },
];
/** Wrapped MAS — how native MAS is represented in Dusa pools. */
const WMAS = 'AS12U4TZfNK7qoLyEERBBRDMu8nm5MKoRzPXDXans4v9wdATZedz9';
const WMAS_DECIMALS = 9;
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
      parameter: new Args()
        .addArray(route, ArrayTypes.STRING)
        .addU256(amountIn)
        .addBool(source.checkLegacy)
        .serialize(),
    });
    if (result.info.error || !result.value?.length)
      throw new Error(result.info.error || 'No quote');

    // Quote layout: route, pairs, binSteps, amounts, virtualAmountsWithoutSlippage, fees
    const args = new Args(result.value);
    args.nextArray(ArrayTypes.STRING);
    args.nextArray(ArrayTypes.STRING);
    args.nextArray(ArrayTypes.U64);
    args.nextArray(ArrayTypes.U256);
    const spot = args.nextArray(ArrayTypes.U256) as bigint[];
    return spot.at(-1) ?? 0n;
  }
}
