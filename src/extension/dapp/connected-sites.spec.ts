import { ChromeConnectedSites } from './connected-sites';
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

describe('ChromeConnectedSites', () => {
  const stored = {
    [PERMISSIONS_ITEM]: {
      'https://two.example': { address: B, grantedAt: 2000 },
      'https://one.example': { address: A, grantedAt: 1000 },
    },
  };

  it('lists the stored sites, oldest first', async () => {
    const { area, onChanged } = fakeStorage(stored);
    const sites = new ChromeConnectedSites(area, onChanged);
    await settle();
    expect(sites.sites()).toEqual([
      { origin: 'https://one.example', address: A, grantedAt: 1000 },
      { origin: 'https://two.example', address: B, grantedAt: 2000 },
    ]);
  });

  it('changes a site’s account and disconnects a site', async () => {
    const { area, onChanged, items } = fakeStorage(stored);
    const sites = new ChromeConnectedSites(area, onChanged);
    await settle();
    await sites.changeAccount('https://one.example', B);
    expect(sites.sites()[0].address).toBe(B);
    await sites.disconnect('https://two.example');
    expect(sites.sites().map((s) => s.origin)).toEqual(['https://one.example']);
    expect(Object.keys(items[PERMISSIONS_ITEM] as object)).toEqual(['https://one.example']);
  });

  it('forgets the sites of a removed account, and every site on log out', async () => {
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
    await external({ [PERMISSIONS_ITEM]: { 'https://new.example': { address: A, grantedAt: 5 } } });
    expect(sites.sites()).toEqual([{ origin: 'https://new.example', address: A, grantedAt: 5 }]);
  });
});
