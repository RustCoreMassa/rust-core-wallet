import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { SavedAddress } from '../models/saved-address.model';
import { TokenPrices, TokenSymbol } from '../models/token.model';
import { TransactionRecord } from '../models/transaction.model';
import { WalletState } from '../models/wallet.model';
import { MASSA_PROVIDER } from '../services/massa-provider';
import { ROLL_PRICE_MAS } from '../services/mock-massa-provider';

export type Network = 'mainnet' | 'testnet';

const INITIAL_WALLETS: Record<string, WalletState> = {
  main: {
    id: 'main',
    name: 'Main Wallet',
    address: 'AU12k9pQ7mZx3vT8wRj2LhN5cF6dY1sB4eK0xP9tQmVn7uWaXbYc',
    balances: { MAS: 3214.87, USDC: 248, WETH: 0.03 },
    rolls: { active: 12, candidate: 0, deferred: 0 },
    history: [
      {
        id: 't1',
        type: 'receive',
        token: 'MAS',
        amount: 500,
        counterparty: 'AU3k4m…81fe',
        timestamp: Date.now() - 1000 * 60 * 60 * 5,
      },
      {
        id: 't2',
        type: 'send',
        token: 'USDC',
        amount: 40,
        counterparty: 'AU7q2n…20ac',
        timestamp: Date.now() - 1000 * 60 * 60 * 26,
      },
      {
        id: 't3',
        type: 'reward',
        token: 'MAS',
        amount: 3.36,
        timestamp: Date.now() - 1000 * 60 * 60 * 30,
      },
      {
        id: 't4',
        type: 'buy_rolls',
        token: 'MAS',
        amount: 1200,
        rollCount: 12,
        timestamp: Date.now() - 1000 * 60 * 60 * 72,
      },
    ],
    nfts: [
      {
        id: 'n1',
        name: 'Massa Genesis #0142',
        collection: 'Massa Genesis',
        gradientFrom: '#ff2d42',
        gradientTo: '#3b0a10',
      },
      {
        id: 'n2',
        name: 'DeWeb Pioneer #009',
        collection: 'DeWeb Pioneers',
        gradientFrom: '#ff8a3d',
        gradientTo: '#3b1c05',
      },
      {
        id: 'n3',
        name: 'Node Runner #771',
        collection: 'Node Runners',
        gradientFrom: '#4361ff',
        gradientTo: '#0b1240',
      },
      {
        id: 'n4',
        name: 'Blockclique #058',
        collection: 'Massa Genesis',
        gradientFrom: '#33d17a',
        gradientTo: '#0a3320',
      },
    ],
  },
  savings: {
    id: 'savings',
    name: 'Savings',
    address: 'AU8f3nQ2wT6bY0cD5eH2jN4mR7uV9xZ3wQ6bY0cD5eLp8h',
    balances: { MAS: 850, USDC: 0, WETH: 0 },
    rolls: { active: 0, candidate: 0, deferred: 0 },
    history: [],
    nfts: [],
  },
};

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Single source of truth for session + wallet state.
 *
 * All state is exposed as read-only signals; every mutation goes through
 * one of the methods below. Methods that touch the chain are async: they
 * await `MassaProvider` first (see massa-provider.ts) and only update
 * local signals once that call resolves — the same flow a real dApp
 * follows around a wallet SDK, just with a mocked provider underneath.
 */
@Injectable({ providedIn: 'root' })
export class WalletStore {
  private readonly provider = inject(MASSA_PROVIDER);

  private readonly _wallets = signal<Record<string, WalletState>>(INITIAL_WALLETS);
  private readonly _activeWalletId = signal<string>('main');
  private readonly _network = signal<Network>('mainnet');
  private readonly _addressBook = signal<SavedAddress[]>([]);
  private readonly _prices = signal<TokenPrices>({ MAS: 0.19, USDC: 1.0, WETH: 3182.4 });
  private readonly _dayChangePct = signal<Record<TokenSymbol, number>>({
    MAS: 4.82,
    USDC: 0.01,
    WETH: -1.14,
  });
  private readonly _isUnlocked = signal(false);

  readonly wallets = this._wallets.asReadonly();
  readonly activeWalletId = this._activeWalletId.asReadonly();
  readonly network = this._network.asReadonly();
  readonly addressBook = this._addressBook.asReadonly();
  readonly prices = this._prices.asReadonly();
  readonly dayChangePct = this._dayChangePct.asReadonly();
  readonly isUnlocked = this._isUnlocked.asReadonly();

