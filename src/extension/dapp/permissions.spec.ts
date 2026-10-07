import { DappPermissions, PERMISSIONS_ITEM, dappOrigin } from './permissions';

const A = 'AU12dG5xP1RDEB5ocdHkymNVvvSJmUL9BgHwCksDowqmGWxfpm93x';
const B = 'AU1qDAxGJ387ETi9JRQzZWSPKYq4YPXrFvdiE4VoXUaiAt38JFEC';

function fakeLocal(initial: Record<string, unknown> = {}) {
  const items: Record<string, unknown> = { ...initial };
  const area = {
    get: async (key: string) => (key in items ? { [key]: items[key] } : {}),
    set: async (entries: Record<string, unknown>) => void Object.assign(items, entries),
  };
  return { items, area: area as unknown as ConstructorParameters<typeof DappPermissions>[0] };
}

describe('dappOrigin', () => {
  it('takes the origin of https pages', () => {
    expect(dappOrigin('https://app.dusa.io/trade?x=1#y')).toBe('https://app.dusa.io');
    expect(dappOrigin('https://example.com:8443/a')).toBe('https://example.com:8443');
  });

  it('allows plain http only on this computer, for dApp developers', () => {
    expect(dappOrigin('http://localhost:4200/')).toBe('http://localhost:4200');
    expect(dappOrigin('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(dappOrigin('http://example.com/')).toBeNull();
    expect(dappOrigin('http://localhost.evil.com/')).toBeNull();
  });

  it('refuses everything else', () => {
    for (const url of [
      undefined,
      '',
      'not a url',
      'file:///etc/passwd',
      'chrome-extension://abc/index.html',
      'data:text/html,hi',
      'javascript:alert(1)',
    ]) {
      expect(dappOrigin(url)).toBeNull();
    }
  });
});

describe('DappPermissions', () => {
  it('knows no site until one is granted', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    expect(await permissions.get('https://app.dusa.io')).toBeNull();
    expect(await permissions.all()).toEqual({});
  });

  it('grants one account per site and stores it', async () => {
    const { area, items } = fakeLocal();
    const permissions = new DappPermissions(area, () => 1000);
    await permissions.grant('https://app.dusa.io', A);
    await permissions.grant('https://other.example', B);
    expect(await permissions.get('https://app.dusa.io')).toEqual({ address: A, grantedAt: 1000 });
    expect(Object.keys(items[PERMISSIONS_ITEM] as object)).toEqual([
      'https://app.dusa.io',
      'https://other.example',
    ]);
  });

  it('changes the account of a connected site only', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area, () => 1000);
    await permissions.grant('https://app.dusa.io', A);
    expect(await permissions.changeAccount('https://app.dusa.io', B)).toBe(true);
    expect((await permissions.get('https://app.dusa.io'))?.address).toBe(B);
    expect(await permissions.changeAccount('https://unknown.example', B)).toBe(false);
    expect(await permissions.get('https://unknown.example')).toBeNull();
  });

  it('revokes a site', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://app.dusa.io', A);
    expect(await permissions.revoke('https://app.dusa.io')).toBe(true);
    expect(await permissions.revoke('https://app.dusa.io')).toBe(false);
    expect(await permissions.get('https://app.dusa.io')).toBeNull();
  });

  it('revokes every site of a removed account and returns them', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://one.example', A);
    await permissions.grant('https://two.example', B);
    await permissions.grant('https://three.example', A);
    expect(await permissions.revokeAddress(A)).toEqual([
      'https://one.example',
      'https://three.example',
    ]);
    expect(Object.keys(await permissions.all())).toEqual(['https://two.example']);
  });

  it('disconnects every site at once', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://one.example', A);
    await permissions.grant('https://two.example', B);
    await permissions.clear();
    expect(await permissions.all()).toEqual({});
  });

  it('ignores a damaged stored map instead of trusting it', async () => {
    for (const stored of [
      'oops',
      [],
      { 'https://ok.example': { address: A } }, // grantedAt missing
      { 'http://evil.example': { address: A, grantedAt: 1 } }, // not an allowed origin
      { 'https://ok.example/path': { address: A, grantedAt: 1 } }, // not an origin
    ]) {
      const { area } = fakeLocal({ [PERMISSIONS_ITEM]: stored });
      expect(await new DappPermissions(area).all()).toEqual({});
    }
  });
});
