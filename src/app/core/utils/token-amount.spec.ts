import { fromUnits, toUnits } from './token-amount';

describe('toUnits', () => {
  it('converts through the decimal string, keeping 18-decimal precision', () => {
    // A float multiply would give 100000000000000005.55… here.
    expect(toUnits(0.1, 18)).toBe(100_000_000_000_000_000n);
    expect(toUnits(1.5, 9)).toBe(1_500_000_000n);
  });

  it('accepts decimal strings', () => {
    expect(toUnits('0.000000000000000001', 18)).toBe(1n);
    expect(toUnits(' 2.5 ', 6)).toBe(2_500_000n);
  });

  it('expands the exponent notation String() uses for tiny and huge numbers', () => {
    expect(toUnits(1e-7, 9)).toBe(100n);
    expect(toUnits(1.5e21, 0)).toBe(1_500_000_000_000_000_000_000n);
  });

  it('drops digits beyond the precision toward zero — never rounds up', () => {
    expect(toUnits(1.23456789012, 9)).toBe(1_234_567_890n);
    expect(toUnits('0.0000009', 6)).toBe(0n);
  });

  it('rejects negative, non-finite and malformed amounts', () => {
    expect(() => toUnits(-1, 9)).toThrow();
    expect(() => toUnits(Number.NaN, 9)).toThrow();
    expect(() => toUnits(Infinity, 9)).toThrow();
    expect(() => toUnits('1,5', 9)).toThrow();
    expect(() => toUnits('abc', 9)).toThrow();
  });
});

describe('fromUnits', () => {
  it('converts smallest units back to a human amount', () => {
    expect(fromUnits(1_500_000_000n, 9)).toBe(1.5);
    expect(fromUnits(1n, 18)).toBe(1e-18);
    expect(fromUnits(0n, 6)).toBe(0);
    expect(fromUnits(42n, 0)).toBe(42);
  });

  it('handles negative values', () => {
    expect(fromUnits(-2_500_000n, 6)).toBe(-2.5);
  });

  it('round-trips 9-decimal MAS amounts exactly', () => {
    for (const units of [1n, 1_537_858_546_292n, 999_999_999_999n]) {
      expect(toUnits(fromUnits(units, 9), 9)).toBe(units);
    }
  });

  it('documents the float limit that WalletStore clamps: 18 decimals can round up', () => {
    // 0.999797356704804 is what Max showed for this real DAI balance; converted
    // back it's above the held amount — see WalletStore.spendableUnits.
    const held = 999_797_356_704_803_912n;
    expect(toUnits(fromUnits(held, 18), 18)).toBeGreaterThan(held);
  });
});
