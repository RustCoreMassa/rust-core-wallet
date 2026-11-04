import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UNLOCK_SECRET } from '../../../core/platform/unlock-secret';
import { MASSA_PROVIDER } from '../../../core/services/massa-provider';
import { AuthStore, VaultExistsError } from '../../../core/state/auth-store';
import { WalletDataEraser } from '../../../core/state/wallet-data-eraser';
import { WalletStore } from '../../../core/state/wallet-store';
import { PinLockPage } from './pin-lock-page';

interface Page {
  step(): string;
  error(): string | null;
  onSecret(secret: string): Promise<void>;
  submitImportedKey(): Promise<void>;
  importKeyValue: { set(v: string): void };
  importNameValue: { set(v: string): void };
}

function setup(hasVault: boolean, register = vi.fn(async () => undefined)) {
  const auth = {
    hasVault: signal(hasVault),
    unlock: vi.fn(async () => true),
    register,
    isNameTaken: vi.fn(() => false),
    suggestWalletName: vi.fn(() => 'wallet_1'),
  };
  TestBed.configureTestingModule({
    imports: [PinLockPage],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: UNLOCK_SECRET, useValue: 'password' },
      { provide: AuthStore, useValue: auth },
      { provide: WalletStore, useValue: { restoreCache: vi.fn(async () => undefined) } },
      { provide: WalletDataEraser, useValue: { erase: vi.fn() } },
      {
        provide: MASSA_PROVIDER,
        useValue: { resolveAddress: vi.fn(async () => 'AU1someaddress') },
      },
    ],
  });
  const fixture = TestBed.createComponent(PinLockPage);
  fixture.detectChanges();
  return { page: fixture.componentInstance as unknown as Page, auth };
}

describe('PinLockPage (extension)', () => {
  it('opens a PIN vault for this page only, so reopening the popup cannot skip the password step', async () => {
    const { page, auth } = setup(true);
    await page.onSecret('123456');
    expect(auth.unlock).toHaveBeenCalledWith('123456', { keepSession: false });
    expect(page.step()).toBe('upgrade');
  });

  it('keeps the session when unlocked with a password', async () => {
    const { page, auth } = setup(true);
    await page.onSecret('correct horse battery');
    expect(auth.unlock).toHaveBeenCalledWith('correct horse battery', { keepSession: true });
  });

  it('switches to unlocking when another window set up a wallet meanwhile', async () => {
    const register = vi.fn(async () => {
      throw new VaultExistsError();
    });
    const { page } = setup(false, register);
    page.importKeyValue.set('S1key');
    page.importNameValue.set('main');
    await page.submitImportedKey();
    expect(register).toHaveBeenCalled();
    expect(page.step()).toBe('unlock');
    expect(page.error()).toMatch(/already set up/);
  });
});
