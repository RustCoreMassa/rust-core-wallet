import { Injectable } from '@angular/core';
import {
  Account,
  Args,
  ArrayTypes,
  JsonRpcPublicProvider,
  MRC20,
  Web3Provider,
} from '@massalabs/massa-web3';
import { TOKEN_REGISTRY, TokenSymbol } from '../models/token.model';
import { DUSA, DusaQuote, decodeQuote, quoteArgs } from './dusa-contracts';
import { OperationResult } from './massa-provider';
import { waitExecuted } from './operation-execution';

/** MAS the router requires with every swap for storage (`SWAP_STORAGE_COST` in the SDK). */
export const SWAP_STORAGE_COST_MAS = 0.1;
const SWAP_STORAGE_COST = 100_000_000n; // 0.1 MAS in nanoMAS
/** How long a signed swap stays valid on-chain. */
const SWAP_TTL_MS = 10 * 60_000;
const BPS = 10_000n;

export interface SwapQuote {
  readonly from: TokenSymbol;
  readonly to: TokenSymbol;
  /** Smallest units of `from` / `to`. */
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  /** The least the router will accept to pay out (slippage applied), or it reverts. */
  readonly minAmountOut: bigint;
  /** How far `amountOut` is below the pools' spot price, in %. */
  readonly priceImpactPct: number;
  readonly slippageBps: number;
  /** Token symbols along the path, for display (MAS for WMAS). */
  readonly path: TokenSymbol[];
  readonly quote: DusaQuote;
}

/** Token contract as it appears in a Dusa path — native MAS travels as WMAS. */
function pathAddress(symbol: TokenSymbol): string {
  return symbol === 'MAS' ? DUSA.wmas : TOKEN_REGISTRY[symbol].contract;
}

function symbolForAddress(address: string): TokenSymbol {
  if (address === DUSA.wmas) return 'MAS';
  const token = Object.values(TOKEN_REGISTRY).find((t) => t.contract === address);
  if (!token) throw new Error(`Unknown token in route: ${address}`);
  return token.symbol;
}

/**
 * Swaps through Dusa (mainnet), mirroring @dusalabs/sdk's QuoterHelper and
 * TradeV2.swapCallParameters for exact-input trades — same contracts, same
 * argument encoding — on the app's own massa-web3.
 *
 * Quotes come from the V2 quoter over V2 pools only (legacy pools hold
 * stale prices) and are executed on the V2 router with the quote's
 * `isLegacy` flags. Candidate paths: direct, via WMAS and via USDC.e;
 * the one paying out most wins.
 */
@Injectable({ providedIn: 'root' })
export class DusaSwap {
  private readonly publicProvider = JsonRpcPublicProvider.mainnet();

  async quote(
    from: TokenSymbol,
    to: TokenSymbol,
    amountIn: bigint,
    slippageBps: number,
  ): Promise<SwapQuote> {
    if (from === to) throw new Error('Choose two different tokens');
    if (amountIn <= 0n) throw new Error('Enter an amount');

    const a = pathAddress(from);
    const b = pathAddress(to);
    const hops = [DUSA.wmas, TOKEN_REGISTRY['USDC.e'].contract].filter((h) => h !== a && h !== b);
    const routes = [[a, b], ...hops.map((h) => [a, h, b])];

    const results = await Promise.allSettled(routes.map((r) => this.readQuote(r, amountIn)));
    const best = results.reduce<DusaQuote | null>((best, r) => {
      if (r.status !== 'fulfilled') return best;
      const out = r.value.amounts.at(-1) ?? 0n;
      return out > 0n && (!best || out > (best.amounts.at(-1) ?? 0n)) ? r.value : best;
    }, null);
    if (!best) throw new Error(`No Dusa liquidity for ${from} → ${to}`);

    const amountOut = best.amounts.at(-1)!;
    const spot = best.virtualAmountsWithoutSlippage.at(-1) ?? amountOut;
    const bps = BigInt(slippageBps);
    return {
      from,
      to,
      amountIn,
      amountOut,
      // SDK minimumAmountOut: amountOut / (1 + slippage)
      minAmountOut: (amountOut * BPS) / (BPS + bps),
      priceImpactPct: spot > 0n ? Number(((spot - amountOut) * 1_000_000n) / spot) / 10_000 : 0,
      slippageBps,
      path: best.route.map(symbolForAddress),
      quote: best,
    };
  }

