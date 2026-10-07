/** Digits in the web app's PIN. */
export const PIN_LENGTH = 6;

/** Shortest password the extension accepts, in characters. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Why `password` can't protect the vault, or null when it can. Digits only are refused at any
 * length, so a 6-digit PIN can't simply be padded into a password.
 */
export function passwordProblem(password: string): string | null {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (/^\d+$/.test(password)) return 'Use letters or symbols too, not only digits';
  return null;
}
