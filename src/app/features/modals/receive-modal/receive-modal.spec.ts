import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SHARE_SHEET } from '../../../core/platform/share-sheet';
import { WalletStore } from '../../../core/state/wallet-store';
import { ReceiveModal } from './receive-modal';

const ADDRESS = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';

describe('ReceiveModal — Share (the apps)', () => {
  /** Logic only (no render: the QR code needs a canvas). */
  function open(shareSheet: { share(text: string): Promise<void> } | null) {
    TestBed.configureTestingModule({
      imports: [ReceiveModal],
      providers: [
        { provide: WalletStore, useValue: { activeWallet: signal({ address: ADDRESS }) } },
        { provide: SHARE_SHEET, useValue: shareSheet },
      ],
    });
    return TestBed.createComponent(ReceiveModal).componentInstance as unknown as {
      shareSheet: unknown;
      shareAddress(): void;
    };
  }

  it("shares the active wallet's address through the phone's share menu", () => {
    const share = vi.fn(async () => undefined);
    open({ share }).shareAddress();
    expect(share).toHaveBeenCalledWith(ADDRESS);
  });

  it('offers no Share in the web app and the extension', () => {
    expect(open(null).shareSheet).toBeNull();
  });
});
