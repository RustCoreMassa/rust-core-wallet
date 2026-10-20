import { DappPermissions, PERMISSIONS_ITEM } from './permissions';
import {
  NETWORK_ITEM,
  PortMessage,
  TabEventMessage,
  WalletNetwork,
  networkInfo,
  toBase64,
} from './protocol';
import { ApprovalResult } from './approval';
import { DappRouter, MAX_PENDING, REQUEST_TTL_MS, RouterPort } from './router';
import { SITE_TABS_ITEM, SiteTabs } from './site-tabs';

const ALICE = 'AU12dG5xP1RDEB5ocdHkymNVvvSJmUL9BgHwCksDowqmGWxfpm93x';
const BOB = 'AU1qDAxGJ387ETi9JRQzZWSPKYq4YPXrFvdiE4VoXUaiAt38JFEC';
const CONTRACT = 'AS12UMSUxgpRBB6ArZDJ19arHoxNkkpdfofQGekAiAJqsuE6PEFJy';
const OP_ID = 'O1PNZyBoU8PrrCtX57N3urXiQ3Gh4Xh9G8VoVywaUJCZVs41tPG';
const PUBLIC_KEY = 'P12EF9rJPm1rjGADr4gWDQACPyeVZ2p63fdZhVn234a7yt5MTL9b';
const SIGNATURE =
  '1E9LVdjVGJvDdPZ4VEsQA34pZx7vdkdqKKzPCkuVfKJFzJenTgRBubAjrAfY3iVYZ2ono6AANZMeqTHmXAvotYkFvCLqsC';
const DUSA = 'https://app.dusa.io';
const ITEMS = { permissions: PERMISSIONS_ITEM, network: NETWORK_ITEM };

let lastTabId = 0;

/** A page's port as the background sees it — each in its own tab unless the sender says. */
function fakePort(
  sender: RouterPort['sender'] = { origin: DUSA, url: `${DUSA}/trade`, frameId: 0 },
) {
  if (sender) sender = { tab: { id: ++lastTabId }, ...sender };
  const sent: PortMessage[] = [];
  const onMessage: ((m: unknown) => void)[] = [];
  const onDisconnect: (() => void)[] = [];
  let disconnected = false;
  const port: RouterPort = {
    sender,
    postMessage: (m) => void sent.push(m),
    onMessage: { addListener: (cb) => void onMessage.push(cb) },
    onDisconnect: { addListener: (cb) => void onDisconnect.push(cb) },
    disconnect: () => void (disconnected = true),
  };
  let n = 0;
  return {
    port,
    sent,
    isDisconnected: () => disconnected,
    /** Sends a request as content.js would; returns its id. */
    send: (method: string, params?: unknown) => {
      const id = `r${++n}`;
      onMessage.forEach((cb) => cb({ id, method, params }));
      return id;
    },
    raw: (message: unknown) => onMessage.forEach((cb) => cb(message)),
    close: () => onDisconnect.forEach((cb) => cb()),
    /** The reply to request `id`, if any. */
    replyTo: (id: string) => sent.find((m) => m.id === id),
    tabId: sender?.tab?.id ?? -1,
  };
}

type FakeStorage = ConstructorParameters<typeof DappPermissions>[0];

function fakeArea(items: Record<string, unknown>): FakeStorage {
  return {
    get: async (key: string) => (key in items ? { [key]: items[key] } : {}),
    set: async (entries: Record<string, unknown>) => void Object.assign(items, entries),
  } as unknown as FakeStorage;
}

/** What the browser keeps while the worker restarts: chrome.storage.local and .session. */
function fakeBrowser() {
  return {
    local: {} as Record<string, unknown>,
    session: {} as Record<string, unknown>,
    /** Events delivered per tab (chrome.tabs.sendMessage). */
    delivered: new Map<number, TabEventMessage[]>(),
    /** Tabs where nothing listens anymore (closed, or the extension was reloaded). */
    deaf: new Set<number>(),
  };
}

