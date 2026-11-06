import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SWAP_AVAILABLE } from '../../../core/platform/app-platform';
import { SiteConnection } from '../../../core/state/site-connection';
import { WalletStore } from '../../../core/state/wallet-store';
import { HomePage } from './home-page';

describe('HomePage — actions', () => {
  function actionLabels(swapAvailable?: boolean): string[] {
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        {
          provide: WalletStore,
          useValue: {
            activeWallet: signal({ name: 'main', loaded: false, balances: {} }),
            portfolioValueUsd: signal(0),
            prices: signal({}),
            availableTokens: signal([]),
            network: signal('mainnet'),
            hasMoreHistory: signal(false),
          },
        },
        { provide: SiteConnection, useValue: { notice: signal(null), dismiss: () => {} } },
        ...(swapAvailable === undefined
          ? []
          : [{ provide: SWAP_AVAILABLE, useValue: swapAvailable }]),
      ],
    });
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return [...element.querySelectorAll('.action-label')].map((e) => e.textContent?.trim() ?? '');
  }

  it('offers Swap in the web app and the extension (the default)', () => {
    expect(actionLabels()).toEqual(['Receive', 'Send', 'Swap']);
  });

  it('has no Swap in the iOS / Android apps', () => {
    expect(actionLabels(false)).toEqual(['Receive', 'Send']);
  });
});
