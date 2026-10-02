import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TOKEN_REGISTRY } from '../models/token.model';
import { VaultAccount } from '../models/vault.model';
import { DusaPrices } from '../services/dusa-prices';
import { DusaSwap } from '../services/dusa-swap';
import { ExplorerApi } from '../services/explorer-api';
import { MASSA_PROVIDER, MassaProvider, OperationFailedError } from '../services/massa-provider';
import { WalletCache } from '../services/wallet-cache';
import { AuthStore } from './auth-store';
import { WalletStore } from './wallet-store';

const A = 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz';
const B = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const OUTSIDER = 'AU1Aq3tvikkbBW83jKLTB2UmcfknUMvNjXNyTafNPbSmUdAsjWQ4';
const DAI = TOKEN_REGISTRY['DAI.e'].contract;

const accounts: VaultAccount[] = [
  { id: 'a', name: 'main', address: A, privateKey: 'S1a' },
  { id: 'b', name: 'savings', address: B, privateKey: 'S1b' },
];

/** Chain state the fake provider serves: nanoMAS and token units per private key. */
let chain: { mas: Record<string, bigint>; tokens: Record<string, Record<string, bigint>> };

function fakeProvider() {
  return {
    getBalance: vi.fn(async (pk: string) => chain.mas[pk] ?? 0n),
    getTokenBalance: vi.fn(
      async (pk: string, contract: string) => chain.tokens[pk]?.[contract] ?? 0n,
    ),
    getStaking: vi.fn(async () => ({
      rolls: { active: 0, candidate: 0, deferred: 0 },
      stats: { activeRolls: 0, produced: 0, missed: 0, nextBlockDraws: 0, nextEndorsementDraws: 0 },
    })),
    transferMas: vi.fn(async () => ({ operationId: 'Osent' })),
    transferToken: vi.fn(async () => ({ operationId: 'Otoken' })),
    buyRolls: vi.fn(async () => ({ operationId: 'Oroll' })),
    sellRolls: vi.fn(async () => ({ operationId: 'Osell' })),
    getTotalRolls: vi.fn(async () => 1000),
    getOwnedDomains: vi.fn(async () => []),
    signMessage: vi.fn(async () => ({ publicKey: 'P1key', signature: '1sig' })),
  } satisfies Partial<MassaProvider>;
}