function setup(network: WalletNetwork = 'mainnet', browser = fakeBrowser()) {
  const items = browser.local;
  const permissions = new DappPermissions(fakeArea(items), () => 1000);
  const showApproval = vi.fn();
  const state = { network };
  const sendToTab = vi.fn(async (tabId: number, message: TabEventMessage) => {
    if (browser.deaf.has(tabId)) throw new Error('Receiving end does not exist');
    browser.delivered.set(tabId, [...(browser.delivered.get(tabId) ?? []), message]);
  });
  const router = new DappRouter({
    permissions,
    network: async () => state.network,
    showApproval,
    tabs: new SiteTabs(fakeArea(browser.session)),
    sendToTab,
    now: () => 5000,
  });
  /** The events a page's tab received, as the page will see them. */
  const events = (page: { tabId: number }) =>
    (browser.delivered.get(page.tabId) ?? []).map(({ event, data }) =>
      data === undefined ? { event } : { event, data },
    );
  /** Simulates chrome.storage.onChanged for a write the test makes through `permissions`. */
  const trackPermissions = async (change: () => Promise<unknown>) => {
    const oldValue = structuredClone(items[PERMISSIONS_ITEM]);
    await change();
    await router.onStorageChanged(
      { [PERMISSIONS_ITEM]: { oldValue, newValue: items[PERMISSIONS_ITEM] } },
      ITEMS,
    );
  };
  return { router, permissions, showApproval, state, trackPermissions, events, sendToTab, browser };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('DappRouter — ports', () => {
  it('accepts https pages and, for developers, localhost', async () => {
    const { router } = setup();
    for (const sender of [
      { origin: DUSA, frameId: 0 },
      { url: 'https://app.dusa.io/x' }, // Firefox may only give the url
      { origin: 'http://localhost:3000', frameId: 0 },
    ]) {
      const page = fakePort(sender);
      router.attach(page.port);
      expect(page.isDisconnected()).toBe(false);
    }
  });

  it('drops ports from anything else, and from iframes', () => {
    const { router } = setup();
    for (const sender of [
      null, // no sender at all
      {},
      { origin: 'http://evil.example', frameId: 0 },
      { url: 'file:///home/me/page.html' },
      { origin: DUSA, frameId: 3 },
    ]) {
      const page = fakePort(sender ?? undefined);
      if (sender === null) (page.port as { sender?: unknown }).sender = undefined;
      router.attach(page.port);
      expect(page.isDisconnected()).toBe(true);
    }
  });

  it('ignores malformed messages and answers bad requests with their error code', async () => {
    const { router } = setup();
    const page = fakePort();
    router.attach(page.port);
    page.raw(null);
    page.raw({ method: 'connect' });
    page.raw({ id: 'a b', method: 'connect' });
    const bad = page.send('transfer', { to: ALICE, amount: 1 });
    const refused = page.send('executeSC', {});
    await settle();
    expect(page.sent).toHaveLength(2);
    expect(page.replyTo(bad)).toMatchObject({ error: { code: -32602 } });
    expect(page.replyTo(refused)).toMatchObject({ error: { code: 4200 } });
  });
});

describe('DappRouter — status requests', () => {
  it('reveals nothing to a site that is not connected', async () => {
    const { router } = setup();
    const page = fakePort();
    router.attach(page.port);
    const connected = page.send('connected');
    const account = page.send('account');
    const network = page.send('network');
    await settle();
    expect(page.replyTo(connected)).toEqual({ id: connected, result: false });
    expect(page.replyTo(account)).toMatchObject({ error: { code: 4100 } });
    expect(page.replyTo(network)).toMatchObject({ error: { code: 4100 } });
  });

  it('answers a connected site with its account and the wallet network', async () => {
    const { router, permissions } = setup('buildnet');
    await permissions.grant(DUSA, [ALICE]);
    const page = fakePort();
    router.attach(page.port);
    const account = page.send('account');
    const network = page.send('network');
    await settle();
    expect(page.replyTo(account)).toEqual({ id: account, result: { address: ALICE } });
    expect(page.replyTo(network)).toEqual({ id: network, result: networkInfo('buildnet') });
  });

  it('lists every account a connected site may see, the one in use first', async () => {
    const { router, permissions } = setup();
    const page = fakePort();
    router.attach(page.port);
    const before = page.send('accounts');
    await settle();
    expect(page.replyTo(before)).toMatchObject({ error: { code: 4100 } });
    await permissions.grant(DUSA, [BOB, ALICE]);
    const accounts = page.send('accounts');
    const account = page.send('account');
    await settle();
    expect(page.replyTo(accounts)).toEqual({ id: accounts, result: { addresses: [BOB, ALICE] } });
    expect(page.replyTo(account)).toEqual({ id: account, result: { address: BOB } });
  });

  it('still knows sites connected before several accounts per site', async () => {
    const browser = fakeBrowser();
    browser.local[PERMISSIONS_ITEM] = { [DUSA]: { address: ALICE, grantedAt: 1 } };
    const { router } = setup('mainnet', browser);
    const page = fakePort();
    router.attach(page.port);
    const accounts = page.send('accounts');
    await settle();
    expect(page.replyTo(accounts)).toEqual({ id: accounts, result: { addresses: [ALICE] } });
  });

  it('disconnects a site on its request', async () => {
    const { router, permissions } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const page = fakePort();
    router.attach(page.port);
    const id = page.send('disconnect');
    await settle();
    expect(page.replyTo(id)).toEqual({ id, result: true });
    expect(await permissions.get(DUSA)).toBeNull();
  });
});

describe('DappRouter — connect', () => {
  it('asks the user, then connects the chosen account', async () => {
    const { router, permissions, showApproval } = setup();
    const page = fakePort();
    router.attach(page.port);
    const id = page.send('connect');
    await settle();
    expect(page.replyTo(id)).toBeUndefined();
    expect(showApproval).toHaveBeenCalledTimes(1);
    const view = router.next()!;
    expect(view).toMatchObject({ origin: DUSA, method: 'connect', address: null, queued: 0 });
    expect(await router.resolve(view.approvalId, { addresses: [BOB] })).toBe(true);
    expect(page.replyTo(id)).toEqual({ id, result: { address: BOB, addresses: [BOB] } });
    expect((await permissions.get(DUSA))?.addresses).toEqual([BOB]);
    expect(router.next()).toBeNull();
  });

  it('connects several accounts, the first one in use', async () => {
    const { router, permissions } = setup();
    const page = fakePort();
    router.attach(page.port);
    const id = page.send('connect');
    await settle();
    expect(await router.resolve(router.next()!.approvalId, { addresses: [BOB, ALICE] })).toBe(true);
    expect(page.replyTo(id)).toEqual({ id, result: { address: BOB, addresses: [BOB, ALICE] } });
    expect((await permissions.get(DUSA))?.addresses).toEqual([BOB, ALICE]);
  });

  it('refuses a connect result with no account, the same one twice, or a contract', async () => {
    const { router, permissions } = setup();
    for (const addresses of [[], [ALICE, ALICE], [ALICE, CONTRACT]]) {
      const page = fakePort();
      router.attach(page.port);
      const id = page.send('connect');
      await settle();
      expect(await router.resolve(router.next()!.approvalId, { addresses })).toBe(false);
      expect(page.replyTo(id)).toMatchObject({ error: { code: -32603 } });
    }
    expect(await permissions.get(DUSA)).toBeNull();
  });

  it('answers at once when the site is already connected', async () => {
    const { router, permissions, showApproval } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const page = fakePort();
    router.attach(page.port);
    const id = page.send('connect');
    await settle();
    expect(page.replyTo(id)).toEqual({ id, result: { address: ALICE, addresses: [ALICE] } });
    expect(showApproval).not.toHaveBeenCalled();
  });

  it('connects nothing when the user rejects, or when the result is not an account', async () => {
    const { router, permissions } = setup();
    const page = fakePort();
    router.attach(page.port);
    const first = page.send('connect');
    await settle();
    expect(router.reject(router.next()!.approvalId)).toBe(true);
    expect(page.replyTo(first)).toMatchObject({ error: { code: 4001 } });

    const second = page.send('connect');
    await settle();
    expect(await router.resolve(router.next()!.approvalId, { addresses: [CONTRACT] })).toBe(false);
    expect(page.replyTo(second)).toMatchObject({ error: { code: -32603 } });
    expect(await permissions.get(DUSA)).toBeNull();
  });
});

describe('DappRouter — signatures', () => {
  async function connectedPage() {
    const ctx = setup();
    await ctx.permissions.grant(DUSA, [ALICE]);
    const page = fakePort();
    ctx.router.attach(page.port);
    return { ...ctx, page };
  }

  it('refuses to queue anything for a site that is not connected', async () => {
    const { router, showApproval } = setup();
    const page = fakePort();
    router.attach(page.port);
    const id = page.send('transfer', { to: BOB, amount: '1000' });
    await settle();
    expect(page.replyTo(id)).toMatchObject({ error: { code: 4100 } });
    expect(showApproval).not.toHaveBeenCalled();
    expect(router.next()).toBeNull();
  });

  it("queues a transfer for the site's account and returns the operation id", async () => {
    const { router, page } = await connectedPage();
    const params = { to: BOB, amount: '1000' };
    const id = page.send('transfer', params);
    await settle();
    const view = router.next()!;
    expect(view).toMatchObject({ method: 'transfer', params, address: ALICE, createdAt: 5000 });
    expect(await router.resolve(view.approvalId, { operationId: OP_ID, network: 'buildnet' })).toBe(
      true,
    );
    expect(page.replyTo(id)).toEqual({
      id,
      result: { operationId: OP_ID, network: networkInfo('buildnet') },
    });
  });

  it('refuses an operation result without the network it was sent on', async () => {
    const { router, page } = await connectedPage();
    const id = page.send('transfer', { to: BOB, amount: '1000' });
    await settle();
    const view = router.next()!;
    const result = { operationId: OP_ID } as unknown as ApprovalResult;
    expect(await router.resolve(view.approvalId, result)).toBe(false);
    expect(page.replyTo(id)).toMatchObject({ error: { code: -32603 } });
  });

  it("signs with another of the site's accounts when it names it, and only those", async () => {
    const { router, permissions, page, showApproval } = await connectedPage();
    await permissions.addAccount(DUSA, BOB, false);
    page.send('transfer', { to: ALICE, amount: '1', from: BOB });
    await settle();
    expect(router.next()).toMatchObject({ method: 'transfer', address: BOB });
    router.reject(router.next()!.approvalId);

    const outsider = 'AU1Aq3tvikkbBW83jKLTB2UmcfknUMvNjXNyTafNPbSmUdAsjWQ4';
    const shown = showApproval.mock.calls.length;
    const id = page.send('sign', { data: 'aGk=', from: outsider });
    await settle();
    expect(page.replyTo(id)).toMatchObject({ error: { code: 4100 } });
    expect(router.next()).toBeNull();
    expect(showApproval).toHaveBeenCalledTimes(shown);
  });

  it('returns a signature for sign', async () => {
    const { router, page } = await connectedPage();
    const id = page.send('sign', { data: toBase64(new TextEncoder().encode('hello')) });
    await settle();
    const result = { publicKey: PUBLIC_KEY, signature: SIGNATURE };
    expect(await router.resolve(router.next()!.approvalId, result)).toBe(true);
    expect(page.replyTo(id)).toEqual({ id, result });
  });

  it('never passes on a result that does not fit the request', async () => {
    const { router, page } = await connectedPage();
    const id = page.send('callSC', { target: CONTRACT, func: 'swap' });
    await settle();
    expect(await router.resolve(router.next()!.approvalId, { addresses: [ALICE] })).toBe(false);
    expect(page.replyTo(id)).toMatchObject({ error: { code: -32603 } });
  });

  it('keeps one request per site waiting, and a cap across sites', async () => {
    const { router, page, permissions } = await connectedPage();
    page.send('buyRolls', { rolls: '1' });
    const second = page.send('sellRolls', { rolls: '1' });
    await settle();
    expect(page.replyTo(second)).toMatchObject({ error: { code: 4900 } });

    for (let i = 1; i < MAX_PENDING; i++) {
      const origin = `https://site${i}.example`;
      await permissions.grant(origin, [ALICE]);
      const other = fakePort({ origin, frameId: 0 });
      router.attach(other.port);
      other.send('buyRolls', { rolls: '1' });
    }
    await permissions.grant('https://late.example', [ALICE]);
    const late = fakePort({ origin: 'https://late.example', frameId: 0 });
    router.attach(late.port);
    const lateId = late.send('buyRolls', { rolls: '1' });
    await settle();
    expect(late.replyTo(lateId)).toMatchObject({ error: { code: 4900 } });
    expect(router.next()!.queued).toBe(MAX_PENDING - 1);
  });

  it('answers a repeated connect together with the waiting one', async () => {
    const { router, showApproval } = setup();
    const page = fakePort();
    const otherTab = fakePort();
    router.attach(page.port);
    router.attach(otherTab.port);
    const first = page.send('connect');
    const again = page.send('connect');
    const fromOtherTab = otherTab.send('connect');
    await settle();
    expect(router.next()).toMatchObject({ method: 'connect', queued: 0 });
    expect(showApproval).toHaveBeenCalledTimes(3);

    expect(await router.resolve(router.next()!.approvalId, { addresses: [ALICE] })).toBe(true);
    for (const [p, id] of [
      [page, first],
      [page, again],
      [otherTab, fromOtherTab],
    ] as const) {
      expect(p.replyTo(id)).toEqual({ id, result: { address: ALICE, addresses: [ALICE] } });
    }
  });

  it('rejects every page waiting on a connect, and keeps it while one still waits', async () => {
    const { router } = setup();
    const page = fakePort();
    const otherTab = fakePort();
    router.attach(page.port);
    router.attach(otherTab.port);
    page.send('connect');
    const stays = otherTab.send('connect');
    await settle();
    page.close();
    expect(router.next()).not.toBeNull();
    router.reject(router.next()!.approvalId);
    expect(otherTab.replyTo(stays)).toMatchObject({ error: { code: 4001 } });

    const last = fakePort();
    router.attach(last.port);
    last.send('connect');
    await settle();
    last.close();
    expect(router.next()).toBeNull();
  });

  it('stays busy for anything else while a connect waits', async () => {
    const { router, permissions } = setup();
    const page = fakePort();
    router.attach(page.port);
    page.send('connect');
    await settle();
    await permissions.grant(DUSA, [ALICE]); // e.g. connected from another profile view meanwhile
    const transfer = page.send('transfer', { to: BOB, amount: '1' });
    await settle();
    expect(page.replyTo(transfer)).toMatchObject({ error: { code: 4900 } });
  });

  it('shows requests oldest first', async () => {
    const { router, permissions, page } = await connectedPage();
    await permissions.grant('https://other.example', [BOB]);
    const other = fakePort({ origin: 'https://other.example', frameId: 0 });
    router.attach(other.port);
    page.send('buyRolls', { rolls: '1' });
    other.send('sellRolls', { rolls: '2' });
    await settle();
    const first = router.next()!;
    expect(first).toMatchObject({ origin: DUSA, queued: 1 });
    router.reject(first.approvalId);
    expect(router.next()).toMatchObject({ origin: 'https://other.example', address: BOB });
  });
});

describe('DappRouter — requests that end without the user', () => {
  afterEach(() => vi.useRealTimers());

  it('expires a request nobody answers', async () => {
    vi.useFakeTimers();
    const { router, permissions } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const page = fakePort();
    router.attach(page.port);
    const id = page.send('buyRolls', { rolls: '1' });
    await vi.advanceTimersByTimeAsync(0);
    const view = router.next()!;
    await vi.advanceTimersByTimeAsync(REQUEST_TTL_MS);
    expect(page.replyTo(id)).toMatchObject({
      error: { code: 4001, message: 'The request expired' },
    });
    expect(router.next()).toBeNull();
    expect(await router.resolve(view.approvalId, { operationId: OP_ID, network: 'mainnet' })).toBe(
      false,
    );
  });

  it('forgets the requests of a page that went away', async () => {
    const { router, permissions } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const page = fakePort();
    router.attach(page.port);
    page.send('buyRolls', { rolls: '1' });
    await settle();
    const view = router.next()!;
    page.close();
    expect(router.next()).toBeNull();
    expect(await router.resolve(view.approvalId, { operationId: OP_ID, network: 'mainnet' })).toBe(
      false,
    );
    expect(page.sent).toHaveLength(0);
  });

  it('rejects everything when the approval window is closed', async () => {
    const { router, permissions } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const page = fakePort();
    router.attach(page.port);
    const a = page.send('buyRolls', { rolls: '1' });
    const other = fakePort({ origin: 'https://other.example', frameId: 0 });
    router.attach(other.port);
    const b = other.send('connect');
    await settle();
    router.rejectAll();
    expect(page.replyTo(a)).toMatchObject({ error: { code: 4001 } });
    expect(other.replyTo(b)).toMatchObject({ error: { code: 4001 } });
    expect(router.next()).toBeNull();
  });
});

describe('DappRouter — events', () => {
  it("tells every page of a site when it's disconnected, and drops what it had waiting", async () => {
    const { router, permissions, trackPermissions, events } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const tab1 = fakePort();
    const tab2 = fakePort();
    router.attach(tab1.port);
    router.attach(tab2.port);
    const waiting = tab1.send('buyRolls', { rolls: '1' });
    await settle();
    await trackPermissions(() => permissions.revoke(DUSA));
    expect(tab1.replyTo(waiting)).toMatchObject({ error: { code: 4100 } });
    expect(events(tab1)).toEqual([{ event: 'disconnect' }]);
    expect(events(tab2)).toEqual([{ event: 'disconnect' }]);
    expect(router.next()).toBeNull();
  });

  it('tells a site when its account changes, and nobody else', async () => {
    const { router, permissions, trackPermissions, events } = setup();
    await permissions.grant(DUSA, [ALICE]);
    await permissions.grant('https://other.example', [ALICE]);
    const dusa = fakePort();
    const other = fakePort({ origin: 'https://other.example', frameId: 0 });
    router.attach(dusa.port);
    router.attach(other.port);
    await trackPermissions(() => permissions.addAccount(DUSA, BOB, true));
    expect(events(dusa)).toEqual([
      { event: 'accountChanged', data: { address: BOB } },
      { event: 'accountsChanged', data: { addresses: [BOB, ALICE] } },
    ]);
    expect(events(other)).toEqual([]);
  });

  it('tells only the list when an account is added or taken away behind the one in use', async () => {
    const { router, permissions, trackPermissions, events } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const dusa = fakePort();
    router.attach(dusa.port);
    await trackPermissions(() => permissions.addAccount(DUSA, BOB, false));
    await trackPermissions(() => permissions.removeAccount(DUSA, BOB));
    expect(events(dusa)).toEqual([
      { event: 'accountsChanged', data: { addresses: [ALICE, BOB] } },
      { event: 'accountsChanged', data: { addresses: [ALICE] } },
    ]);
  });

  it('moves every site that may see the wallet switched to, as MetaMask', async () => {
    const { router, permissions, trackPermissions, events } = setup();
    await permissions.grant(DUSA, [ALICE, BOB]);
    await permissions.grant('https://alice-only.example', [ALICE]);
    const dusa = fakePort();
    const aliceOnly = fakePort({ origin: 'https://alice-only.example', frameId: 0 });
    router.attach(dusa.port);
    router.attach(aliceOnly.port);
    await trackPermissions(() => permissions.useAccount(BOB));
    expect(events(dusa)).toEqual([
      { event: 'accountChanged', data: { address: BOB } },
      { event: 'accountsChanged', data: { addresses: [BOB, ALICE] } },
    ]);
    expect(events(aliceOnly)).toEqual([]);
  });

  it('drops a waiting request only when its account is taken away from the site', async () => {
    const { router, permissions, trackPermissions } = setup();
    await permissions.grant(DUSA, [ALICE, BOB]);
    const page = fakePort();
    router.attach(page.port);
    const fromBob = page.send('buyRolls', { rolls: '1', from: BOB });
    await settle();
    await trackPermissions(() => permissions.useAccount(BOB)); // still allowed: stays
    expect(router.next()).toMatchObject({ address: BOB });
    await trackPermissions(() => permissions.removeAccount(DUSA, BOB));
    expect(page.replyTo(fromBob)).toMatchObject({ error: { code: 4100 } });
    expect(router.next()).toBeNull();
  });

  it('tells connected sites only when the wallet switches network', async () => {
    const { router, permissions, state, events } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const dusa = fakePort();
    const stranger = fakePort({ origin: 'https://stranger.example', frameId: 0 });
    router.attach(dusa.port);
    router.attach(stranger.port);
    state.network = 'buildnet';
    await router.onStorageChanged(
      { [NETWORK_ITEM]: { oldValue: undefined, newValue: 'buildnet' } },
      ITEMS,
    );
    expect(events(dusa)).toEqual([{ event: 'networkChanged', data: networkInfo('buildnet') }]);
    expect(events(stranger)).toEqual([]);
  });

  it('still reaches a page after the browser restarted the worker and the port closed', async () => {
    const browser = fakeBrowser();
    const before = setup('mainnet', browser);
    await before.permissions.grant(DUSA, [ALICE]);
    const dusa = fakePort();
    before.router.attach(dusa.port);
    await settle();
    dusa.close();

    // A new worker: nothing in memory, no port — only what the browser stored.
    const after = setup('buildnet', browser);
    await after.router.onStorageChanged(
      { [NETWORK_ITEM]: { oldValue: 'mainnet', newValue: 'buildnet' } },
      ITEMS,
    );
    expect(after.events(dusa)).toEqual([
      { event: 'networkChanged', data: networkInfo('buildnet') },
    ]);
    expect(browser.delivered.get(dusa.tabId)?.[0]).toMatchObject({ origin: DUSA });
  });

  it('forgets a tab where nothing listens anymore', async () => {
    const { router, permissions, trackPermissions, sendToTab, browser } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const dusa = fakePort();
    router.attach(dusa.port);
    await settle();
    browser.deaf.add(dusa.tabId);
    await trackPermissions(() => permissions.addAccount(DUSA, BOB, true));
    const calls = sendToTab.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(browser.session[SITE_TABS_ITEM]).toEqual({});
    await trackPermissions(() => permissions.useAccount(ALICE));
    expect(sendToTab).toHaveBeenCalledTimes(calls);
  });

  it('counts a tab for the site it shows now, not one it showed before', async () => {
    const { router, permissions, trackPermissions, events } = setup();
    await permissions.grant(DUSA, [ALICE]);
    const dusa = fakePort();
    router.attach(dusa.port);
    // The same tab moves on to another site, whose page opens its own port.
    router.attach(
      fakePort({ origin: 'https://other.example', frameId: 0, tab: { id: dusa.tabId } }).port,
    );
    await settle();
    await trackPermissions(() => permissions.revoke(DUSA));
    expect(events(dusa)).toEqual([]);
  });
});
