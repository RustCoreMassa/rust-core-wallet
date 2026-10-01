import { ChromeStorageArea } from './chrome-storage-area';

type Changes = Record<string, { newValue?: unknown }>;

/** An in-memory chrome.storage area that reports changes like the real one. */
function fakeArea(initial: Record<string, unknown> = {}) {
  const items: Record<string, unknown> = { ...initial };
  const listeners: ((changes: Changes) => void)[] = [];
  const area = {
    get: async () => ({ ...items }),
    set: async (entries: Record<string, unknown>) => void Object.assign(items, entries),
    remove: async (key: string) => void delete items[key],
    onChanged: { addListener: (fn: (changes: Changes) => void) => listeners.push(fn) },
  };
  const emit = (changes: Changes) => listeners.forEach((fn) => fn(changes));
  return {
    items,
    emit,
    area: area as unknown as ConstructorParameters<typeof ChromeStorageArea>[0],
  };
}

describe('ChromeStorageArea', () => {
  it("loads only the app's own string items", async () => {
    const { area } = fakeArea({
      'massa-wallet:network': 'buildnet',
      'rustcore:session-key': { key: 'secret', expiresAt: 1 },
      'massa-wallet:odd': 42,
    });
    const store = new ChromeStorageArea(area);
    await store.load();
    expect(store.getItem('massa-wallet:network')).toBe('buildnet');
    expect(store.getItem('rustcore:session-key')).toBeNull();
    expect(store.getItem('massa-wallet:odd')).toBeNull();
  });

  it('reads its own writes at once and writes them through', async () => {
    const { area, items } = fakeArea();
    const store = new ChromeStorageArea(area);
    await store.load();
    store.setItem('massa-wallet:vault', '{"salt":"x"}');
    expect(store.getItem('massa-wallet:vault')).toBe('{"salt":"x"}');
    await Promise.resolve();
    expect(items['massa-wallet:vault']).toBe('{"salt":"x"}');

    store.removeItem('massa-wallet:vault');
    expect(store.getItem('massa-wallet:vault')).toBeNull();
    await Promise.resolve();
    expect('massa-wallet:vault' in items).toBe(false);
  });

  it('follows changes made by other extension pages', async () => {
    const { area, emit } = fakeArea({ 'massa-wallet:network': 'mainnet' });
    const store = new ChromeStorageArea(area);
    await store.load();
    emit({ 'massa-wallet:network': { newValue: 'buildnet' }, 'rustcore:x': { newValue: 'y' } });
    expect(store.getItem('massa-wallet:network')).toBe('buildnet');
    expect(store.getItem('rustcore:x')).toBeNull();
    emit({ 'massa-wallet:network': {} });
    expect(store.getItem('massa-wallet:network')).toBeNull();
  });
});