describe('WalletStore', () => {
  let store: WalletStore;
  let provider: ReturnType<typeof fakeProvider>;

  beforeEach(async () => {
    localStorage.clear();
    chain = {
      mas: { S1a: 100_000_000_000n, S1b: 5_000_000_000n }, // 100 MAS, 5 MAS
      tokens: { S1a: { [DAI]: 999_797_356_704_803_912n } }, // ≈ 0.9998 DAI
    };
    provider = fakeProvider();
    TestBed.configureTestingModule({
      providers: [
        { provide: MASSA_PROVIDER, useValue: provider },
        { provide: AuthStore, useValue: { accounts: signal(accounts), isUnlocked: signal(true) } },
        {
          provide: ExplorerApi,
          useValue: { getHistory: vi.fn().mockRejectedValue(new Error('offline')) },
        },
        {
          provide: DusaPrices,
          useValue: { getUsdPrices: vi.fn().mockResolvedValue({ MAS: 0.003 }) },
        },
        { provide: DusaSwap, useValue: {} },
        {
          provide: WalletCache,
          useValue: { save: vi.fn().mockResolvedValue(undefined), load: vi.fn(), clear: vi.fn() },
        },
      ],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    store = TestBed.inject(WalletStore);
    for (const acc of accounts) store.ensureWallet(acc.id, acc.name, acc.address);
    await store.refresh('a');
    await store.refresh('b');
  });

  describe('reading the chain', () => {
    it('marks a wallet unloaded until its first chain read (UI shows placeholders, not 0)', () => {
      store.ensureWallet('c', 'fresh', OUTSIDER);
      expect(store.wallets()['c'].loaded).toBe(false);
    });

    it('loads real balances from the chain', () => {
      const wallet = store.wallets()['a'];
      expect(wallet.loaded).toBe(true);
      expect(wallet.balances.MAS).toBe(100);
      expect(wallet.balances['DAI.e']).toBeCloseTo(0.9998, 4);
    });

    it('keeps the exact on-chain units next to the display value', () => {
      expect(store.wallets()['a'].rawBalances['DAI.e']).toBe('999797356704803912');
    });

    it('lists only tokens actually held (sparse balances)', () => {
      expect(Object.keys(store.wallets()['b'].balances)).toEqual(['MAS']);
    });

    it('refreshes all wallets one at a time, the active one first (no RPC burst)', async () => {
      const order: string[] = [];
      let inFlight = 0;
      let maxInFlight = 0;
      provider.getBalance.mockImplementation(async (pk: string) => {
        order.push(pk);
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return chain.mas[pk] ?? 0n;
      });
      chain.mas['S1b'] = 7_000_000_000n;
      await store.refreshAll();
      expect(order).toEqual(['S1a', 'S1b']);
      expect(maxInFlight).toBe(1);
      expect(store.wallets()['b'].balances.MAS).toBe(7);
    });
  });

  describe('validateSend', () => {
    it('rejects bad recipients', () => {
      expect(() => store.validateSend('MAS', 'not-an-address', 1)).toThrow(/valid Massa address/);
      expect(() => store.validateSend('MAS', A, 1)).toThrow(/own address/);
    });

    it('enforces the minimum amount', () => {
      expect(() => store.validateSend('MAS', B, 0.001)).toThrow(/Minimum/);
    });

    it('keeps the 0.01 MAS network fee back when sending MAS', () => {
      expect(() => store.validateSend('MAS', B, 100)).toThrow(/network fee/);
      expect(() => store.validateSend('MAS', B, 99.99)).not.toThrow();
    });

    it('requires MAS for the fee when sending a token', () => {
      store.switchWallet('b');
      expect(() => store.validateSend('DAI.e', A, 0.5)).toThrow(/Insufficient balance/);
    });

    it('accepts a valid transfer', () => {
      expect(() => store.validateSend('DAI.e', B, 0.5)).not.toThrow();
    });
  });

  it('maxSendable leaves exactly the fee for MAS, the full balance for tokens', () => {
    expect(store.maxSendable('MAS')).toBe(99.99);
    expect(store.maxSendable('DAI.e')).toBe(store.wallets()['a'].balances['DAI.e']);
  });

  describe('send', () => {
    it('never sends more than held: Max of an 18-decimal token is clamped to the exact balance', async () => {
      await store.send('DAI.e', OUTSIDER, store.maxSendable('DAI.e'));
      expect(provider.transferToken).toHaveBeenCalledWith(
        'S1a',
        DAI,
        OUTSIDER,
        999_797_356_704_803_912n,
      );
    });

    it('changes nothing locally when the transaction fails', async () => {
      provider.transferMas.mockRejectedValueOnce(
        new OperationFailedError('Ofail', 'insufficient funds'),
      );
      const before = store.wallets()['a'];

      await expect(store.send('MAS', OUTSIDER, 10)).rejects.toThrow(/Transaction failed/);
      expect(store.wallets()['a'].balances).toEqual(before.balances);
      expect(store.wallets()['a'].history).toEqual(before.history);
    });

    it('records history and shows the re-read chain balance only after execution', async () => {
      provider.transferMas.mockImplementationOnce(async () => {
        chain.mas['S1a'] = 89_990_000_000n; // what the chain reports after the send + fee
        return { operationId: 'Osent' };
      });
      await store.send('MAS', OUTSIDER, 10);

      const wallet = store.wallets()['a'];
      expect(wallet.balances.MAS).toBe(89.99);
      expect(wallet.history[0]).toMatchObject({
        type: 'send',
        amount: 10,
        operationId: 'Osent',
        to: OUTSIDER,
        local: true,
        status: 'pending',
      });
    });

    it('records the receive on an own wallet too, with that wallet re-read from chain', async () => {
      const result = await store.send('MAS', B, 1);
      expect(result.internal).toBe(true);
      expect(store.wallets()['b'].history[0]).toMatchObject({ type: 'receive', amount: 1 });
      expect(provider.getBalance).toHaveBeenCalledWith('S1b', false);
    });
  });

  describe('rolls', () => {
    it('requires the roll price plus the fee', () => {
      expect(() => store.validateBuyRolls(1)).toThrow(/Insufficient MAS/); // 100 MAS, needs 100.01
      chain.mas['S1a'] = 200_000_000_000n;
      return store.refresh('a').then(() => expect(() => store.validateBuyRolls(1)).not.toThrow());
    });

    it('rejects fractional or non-positive roll counts', () => {
      expect(() => store.validateBuyRolls(1.5)).toThrow(/valid amount/);
      expect(() => store.validateSellRolls(0)).toThrow(/valid amount/);
    });

    it('cannot sell more rolls than are active', () => {
      expect(() => store.validateSellRolls(1)).toThrow(/Not enough active rolls/);
    });
  });

  describe('networks', () => {
    it('keeps each network’s state separate', async () => {
      store.setNetwork('buildnet');
      expect(store.wallets()['a'].loaded).toBe(false);
      store.setNetwork('mainnet');
      expect(store.wallets()['a'].balances.MAS).toBe(100);
    });

    it('quotes exactly the typed amount, never the whole balance in its place', async () => {
      const dusa = TestBed.inject(DusaSwap) as unknown as { quote: ReturnType<typeof vi.fn> };
      dusa.quote = vi.fn().mockResolvedValue({});
      await expect(store.quoteSwap('MAS', 'USDC.e', 1000, 50)).rejects.toThrow(/Insufficient MAS/);
      expect(dusa.quote).not.toHaveBeenCalled();

      await store.quoteSwap('MAS', 'USDC.e', 50, 50);
      expect(dusa.quote).toHaveBeenCalledWith('MAS', 'USDC.e', 50_000_000_000n, 50);
    });

    it('only allows swaps on mainnet', () => {
      store.setNetwork('buildnet');
      expect(() => store.validateSwap('MAS', 'USDC.e', 1)).toThrow(/Mainnet only/);
    });
  });

  describe('dApp requests', () => {
    // Wallet b holds exactly 5 MAS; the active wallet is a.

    it('sends exactly the units asked for, from the connected wallet, without switching', async () => {
      const operationId = await store.dappTransfer('b', OUTSIDER, 1_234_567_891n);
      expect(operationId).toBe('Osent');
      expect(provider.transferMas).toHaveBeenCalledWith('S1b', OUTSIDER, 1_234_567_891n);
      expect(store.activeWalletId()).toBe('a');
      expect(store.wallets()['b'].history[0]).toMatchObject({
        type: 'send',
        amount: 1.234567891,
        from: B,
        to: OUTSIDER,
        operationId: 'Osent',
      });
    });

    it('keeps the network fee, to the nanoMAS', () => {
      expect(() => store.validateDappTransfer('b', OUTSIDER, 4_990_000_000n)).not.toThrow();
      expect(() => store.validateDappTransfer('b', OUTSIDER, 4_990_000_001n)).toThrow(
        /Insufficient balance/,
      );
    });

    it('refuses odd transfers before anything is signed', async () => {
      expect(() => store.validateDappTransfer('b', B, 1n)).toThrow(/own address/);
      expect(() => store.validateDappTransfer('b', 'AU123', 1n)).toThrow(/valid Massa address/);
      expect(() => store.validateDappTransfer('b', OUTSIDER, 0n)).toThrow(/greater than 0/);
      expect(() => store.validateDappTransfer('gone', OUTSIDER, 1n)).toThrow(/no longer/);
      await expect(store.dappTransfer('b', OUTSIDER, 6_000_000_000n)).rejects.toThrow();
      expect(provider.transferMas).not.toHaveBeenCalled();
    });

    it('changes nothing when the transfer fails on-chain', async () => {
      const before = store.wallets()['b'];
      provider.transferMas.mockRejectedValueOnce(new OperationFailedError('Ofail', 'reverted'));
      await expect(store.dappTransfer('b', OUTSIDER, 1_000_000_000n)).rejects.toThrow(
        OperationFailedError,
      );
      expect(store.wallets()['b'].history).toEqual(before.history);
    });

    it('checks rolls against the exact balance and the active rolls', async () => {
      expect(() => store.validateDappRolls('a', 'buy', 0n)).toThrow(/greater than 0/);
      expect(() => store.validateDappRolls('b', 'buy', 1n)).toThrow(/Insufficient MAS/);
      expect(() => store.validateDappRolls('a', 'sell', 1n)).toThrow(/Not enough active rolls/);
      await expect(store.dappRolls('a', 'buy', 0n)).rejects.toThrow(/greater than 0/);
      chain.mas['S1a'] = 100_010_000_000n; // exactly one roll + the fee
      await store.refresh('a');
      await expect(store.dappRolls('a', 'buy', 1n)).resolves.toBe('Oroll');
      expect(provider.buyRolls).toHaveBeenCalledWith('S1a', 1n);
    });

    it("signs with the connected wallet's key", async () => {
      const data = new TextEncoder().encode('hello');
      await expect(store.dappSign('b', data)).resolves.toEqual({
        publicKey: 'P1key',
        signature: '1sig',
      });
      expect(provider.signMessage).toHaveBeenCalledWith('S1b', data);
    });
  });
});
