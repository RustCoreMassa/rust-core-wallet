// Loads the production build's entry module with a simulated DOM and reports
// whether all modules evaluate — catches bundle-order bugs (e.g. a class that
// extends a not-yet-defined class) that only show up in the built output.
// With --extension it boots the extension's popup instead, over an in-memory
// stand-in for the chrome.storage / chrome.alarms APIs.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const args = process.argv.slice(2);
const extension = args.includes('--extension');
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist/rust-core-wallet/browser');
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://wallet.test/', pretendToBeVisual: true });
const win = dom.window;
// Pose as a phone (touch-first), so the app boots past its desktop gate.
win.matchMedia = (query) => ({
  matches: /pointer:\s*coarse|hover:\s*none/.test(query),
  addEventListener() {},
  removeEventListener() {},
});
Object.defineProperty(win.navigator, 'userAgent', {
  value:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
});
for (const key of Object.getOwnPropertyNames(win)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = win[key];
    } catch {}
  }
}
for (const key of [
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
]) {
  try {
    Object.defineProperty(globalThis, key, { value: win[key], configurable: true, writable: true });
  } catch {}
}

if (extension) {
  const storageArea = () => {
    const items = {};
    return {
      get: async (keys) =>
        keys == null
          ? { ...items }
          : Object.fromEntries(
              [keys]
                .flat()
                .filter((k) => k in items)
                .map((k) => [k, items[k]]),
            ),
      set: async (entries) => void Object.assign(items, entries),
      remove: async (keys) => [keys].flat().forEach((k) => delete items[k]),
      onChanged: { addListener() {} },
    };
  };
  globalThis.chrome = {
    storage: { local: storageArea(), session: storageArea() },
    alarms: { create: async () => {}, clear: async () => true, onAlarm: { addListener() {} } },
    windows: { getCurrent: async () => ({ id: 1 }) },
    sidePanel: { open: async () => {} },
    tabs: { create: async () => ({}) },
    runtime: { getURL: (path) => `chrome-extension://smoke/${path}` },
  };
}

const main = readdirSync(dir).find((f) => /^main-.*\.js$/.test(f));
const errors = [];
process.on('uncaughtException', (e) => errors.push(e));
process.on('unhandledRejection', (e) => errors.push(e));
try {
  await import(pathToFileURL(join(dir, main)).href);
} catch (e) {
  errors.push(e);
}
await new Promise((r) => setTimeout(r, 1500));
const fatal = errors.filter(
  (e) => e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError,
);
if (fatal.length) {
  console.log('BOOT FAILED:', fatal.map((e) => `${e.constructor.name}: ${e.message}`).join(' | '));
  process.exit(1);
}
// The app must actually have rendered: a fresh device lands on the PIN screen.
const rendered =
  win.document.querySelector('app-root')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
if (!rendered) {
  console.log('BOOT FAILED: modules loaded but <app-root> is empty — the app did not render');
  process.exit(1);
}
console.log(
  `BOOT OK — ${main} evaluated and rendered: "${rendered.slice(0, 60)}…"` +
    (errors.length ? ` (${errors.length} non-fatal runtime notices)` : ''),
);
process.exit(0);
