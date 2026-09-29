import { Args, ArrayTypes } from '@massalabs/massa-web3';

/**
 * Dusa (Liquidity Book DEX) mainnet contracts, as published in
 * @dusalabs/sdk (`V2_LB_QUOTER_ADDRESS`, `LB_QUOTER_ADDRESS`,
 * `V2_LB_ROUTER_ADDRESS`, `WMAS`).
 */
export const DUSA = {
  v2Quoter: 'AS1d3DvZeqTo3Uq7mfAAUmNggjFXqEfGGpSUv6uTYvikVVW8EybN',
  v1Quoter: 'AS12VBT5xeL3XdXhLwnpyMVB8re5RcMuW4Z8ragCKEKnDDCEkYjXL',
  /** Pairs with the V2 quoter: its quotes carry the `isLegacy` flags the V2 router expects. */
  v2Router: 'AS1gUwVGA3A5Dnmev8c2BjBR2wC8y9hb7CFZXVzLb1iwASFHUZ1p',
  /** Wrapped MAS — how native MAS appears in pools and swap paths. */
  wmas: 'AS12U4TZfNK7qoLyEERBBRDMu8nm5MKoRzPXDXans4v9wdATZedz9',
  wmasDecimals: 9,
} as const;

/** What the LB quoter's `findBestPathFromAmountIn` returns. */
export interface DusaQuote {
  /** Token path, input first. */
  readonly route: string[];
  readonly pairs: string[];
  readonly binSteps: bigint[];
  /** Amounts along the path (smallest units), slippage included. */
  readonly amounts: bigint[];
  /** Same, at the pools' spot price — the no-impact reference. */
  readonly virtualAmountsWithoutSlippage: bigint[];
  readonly fees: bigint[];
  /** Per hop, whether it's a legacy pool; empty for quotes from the V1 quoter. */
  readonly isLegacy: boolean[];
}

export function quoteArgs(route: string[], amountIn: bigint, checkLegacy: boolean): Uint8Array {
  return new Args()
    .addArray(route, ArrayTypes.STRING)
    .addU256(amountIn)
    .addBool(checkLegacy)
    .serialize();
}

/** Mirrors the SDK's `Quote.deserialize`. */
export function decodeQuote(bytes: Uint8Array): DusaQuote {
  const args = new Args(bytes);
  const route = args.nextArray(ArrayTypes.STRING) as string[];
  const pairs = args.nextArray(ArrayTypes.STRING) as string[];
  const binSteps = args.nextArray(ArrayTypes.U64) as bigint[];
  const amounts = args.nextArray(ArrayTypes.U256) as bigint[];
  const virtualAmountsWithoutSlippage = args.nextArray(ArrayTypes.U256) as bigint[];
  const fees = args.nextArray(ArrayTypes.U256) as bigint[];
  let isLegacy: boolean[] = [];
  try {
    isLegacy = args.nextArray(ArrayTypes.BOOL) as boolean[];
  } catch {
    // V1 quoter: no isLegacy field.
  }
  return { route, pairs, binSteps, amounts, virtualAmountsWithoutSlippage, fees, isLegacy };
}