  readonly walletList = computed(() => Object.values(this._wallets()));

  readonly activeWallet = computed<WalletState>(() => {
    const wallet = this._wallets()[this._activeWalletId()];
    if (!wallet) throw new Error(`Unknown active wallet id "${this._activeWalletId()}"`);
    return wallet;
  });

  readonly portfolioValueUsd = computed(() => {
    const wallet = this.activeWallet();
    const prices = this._prices();
    return (Object.keys(wallet.balances) as TokenSymbol[]).reduce(
      (sum, token) => sum + wallet.balances[token] * prices[token],
      0,
    );
  });

  readonly knownAddresses = computed(() => {
    const walletAddresses = this.walletList().map((w) => w.address);
    const savedAddresses = this._addressBook().map((entry) => entry.address);
    return new Set([...walletAddresses, ...savedAddresses]);
  });

  /**
   * Read-side example of the async pattern the wallet is built around: a
   * `resource()` whose request is derived from the active wallet's
   * address and whose loader calls `MassaProvider.getBalance` — it
   * re-runs automatically whenever the active wallet signal changes.
   * Components can bind to `balanceResource.isLoading()` to show a
   * refresh indicator. The figures actually rendered in this demo come
   * from local state (below); a production build would source
   * `activeWallet().balances` from resources like this one instead.
   */
  readonly balanceResource = resource({
    params: () => ({ address: this.activeWallet().address }),
    loader: ({ params }) => this.provider.getBalance(params.address, 'MAS'),
  });

  // ---- session ---------------------------------------------------------

  unlock(pin: string): boolean {
    const isValid = pin.length === 6;
    if (isValid) this._isUnlocked.set(true);
    return isValid;
  }

  lock(): void {
    this._isUnlocked.set(false);
  }

  toggleNetwork(): void {
    this._network.update((n) => (n === 'mainnet' ? 'testnet' : 'mainnet'));
  }

  // ---- wallets -----------------------------------------------------------

  switchWallet(id: string): void {
    if (this._wallets()[id]) this._activeWalletId.set(id);
  }

  /**
   * Ensures a demo economy entry (zero balances) exists for a real
   * account from AuthStore, keyed by the same id — idempotent, safe to
   * call for accounts that already have one. Real identity (name,
   * address, private key) lives in AuthStore; this is just the mock
   * balances/rolls/history/nfts this demo renders for that account.
   */
  ensureWallet(id: string, name: string, address: string): void {
    if (this._wallets()[id]) return;
    const wallet: WalletState = {
      id,
      name,
      address,
      balances: { MAS: 0, USDC: 0, WETH: 0 },
      rolls: { active: 0, candidate: 0, deferred: 0 },
      history: [],
      nfts: [],
    };
    this._wallets.update((all) => ({ ...all, [id]: wallet }));
  }

  saveAddress(name: string, address: string): void {
    this._addressBook.update((book) => [...book, { name, address }]);
  }

  // ---- transactions --------------------------------------------------------

  async send(
    token: TokenSymbol,
    toAddress: string,
    amount: number,
  ): Promise<{ internal: boolean }> {
    const wallet = this.activeWallet();
    if (!(amount > 0)) throw new Error('Enter a valid amount');
    if (amount > wallet.balances[token]) throw new Error('Insufficient balance');

    const { operationId } = await this.provider.transfer({
      fromAddress: wallet.address,
      toAddress,
      token,
      amount,
    });

    this.updateWallet(wallet.id, (w) => ({
      ...w,
      balances: { ...w.balances, [token]: w.balances[token] - amount },
      history: [
        this.record({
          type: 'send',
          token,
          amount,
          counterparty: shortAddress(toAddress),
          operationId,
        }),
        ...w.history,
      ],
    }));

    const targetId = this.walletList().find(
      (w) => w.address === toAddress && w.id !== wallet.id,
    )?.id;
    if (targetId) {
      this.updateWallet(targetId, (w) => ({
        ...w,
        balances: { ...w.balances, [token]: w.balances[token] + amount },
        history: [
          this.record({
            type: 'receive',
            token,
            amount,
            counterparty: shortAddress(wallet.address),
            operationId,
          }),
          ...w.history,
        ],
      }));
    }

    return { internal: !!targetId };
  }

