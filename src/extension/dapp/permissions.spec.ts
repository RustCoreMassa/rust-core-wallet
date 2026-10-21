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

  it('grants a site its accounts, the first in use, and stores them', async () => {
    const { area, items } = fakeLocal();
    const permissions = new DappPermissions(area, () => 1000);
    await permissions.grant('https://app.dusa.io', [B, A, B]);
    await permissions.grant('https://other.example', [B]);
    expect(await permissions.get('https://app.dusa.io')).toEqual({
      addresses: [B, A],
      followsWallet: false,
      grantedAt: 1000,
    });
    expect(Object.keys(items[PERMISSIONS_ITEM] as object)).toEqual([
      'https://app.dusa.io',
      'https://other.example',
    ]);
    await expect(permissions.grant('https://empty.example', [])).rejects.toThrow();
  });

  it('adds an account to a connected site only — in use, or after the others', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area, () => 1000);
    await permissions.grant('https://app.dusa.io', [A]);
    expect(await permissions.addAccount('https://app.dusa.io', B, false)).toBe(true);
    expect((await permissions.get('https://app.dusa.io'))?.addresses).toEqual([A, B]);
    expect(await permissions.addAccount('https://app.dusa.io', B, true)).toBe(true);
    expect((await permissions.get('https://app.dusa.io'))?.addresses).toEqual([B, A]);
    expect(await permissions.addAccount('https://unknown.example', B, true)).toBe(false);
    expect(await permissions.get('https://unknown.example')).toBeNull();
  });

  it('takes an account away from a site, and disconnects it with its last one', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://app.dusa.io', [A, B]);
    expect(await permissions.removeAccount('https://app.dusa.io', A)).toBe(true);
    expect((await permissions.get('https://app.dusa.io'))?.addresses).toEqual([B]);
    expect(await permissions.removeAccount('https://app.dusa.io', A)).toBe(false);
    expect(await permissions.removeAccount('https://app.dusa.io', B)).toBe(true);
    expect(await permissions.get('https://app.dusa.io')).toBeNull();
  });

  it('puts the wallet switched to in use on every site that may see it and follows it', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://one.example', [A, B]);
    await permissions.grant('https://two.example', [A]);
    await permissions.grant('https://three.example', [B, A]);
    await permissions.grant('https://older.example', [A, B]); // never asked for `accounts`
    for (const origin of ['https://one.example', 'https://two.example', 'https://three.example']) {
      await permissions.followWallet(origin);
    }
    expect(await permissions.useAccount(B)).toEqual(['https://one.example']);
    const map = await permissions.all();
    expect(map['https://one.example'].addresses).toEqual([B, A]);
    expect(map['https://two.example'].addresses).toEqual([A]);
    expect(map['https://three.example'].addresses).toEqual([B, A]);
    expect(map['https://older.example'].addresses).toEqual([A, B]);
    expect(await permissions.useAccount(B)).toEqual([]);
  });

  it('marks a connected site as following the wallet, once and for good', async () => {
    const { area, items } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://app.dusa.io', [A]);
    expect((await permissions.get('https://app.dusa.io'))?.followsWallet).toBe(false);
    expect(await permissions.followWallet('https://app.dusa.io')).toBe(true);
    const stored = items[PERMISSIONS_ITEM];
    expect(await permissions.followWallet('https://app.dusa.io')).toBe(true);
    expect(items[PERMISSIONS_ITEM]).toBe(stored); // nothing written again
    expect((await permissions.get('https://app.dusa.io'))?.followsWallet).toBe(true);
    await permissions.addAccount('https://app.dusa.io', B, false);
    expect((await permissions.get('https://app.dusa.io'))?.followsWallet).toBe(true);
    expect(await permissions.followWallet('https://unknown.example')).toBe(false);
    expect(await permissions.get('https://unknown.example')).toBeNull();
  });

  it('runs changes made at once one after the other, so none is lost', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://one.example', [A]);
    await permissions.grant('https://two.example', [A]);
    await Promise.all([
      permissions.followWallet('https://one.example'),
      permissions.followWallet('https://two.example'),
      permissions.addAccount('https://one.example', B, false),
    ]);
    const map = await permissions.all();
    expect(map['https://one.example']).toMatchObject({ addresses: [A, B], followsWallet: true });
    expect(map['https://two.example'].followsWallet).toBe(true);
  });

  it('revokes a site', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://app.dusa.io', [A]);
    expect(await permissions.revoke('https://app.dusa.io')).toBe(true);
    expect(await permissions.revoke('https://app.dusa.io')).toBe(false);
    expect(await permissions.get('https://app.dusa.io')).toBeNull();
  });

  it('takes a removed account away from every site, disconnecting those left with none', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://one.example', [A]);
    await permissions.grant('https://two.example', [B]);
    await permissions.grant('https://three.example', [A, B]);
    expect(await permissions.removeAddress(A)).toEqual(['https://one.example']);
    const map = await permissions.all();
    expect(Object.keys(map)).toEqual(['https://two.example', 'https://three.example']);
    expect(map['https://three.example'].addresses).toEqual([B]);
  });

  it('reads sites saved with one account (before several per site) as that account', async () => {
    const { area } = fakeLocal({
      [PERMISSIONS_ITEM]: { 'https://app.dusa.io': { address: A, grantedAt: 7 } },
    });
    const permissions = new DappPermissions(area);
    expect(await permissions.get('https://app.dusa.io')).toEqual({
      addresses: [A],
      followsWallet: false,
      grantedAt: 7,
    });
    await permissions.addAccount('https://app.dusa.io', B, false);
    expect(await permissions.get('https://app.dusa.io')).toEqual({
      addresses: [A, B],
      followsWallet: false,
      grantedAt: 7,
    });
    // a switch leaves it on the account its dApp shows
    expect(await permissions.useAccount(B)).toEqual([]);
  });

  it('disconnects every site at once', async () => {
    const { area } = fakeLocal();
    const permissions = new DappPermissions(area);
    await permissions.grant('https://one.example', [A]);
    await permissions.grant('https://two.example', [B]);
    await permissions.clear();
    expect(await permissions.all()).toEqual({});
  });

  it('ignores a damaged stored map instead of trusting it', async () => {
    for (const stored of [
      'oops',
      [],
      { 'https://ok.example': { address: A } }, // grantedAt missing
      { 'https://ok.example': { addresses: [], grantedAt: 1 } }, // no account
      { 'https://ok.example': { addresses: [A, 3], grantedAt: 1 } }, // not an address
      { 'http://evil.example': { address: A, grantedAt: 1 } }, // not an allowed origin
      { 'https://ok.example/path': { address: A, grantedAt: 1 } }, // not an origin
    ]) {
      const { area } = fakeLocal({ [PERMISSIONS_ITEM]: stored });
      expect(await new DappPermissions(area).all()).toEqual({});
    }
  });
});
