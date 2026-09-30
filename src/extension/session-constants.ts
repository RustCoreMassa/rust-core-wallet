// Shared by the popup (ChromeSessionKeyStore) and the background worker, which
// must not pull Angular into its bundle — so this file imports nothing.

/** chrome.storage.session item holding the unlocked session's vault key. */
export const SESSION_KEY_ITEM = 'rustcore:session-key';

/** chrome.alarms alarm that wipes SESSION_KEY_ITEM when the session expires. */
export const AUTO_LOCK_ALARM = 'rustcore:auto-lock';

/** The popup locks itself after this long without being open. */
export const AUTO_LOCK_MS = 15 * 60_000;
