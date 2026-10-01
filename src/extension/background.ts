/// <reference types="chrome" />
// The extension's background service worker (bundled on its own by
// scripts/build-extension.mjs — no Angular here). For now it only ends
// expired popup sessions; the dApp connection will live here too.
import { AUTO_LOCK_ALARM, SESSION_KEY_ITEM } from './session-constants';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    chrome.storage.session.remove(SESSION_KEY_ITEM).catch(() => {});
  }
});
