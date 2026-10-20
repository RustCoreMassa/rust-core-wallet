import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VaultAccount } from '../../../core/models/vault.model';
import { CONNECTED_SITES, ConnectedSite } from '../../../core/platform/connected-sites';
import { SITE_ACCESS } from '../../../core/platform/site-access';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { ConnectedSitesModal } from './connected-sites-modal';

const MAIN = 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz';
const GONE = 'AU1Aq3tvikkbBW83jKLTB2UmcfknUMvNjXNyTafNPbSmUdAsjWQ4';

const SAVINGS = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';

const accounts: VaultAccount[] = [
  { id: 'a', name: 'main', address: MAIN, privateKey: 'S1a' },
  { id: 'b', name: 'savings', address: SAVINGS, privateKey: 'S1b' },
];

function setup(sites: ConnectedSite[], accessGranted: boolean | null = true) {
  const siteAccess = { granted: signal(accessGranted), request: vi.fn(async () => true) };
  const service = {
    sites: signal(sites),
    addAccount: vi.fn(async () => undefined),
    removeAccount: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    forgetAccount: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    imports: [ConnectedSitesModal],
    providers: [
      { provide: CONNECTED_SITES, useValue: service },
      { provide: AuthStore, useValue: { accounts: signal(accounts) } },
      {
        provide: WalletStore,
        useValue: {
          activeWalletId: signal('b'),
          wallets: signal({ a: { address: MAIN }, b: { address: SAVINGS } }),
        },
      },
      { provide: SITE_ACCESS, useValue: siteAccess },
    ],
  });
  const fixture = TestBed.createComponent(ConnectedSitesModal);
  fixture.detectChanges();
  return {
    fixture,
    service,
    siteAccess,
    text: () => fixture.nativeElement.textContent as string,
  };
}

describe('ConnectedSitesModal', () => {
  it('says when no site is connected', () => {
    const { text } = setup([]);
    expect(text()).toContain('No site is connected');
  });

  it('lists each site and disconnects the one asked', async () => {
    const { fixture, service, text } = setup([
      { origin: 'https://app.dusa.io', addresses: [MAIN], grantedAt: 0 },
      { origin: 'https://other.example', addresses: [MAIN], grantedAt: 1 },
    ]);
    expect(text()).toContain('https://app.dusa.io');
    expect(text()).toContain('https://other.example');
    const buttons = [...fixture.nativeElement.querySelectorAll('button')].filter(
      (b: HTMLButtonElement) => b.textContent?.trim() === 'Disconnect',
    ) as HTMLButtonElement[];
    buttons[1].click();
    await fixture.whenStable();
    expect(service.disconnect).toHaveBeenCalledWith('https://other.example');
  });

  it('lists the accounts each site sees, the one in use first, and adds or takes one away', async () => {
    const { fixture, service, text } = setup([
      { origin: 'https://app.dusa.io', addresses: [MAIN, SAVINGS], grantedAt: 0 },
      { origin: 'https://other.example', addresses: [MAIN], grantedAt: 1 },
    ]);
    expect(text()).toContain('In use');
    const buttons = () =>
      [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    // A single account can't be taken away (Disconnect does that): one ✕ per account of the first site.
    const removes = buttons().filter(
      (b) => b.textContent?.trim() === '✕' && b.closest('.site-account'),
    );
    expect(removes).toHaveLength(2);
    removes[1].click();
    await fixture.whenStable();
    expect(service.removeAccount).toHaveBeenCalledWith('https://app.dusa.io', SAVINGS);

    // The active wallet (savings), once added, is the one the site uses.
    buttons()
      .find((b) => b.textContent?.trim() === '+ savings')!
      .click();
    await fixture.whenStable();
    expect(service.addAccount).toHaveBeenCalledWith('https://other.example', SAVINGS, true);
  });

  it('flags a site still pointing at an account no longer in the wallet', () => {
    const { text } = setup([{ origin: 'https://app.dusa.io', addresses: [GONE], grantedAt: 0 }]);
    expect(text()).toContain('No longer in RustCore Wallet');
  });

  it('explains when the browser blocks the extension on websites, and asks for access', () => {
    const { fixture, siteAccess, text } = setup([], false);
    expect(text()).toContain("Sites can't connect right now");
    const allow = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b: HTMLButtonElement) => b.textContent?.trim() === 'Allow access to websites',
    ) as HTMLButtonElement;
    allow.click();
    expect(siteAccess.request).toHaveBeenCalledTimes(1);
  });

  it('says nothing about access while it is granted or unknown', () => {
    expect(setup([], true).text()).not.toContain("Sites can't connect");
    TestBed.resetTestingModule();
    expect(setup([], null).text()).not.toContain("Sites can't connect");
  });
});
