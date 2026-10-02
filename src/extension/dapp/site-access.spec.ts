import { ChromeSiteAccess, SITE_ORIGINS } from './site-access';

function fakePermissions(granted: boolean) {
  const state = { granted };
  const added: (() => void)[] = [];
  const removed: (() => void)[] = [];
  const api = {
    contains: vi.fn(async () => state.granted),
    request: vi.fn(async () => (state.granted = true)),
    onAdded: { addListener: (l: () => void) => added.push(l) },
    onRemoved: { addListener: (l: () => void) => removed.push(l) },
  };
  return {
    api: api as unknown as ConstructorParameters<typeof ChromeSiteAccess>[0],
    raw: api,
    state,
    /** The user changed the permission in the browser's settings. */
    change: (to: boolean) => {
      state.granted = to;
      (to ? added : removed).forEach((l) => l());
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('ChromeSiteAccess', () => {
  it('reports whether the extension may run on websites', async () => {
    const off = new ChromeSiteAccess(fakePermissions(false).api);
    const on = new ChromeSiteAccess(fakePermissions(true).api);
    expect(off.granted()).toBeNull(); // still checking
    await settle();
    expect(off.granted()).toBe(false);
    expect(on.granted()).toBe(true);
  });

  it('follows the user turning access off and on in the browser', async () => {
    const fake = fakePermissions(true);
    const access = new ChromeSiteAccess(fake.api);
    await settle();
    fake.change(false);
    await settle();
    expect(access.granted()).toBe(false);
    fake.change(true);
    await settle();
    expect(access.granted()).toBe(true);
  });

  it('asks for every origin the dApp scripts are declared for', async () => {
    const fake = fakePermissions(false);
    const access = new ChromeSiteAccess(fake.api);
    await settle();
    await expect(access.request()).resolves.toBe(true);
    expect(fake.raw.request).toHaveBeenCalledWith({ origins: SITE_ORIGINS });
    expect(access.granted()).toBe(true);
  });

  it('stays quiet where the browser has no permissions API', async () => {
    const access = new ChromeSiteAccess(undefined);
    await settle();
    expect(access.granted()).toBeNull();
    await expect(access.request()).resolves.toBe(false);
  });
});
