import { NativeStorageArea, NativeStorePlugin } from './native-storage-area';

/** The Keychain plugin, in memory; `failOn` makes writes of that key fail. */
function fakePlugin(initial: Record<string, string> = {}) {
  const items: Record<string, string> = { ...initial };
  const calls: string[] = [];
  // `delays`: how long each next native call takes (ms), in call order; then 0.
  const state = { failOn: null as string | null, delays: [] as number[] };
  const settle = () => new Promise<void>((r) => setTimeout(r, state.delays.shift() ?? 0));
  const plugin: NativeStorePlugin = {
    getAll: async () => ({ items: { ...items } }),
    set: async ({ key, value }) => {
      await settle();
      if (key === state.failOn) throw new Error('errSecInteractionNotAllowed');
      calls.push(`set ${key}=${value}`);
      items[key] = value;
    },
    remove: async ({ key }) => {
      await settle();
      if (key === state.failOn) throw new Error('errSecInteractionNotAllowed');
      calls.push(`remove ${key}`);
      delete items[key];
    },
  };
  return { plugin, items, calls, state };
}

/** A Web Storage of its own (not the shared jsdom localStorage). */
function fakeWebStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe('NativeStorageArea', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

  it("loads only the app's own items", async () => {
    const { plugin } = fakePlugin({ 'massa-wallet:network': 'buildnet', 'other:key': 'x' });
    const store = new NativeStorageArea(plugin, null);
    await store.load();
    expect(store.getItem('massa-wallet:network')).toBe('buildnet');
    expect(store.getItem('other:key')).toBeNull();
  });

  it('reads its own writes at once and writes them through, in order', async () => {
    const { plugin, items, calls, state } = fakePlugin();
    const store = new NativeStorageArea(plugin, null);
    await store.load();
    state.delays = [20, 0, 0]; // a slow first write must not be overtaken by the next ones
    store.setItem('massa-wallet:vault', 'v1');
    store.setItem('massa-wallet:vault', 'v2');
    store.removeItem('massa-wallet:network');
    expect(store.getItem('massa-wallet:vault')).toBe('v2');
    await store.settled();
    expect(calls).toEqual([
      'set massa-wallet:vault=v1',
      'set massa-wallet:vault=v2',
      'remove massa-wallet:network',
    ]);
    expect(items['massa-wallet:vault']).toBe('v2');

    store.removeItem('massa-wallet:vault');
    expect(store.getItem('massa-wallet:vault')).toBeNull();
    await store.settled();
    expect('massa-wallet:vault' in items).toBe(false);
  });

  it('reports a failed write and keeps writing the next ones', async () => {
    const { plugin, items, state } = fakePlugin();
    const store = new NativeStorageArea(plugin, null);
    await store.load();
    const failed: string[] = [];
    store.onWriteError = (key) => failed.push(key);
    state.failOn = 'massa-wallet:vault';
    store.setItem('massa-wallet:vault', 'v1');
    store.setItem('massa-wallet:network', 'buildnet');
    await store.settled();
    expect(failed).toEqual(['massa-wallet:vault']);
    expect(items['massa-wallet:network']).toBe('buildnet');
  });

  it("moves the web view's items into the native store, then deletes them there", async () => {
    const { plugin, items } = fakePlugin({ 'massa-wallet:network': 'mainnet' });
    const web = fakeWebStorage({
      'massa-wallet:vault': 'old-vault',
      'massa-wallet:network': 'buildnet', // the native store's copy is newer
      'unrelated:key': 'stays',
    });
    const store = new NativeStorageArea(plugin, web);
    await store.load();
    expect(items['massa-wallet:vault']).toBe('old-vault');
    expect(store.getItem('massa-wallet:vault')).toBe('old-vault');
    expect(store.getItem('massa-wallet:network')).toBe('mainnet');
    expect(web.getItem('massa-wallet:vault')).toBeNull();
    expect(web.getItem('massa-wallet:network')).toBeNull();
    expect(web.getItem('unrelated:key')).toBe('stays');
  });

  it('keeps the web copy when moving fails, and moves it at the next start', async () => {
    const { plugin, items, state } = fakePlugin();
    const web = fakeWebStorage({ 'massa-wallet:vault': 'old-vault' });
    state.failOn = 'massa-wallet:vault';
    const first = new NativeStorageArea(plugin, web);
    await first.load();
    expect(first.getItem('massa-wallet:vault')).toBe('old-vault'); // still usable
    expect(web.getItem('massa-wallet:vault')).toBe('old-vault');

    state.failOn = null;
    const next = new NativeStorageArea(plugin, web);
    await next.load();
    expect(items['massa-wallet:vault']).toBe('old-vault');
    expect(web.getItem('massa-wallet:vault')).toBeNull();
  });

  it('a removed item never comes back from a web copy still waiting to move', async () => {
    const { plugin, state } = fakePlugin();
    const web = fakeWebStorage({ 'massa-wallet:vault': 'old-vault' });
    state.failOn = 'massa-wallet:vault';
    const store = new NativeStorageArea(plugin, web);
    await store.load();
    state.failOn = null;
    store.removeItem('massa-wallet:vault'); // e.g. Log out
    await store.settled();

    const next = new NativeStorageArea(plugin, web);
    await next.load();
    expect(next.getItem('massa-wallet:vault')).toBeNull();
  });
});
