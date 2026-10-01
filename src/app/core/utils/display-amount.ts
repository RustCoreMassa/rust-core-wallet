/** Decimals every amount shows on screen (balances, lists, history). */
export const DISPLAY_DECIMALS = 2;

/**
 * Amount for display: exactly DISPLAY_DECIMALS decimals, cut (never rounded
 * up — 0.999 MAS shows 0.99, never more than is held), with thousands
 * separators: 1467.460080567 → "1,467.46". Display only — Review steps and
 * transaction details show exact amounts, and nothing here feeds a spend.
 * Works on the decimal string, so float noise can't shift a digit
 * (1.15 → "1.15", where Math.trunc(1.15 * 100) gives 114).
 */
export function formatDisplayAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  const exact = Math.abs(amount).toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: 20,
  });
  const [whole, fraction = ''] = exact.split('.');
  const cut = fraction.slice(0, DISPLAY_DECIMALS).padEnd(DISPLAY_DECIMALS, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const negative = amount < 0 && /[1-9]/.test(whole + cut);
  return `${negative ? '-' : ''}${grouped}.${cut}`;
}
