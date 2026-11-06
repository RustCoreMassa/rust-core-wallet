import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BIOMETRIC_UNLOCK, BiometryChangedError } from '../../../core/platform/biometric-unlock';
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

describe('PinLockPage (apps) — biometric unlock', () => {
  interface BioPage extends Page {
    biometryLabel(): string | null;
    unlockWithBiometrics(): Promise<void>;
  }

  function setupBiometric(
    readSecret: () => Promise<string | null>,
    { enabled = true, unlocks = true } = {},
  ) {
    const auth = {
      hasVault: signal(true),
      unlock: vi.fn(async () => unlocks),
    };
    const biometric = {
      enabled: signal(enabled),
      available: vi.fn(async () => 'face' as const),
      enable: vi.fn(),
      readSecret: vi.fn(readSecret),
      disable: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      imports: [PinLockPage],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: UNLOCK_SECRET, useValue: 'pin' },
        { provide: AuthStore, useValue: auth },
        { provide: BIOMETRIC_UNLOCK, useValue: biometric },
        { provide: WalletStore, useValue: { restoreCache: vi.fn(async () => undefined) } },
        { provide: WalletDataEraser, useValue: { erase: vi.fn() } },
        { provide: MASSA_PROVIDER, useValue: {} },
      ],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const fixture = TestBed.createComponent(PinLockPage);
    fixture.detectChanges();
    return { page: fixture.componentInstance as unknown as BioPage, auth, biometric, navigate };
  }

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('asks for Face ID as the page opens and unlocks with the kept PIN', async () => {
    const { page, auth, navigate } = setupBiometric(async () => '123456');
    await settle();
    expect(auth.unlock).toHaveBeenCalledWith('123456', { keepSession: true });
    expect(navigate).toHaveBeenCalledWith('/home');
    expect(page.biometryLabel()).toBe('Face ID');
  });

  it('cancelled: nothing happens, the PIN pad and the Face ID button stay', async () => {
    const { page, auth } = setupBiometric(async () => null);
    await settle();
    expect(auth.unlock).not.toHaveBeenCalled();
    expect(page.error()).toBeNull();
    expect(page.biometryLabel()).toBe('Face ID');
  });

  it('Face ID changed on the phone: says so and stops offering it', async () => {
    const { page, auth } = setupBiometric(async () => {
      throw new BiometryChangedError();
    });
    await settle();
    expect(auth.unlock).not.toHaveBeenCalled();
    expect(page.error()).toMatch(/Face ID changed on this phone/);
    expect(page.biometryLabel()).toBeNull();
  });

  it('a kept PIN that no longer opens the vault turns Face ID off', async () => {
    const { page, biometric, navigate } = setupBiometric(async () => '111111', {
      unlocks: false,
    });
    await settle();
    expect(biometric.disable).toHaveBeenCalled();
    expect(page.error()).toMatch(/Face ID was turned off/);
    expect(page.biometryLabel()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('turned off: never asks', async () => {
    const { page, biometric } = setupBiometric(async () => '123456', { enabled: false });
    await settle();
    expect(biometric.readSecret).not.toHaveBeenCalled();
    expect(page.biometryLabel()).toBeNull();
  });
});
