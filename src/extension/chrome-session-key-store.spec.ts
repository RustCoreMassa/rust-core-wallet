import { CryptoVault } from '../app/core/services/crypto-vault';
import { ChromeSessionKeyStore } from './chrome-session-key-store';
import { AUTO_LOCK_ALARM, AUTO_LOCK_MS, SESSION_KEY_ITEM } from './session-constants';

type Args = ConstructorParameters<typeof ChromeSessionKeyStore>;

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

function setup() {
  const items: Record<string, unknown> = {};
  const alarms = new Map<string, number>();
  const listeners = new Set<Listener>();
  let now = 1_000_000;
  const notify = (key: string) =>
    listeners.forEach((l) => l({ [key]: { newValue: items[key] } }, 'session'));
  const area = {
    get: async (key: string) => (key in items ? { [key]: items[key] } : {}),
    set: async (entries: Record<string, unknown>) => {
      Object.assign(items, entries);
      Object.keys(entries).forEach(notify);
    },
    remove: async (key: string) => {
      delete items[key];
      notify(key);
    },
  } as unknown as Args[0];
  const events = {
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
  } as unknown as Args[3];
  const alarmsApi = {
    create: async (name: string, info: { when: number }) => void alarms.set(name, info.when),
    clear: async (name: string) => alarms.delete(name),
  } as unknown as Args[1];
  const clock = () => now;
  const store = new ChromeSessionKeyStore(area, alarmsApi, clock, events);
  /** Another view of the extension (the side panel, say): same storage, its own store. */
  const otherView = () => new ChromeSessionKeyStore(area, alarmsApi, clock, events);
  return {
    store,
    otherView,
    items,
    alarms,
    listeners,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const vault = new CryptoVault();

describe('ChromeSessionKeyStore', () => {
  it('gives back a key that decrypts what the original encrypted', async () => {
    const { store } = setup();
    const { key } = await vault.deriveNewKey('123456', true);
    const sealed = await vault.encrypt('vault', key);
    await store.save(key);

    const restored = await store.restore();
    expect(restored).not.toBeNull();
    expect(await vault.decrypt(sealed, restored!)).toBe('vault');
    await store.clear();
  });

  it('schedules the auto-lock alarm and extends it on each restore', async () => {
    const { store, alarms, advance, now } = setup();
    await store.save((await vault.deriveNewKey('123456', true)).key);
    expect(alarms.get(AUTO_LOCK_ALARM)).toBe(now() + AUTO_LOCK_MS);

    advance(AUTO_LOCK_MS - 1);
    expect(await store.restore()).not.toBeNull();
    expect(alarms.get(AUTO_LOCK_ALARM)).toBe(now() + AUTO_LOCK_MS);
    await store.clear();
  });

  it('refuses and wipes an expired key even if the alarm never fired', async () => {
    const { store, items, alarms, advance } = setup();
    await store.save((await vault.deriveNewKey('123456', true)).key);
    advance(AUTO_LOCK_MS);
    expect(await store.restore()).toBeNull();
    expect(SESSION_KEY_ITEM in items).toBe(false);
    expect(alarms.has(AUTO_LOCK_ALARM)).toBe(false);
  });

  it('clears the key and the alarm', async () => {
    const { store, items, alarms } = setup();
    await store.save((await vault.deriveNewKey('123456', true)).key);
    await store.clear();
    expect(SESSION_KEY_ITEM in items).toBe(false);
    expect(alarms.has(AUTO_LOCK_ALARM)).toBe(false);
    expect(await store.restore()).toBeNull();
  });

  it('lasts AUTO_LOCK_MS after the last activity — an open view alone keeps nothing alive', async () => {
    const { store, alarms, advance, now } = setup();
    await store.save((await vault.deriveNewKey('123456', true)).key);
    const unlockedAt = now();

    advance(10 * 60_000);
    store.touch(); // the user did something
    await flush();
    expect(alarms.get(AUTO_LOCK_ALARM)).toBe(now() + AUTO_LOCK_MS);

    // No more activity: nothing extends it, however long the view stays open.
    advance(AUTO_LOCK_MS);
    expect(await store.restore()).toBeNull();
    expect(now() - unlockedAt).toBeGreaterThan(AUTO_LOCK_MS);
  });

  it('extends at most every 30 s, and never revives an ended session', async () => {
    const { store, items, advance } = setup();
    await store.save((await vault.deriveNewKey('123456', true)).key);
    const write = vi.spyOn(store as unknown as { write(k: string): Promise<void> }, 'write');
    store.touch();
    store.touch();
    advance(10_000);
    store.touch();
    await flush();
    expect(write).toHaveBeenCalledTimes(1);

    await store.clear();
    advance(60_000);
    store.touch();
    await flush();
    expect(SESSION_KEY_ITEM in items).toBe(false);
  });

  it('never extends a session that already expired, before the alarm wiped it', async () => {
    const { store, alarms, advance } = setup();
    await store.save((await vault.deriveNewKey('123456', true)).key);
    const expiry = alarms.get(AUTO_LOCK_ALARM);
    advance(AUTO_LOCK_MS + 1);
    store.touch();
    await flush();
    expect(alarms.get(AUTO_LOCK_ALARM)).toBe(expiry);
    expect(await store.restore()).toBeNull();
  });

  it('tells every open view when the session ends, whichever view or alarm ended it', async () => {
    const { store, otherView, items, listeners } = setup();
    await store.save((await vault.deriveNewKey('123456', true)).key);
    const panelEnded = vi.fn();
    const stop = otherView().watch(panelEnded);

    store.touch(); // a write that keeps the key: not an end
    await flush();
    expect(panelEnded).not.toHaveBeenCalled();

    delete items[SESSION_KEY_ITEM]; // e.g. the background's alarm…
    listeners.forEach((l) => l({ [SESSION_KEY_ITEM]: { newValue: undefined } }, 'session'));
    expect(panelEnded).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it('notices an expired session by itself, if the alarm came late', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { store, items, advance } = setup();
      await store.save((await vault.deriveNewKey('123456', true)).key);
      const ended = vi.fn();
      const stop = store.watch(ended);
      advance(AUTO_LOCK_MS + 1);
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
      expect(SESSION_KEY_ITEM in items).toBe(false);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cannot keep a key the web app derived (non-extractable)', async () => {
    const { store } = setup();
    await expect(store.save((await vault.deriveNewKey('123456')).key)).rejects.toThrow();
  });
});
