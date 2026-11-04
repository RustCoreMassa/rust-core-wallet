/** How long a copied private key stays in the clipboard. */
export const CLIPBOARD_CLEAR_MS = 60_000;

type Clipboard = Pick<globalThis.Clipboard, 'writeText'>;

/**
 * Copies a secret (a private key), then empties the clipboard after
 * CLIPBOARD_CLEAR_MS — so it doesn't sit there for every app, keyboard or
 * clipboard manager to read. Best effort: the browser lets the page write the
 * clipboard only while it's open and focused, so a closed popup can't clear it.
 */
export async function copySecret(
  text: string,
  clipboard: Clipboard = navigator.clipboard,
  later: (run: () => void, ms: number) => unknown = setTimeout,
): Promise<void> {
  await clipboard.writeText(text);
  later(() => {
    clipboard.writeText('').catch(() => {
      // Not focused any more: nothing the page can do.
    });
  }, CLIPBOARD_CLEAR_MS);
}
