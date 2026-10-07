/**
 * Conversion between human-readable token amounts (`number`, what the UI
 * and WalletStore hold) and on-chain integer units (`bigint`, what
 * MassaProvider takes and returns).
 *
 * Goes through the decimal string, never through `amount * 10 ** decimals`:
 * a float multiply can't represent 18-decimal precision (0.1 * 1e18 is
 * 100000000000000005.55…), while `String(0.1)` is exactly "0.1".
 */

const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export function toUnits(amount: number | string, decimals: number): bigint {
  const text = typeof amount === 'number' ? numberToPlainString(amount) : amount.trim();
  const match = PLAIN_DECIMAL.exec(text);
  if (!match) throw new Error(`Invalid amount "${text}"`);
  const [, whole, fraction = ''] = match;
  // Digits beyond the token's precision are dropped (toward zero), never
  // rounded up — the chain never moves more than what was typed.
  return BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, '0'));
}

export function fromUnits(units: bigint, decimals: number): number {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0');
  const value = Number(decimals > 0 ? `${whole}.${fraction}` : `${whole}`);
  return negative ? -value : value;
}

/** `String(n)`, minus the exponent notation it uses below 1e-6 / from 1e21. */
function numberToPlainString(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid amount ${n}`);
  const text = String(n);
  const match = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;

  const [, whole, fraction = '', exponent] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * `units` as an exact decimal string — every digit, trailing zeros dropped
 * ("1.23", not "1.230000000"). For review screens, where a rounded number
 * could hide what's really being sent.
 */
export function formatUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString('en-US');
  const fraction = decimals > 0 ? (abs % base).toString().padStart(decimals, '0') : '';
  const trimmed = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${trimmed ? `.${trimmed}` : ''}`;
}
