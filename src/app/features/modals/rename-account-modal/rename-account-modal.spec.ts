import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VaultAccount } from '../../../core/models/vault.model';
import { Modal } from '../../../core/services/modal';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { RenameAccountModal } from './rename-account-modal';

const account: VaultAccount = {
  id: 'a',
  name: 'main',
  address: 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz',
  privateKey: 'S1secretkey',
};

interface Page {
  step(): string;
  error(): string | null;
  copyPrivateKey(): void;
  confirmKeySecret(secret: string): Promise<void>;
  cancelKey(): void;
  startRemove(): void;
}

describe('RenameAccountModal — the private key', () => {
  let writeText: ReturnType<typeof vi.fn>;
  let verifySecret: ReturnType<typeof vi.fn>;

  function open(): Page {
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    verifySecret = vi.fn(async (secret: string) => secret === '123456');
    TestBed.configureTestingModule({
      imports: [RenameAccountModal],
      providers: [
        {
          provide: AuthStore,
          useValue: { accounts: signal([account, { ...account, id: 'b' }]), verifySecret },
        },
        { provide: WalletStore, useValue: {} },
      ],
    });
    TestBed.inject(Modal).open('rename-account', account);
    const fixture = TestBed.createComponent(RenameAccountModal);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as Page;
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('never copies it without the PIN/password', async () => {
    const page = open();
    page.copyPrivateKey();
    await flush();
    expect(writeText).not.toHaveBeenCalled();
    expect(page.step()).toBe('key-confirm');

    await page.confirmKeySecret('000000');
    await flush();
    expect(page.error()).toMatch(/Incorrect/);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies it once the secret is confirmed, then goes back where it was', async () => {
    const page = open();
    page.startRemove(); // from the "remove this wallet" warning, too
    page.copyPrivateKey();
    await page.confirmKeySecret('123456');
    await flush();
    expect(verifySecret).toHaveBeenCalledWith('123456');
    expect(writeText).toHaveBeenCalledWith('S1secretkey');
    expect(page.step()).toBe('remove-warn');

    // Confirmed in this modal: the next copy needs no second entry.
    page.copyPrivateKey();
    await flush();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(verifySecret).toHaveBeenCalledTimes(1);
  });

  it('cancels back to the step it came from', () => {
    const page = open();
    page.copyPrivateKey();
    page.cancelKey();
    expect(page.step()).toBe('edit');
  });
});
