import { Args, ArrayTypes } from '@massalabs/massa-web3';
import { decodeQuote, quoteArgs } from './dusa-contracts';

function encodeQuote(withLegacy: boolean): Uint8Array {
  const args = new Args()
    .addArray(['AS1a', 'AS1b'], ArrayTypes.STRING)
    .addArray(['AS1pair'], ArrayTypes.STRING)
    .addArray([20n], ArrayTypes.U64)
    .addArray([1_000_000_000n, 3_165n], ArrayTypes.U256)
    .addArray([1_000_000_000n, 3_170n], ArrayTypes.U256)
    .addArray([100n], ArrayTypes.U256);
  if (withLegacy) args.addArray([false], ArrayTypes.BOOL);
  return args.serialize();
}

describe('Dusa quote encoding', () => {
  it('decodes a V2 quoter answer, including the isLegacy flags', () => {
    const quote = decodeQuote(encodeQuote(true));
    expect(quote.route).toEqual(['AS1a', 'AS1b']);
    expect(quote.pairs).toEqual(['AS1pair']);
    expect(quote.binSteps).toEqual([20n]);
    expect(quote.amounts).toEqual([1_000_000_000n, 3_165n]);
    expect(quote.virtualAmountsWithoutSlippage.at(-1)).toBe(3_170n);
    expect(quote.fees).toEqual([100n]);
    expect(quote.isLegacy).toEqual([false]);
  });

  it('decodes a V1 quoter answer, which has no isLegacy field', () => {
    expect(decodeQuote(encodeQuote(false)).isLegacy).toEqual([]);
  });

  it('serializes quoter arguments as route, amountIn, checkLegacy', () => {
    const args = new Args(quoteArgs(['AS1a', 'AS1b'], 42n, true));
    expect(args.nextArray(ArrayTypes.STRING)).toEqual(['AS1a', 'AS1b']);
    expect(args.nextU256()).toBe(42n);
    expect(args.nextBool()).toBe(true);
  });
});
