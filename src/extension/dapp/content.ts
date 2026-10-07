/// <reference types="chrome" />
// Runs in every https page, in the extension's isolated world (manifest: content_scripts).
// Relays window.rustcore requests from the page to the background worker over a runtime port,
// and replies and events back — see docs/DAPP-CONNECTION.md.
//
// It never adds the page's origin: the background reads it from the port's sender, which the
// browser fills in. It opens the port only on the page's first request, so pages that never use
// the wallet never talk to it.
import {
  CHANNEL,
  DappErrorCode,
  DappErrorData,
  MAX_MESSAGE_CHARS,
  PageEventMessage,
  PageReplyMessage,
  PortMessage,
  PortRequest,
  isPageRequest,
  isPortMessage,
} from './protocol';

/** The parts of `window` the relay uses — a real window in the browser, a fake one in tests. */
export type ContentWindow = Pick<Window, 'addEventListener' | 'postMessage'> & {
  readonly location: { readonly origin: string };
};

/** The runtime port's parts the relay uses. */
export interface RelayPort {
  postMessage(message: PortRequest): void;
  readonly onMessage: { addListener(callback: (message: unknown) => void): void };
  readonly onDisconnect: { addListener(callback: () => void): void };
}

/** Opens a port to the background worker; throws if the extension was reloaded or removed. */
export type ConnectPort = () => RelayPort;

export function startRelay(win: ContentWindow, connect: ConnectPort): void {
  let port: RelayPort | null = null;
  /** Requests sent on the current port and not answered yet. */
  const waiting = new Set<string>();

  const toPage = (message: PageReplyMessage | PageEventMessage) =>
    win.postMessage(message, win.location.origin === 'null' ? '*' : win.location.origin);

  const fail = (id: string, error: DappErrorData) =>
    toPage({ channel: CHANNEL, to: 'page', id, error });

  const openPort = (): RelayPort => {
    const opened = connect();
    opened.onMessage.addListener((message) => {
      if (port !== opened || !isPortMessage(message)) return;
      relayToPage(message);
    });
    opened.onDisconnect.addListener(() => {
      if (port !== opened) return;
      port = null;
      // The worker went away (extension updated, reloaded, or the browser stopped it):
      // whatever was in flight is lost. The next request opens a new port.
      for (const id of waiting) {
        fail(id, {
          code: DappErrorCode.Internal,
          message: 'The wallet restarted. Please try again.',
        });
      }
      waiting.clear();
    });
    return opened;
  };

  const relayToPage = (message: PortMessage) => {
    if ('event' in message) {
      toPage({ channel: CHANNEL, to: 'page', event: message.event, data: message.data });
      return;
    }
    if (!waiting.delete(message.id)) return; // not ours, or already answered
    toPage({ channel: CHANNEL, to: 'page', ...message });
  };

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win || !isPageRequest(event.data)) return;
    const { id, method, params } = event.data;
    if (waiting.has(id)) return; // a repeated id would make two answers ambiguous
    let size: number;
    try {
      size = JSON.stringify({ method, params }).length;
    } catch {
      fail(id, { code: DappErrorCode.InvalidParams, message: 'params must be JSON' });
      return;
    }
    if (size > MAX_MESSAGE_CHARS) {
      fail(id, { code: DappErrorCode.InvalidParams, message: 'Request is too large' });
      return;
    }
    try {
      port ??= openPort();
      waiting.add(id);
      port.postMessage({ id, method, params });
    } catch {
      waiting.delete(id);
      port = null;
      fail(id, {
        code: DappErrorCode.Internal,
        message: 'The wallet is unavailable. Reload the page and try again.',
      });
    }
  });
}
