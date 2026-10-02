import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApprovalView } from '../../../../extension/dapp/approval';
import { toBase64 } from '../../../../extension/dapp/protocol';
import { VaultAccount } from '../../../core/models/vault.model';
import { DAPP_APPROVALS, DappApprovals } from '../../../core/platform/dapp-approvals';
import { OperationFailedError } from '../../../core/services/massa-provider';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { ApprovePage, describeBytes } from './approve-page';

const MAIN = 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz';
const SAVINGS = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const OUTSIDER = 'AU1Aq3tvikkbBW83jKLTB2UmcfknUMvNjXNyTafNPbSmUdAsjWQ4';
const CONTRACT = 'AS12UMSUxgpRBB6ArZDJ19arHoxNkkpdfofQGekAiAJqsuE6PEFJy';

const accounts: VaultAccount[] = [
  { id: 'a', name: 'main', address: MAIN, privateKey: 'S1a' },
  { id: 'b', name: 'savings', address: SAVINGS, privateKey: 'S1b' },
];

function view(partial: Partial<ApprovalView>): ApprovalView {
  return {
    approvalId: 'ap1',
    origin: 'https://app.dusa.io',
    method: 'connect',
    params: undefined,
    address: null,
    createdAt: 0,
    queued: 0,
    ...partial,
  };
}

type FakeStore = ReturnType<typeof fakeStore>;

function fakeStore() {
  return {
    network: signal<'mainnet' | 'buildnet'>('mainnet'),
    ensureWallet: vi.fn(),
    prepareDappWallet: vi.fn(async () => undefined),
    validateDappTransfer: vi.fn(),
    validateDappRolls: vi.fn(),
    dappTransfer: vi.fn(async () => 'O1sent'),
    dappRolls: vi.fn(async () => 'O1roll'),
    dappSign: vi.fn(async () => ({ publicKey: 'P1key', signature: '1sig' })),
  };
}

async function setup(queue: ApprovalView[], configure: (store: FakeStore) => void = () => {}) {
  const approvals = {
    next: vi.fn(async () => queue.shift() ?? null),
    resolve: vi.fn(async () => true),
    reject: vi.fn(async () => true),
    keepAlive: vi.fn(() => () => undefined),
    close: vi.fn(),
  } satisfies DappApprovals;
  const store = fakeStore();
  configure(store);
  const accountsSignal = signal(accounts);
  TestBed.configureTestingModule({
    imports: [ApprovePage],
    providers: [
      { provide: DAPP_APPROVALS, useValue: approvals },
      { provide: WalletStore, useValue: store },
      {
        provide: AuthStore,
        useValue: { accounts: accountsSignal, activeAccount: computed(() => accountsSignal()[0]) },
      },
    ],
  });
  const fixture = TestBed.createComponent(ApprovePage);
  const page = fixture.componentInstance as unknown as {
    approve(): Promise<void>;
    reject(): Promise<void>;
    chosenId: ReturnType<typeof signal<string>>;
    phase(): string;
    error(): string | null;
    blocker(): string | null;
    notice(): string | null;
  };
  await settle(fixture);
  return { fixture, page, approvals, store };
}

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  fixture.detectChanges();
}

