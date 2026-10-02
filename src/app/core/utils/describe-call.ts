import { Args, ArrayTypes } from '@massalabs/massa-web3';
import { TOKEN_LIST, TokenMeta } from '../models/token.model';
import { DUSA } from '../services/dusa-contracts';
import { formatUnits } from './token-amount';

/**
 * Reads a smart-contract call a dApp asks to sign, so the approval window can say what it does
 * in words. Only calls the wallet knows for sure are decoded — MRC-20 transfers and allowances
 * on the supported tokens, and swaps on Dusa's V2 router, with exactly the argument layouts
 * massa-web3's MRC20 wrapper and the Dusa SDK use — and only when the parameters decode
 * completely. Anything else is shown as an unknown call, with a warning.
 */

export interface ContractCall {
  readonly target: string;
  readonly func: string;
  readonly parameter: Uint8Array;
  /** nanoMAS sent with the call. */
  readonly coins: bigint;
}

export interface CallRow {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

export interface CallDescription {
  /** The contract's name, when it's one the wallet knows. */
  readonly contract: string | null;
  /** What the call does, in one line — null when the wallet can't tell. */
  readonly summary: string | null;
  readonly rows: readonly CallRow[];
  readonly warnings: readonly string[];
}

/** An allowance this large is "unlimited" in practice (dApps send 2^256 − 1). */
export const UNLIMITED_ALLOWANCE = 2n ** 128n;

const MASSA_ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;
const MAS_DECIMALS = 9;

/** The token contracts in TOKEN_REGISTRY are mainnet deployments. */
const TOKENS_BY_CONTRACT = new Map<string, TokenMeta>(
  TOKEN_LIST.filter((t) => t.isErc20).map((t) => [t.contract, t]),
);

const DUSA_SWAPS = ['swapExactMASForTokens', 'swapExactTokensForMAS', 'swapExactTokensForTokens'];

export function describeCall(
  call: ContractCall,
  owner: string,
  network: 'mainnet' | 'buildnet',
): CallDescription {
  const known = network === 'mainnet';
  const token = known ? TOKENS_BY_CONTRACT.get(call.target) : undefined;
  if (token) {
    const decoded = describeTokenCall(token, call, owner);
    if (decoded) return decoded;
  }
  if (known && call.target === DUSA.v2Router && DUSA_SWAPS.includes(call.func)) {
    const decoded = describeSwap(call, owner);
    if (decoded) return decoded;
  }
  return {
    contract: known ? contractName(call.target) : null,
    summary: null,
    rows: [],
    warnings: [
      "RustCore Wallet can't read what this call does. Approve it only if you trust this site.",
    ],
  };
}

// ------------------------------------------------------------------ MRC-20 tokens

function describeTokenCall(
  token: TokenMeta,
  call: ContractCall,
  owner: string,
): CallDescription | null {
  const contract = `${token.symbol} token`;
  const amountOf = (units: bigint) => `${formatUnits(units, token.decimals)} ${token.symbol}`;
  switch (call.func) {
    case 'transfer': {
      const args = read(call.parameter, (a) => ({ to: address(a), amount: a.nextU256() }));
      if (!args) return null;
      return {
        contract,
        summary: `Send ${amountOf(args.amount)}`,
        rows: [
          { label: 'To', value: args.to, mono: true },
          { label: 'Amount', value: amountOf(args.amount) },
        ],
        warnings: args.to === owner ? ["The recipient is this wallet's own address."] : [],
      };
    }
    case 'increaseAllowance':
    case 'decreaseAllowance': {
      const args = read(call.parameter, (a) => ({ spender: address(a), amount: a.nextU256() }));
      if (!args) return null;
      const spender = contractName(args.spender) ?? args.spender;
      const unlimited = args.amount >= UNLIMITED_ALLOWANCE;
      const increase = call.func === 'increaseAllowance';
      const warnings: string[] = [];
      if (increase && unlimited) {
        warnings.push(
          `${spender} will be able to spend all your ${token.symbol}, now and later, until you lower the allowance.`,
        );
      }
      if (increase && !contractName(args.spender)) {
        warnings.push('RustCore Wallet doesn’t know this spender. Check it before approving.');
      }
      return {
        contract,
        summary: increase
          ? `Allow ${spender} to spend ${unlimited ? `unlimited ${token.symbol}` : amountOf(args.amount)}`
          : `Lower ${spender}'s allowance by ${unlimited ? 'everything' : amountOf(args.amount)}`,
        rows: [
          { label: 'Spender', value: args.spender, mono: true },
          { label: 'Amount', value: unlimited ? 'Unlimited' : amountOf(args.amount) },
        ],
        warnings,
      };
    }
    case 'transferFrom': {
      const args = read(call.parameter, (a) => ({
        from: address(a),
        to: address(a),
        amount: a.nextU256(),
      }));
      if (!args) return null;
      return {
        contract,
        summary: `Move ${amountOf(args.amount)} between two addresses`,
        rows: [
          { label: 'From', value: args.from, mono: true },
          { label: 'To', value: args.to, mono: true },
          { label: 'Amount', value: amountOf(args.amount) },
        ],
        warnings: args.from === owner ? [] : ['The tokens move from an address other than yours.'],
      };
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Dusa swaps

/** @dusalabs/sdk TradeV2.swapCallParameters (exact input); `isLegacy` only on V2 quotes. */
function describeSwap(call: ContractCall, owner: string): CallDescription | null {
  const fromMas = call.func === 'swapExactMASForTokens';
  const decode = (withLegacy: boolean) =>
    read(call.parameter, (a) => {
      const amountIn = fromMas ? null : a.nextU256();
      const minOut = a.nextU256();
      a.nextArray(ArrayTypes.U64); // bin steps
      if (withLegacy) a.nextArray(ArrayTypes.BOOL);
      const route = a.nextArray<string>(ArrayTypes.STRING);
      const to = address(a);
      a.nextU64(); // deadline
      const storage = fromMas ? a.nextU64() : null;
      if (route.length < 2 || !route.every((r) => MASSA_ADDRESS.test(r))) {
        throw new Error('not a route');
      }
      return { amountIn, minOut, route, to, storage };
    });
  const swap = decode(true) ?? decode(false);
  if (!swap) return null;

  const amountIn =
    swap.amountIn ??
    (swap.storage !== null && call.coins >= swap.storage ? call.coins - swap.storage : null);
  if (amountIn === null) return null;
  const sell = tokenAmount(swap.route[0], amountIn);
  const buy = tokenAmount(swap.route[swap.route.length - 1], swap.minOut);
  return {
    contract: 'Dusa router',
    summary: `Swap ${sell} for at least ${buy}`,
    rows: [
      { label: 'You pay', value: sell },
      { label: 'You receive at least', value: buy },
      { label: 'Route', value: swap.route.map(symbolOf).join(' → ') },
      { label: 'Sent to', value: swap.to, mono: true },
    ],
    warnings:
      swap.to === owner ? [] : ['The swapped tokens go to another address, not to this wallet.'],
  };
}

// ------------------------------------------------------------------ helpers

/** Runs `decode` over the whole parameter; null unless every byte was read. */
function read<T>(parameter: Uint8Array, decode: (args: Args) => T): T | null {
  try {
    const args = new Args(parameter);
    const value = decode(args);
    return args.getOffset() === parameter.length ? value : null;
  } catch {
    return null;
  }
}

function address(args: Args): string {
  const value = args.nextString();
  if (!MASSA_ADDRESS.test(value)) throw new Error('not an address');
  return value;
}

function contractName(address: string): string | null {
  const token = TOKENS_BY_CONTRACT.get(address);
  if (token) return `${token.symbol} token`;
  switch (address) {
    case DUSA.v2Router:
      return 'Dusa router';
    case DUSA.wmas:
      return 'Wrapped MAS (WMAS)';
    default:
      return null;
  }
}

/** A token in a Dusa route, by symbol (WMAS shows as MAS). */
function symbolOf(address: string): string {
  if (address === DUSA.wmas) return 'MAS';
  return TOKENS_BY_CONTRACT.get(address)?.symbol ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function tokenAmount(address: string, units: bigint): string {
  if (address === DUSA.wmas) return `${formatUnits(units, MAS_DECIMALS)} MAS`;
  const token = TOKENS_BY_CONTRACT.get(address);
  return token
    ? `${formatUnits(units, token.decimals)} ${token.symbol}`
    : `${units} units of ${symbolOf(address)}`;
}
