/// <reference types="chrome" />
// The extension's background service worker (bundled on its own by
// scripts/build-extension.mjs — no Angular here). It ends expired popup
// sessions and routes web pages' dApp requests (docs/DAPP-CONNECTION.md).
import { APPROVAL_PORT, ApprovalMessage, isApprovalMessage } from './dapp/approval';
import { ApprovalWindow } from './dapp/approval-window';
import { DappPermissions, PERMISSIONS_ITEM } from './dapp/permissions';
import { NETWORK_ITEM, PORT_NAME, walletNetworkOf } from './dapp/protocol';
import { DappRouter } from './dapp/router';
import { SiteTabs } from './dapp/site-tabs';
import { AUTO_LOCK_ALARM, SESSION_KEY_ITEM } from './session-constants';

/** Ends the unlocked session: every open view of the wallet locks (ChromeSessionKeyStore.watch). */
function endSession(): void {
  chrome.storage.session.remove(SESSION_KEY_ITEM).catch(() => {});
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) endSession();
});

// The computer locks (screen lock, lid closed): so does the wallet. Not every browser reports it
// (Firefox for Android has no idle API at all).
chrome.idle?.onStateChanged.addListener((state) => {
  if (state === 'locked') endSession();
});

// Only the extension's own pages read its storage. Web pages never can, but content scripts run
// inside them, so a page that broke out of its sandbox could otherwise read the encrypted vault
// (to guess the password offline) or write itself a connection. content.js never uses storage.
// Chromium applies it to `local` too; where a browser doesn't, nothing changes.
if (typeof chrome.storage.local.setAccessLevel === 'function') {
  chrome.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((err) => console.warn('Restricting storage access failed', err));
}

// ------------------------------------------------------------------ dApp connections

const approvalWindow = new ApprovalWindow(() => router.rejectAll());
const siteTabs = new SiteTabs(chrome.storage.session);
const router = new DappRouter({
  permissions: new DappPermissions(chrome.storage.local),
  network: async () =>
    walletNetworkOf((await chrome.storage.local.get(NETWORK_ITEM))[NETWORK_ITEM]),
  showApproval: () => approvalWindow.show(),
  tabs: siteTabs,
  // Top frame only: content.js isn't injected into frames.
  sendToTab: async (tabId, message) => {
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  },
});

chrome.tabs.onRemoved.addListener((tabId) => {
  siteTabs.forget(tabId).catch(() => {});
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAME) {
    router.attach(port);
  } else if (port.name === APPROVAL_PORT && isExtensionPage(port.sender)) {
    // The approval window's pings keep this worker (and the requests it holds) alive.
    port.onMessage.addListener(() => {});
  }
});

// The approval window asks for the next request and reports the user's answer.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isApprovalMessage(message) || !isExtensionPage(sender)) return false;
  answerApproval(message).then(sendResponse, (err) => {
    console.error('Approval message failed', err);
    sendResponse(null);
  });
  return true; // answered asynchronously
});

async function answerApproval(message: ApprovalMessage): Promise<unknown> {
  switch (message.type) {
    case 'rustcore:approval:next':
      return router.next();
    case 'rustcore:approval:resolve':
      return router.resolve(message.approvalId, message.result);
    case 'rustcore:approval:reject':
      return router.reject(message.approvalId);
  }
}

// Sites hear about account, connection and network changes, whichever view made them.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  router
    .onStorageChanged(changes, { permissions: PERMISSIONS_ITEM, network: NETWORK_ITEM })
    .catch((err) => console.error('Notifying dApps failed', err));
});

/**
 * Is the sender one of the extension's own pages (popup, side panel, tab, approval window)?
 * Content scripts share the extension id, but their url is the web page's.
 */
function isExtensionPage(sender?: chrome.runtime.MessageSender): boolean {
  return (
    sender?.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''))
  );
}
