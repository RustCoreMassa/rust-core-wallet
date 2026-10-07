import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VaultAccount } from '../../../core/models/vault.model';
import { CONNECTED_SITES, ConnectedSite } from '../../../core/platform/connected-sites';
import { SITE_ACCESS } from '../../../core/platform/site-access';
import { AuthStore } from '../../../core/state/auth-store';
import { ConnectedSitesModal } from './connected-sites-modal';

const MAIN = 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz';
const GONE = 'AU1Aq3tvikkbBW83jKLTB2UmcfknUMvNjXNyTafNPbSmUdAsjWQ4';

const accounts: VaultAccount[] = [{ id: 'a', name: 'main', address: MAIN, privateKey: 'S1a' }];

function setup(sites: ConnectedSite[], accessGranted: boolean | null = true) {
  const siteAccess = { granted: signal(accessGranted), request: vi.fn(async () => true) };
  const service = {
    sites: signal(sites),
    changeAccount: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    forgetAccount: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    imports: [ConnectedSitesModal],
    providers: [
      { provide: CONNECTED_SITES, useValue: service },
      { provide: AuthStore, useValue: { accounts: signal(accounts) } },
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
      { origin: 'https://app.dusa.io', address: MAIN, grantedAt: 0 },
      { origin: 'https://other.example', address: MAIN, grantedAt: 1 },
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

  it('flags a site still pointing at an account no longer in the wallet', () => {
    const { text } = setup([{ origin: 'https://app.dusa.io', address: GONE, grantedAt: 0 }]);
    expect(text()).toContain('no longer in RustCore Wallet');
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
