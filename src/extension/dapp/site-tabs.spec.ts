import { SITE_TABS_ITEM, SiteTabs } from './site-tabs';

const DUSA = 'https://app.dusa.io';
const OTHER = 'https://other.example';

/** chrome.storage.session, with reads and writes that take a little while, like the real one. */
function fakeSession(items: Record<string, unknown> = {}) {
  const later = () => new Promise((r) => setTimeout(r, 1));
  const area = {
    get: async (key: string) => {
      await later();
      return key in items ? { [key]: structuredClone(items[key]) } : {};
    },
    set: async (entries: Record<string, unknown>) => {
      await later();
      Object.assign(items, structuredClone(entries));
    },
  } as unknown as ConstructorParameters<typeof SiteTabs>[0];
  return { area, items };
}

describe('SiteTabs', () => {
  it('lists the tabs showing a site', async () => {
    const tabs = new SiteTabs(fakeSession().area);
    await tabs.remember(1, DUSA);
    await tabs.remember(2, OTHER);
    await tabs.remember(3, DUSA);
    expect(await tabs.of(DUSA)).toEqual([1, 3]);
    expect(await tabs.of('https://nobody.example')).toEqual([]);
  });

  it('keeps every tab when pages open their ports at the same time', async () => {
    const tabs = new SiteTabs(fakeSession().area);
    await Promise.all([1, 2, 3, 4, 5].map((id) => tabs.remember(id, DUSA)));
    expect(await tabs.of(DUSA)).toEqual([1, 2, 3, 4, 5]);
  });

  it('counts a tab for the last site it showed, and forgets closed tabs', async () => {
    const tabs = new SiteTabs(fakeSession().area);
    await tabs.remember(7, DUSA);
    await tabs.remember(7, OTHER);
    expect(await tabs.of(DUSA)).toEqual([]);
    expect(await tabs.of(OTHER)).toEqual([7]);
    await tabs.forget(7);
    expect(await tabs.of(OTHER)).toEqual([]);
  });

  it('survives a restart: a new instance reads what the browser kept', async () => {
    const session = fakeSession();
    await new SiteTabs(session.area).remember(4, DUSA);
    expect(await new SiteTabs(session.area).of(DUSA)).toEqual([4]);
  });

  it('ignores stored entries it did not write', async () => {
    const session = fakeSession({
      [SITE_TABS_ITEM]: { '1': DUSA, x: DUSA, '2': 42, '3': { origin: DUSA } },
    });
    const tabs = new SiteTabs(session.area);
    expect(await tabs.of(DUSA)).toEqual([1]);
    await tabs.remember(5, DUSA);
    expect(session.items[SITE_TABS_ITEM]).toEqual({ '1': DUSA, '5': DUSA });
  });

  it('keeps going after a failed write', async () => {
    const session = fakeSession();
    const failing = { ...session.area, set: vi.fn().mockRejectedValueOnce(new Error('quota')) };
    failing.set.mockImplementation(session.area.set);
    const tabs = new SiteTabs(failing as unknown as typeof session.area);
    await expect(tabs.remember(1, DUSA)).rejects.toThrow('quota');
    await tabs.remember(2, DUSA);
    expect(await tabs.of(DUSA)).toEqual([2]);
  });
});
