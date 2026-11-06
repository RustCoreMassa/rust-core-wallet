import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CameraDeniedError, QR_SCANNER } from '../../../core/platform/qr-scanner';
import { WalletStore } from '../../../core/state/wallet-store';
import { SendModal } from './send-modal';

interface Page {
  address(): string;
  error(): string | null;
  scanAddress(): Promise<void>;
}

const ADDRESS = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';

describe('SendModal — Scan (the apps)', () => {
  /** The modal's own logic only: nothing is rendered, so the store needs no balances. */
  function open(scan: () => Promise<string | null>): Page {
    TestBed.configureTestingModule({
      imports: [SendModal],
      providers: [
        { provide: WalletStore, useValue: { addressBook: signal([]) } },
        { provide: QR_SCANNER, useValue: { scan } },
      ],
    });
    return TestBed.createComponent(SendModal).componentInstance as unknown as Page;
  }

  it('fills the recipient from an address QR code or a massa: link', async () => {
    const page = open(async () => `massa:${ADDRESS}?amount=2`);
    await page.scanAddress();
    expect(page.address()).toBe(ADDRESS);
    expect(page.error()).toBeNull();
  });

  it('refuses a QR code that holds something else, leaving the field as it was', async () => {
    const page = open(async () => 'https://example.com/claim');
    await page.scanAddress();
    expect(page.address()).toBe('');
    expect(page.error()).toMatch(/doesn't hold a Massa address/);
  });

  it('does nothing when the camera is closed', async () => {
    const page = open(async () => null);
    await page.scanAddress();
    expect(page.address()).toBe('');
    expect(page.error()).toBeNull();
  });

  it('says how to allow the camera when access is off', async () => {
    const page = open(async () => {
      throw new CameraDeniedError();
    });
    await page.scanAddress();
    expect(page.error()).toMatch(/Allow camera access/);
  });
});
