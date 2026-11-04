import { WebSessionKeyStore } from './session-key-store';

describe('WebSessionKeyStore', () => {
  it('keeps no key: a reload needs the PIN', async () => {
    const store = new WebSessionKeyStore();
    await store.save();
    expect(store.keepsKey).toBe(false);
    expect(await store.restore()).toBeNull();
  });

  it("locks the wallet's other tabs when one locks", async () => {
    const lockingTab = new WebSessionKeyStore();
    const otherTab = new WebSessionKeyStore();
    const ended = vi.fn();
    const stop = otherTab.watch(ended);

    await lockingTab.clear();
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    stop();
  });
});