describe('ApprovePage', () => {
  it('closes the window when nothing is waiting', async () => {
    const { approvals } = await setup([]);
    expect(approvals.close).toHaveBeenCalled();
  });

  it('shows the requesting site and connects the account the user picks', async () => {
    const { fixture, page, approvals } = await setup([view({ method: 'connect' })]);
    expect(fixture.nativeElement.textContent).toContain('https://app.dusa.io');
    page.chosenId.set('b');
    await page.approve();
    expect(approvals.resolve).toHaveBeenCalledWith('ap1', { address: SAVINGS });
  });

  it("sends exactly what was asked, from the site's account, and answers with the operation", async () => {
    const { page, approvals, store } = await setup([
      view({
        method: 'transfer',
        params: { to: OUTSIDER, amount: '1234567891' },
        address: SAVINGS,
      }),
    ]);
    expect(store.prepareDappWallet).toHaveBeenCalledWith('b');
    expect(store.validateDappTransfer).toHaveBeenCalledWith('b', OUTSIDER, 1_234_567_891n);
    await page.approve();
    expect(store.dappTransfer).toHaveBeenCalledWith('b', OUTSIDER, 1_234_567_891n);
    expect(approvals.resolve).toHaveBeenCalledWith('ap1', { operationId: 'O1sent' });
  });

  it("keeps Approve off when the wallet can't do it, and never sends", async () => {
    const { fixture, page, approvals, store } = await setup(
      [view({ method: 'buyRolls', params: { rolls: '5' }, address: MAIN })],
      (store) =>
        store.validateDappRolls.mockImplementation(() => {
          throw new Error('Insufficient MAS — 0.01 MAS is needed for the network fee');
        }),
    );
    expect(store.validateDappRolls).toHaveBeenCalledWith('a', 'buy', 5n);
    expect(page.blocker()).toMatch(/Insufficient MAS/);
    const approve = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b: HTMLButtonElement) => b.textContent?.trim() === 'Approve',
    ) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    await page.approve();
    expect(store.dappRolls).not.toHaveBeenCalled();
    expect(approvals.resolve).not.toHaveBeenCalled();
  });

  it('blocks a request for an account that is no longer in the wallet', async () => {
    const { page, approvals, store } = await setup([
      view({ method: 'transfer', params: { to: OUTSIDER, amount: '1' }, address: OUTSIDER }),
    ]);
    expect(page.blocker()).toMatch(/no longer in RustCore Wallet/);
    await page.approve();
    expect(store.dappTransfer).not.toHaveBeenCalled();
    expect(approvals.resolve).not.toHaveBeenCalled();
  });

  it('blocks contract calls for now', async () => {
    const { page, approvals } = await setup([
      view({ method: 'callSC', params: { target: CONTRACT, func: 'swap' }, address: MAIN }),
    ]);
    expect(page.blocker()).toMatch(/aren't supported yet/);
    await page.approve();
    expect(approvals.resolve).not.toHaveBeenCalled();
  });

  it('keeps the request when sending fails before anything went out', async () => {
    const { page, approvals, store } = await setup([
      view({ method: 'transfer', params: { to: OUTSIDER, amount: '1' }, address: MAIN }),
    ]);
    store.dappTransfer.mockRejectedValueOnce(new Error('Insufficient balance'));
    await page.approve();
    expect(approvals.resolve).not.toHaveBeenCalled();
    expect(page.phase()).toBe('review');
    expect(page.error()).toMatch(/Insufficient balance/);
  });

  it('still gives the site the operation when it failed on-chain, and tells the user', async () => {
    const { page, approvals, store } = await setup([
      view({ method: 'sellRolls', params: { rolls: '1' }, address: MAIN }),
    ]);
    store.dappRolls.mockRejectedValueOnce(new OperationFailedError('O1fail', 'reverted'));
    await page.approve();
    expect(approvals.resolve).toHaveBeenCalledWith('ap1', { operationId: 'O1fail' });
    expect(page.phase()).toBe('notice');
    expect(page.notice()).toBeTruthy();
  });

  it('signs a message with the connected account', async () => {
    const data = toBase64(new TextEncoder().encode('Sign in to Dusa'));
    const { fixture, page, approvals, store } = await setup([
      view({ method: 'sign', params: { data }, address: MAIN }),
    ]);
    expect(fixture.nativeElement.textContent).toContain('Sign in to Dusa');
    await page.approve();
    const [walletId, signed] = store.dappSign.mock.calls[0] as unknown as [string, Uint8Array];
    expect(walletId).toBe('a');
    // (compared as bytes: jsdom's and Node's Uint8Array are different classes)
    expect(Array.from(signed)).toEqual(Array.from(new TextEncoder().encode('Sign in to Dusa')));
    expect(approvals.resolve).toHaveBeenCalledWith('ap1', {
      publicKey: 'P1key',
      signature: '1sig',
    });
  });

  it('rejects, then moves on to the next request', async () => {
    const { page, approvals } = await setup([
      view({ method: 'connect' }),
      view({ approvalId: 'ap2', method: 'connect' }),
    ]);
    await page.reject();
    expect(approvals.reject).toHaveBeenCalledWith('ap1');
    expect(approvals.next).toHaveBeenCalledTimes(2);
    expect(approvals.close).not.toHaveBeenCalled();
  });
});

describe('describeBytes', () => {
  it('shows readable text as text, anything else as hex', () => {
    expect(describeBytes(new TextEncoder().encode('Hello\nworld'))).toEqual({
      text: 'Hello\nworld',
      hex: false,
    });
    expect(describeBytes(Uint8Array.from([0, 1, 255]))).toEqual({ text: '0x0001ff', hex: true });
    expect(describeBytes(Uint8Array.from([0xc3, 0x28]))).toEqual({ text: '0xc328', hex: true });
  });
});
