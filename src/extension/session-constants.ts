// Shared by the popup (ChromeSessionKeyStore) and the background worker, which
// must not pull Angular into its bundle — so this file imports nothing but the import-free
// auto-lock time.
export { AUTO_LOCK_MS } from '../app/core/utils/auto-lock-time';

/** chrome.storage.session item holding the unlocked session's vault key. */
export const SESSION_KEY_ITEM = 'rustcore:session-key';

/** chrome.alarms alarm that wipes SESSION_KEY_ITEM when the session expires. */
export const AUTO_LOCK_ALARM = 'rustcore:auto-lock';
