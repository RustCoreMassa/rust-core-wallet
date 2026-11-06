// No imports: the extension's background worker uses it too (src/extension/session-constants.ts).

/**
 * The wallet locks itself after this long without the user touching it: no tap, click, key or
 * scroll in any of its pages. On the web the page counts it; in the extension the shared session
 * (chrome.storage.session) does, across the popup, the side panel, the tab and the approval window.
 */
export const AUTO_LOCK_MS = 15 * 60_000;

/**
 * The iOS / Android apps also lock when they come back after this long in the background — long
 * enough to fetch an address from another app and paste it, short enough that a phone left
 * unlocked doesn't leave the wallet open.
 */
export const APP_BACKGROUND_LOCK_MS = 60_000;