  async swap(
    fromToken: TokenSymbol,
    toToken: TokenSymbol,
    amount: number,
  ): Promise<{ received: number }> {
    const wallet = this.activeWallet();
    if (fromToken === toToken) throw new Error('Choose two different assets');
    if (!(amount > 0)) throw new Error('Enter a valid amount');
    if (amount > wallet.balances[fromToken]) throw new Error('Insufficient balance');

    const { operationId } = await this.provider.swap({
      address: wallet.address,
      fromToken,
      toToken,
      amount,
    });
    const prices = this._prices();
    const received = (amount * prices[fromToken]) / prices[toToken];

    this.updateWallet(wallet.id, (w) => ({
      ...w,
      balances: {
        ...w.balances,
        [fromToken]: w.balances[fromToken] - amount,
        [toToken]: w.balances[toToken] + received,
      },
      history: [
        this.record({ type: 'swap', token: fromToken, toToken, amount, received, operationId }),
        ...w.history,
      ],
    }));

    return { received };
  }

  async buyRolls(rollCount: number): Promise<void> {
    const wallet = this.activeWallet();
    if (!(rollCount > 0)) throw new Error('Enter a valid amount of rolls');
    const cost = rollCount * ROLL_PRICE_MAS;
    if (cost > wallet.balances.MAS) throw new Error('Insufficient MAS');

    const { operationId } = await this.provider.buyRolls({ address: wallet.address, rollCount });

    this.updateWallet(wallet.id, (w) => ({
      ...w,
      balances: { ...w.balances, MAS: w.balances.MAS - cost },
      rolls: { ...w.rolls, candidate: w.rolls.candidate + rollCount },
      history: [
        this.record({ type: 'buy_rolls', token: 'MAS', amount: cost, rollCount, operationId }),
        ...w.history,
      ],
    }));

    setTimeout(() => {
      this.updateWallet(wallet.id, (w) => ({
        ...w,
        rolls: {
          ...w.rolls,
          active: w.rolls.active + rollCount,
          candidate: w.rolls.candidate - rollCount,
        },
      }));
    }, 4000);
  }

  async sellRolls(rollCount: number): Promise<void> {
    const wallet = this.activeWallet();
    if (!(rollCount > 0)) throw new Error('Enter a valid amount of rolls');
    if (rollCount > wallet.rolls.active) throw new Error('Not enough active rolls');

    const { operationId } = await this.provider.sellRolls({ address: wallet.address, rollCount });
    const refund = rollCount * ROLL_PRICE_MAS;

    this.updateWallet(wallet.id, (w) => ({
      ...w,
      rolls: {
        ...w.rolls,
        active: w.rolls.active - rollCount,
        deferred: w.rolls.deferred + rollCount,
      },
      history: [
        this.record({ type: 'sell_rolls', token: 'MAS', amount: refund, rollCount, operationId }),
        ...w.history,
      ],
    }));

    setTimeout(() => {
      this.updateWallet(wallet.id, (w) => ({
        ...w,
        balances: { ...w.balances, MAS: w.balances.MAS + refund },
        rolls: { ...w.rolls, deferred: w.rolls.deferred - rollCount },
      }));
    }, 4000);
  }

  // ---- simulated market data ------------------------------------------------

  jitterPrices(): void {
    const drift = {} as Record<TokenSymbol, number>;
    this._prices.update((prices) => {
      const next = { ...prices };
      (Object.keys(next) as TokenSymbol[]).forEach((token) => {
        const d = (Math.random() - 0.5) * 0.006;
        drift[token] = d;
        next[token] = Math.max(0.0001, next[token] * (1 + d));
      });
      return next;
    });
    this._dayChangePct.update((pct) => {
      const next = { ...pct };
      (Object.keys(next) as TokenSymbol[]).forEach((token) => {
        next[token] += drift[token] * 100;
      });
      return next;
    });
  }

  // ---- internal helpers ---------------------------------------------------

  private updateWallet(id: string, updater: (wallet: WalletState) => WalletState): void {
    this._wallets.update((all) => ({ ...all, [id]: updater(all[id]) }));
  }

  private record(partial: Omit<TransactionRecord, 'id' | 'timestamp'>): TransactionRecord {
    return {
      id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      ...partial,
    };
  }
}
