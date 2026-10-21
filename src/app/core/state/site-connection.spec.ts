import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONNECTED_SITES, ConnectedSite } from '../platform/connected-sites';
import { SiteConnection } from './site-connection';
import { WalletStore } from './wallet-store';

const A = 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz';
const B = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const DUSA = 'https://app.dusa.io';

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

function setup(sites: ConnectedSite[], tabOrigin: string | null = DUSA, web = false) {
  let onTabChange: () => void = () => {};
  const tab = { origin: tabOrigin };
  const service = {
    sites: signal(sites),
    useAccount: vi.fn(async () => undefined),
    addAccount: vi.fn(async () => undefined),
    activeTabOrigin: vi.fn(async () => tab.origin),
    watchActiveTab: vi.fn((cb: () => void) => {
      onTabChange = cb;
      return () => (onTabChange = () => {});
    }),
  };
  const activeWalletId = signal('a');
  TestBed.configureTestingModule({
    providers: [
      { provide: CONNECTED_SITES, useValue: web ? null : service },
      {
        provide: WalletStore,
        useValue: {
          activeWalletId,
          wallets: signal({ a: { address: A, name: 'main' }, b: { address: B, name: 'savings' } }),
        },
      },
    ],
  });
  const connection = TestBed.inject(SiteConnection);
  TestBed.runInInjectionContext(() => connection.start());
  return {
    connection,
    service,
    activeWalletId,
    tab,
    changeTab: () => onTabChange(),
  };
}

describe('SiteConnection', () => {
  it('puts the wallet you switch to in use on the sites — not the one it opens with', async () => {
    const { service, activeWalletId } = setup([]);
    await settle();
    expect(service.useAccount).not.toHaveBeenCalled();
    activeWalletId.set('b');
    await settle();
    expect(service.useAccount).toHaveBeenCalledExactlyOnceWith(B);
    activeWalletId.set('a');
    await settle();
    expect(service.useAccount).toHaveBeenLastCalledWith(A);
  });

  it("says when the active tab's site is connected, but not to the active wallet", async () => {
    const { connection, activeWalletId } = setup([
      { origin: DUSA, addresses: [B], followsWallet: true, grantedAt: 0 },
    ]);
    await settle();
    expect(connection.notice()).toEqual({
      kind: 'not-connected',
      origin: DUSA,
      host: 'app.dusa.io',
      address: A,
      name: 'main',
      inUseName: 'savings',
    });
    activeWalletId.set('b');
    await settle();
    expect(connection.notice()).toBeNull();
  });

  it('says nothing for a site that is not connected, or no site', async () => {
    expect(setup([]).connection.notice()).toBeNull();
    TestBed.resetTestingModule();
    const { connection } = setup(
      [{ origin: DUSA, addresses: [B], followsWallet: true, grantedAt: 0 }],
      null,
    );
    await settle();
    expect(connection.notice()).toBeNull();
  });

  it('connects the active wallet to the site and makes it the one in use', async () => {
    const { connection, service } = setup([
      { origin: DUSA, addresses: [B], followsWallet: true, grantedAt: 0 },
    ]);
    await settle();
    await connection.connectActive();
    expect(service.addAccount).toHaveBeenCalledWith(DUSA, A, true);
  });

  it('stays hidden once closed, for that site and wallet', async () => {
    const { connection } = setup([
      { origin: DUSA, addresses: [B], followsWallet: true, grantedAt: 0 },
    ]);
    await settle();
    connection.dismiss();
    expect(connection.notice()).toBeNull();
  });

  it('reads the site again when the active tab changes', async () => {
    const { connection, tab, changeTab } = setup([
      { origin: DUSA, addresses: [B], followsWallet: true, grantedAt: 0 },
    ]);
    await settle();
    expect(connection.notice()).not.toBeNull();
    tab.origin = 'https://elsewhere.example';
    changeTab();
    await settle();
    expect(connection.notice()).toBeNull();
  });

  it('says when an older dApp, which keeps its account, uses another one than the active wallet', async () => {
    const { connection, activeWalletId } = setup([
      { origin: DUSA, addresses: [B, A], followsWallet: false, grantedAt: 0 },
    ]);
    await settle();
    expect(connection.notice()).toMatchObject({
      kind: 'not-in-use',
      address: A,
      inUseName: 'savings',
    });
    activeWalletId.set('b');
    await settle();
    expect(connection.notice()).toBeNull();
  });

  it('says nothing when a site that follows the wallet may see the active one', async () => {
    const { connection } = setup([
      { origin: DUSA, addresses: [B, A], followsWallet: true, grantedAt: 0 },
    ]);
    await settle();
    expect(connection.notice()).toBeNull();
  });

  it('makes the active wallet the one an older dApp uses', async () => {
    const { connection, service } = setup([
      { origin: DUSA, addresses: [B, A], followsWallet: false, grantedAt: 0 },
    ]);
    await settle();
    await connection.connectActive();
    expect(service.addAccount).toHaveBeenCalledWith(DUSA, A, true);
  });

  it('does nothing in the web app', async () => {
    const { connection } = setup([], DUSA, true);
    await settle();
    expect(connection.notice()).toBeNull();
    await expect(connection.connectActive()).resolves.toBeUndefined();
  });
});
