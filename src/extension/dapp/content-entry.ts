/// <reference types="chrome" />
// Bundled as content.js (scripts/build-extension.mjs) — see content.ts.
import { startRelay } from './content';
import { PORT_NAME } from './protocol';

startRelay(window, () => chrome.runtime.connect({ name: PORT_NAME }));
