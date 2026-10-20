import { ContentWindow, ORIGIN_QUERY, RelayPort, startRelay } from './content';
import {
  READY_EVENT,
  RustCoreError,
  RustCoreInjected,
  createRustCore,
  installRustCore,
} from './inpage';
import { CHANNEL, MAX_MESSAGE_CHARS, PortMessage, PortRequest } from './protocol';

/**
 * A page window that behaves like a browser's for postMessage: the data is cloned, delivered
 * asynchronously, and the event's `source` is the window itself (jsdom leaves it empty).
 */
class FakeWindow extends EventTarget {
  readonly location = { origin: 'https://dapp.example' };
  rustcore?: unknown;

  postMessage(message: unknown, targetOrigin: string): void {
    if (targetOrigin !== '*' && targetOrigin !== this.location.origin) return;
    const data = structuredClone(message); // throws on functions, like the real one
    setTimeout(() => this.deliver(data, this), 0);
  }

  /** A message event as the browser would fire it, from `source`. */
  deliver(data: unknown, source: unknown): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data, source }));
  }
}

/** A runtime port to the background worker; tests answer through `reply`. */
function fakePort() {
  const received: PortRequest[] = [];
  const onMessage: ((m: unknown) => void)[] = [];
  const onDisconnect: (() => void)[] = [];
  const port: RelayPort = {
    postMessage: (m) => void received.push(structuredClone(m)),
    onMessage: { addListener: (cb) => void onMessage.push(cb) },
    onDisconnect: { addListener: (cb) => void onDisconnect.push(cb) },
  };
  return {
    port,
    received,
    reply: (m: PortMessage | unknown) => onMessage.forEach((cb) => cb(m)),
    disconnect: () => onDisconnect.forEach((cb) => cb()),
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** inpage + content script on one fake page, with a fresh fake port per connect. */
function setup() {
  const win = new FakeWindow();
  const ports: ReturnType<typeof fakePort>[] = [];
  let connectError: Error | null = null;
  const tabListeners: ((m: unknown, reply: (answer: unknown) => void) => void)[] = [];
  startRelay(
    win as unknown as ContentWindow,
    () => {
      if (connectError) throw connectError;
      const p = fakePort();
      ports.push(p);
      return p.port;
    },
    (cb) => void tabListeners.push(cb),
  );
  const rustcore = createRustCore(win as unknown as Window);
  return {
    win,
    rustcore,
    ports,
    /** A message from the background to this tab (chrome.tabs.sendMessage). */
    toTab: (m: unknown) => tabListeners.forEach((cb) => cb(m, () => {})),
    /** A message from the wallet's own pages, and the answer it got (undefined if none). */
    askTab: (m: unknown) => {
      let answer: unknown;
      tabListeners.forEach((cb) => cb(m, (a) => (answer = a)));
      return answer;
    },
    failConnect: (e: Error | null) => (connectError = e),
    lastPort: () => ports[ports.length - 1],
  };
}

describe('installRustCore', () => {
  it('defines a read-only window.rustcore and announces it', () => {
    const win = new FakeWindow();
    const ready = vi.fn();
    win.addEventListener(READY_EVENT, ready);
    installRustCore(win as unknown as Window);
    const api = win.rustcore as RustCoreInjected;
    expect(api.isRustCore).toBe(true);
    expect(api.version).toBe('1');
    expect(Object.isFrozen(api)).toBe(true);
    expect(() => {
      (win as { rustcore: unknown }).rustcore = {};
    }).toThrow();
    expect(win.rustcore).toBe(api);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('leaves an existing window.rustcore alone', () => {
    const win = new FakeWindow();
    const existing = {};
    win.rustcore = existing;
    installRustCore(win as unknown as Window);
    expect(win.rustcore).toBe(existing);
  });
});

describe('page ⇄ content script ⇄ background', () => {
  it('relays a request without any origin and resolves with the result', async () => {
    const { rustcore, lastPort } = setup();
    const answer = rustcore.request('transfer', { to: 'AU1x', amount: '5' });
    await flush();
    const port = lastPort();
    expect(port.received).toHaveLength(1);
    const sent = port.received[0];
    expect(Object.keys(sent).sort()).toEqual(['id', 'method', 'params']);
    expect(sent).toMatchObject({ method: 'transfer', params: { to: 'AU1x', amount: '5' } });
    port.reply({ id: sent.id, result: { operationId: 'O1abc' } });
    await expect(answer).resolves.toEqual({ operationId: 'O1abc' });
  });

  it('rejects with the code the background sends', async () => {
    const { rustcore, lastPort } = setup();
    const answer = rustcore.request('connect');
    await flush();
    lastPort().reply({ id: lastPort().received[0].id, error: { code: 4001, message: 'Rejected' } });
    await expect(answer).rejects.toMatchObject({ name: 'RustCoreError', code: 4001 });
    await expect(answer).rejects.toBeInstanceOf(RustCoreError);
  });

  it('opens the port only on the first request, then reuses it', async () => {
    const { rustcore, ports, lastPort } = setup();
    await flush();
    expect(ports).toHaveLength(0);
    rustcore.request('connected');
    rustcore.request('account');
    await flush();
    expect(ports).toHaveLength(1);
    expect(lastPort().received.map((r) => r.method)).toEqual(['connected', 'account']);
  });

  it('answers each request once, and only its own', async () => {
    const { rustcore, lastPort } = setup();
    const first = rustcore.request('connected');
    const second = rustcore.request('network');
    await flush();
    const [a, b] = lastPort().received;
    lastPort().reply({ id: b.id, result: 'buildnet' });
    lastPort().reply({ id: a.id, result: true });
    lastPort().reply({ id: a.id, result: false }); // late duplicate: ignored
    lastPort().reply({ id: 'unknown', result: 1 });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe('buildnet');
  });

  it('delivers events to subscribers until they unsubscribe — with no port open', async () => {
    const { rustcore, toTab, ports } = setup();
    const event = { channel: CHANNEL, origin: 'https://dapp.example', event: 'accountChanged' };
    const seen: unknown[] = [];
    const off = rustcore.on('accountChanged', (d) => seen.push(d));
    toTab({ ...event, data: 'AU1new' });
    await flush();
    off();
    toTab({ ...event, data: 'AU1later' });
    toTab({ ...event, event: 'notAnEvent', data: 'x' });
    await flush();
    expect(seen).toEqual(['AU1new']);
    expect(ports).toHaveLength(0);
  });

  it('passes on only events for this site, sent as tab messages', async () => {
    const { rustcore, toTab, lastPort } = setup();
    const seen: unknown[] = [];
    rustcore.on('disconnect', (d) => seen.push(d ?? 'disconnected'));
    // The tab showed another site when the background last heard from it.
    toTab({ channel: CHANNEL, origin: 'https://other.example', event: 'disconnect' });
    toTab({ channel: 'other', origin: 'https://dapp.example', event: 'disconnect' });
    toTab({ origin: 'https://dapp.example', event: 'disconnect' });
    // Events no longer come over the port.
    rustcore.request('connected');
    await flush();
    lastPort().reply({ event: 'disconnect' });
    await flush();
    expect(seen).toEqual([]);
    toTab({ channel: CHANNEL, origin: 'https://dapp.example', event: 'disconnect' });
    await flush();
    expect(seen).toEqual(['disconnected']);
  });

  it('tells the wallet which site the tab shows, and nothing for other messages', async () => {
    const { askTab, rustcore } = setup();
    const seen: unknown[] = [];
    rustcore.on('disconnect', (d) => seen.push(d));
    expect(askTab(ORIGIN_QUERY)).toBe('https://dapp.example');
    expect(askTab({ channel: 'other', query: 'origin' })).toBeUndefined();
    expect(askTab({ channel: CHANNEL, query: 'cookies' })).toBeUndefined();
    await flush();
    expect(seen).toEqual([]);
  });

  it('ignores messages from other windows and other channels', async () => {
    const { win, ports } = setup();
    const request = { channel: CHANNEL, to: 'wallet', id: 'abc', method: 'connect' };
    win.deliver(request, {}); // e.g. an iframe posting into the page
    win.deliver({ ...request, channel: 'other' }, win);
    win.deliver({ ...request, to: 'page' }, win);
    await flush();
    expect(ports).toHaveLength(0);
  });

  it('refuses requests that are too large or not cloneable, without bothering the wallet', async () => {
    const { rustcore, ports } = setup();
    // Each awaited as soon as it's made: the second one rejects at once.
    await expect(
      rustcore.request('callSC', { parameter: 'A'.repeat(MAX_MESSAGE_CHARS) }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(rustcore.request('sign', { data: () => 1 })).rejects.toMatchObject({
      code: -32602,
    });
    expect(ports).toHaveLength(0);
  });

  it('rejects what was in flight when the wallet restarts, then reconnects', async () => {
    const { rustcore, ports, lastPort } = setup();
    const lost = rustcore.request('transfer', {});
    await flush();
    lastPort().disconnect();
    await expect(lost).rejects.toMatchObject({ code: -32603 });
    const next = rustcore.request('connected');
    await flush();
    expect(ports).toHaveLength(2);
    lastPort().reply({ id: lastPort().received[0].id, result: false });
    await expect(next).resolves.toBe(false);
  });

  it('rejects when the extension is gone (reloaded or removed)', async () => {
    const { rustcore, failConnect } = setup();
    failConnect(new Error('Extension context invalidated.'));
    await expect(rustcore.request('connected')).rejects.toMatchObject({ code: -32603 });
  });

  it('refuses an empty method name at once', async () => {
    const { rustcore, ports } = setup();
    await expect(rustcore.request('')).rejects.toMatchObject({ code: -32602 });
    expect(ports).toHaveLength(0);
  });
});
