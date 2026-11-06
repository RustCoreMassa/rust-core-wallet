// No imports: pure string checks.

/**
 * Shape check for a Massa address: `AU` (user) or `AS` (smart contract) followed by base58. The
 * chain does the real validation on send; this catches typos (and wrong scans) before the
 * confirmation step.
 */
export const MASSA_ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;

/**
 * The address a scanned QR code holds: the plain address (what the Receive screen shows) or a
 * `massa:` link (`massa:AU…`, `massa://AU…?amount=1`). `null` for anything else — a web link
 * or a private key is never taken as a recipient.
 */
export function addressFromQr(text: string): string | null {
  let value = text.trim();
  if (/^massa:/i.test(value)) value = value.slice('massa:'.length).replace(/^\/\//, '');
  value = value.split(/[?#]/)[0];
  return MASSA_ADDRESS.test(value) ? value : null;
}
