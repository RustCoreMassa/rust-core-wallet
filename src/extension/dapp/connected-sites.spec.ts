import { ChromeConnectedSites, TabsApi } from './connected-sites';
import { ORIGIN_QUERY } from './content';
import { PERMISSIONS_ITEM } from './permissions';

const A = 'AU12dG5xP1RDEB5ocdHkymNVvvSJmUL9BgHwCksDowqmGWxfpm93x';
const B = 'AU1qDAxGJ387ETi9JRQzZWSPKYq4YPXrFvdiE4VoXUaiAt38JFEC';

type Change = Record<string, { oldValue?: unknown; newValue?: unknown }>;

function fakeStorage(initial: Record<string, unknown> = {}) {
  const items: Record<string, unknown> = structuredClone(initial);
  const listeners: ((changes: Change, area: string) => void)[] = [];
  const area = {
    get: async (key: string) => (key in items ? { [key]: structuredClone(items[key]) } : {}),
    set: async (entries: Record<string, unknown>) => {
      const changes: Change = {};
      for (const [k, v] of Object.entries(entries)) {
        changes[k] = { oldValue: items[k], newValue: v };
        items[k] = v;
      }
      listeners.forEach((l) => l(changes, 'local'));
    },
  };
  const onChanged = { addListener: (l: (c: Change, a: string) => void) => listeners.push(l) };
  return {
    items,
    area: area as unknown as ConstructorParameters<typeof ChromeConnectedSites>[0],
    onChanged: onChanged as unknown as ConstructorParameters<typeof ChromeConnectedSites>[1],
    /** A write made by another view or the background (the same storage). */
    external: (entries: Record<string, unknown>) => area.set(entries),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeTabs(answer: (tabId: number) => unknown, activeId: number | null = 7) {
  const activated: (() => void)[] = [];
  const updated: ((tabId: number, info: { status?: string }) => void)[] = [];
  const tabs = {
    query: vi.fn(async () => (activeId === null ? [] : [{ id: activeId }])),
    sendMessage: vi.fn(async (tabId: number) => {
      const value = answer(tabId);
      if (value instanceof Error) throw value;
      return value;
    }),
    onActivated: {
      addListener: (cb: () => void) => activated.push(cb),
      removeListener: (cb: () => void) => activated.splice(activated.indexOf(cb), 1),
    },
    onUpdated: {
      addListener: (cb: (typeof updated)[number]) => updated.push(cb),
      removeListener: (cb: (typeof updated)[number]) => updated.splice(updated.indexOf(cb), 1),
    },
  };
  return {
    tabs: tabs as unknown as TabsApi,
    sendMessage: tabs.sendMessage,
    activate: () => activated.forEach((cb) => cb()),
    update: (status?: string) => updated.forEach((cb) => cb(7, { status })),
  };
}

describe('ChromeConnectedSites', () => {
  const stored = {
    [PERMISSIONS_ITEM]: {
      'https://two.example': { addresses: [B], grantedAt: 2000 },
      'https://one.example': { address: A, grantedAt: 1000 }, // saved before several accounts
    },
  };

  it('lists the stored sites, oldest first', async () => {
    const { area, onChanged } = fakeStorage(stored);
    const sites = new ChromeConnectedSites(area, onChanged);
    await settle();
    expect(sites.sites()).toEqual([
      { origin: 'https://one.example', addresses: [A], grantedAt: 1000 },
      { origin: 'https://two.example', addresses: [B], grantedAt: 2000 },
    ]);
  });

  it('adds, uses and takes away accounts, and disconnects a site', async () => {
    const { area, onChanged, items } = fakeStorage(stored);
    const sites = new ChromeConnectedSites(area, onChanged);
    await settle();
    await sites.addAccount('https://one.example', B, false);
    expect(sites.sites()[0].addresses).toEqual([A, B]);
    await sites.useAccount(B);
    expect(sites.sites()[0].addresses).toEqual([B, A]);
    await sites.removeAccount('https://one.example', B);
    expect(sites.sites()[0].addresses).toEqual([A]);
    await sites.disconnect('https://two.example');
    expect(sites.sites().map((s) => s.origin)).toEqual(['https://one.example']);
    expect(Object.keys(items[PERMISSIONS_ITEM] as object)).toEqual(['https://one.example']);
  });

  it('forgets a removed account on every site, and every site on log out', async () => {
    const { area, onChanged } = fakeStorage(stored);
    const sites = new ChromeConnectedSites(area, onChanged);
    await settle();
    await sites.forgetAccount(B);
    expect(sites.sites().map((s) => s.origin)).toEqual(['https://one.example']);
    await sites.clear();
    expect(sites.sites()).toEqual([]);
  });

  it('follows changes made elsewhere (a new connection approved in the approval window)', async () => {
    const { area, onChanged, external } = fakeStorage();
    const sites = new ChromeConnectedSites(area, onChanged);
    await settle();
    expect(sites.sites()).toEqual([]);
    await external({
      [PERMISSIONS_ITEM]: { 'https://new.example': { addresses: [A, B], grantedAt: 5 } },
    });
    expect(sites.sites()).toEqual([
      { origin: 'https://new.example', addresses: [A, B], grantedAt: 5 },
    ]);
  });

  it("asks the active tab's content script which site it shows", async () => {
    const { area, onChanged } = fakeStorage();
    const fake = fakeTabs(() => 'https://app.dusa.io');
    const sites = new ChromeConnectedSites(area, onChanged, fake.tabs);
    expect(await sites.activeTabOrigin()).toBe('https://app.dusa.io');
    expect(fake.sendMessage).toHaveBeenCalledWith(7, ORIGIN_QUERY, { frameId: 0 });
  });

  it('has no site for a tab without the content script, an odd answer, or no tab', async () => {
    const { area, onChanged } = fakeStorage();
    for (const fake of [
      fakeTabs(() => new Error('Could not establish connection')),
      fakeTabs(() => 'http://evil.example'),
      fakeTabs(() => ({ origin: 'https://app.dusa.io' })),
      fakeTabs(() => 'https://app.dusa.io', null),
    ]) {
      expect(await new ChromeConnectedSites(area, onChanged, fake.tabs).activeTabOrigin()).toBe(
        null,
      );
    }
    expect(await new ChromeConnectedSites(area, onChanged).activeTabOrigin()).toBeNull();
  });

  it('calls back when another tab is activated or a page finishes loading, until stopped', async () => {
    const { area, onChanged } = fakeStorage();
    const fake = fakeTabs(() => null);
    const callback = vi.fn();
    const stop = new ChromeConnectedSites(area, onChanged, fake.tabs).watchActiveTab(callback);
    fake.activate();
    fake.update('loading');
    fake.update('complete');
    expect(callback).toHaveBeenCalledTimes(2);
    stop();
    fake.activate();
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
