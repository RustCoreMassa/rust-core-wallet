import { TestBed } from '@angular/core/testing';
import { BIOMETRIC_UNLOCK } from '../platform/biometric-unlock';
import { CONNECTED_SITES, ConnectedSites } from '../platform/connected-sites';
import { NetworkStore } from './network-store';
import { NftStore } from './nft-store';
import { WalletDataEraser } from './wallet-data-eraser';
import { WalletStore } from './wallet-store';

describe('WalletDataEraser', () => {
  let walletStore: { reset: ReturnType<typeof vi.fn> };
  let networkStore: { reset: ReturnType<typeof vi.fn> };
  let nftStore: { reset: ReturnType<typeof vi.fn> };

  function setUp(
    connectedSites: Partial<ConnectedSites> | null,
    biometricUnlock: { disable(): Promise<void> } | null = null,
  ): WalletDataEraser {
    walletStore = { reset: vi.fn() };
    networkStore = { reset: vi.fn() };
    nftStore = { reset: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WalletStore, useValue: walletStore },
        { provide: NetworkStore, useValue: networkStore },
        { provide: NftStore, useValue: nftStore },
        { provide: CONNECTED_SITES, useValue: connectedSites },
        { provide: BIOMETRIC_UNLOCK, useValue: biometricUnlock },
      ],
    });
    return TestBed.inject(WalletDataEraser);
  }

  it('clears the wallets, their NFTs, the network choice and the connected sites', async () => {
    const sites = { clear: vi.fn(async () => {}) };
    await setUp(sites).erase();
    expect(walletStore.reset).toHaveBeenCalledOnce();
    expect(nftStore.reset).toHaveBeenCalledOnce();
    expect(networkStore.reset).toHaveBeenCalledOnce();
    expect(sites.clear).toHaveBeenCalledOnce();
  });

  it('turns Face ID unlock off, deleting the PIN kept for it (the apps)', async () => {
    const biometric = { disable: vi.fn(async () => {}) };
    await setUp(null, biometric).erase();
    expect(biometric.disable).toHaveBeenCalledOnce();
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
