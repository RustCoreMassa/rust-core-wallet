import { BiometryChangedError, BiometryFailedError } from '../app/core/platform/biometric-unlock';
import {
  BIOMETRIC_UNLOCK_KEY,
  BiometricUnlockPlugin,
  NativeBiometricUnlock,
} from './native-biometric-unlock';

/** The Keychain item behind Face ID; `next` decides how the next prompt ends. */
function fakePlugin() {
  const state = {
    kept: null as string | null,
    next: 'ok' as 'ok' | 'canceled' | 'unavailable' | 'failed',
  };
  const plugin: BiometricUnlockPlugin = {
    availability: async () => ({ kind: 'face' }),
    save: async ({ secret }) => void (state.kept = secret),
    read: async () => {
      if (state.next !== 'ok' || state.kept === null) {
        throw Object.assign(new Error('no'), {
          code: state.kept === null ? 'unavailable' : state.next,
        });
      }
      return { secret: state.kept };
    },
    remove: async () => void (state.kept = null),
  };
  return { plugin, state };
}

function memoryStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe('NativeBiometricUnlock', () => {
  it('reads whether it is on from the store', () => {
    const { plugin } = fakePlugin();
    expect(new NativeBiometricUnlock(plugin, memoryStore()).enabled()).toBe(false);
    const on = memoryStore({ [BIOMETRIC_UNLOCK_KEY]: 'on' });
    expect(new NativeBiometricUnlock(plugin, on).enabled()).toBe(true);
  });

  it('turns on only once Face ID has been confirmed', async () => {
    const { plugin, state } = fakePlugin();
    const store = memoryStore();
    const bio = new NativeBiometricUnlock(plugin, store);
    await bio.enable('123456');
    expect(state.kept).toBe('123456');
    expect(bio.enabled()).toBe(true);
    expect(store.items.get(BIOMETRIC_UNLOCK_KEY)).toBe('on');
  });

  it('stays off, keeping nothing, when the confirmation is cancelled', async () => {
    const { plugin, state } = fakePlugin();
    const store = memoryStore();
    const bio = new NativeBiometricUnlock(plugin, store);
    state.next = 'canceled';
    await expect(bio.enable('123456')).rejects.toBeInstanceOf(BiometryFailedError);
    expect(state.kept).toBeNull();
    expect(bio.enabled()).toBe(false);
    expect(store.items.has(BIOMETRIC_UNLOCK_KEY)).toBe(false);
  });

  it('gives the PIN back, or null when the user cancels', async () => {
    const { plugin, state } = fakePlugin();
    const bio = new NativeBiometricUnlock(plugin, memoryStore());
    await bio.enable('123456');
    expect(await bio.readSecret()).toBe('123456');
    state.next = 'canceled';
    expect(await bio.readSecret()).toBeNull();
    expect(bio.enabled()).toBe(true);
  });

  it('turns itself off when Face ID changed on the phone', async () => {
    const { plugin, state } = fakePlugin();
    const store = memoryStore();
    const bio = new NativeBiometricUnlock(plugin, store);
    await bio.enable('123456');
    state.kept = null; // iOS invalidates the item when a face is added
    await expect(bio.readSecret()).rejects.toBeInstanceOf(BiometryChangedError);
    expect(bio.enabled()).toBe(false);
    expect(store.items.has(BIOMETRIC_UNLOCK_KEY)).toBe(false);
  });

  it('stays on after a failed attempt (not recognised, locked out)', async () => {
    const { plugin, state } = fakePlugin();
    const bio = new NativeBiometricUnlock(plugin, memoryStore());
    await bio.enable('123456');
    state.next = 'failed';
    await expect(bio.readSecret()).rejects.toBeInstanceOf(BiometryFailedError);
    expect(bio.enabled()).toBe(true);
  });

  it('turns off even when deleting the kept PIN fails', async () => {
    const { plugin } = fakePlugin();
    const store = memoryStore({ [BIOMETRIC_UNLOCK_KEY]: 'on' });
    plugin.remove = async () => {
      throw new Error('errSecInteractionNotAllowed');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bio = new NativeBiometricUnlock(plugin, store);
    await bio.disable();
    expect(bio.enabled()).toBe(false);
    expect(store.items.has(BIOMETRIC_UNLOCK_KEY)).toBe(false);
  });
});
