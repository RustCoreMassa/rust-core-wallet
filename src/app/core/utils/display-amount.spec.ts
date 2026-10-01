import { formatDisplayAmount } from './display-amount';

describe('formatDisplayAmount', () => {
  it('shows exactly two decimals', () => {
    expect(formatDisplayAmount(251.311090385)).toBe('251.31');
    expect(formatDisplayAmount(5)).toBe('5.00');
    expect(formatDisplayAmount(0.1)).toBe('0.10');
  });

  it('cuts instead of rounding up — never shows more than is held', () => {
    expect(formatDisplayAmount(0.999)).toBe('0.99');
    expect(formatDisplayAmount(9.9999999)).toBe('9.99');
    expect(formatDisplayAmount(0.0049)).toBe('0.00');
  });

  it('is immune to float noise', () => {
    expect(formatDisplayAmount(1.15)).toBe('1.15');
    expect(formatDisplayAmount(4.35)).toBe('4.35');
  });

  it('groups thousands', () => {
    expect(formatDisplayAmount(1467.460080567)).toBe('1,467.46');
    expect(formatDisplayAmount(1234567.891)).toBe('1,234,567.89');
  });

  it('handles tiny, negative and non-finite values', () => {
    expect(formatDisplayAmount(1e-7)).toBe('0.00');
    expect(formatDisplayAmount(-12.345)).toBe('-12.34');
    expect(formatDisplayAmount(-0.001)).toBe('0.00');
    expect(formatDisplayAmount(Infinity)).toBe('—');
  });
});