  /**
   * Executes `q` for the key's account: approves the router for the input
   * token when needed (not for MAS), then swaps. Resolves only once the
   * chain has executed the swap (see waitExecuted).
   */
  async execute(privateKey: string, q: SwapQuote): Promise<OperationResult> {
    const account = await Account.fromPrivateKey(privateKey);
    const provider = Web3Provider.mainnet(account);
    const owner = account.address.toString();

    if (q.from !== 'MAS') await this.ensureAllowance(provider, owner, q);

    const { func, args, coins } = this.swapCall(q, owner);
    return waitExecuted(
      await provider.callSC({ target: DUSA.v2Router, func, parameter: args, coins }),
    );
  }

  private async readQuote(route: string[], amountIn: bigint): Promise<DusaQuote> {
    const result = await this.publicProvider.readSC({
      target: DUSA.v2Quoter,
      func: 'findBestPathFromAmountIn',
      parameter: quoteArgs(route, amountIn, false),
    });
    if (result.info.error || !result.value?.length) throw new Error(result.info.error || 'No quote');
    return decodeQuote(result.value);
  }

  /** SDK `IERC20.approve`: raise the router's allowance only by what's missing. */
  private async ensureAllowance(provider: Web3Provider, owner: string, q: SwapQuote): Promise<void> {
    const token = TOKEN_REGISTRY[q.from].contract;
    const current = await new MRC20(provider, token).allowance(owner, DUSA.v2Router);
    if (current >= q.amountIn) return;

    const parameter = new Args().addString(DUSA.v2Router).addU256(q.amountIn - current).serialize();
    const coins = await this.storageCoins(token, 'increaseAllowance', parameter, owner);
    await waitExecuted(
      await provider.callSC({ target: token, func: 'increaseAllowance', parameter, coins }),
    );
  }

  /**
   * Coins a call needs for storage, read the way the SDK does: simulate it
   * without coins and parse `Storage__NotEnoughCoinsSent:<n>` from the error.
   */
  private async storageCoins(
    target: string,
    func: string,
    parameter: Uint8Array,
    caller: string,
  ): Promise<bigint> {
    const result = await this.publicProvider.readSC({ target, func, parameter, caller, coins: 0n });
    const match = result.info.error?.match(/Storage__NotEnoughCoinsSent:\s*(\d+)/);
    return match ? BigInt(match[1]) : 0n;
  }

  /** SDK `TradeV2.swapCallParameters` for EXACT_INPUT. */
  private swapCall(q: SwapQuote, to: string): { func: string; args: Uint8Array; coins: bigint } {
    const { quote } = q;
    const deadline = BigInt(Date.now() + SWAP_TTL_MS);
    const isV2 = quote.isLegacy.length > 0;
    const args = new Args();

    if (q.from === 'MAS') {
      args.addU256(q.minAmountOut).addArray(quote.binSteps, ArrayTypes.U64);
      if (isV2) args.addArray(quote.isLegacy, ArrayTypes.BOOL);
      args
        .addArray(quote.route, ArrayTypes.STRING)
        .addString(to)
        .addU64(deadline)
        .addU64(SWAP_STORAGE_COST);
      return {
        func: 'swapExactMASForTokens',
        args: args.serialize(),
        coins: SWAP_STORAGE_COST + q.amountIn,
      };
    }

    args.addU256(q.amountIn).addU256(q.minAmountOut).addArray(quote.binSteps, ArrayTypes.U64);
    if (isV2) args.addArray(quote.isLegacy, ArrayTypes.BOOL);
    args.addArray(quote.route, ArrayTypes.STRING).addString(to).addU64(deadline);
    return {
      func: q.to === 'MAS' ? 'swapExactTokensForMAS' : 'swapExactTokensForTokens',
      args: args.serialize(),
      coins: SWAP_STORAGE_COST,
    };
  }
}
