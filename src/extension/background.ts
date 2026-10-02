/// <reference types="chrome" />
// The extension's background service worker (bundled on its own by
// scripts/build-extension.mjs — no Angular here). It ends expired popup
// sessions and answers web pages' dApp requests (docs/DAPP-CONNECTION.md).
import { DappErrorCode, PORT_NAME, PortMessage } from './dapp/protocol';
import { AUTO_LOCK_ALARM, SESSION_KEY_ITEM } from './session-constants';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    chrome.storage.session.remove(SESSION_KEY_ITEM).catch(() => {});
  }
});

// Until the request router exists, every dApp request gets a clear answer instead of hanging.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  port.onMessage.addListener((message: { id?: unknown }) => {
    if (typeof message?.id !== 'string') return;
    const reply: PortMessage = {
      id: message.id,
      error: {
        code: DappErrorCode.UnsupportedMethod,
        message: 'Connecting to dApps is not available yet in this version of RustCore Wallet.',
      },
    };
    port.postMessage(reply);
  });
});
