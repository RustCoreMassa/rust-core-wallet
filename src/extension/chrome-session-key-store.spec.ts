import { CryptoVault } from '../app/core/services/crypto-vault';
import { ChromeSessionKeyStore } from './chrome-session-key-store';
import { AUTO_LOCK_ALARM, AUTO_LOCK_MS, SESSION_KEY_ITEM } from './session-constants';

type Args = ConstructorParameters<typeof ChromeSessionKeyStore>;

function setup() {
  const items: Record<string, unknown> = {};
  const alarms = new Map<string, number>();
  let now = 1_000_000;
  const area = {
    get: async (key: string) => (key in items ? { [key]: items[key] } : {}),
    set: async (entries: Record<string, unknown>) => void Object.assign(items, entries),
    remove: async (key: string) => void delete items[key],
  } as unknown as Args[0];
  const alarmsApi = {
    create: async (name: string, info: { when: number }) => void alarms.set(name, info.when),
    clear: async (name: string) => alarms.delete(name),
  } as unknown as Args[1];
  const store = new ChromeSessionKeyStore(area, alarmsApi, () => now);
  return { store, items, alarms, advance: (ms: number) => (now += ms), now: () => now };
}

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

  it('cannot keep a key the web app derived (non-extractable)', async () => {
    const { store } = setup();
    await expect(store.save((await vault.deriveNewKey('123456')).key)).rejects.toThrow();
  });
});
