import { TestBed } from '@angular/core/testing';
import { CONNECTED_SITES, ConnectedSites } from '../platform/connected-sites';
import { NetworkStore } from './network-store';
import { WalletDataEraser } from './wallet-data-eraser';
import { WalletStore } from './wallet-store';

describe('WalletDataEraser', () => {
  let walletStore: { reset: ReturnType<typeof vi.fn> };
  let networkStore: { reset: ReturnType<typeof vi.fn> };

  function setUp(connectedSites: Partial<ConnectedSites> | null): WalletDataEraser {
    walletStore = { reset: vi.fn() };
    networkStore = { reset: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WalletStore, useValue: walletStore },
        { provide: NetworkStore, useValue: networkStore },
        { provide: CONNECTED_SITES, useValue: connectedSites },
      ],
    });
    return TestBed.inject(WalletDataEraser);
  }

  it('clears the wallets, the network choice and the connected sites', async () => {
    const sites = { clear: vi.fn(async () => {}) };
    await setUp(sites).erase();
    expect(walletStore.reset).toHaveBeenCalledOnce();
    expect(networkStore.reset).toHaveBeenCalledOnce();
    expect(sites.clear).toHaveBeenCalledOnce();
  });

  it('works without connected sites (the web app)', async () => {
    await setUp(null).erase();
    expect(walletStore.reset).toHaveBeenCalledOnce();
    expect(networkStore.reset).toHaveBeenCalledOnce();
  });

  it('still resolves when disconnecting the sites fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sites = { clear: vi.fn(async () => Promise.reject(new Error('storage'))) };
    await expect(setUp(sites).erase()).resolves.toBeUndefined();
    expect(walletStore.reset).toHaveBeenCalledOnce();
  });
});
