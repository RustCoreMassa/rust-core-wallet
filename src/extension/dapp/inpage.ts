// Runs in every https page's own JavaScript world (manifest: content_scripts, "world": "MAIN"),
// before the page's scripts. Defines window.rustcore, the API dApps (through
// @massalabs/wallet-provider) use to talk to the wallet — see docs/DAPP-CONNECTION.md.
//
// It holds no state worth stealing and trusts nothing: whatever it sends, the page could send
// itself. The content script and the background worker check everything.
import {
  CHANNEL,
  DappErrorData,
  DappEvent,
  PageRequestMessage,
  isPageMessage,
  newRequestId,
} from './protocol';

/** Version of the protocol this script speaks (docs/DAPP-CONNECTION.md → Protocol v1). */
export const PROTOCOL_VERSION = '1';

/** Fired on window once window.rustcore exists, for scripts that loaded first. */
export const READY_EVENT = 'rustcore#initialized';

/** What a dApp sees as window.rustcore. */
export interface RustCoreInjected {
  readonly isRustCore: true;
  readonly version: string;
  request(method: string, params?: unknown): Promise<unknown>;
  /** Subscribes to an event; returns the function that unsubscribes. */
  on(event: DappEvent, callback: (data: unknown) => void): () => void;
}

/** A rejected request: `code` follows protocol v1 (4001 rejected by the user, …). */
export class RustCoreError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RustCoreError';
  }
}

/** The parts of `window` the script uses — a real window in the browser, a fake one in tests. */
export type InpageWindow = Pick<Window, 'addEventListener' | 'postMessage' | 'dispatchEvent'> & {
  readonly location: { readonly origin: string };
};

interface Pending {
  resolve(value: unknown): void;
  reject(error: RustCoreError): void;
}

/** Builds the API object and starts listening for replies on `win`. */
export function createRustCore(win: InpageWindow): RustCoreInjected {
  const pending = new Map<string, Pending>();
  const listeners = new Map<DappEvent, Set<(data: unknown) => void>>();

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win || !isPageMessage(event.data)) return;
    const message = event.data;
    if ('event' in message) {
      for (const callback of listeners.get(message.event) ?? []) {
        try {
          callback(message.data);
        } catch (err) {
          console.error('RustCore: an event listener failed', err);
        }
      }
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if ('error' in message) request.reject(toError(message.error));
    else request.resolve(message.result);
  });

  const api: RustCoreInjected = {
    isRustCore: true,
    version: PROTOCOL_VERSION,
    request(method, params) {
      if (typeof method !== 'string' || method.length === 0) {
        return Promise.reject(new RustCoreError(-32602, 'method must be a non-empty string'));
      }
      const id = newRequestId();
      const message: PageRequestMessage = { channel: CHANNEL, to: 'wallet', id, method, params };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          win.postMessage(message, targetOrigin(win));
        } catch (err) {
          // e.g. params that can't be cloned (functions, DOM nodes)
          pending.delete(id);
          reject(new RustCoreError(-32602, `Invalid params: ${(err as Error).message}`));
        }
      });
    },
    on(event, callback) {
      if (typeof callback !== 'function') throw new TypeError('callback must be a function');
      const set = listeners.get(event) ?? new Set();
      set.add(callback);
      listeners.set(event, set);
      return () => void set.delete(callback);
    },
  };
  return Object.freeze(api);
}

/**
 * Defines window.rustcore (read-only, so another script can't swap it by accident) and
 * announces it. Does nothing if it's already there — e.g. the script ran twice.
 */
export function installRustCore(win: InpageWindow & { rustcore?: unknown }): void {
  if (win.rustcore !== undefined) return;
  Object.defineProperty(win, 'rustcore', {
    value: createRustCore(win),
    writable: false,
    configurable: false,
    enumerable: true,
  });
  win.dispatchEvent(new Event(READY_EVENT));
}

function toError(error: DappErrorData): RustCoreError {
  return new RustCoreError(error.code, error.message);
}

/** Our own window only; pages with an opaque origin ("null") can only use '*'. */
function targetOrigin(win: InpageWindow): string {
  return win.location.origin === 'null' ? '*' : win.location.origin;
}
