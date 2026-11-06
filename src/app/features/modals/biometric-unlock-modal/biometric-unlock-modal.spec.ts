import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BIOMETRIC_UNLOCK, BiometryFailedError } from '../../../core/platform/biometric-unlock';
import { UNLOCK_SECRET } from '../../../core/platform/unlock-secret';
import { Modal } from '../../../core/services/modal';
import { AuthStore } from '../../../core/state/auth-store';
import { BiometricUnlockModal } from './biometric-unlock-modal';

interface Page {
  error(): string | null;
  confirmSecret(secret: string): Promise<void>;
}

describe('BiometricUnlockModal', () => {
  function open(enable: (secret: string) => Promise<void> = async () => {}) {
    const biometric = {
      enabled: signal(false),
      available: async () => 'face' as const,
      enable: vi.fn(enable),
      readSecret: vi.fn(),
      disable: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [BiometricUnlockModal],
      providers: [
        { provide: UNLOCK_SECRET, useValue: 'pin' },
        {
          provide: AuthStore,
          useValue: { verifySecret: vi.fn(async (s: string) => s === '123456') },
        },
        { provide: BIOMETRIC_UNLOCK, useValue: biometric },
      ],
    });
    const modal = TestBed.inject(Modal);
    modal.open('biometric-unlock', 'Face ID');
    const fixture = TestBed.createComponent(BiometricUnlockModal);
    fixture.detectChanges();
    return { page: fixture.componentInstance as unknown as Page, biometric, modal };
  }

  it('never keeps a wrong PIN', async () => {
    const { page, biometric, modal } = open();
    await page.confirmSecret('000000');
    expect(biometric.enable).not.toHaveBeenCalled();
    expect(page.error()).toMatch(/Incorrect PIN/);
    expect(modal.active()).toBe('biometric-unlock');
  });

  it('keeps the confirmed PIN behind Face ID, then closes', async () => {
    const { page, biometric, modal } = open();
    await page.confirmSecret('123456');
    expect(biometric.enable).toHaveBeenCalledWith('123456');
    expect(modal.active()).toBeNull();
  });

  it('stays open, and off, when Face ID is not confirmed', async () => {
    const { page, modal } = open(async () => {
      throw new BiometryFailedError();
    });
    await page.confirmSecret('123456');
    expect(page.error()).toMatch(/Face ID wasn't confirmed/);
    expect(modal.active()).toBe('biometric-unlock');
  });
});
