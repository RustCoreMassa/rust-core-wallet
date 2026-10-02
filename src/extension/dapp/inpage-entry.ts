// Bundled as inpage.js (scripts/build-extension.mjs) — see inpage.ts.
import { installRustCore } from './inpage';

installRustCore(window as Window & { rustcore?: unknown });
