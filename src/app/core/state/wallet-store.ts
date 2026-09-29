import { Injectable, computed, inject, signal } from '@angular/core';
import { SavedAddress } from '../models/saved-address.model';
import {
  TOKEN_LIST,
  TOKEN_REGISTRY,
  TokenBalances,
  TokenPrices,
  TokenSymbol,
} from '../models/token.model';
import { TransactionRecord } from '../models/transaction.model';
import { WalletState } from '../models/wallet.model';
import { MASSA_PROVIDER, ROLL_PRICE_MAS } from '../services/massa-provider';
import { fromUnits, toUnits } from '../utils/token-amount';
import { AuthStore } from './auth-store';
import { Network, NetworkStore } from './network-store';

/**
 * The MRC-20 contract addresses in TOKEN_REGISTRY are mainnet deployments;
 * on buildnet only native MAS is read.
 */
const MRC20_TOKENS = TOKEN_LIST.filter((t) => t.isErc20);
const TOKENS_BY_NETWORK: Readonly<Record<Network, typeof MRC20_TOKENS>> = {
  mainnet: MRC20_TOKENS,
  buildnet: [],
};

type WalletsByNetwork = Record<Network, Record<string, WalletState>>;

const emptyWallets = (): WalletsByNetwork => ({ mainnet: {}, buildnet: {} });

function newWallet(id: string, name: string, address: string): WalletState {
  return {
    id,
    name,
    address,
    balances: { MAS: 0 },
    rolls: { active: 0, candidate: 0, deferred: 0 },
    history: [],
    nfts: [],
  };
}

/**
 * Static placeholder USD prices — there is no price feed yet, so the
 * portfolio value is indicative only. Balances themselves are real.
 */
const DEMO_PRICES: TokenPrices = {
  MAS: 0.02,
  PUR: 0.004,
  DUSA: 0.05,
  'USDC.e': 1,
  'WETH.e': 3182.4,
  'DAI.e': 1,
  'WBTC.e': 64000,
  'WETH.b': 3182.4,
  'USDT.b': 1,
};

const DEMO_DAY_CHANGE_PCT: TokenPrices = {
  MAS: 4.82,
  'USDC.e': 0.01,
  'WETH.e': -1.14,
  'WETH.b': -1.14,
};

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Adds `delta` (may be negative) to one token, clamped at 0. */
function adjust(balances: TokenBalances, token: TokenSymbol, delta: number): TokenBalances {
  return { ...balances, [token]: Math.max(0, (balances[token] ?? 0) + delta) };
}

/**
 * Per-wallet chain state for the UI: balances, rolls, local history.
 *
 * Identity (name, address, private key) lives in AuthStore; entries here
 * are keyed by the same account id and created via `ensureWallet`. The
 * private key is looked up from AuthStore by that id at the moment of
 * each chain call and never stored on this class.
 *
 * Amounts are human-readable `number`s everywhere in this store; the
 * conversion to/from `bigint` units (via each token's `decimals`)
 * happens only right at the MassaProvider calls below.
 *
 * Balances and rolls come from the chain (`refresh`). After a write the
 * store applies the expected change optimistically — the chain only
 * reflects it once the operation is final, so a later `refresh`
 * reconciles. History is local: it only lists operations sent from
 * this app. NFTs and prices are not wired to any source yet.
 *
 * State is kept per network (NetworkStore), so mainnet and buildnet
 * balances/history never mix; `wallets` always shows the current one.
 * Every async write captures the network it started on and lands its
 * result there, even if the user switches network mid-flight.
 */
@Injectable({ providedIn: 'root' })
export class WalletStore {
  private readonly provider = inject(MASSA_PROVIDER);
  private readonly auth = inject(AuthStore);
  private readonly networkStore = inject(NetworkStore);

  private readonly _walletsByNetwork = signal<WalletsByNetwork>(emptyWallets());
  private readonly _activeWalletId = signal<string>('');
  private readonly _addressBook = signal<SavedAddress[]>([]);
  private readonly _prices = signal<TokenPrices>(DEMO_PRICES);
  private readonly _dayChangePct = signal<TokenPrices>(DEMO_DAY_CHANGE_PCT);
  private readonly _refreshingIds = signal<ReadonlySet<string>>(new Set());

  readonly network = this.networkStore.network;
  readonly wallets = computed(() => this._walletsByNetwork()[this.network()]);
  readonly activeWalletId = this._activeWalletId.asReadonly();
  readonly addressBook = this._addressBook.asReadonly();
  readonly prices = this._prices.asReadonly();
  readonly dayChangePct = this._dayChangePct.asReadonly();

  readonly walletList = computed(() => Object.values(this.wallets()));

  readonly activeWallet = computed<WalletState>(() => {
    const wallet = this.wallets()[this._activeWalletId()];
    if (!wallet) throw new Error(`Unknown active wallet id "${this._activeWalletId()}"`);
    return wallet;
  });

  readonly isRefreshing = computed(() => this._refreshingIds().has(this._activeWalletId()));

  readonly portfolioValueUsd = computed(() => {
    const balances = this.activeWallet().balances;
    const prices = this._prices();
    return (Object.keys(balances) as TokenSymbol[]).reduce(
      (sum, token) => sum + (balances[token] ?? 0) * (prices[token] ?? 0),
      0,
    );
  });

  readonly knownAddresses = computed(() => {
    const walletAddresses = this.walletList().map((w) => w.address);
    const savedAddresses = this._addressBook().map((entry) => entry.address);
    return new Set([...walletAddresses, ...savedAddresses]);
  });

  // ---- network & session ---------------------------------------------------

  /** Points every chain call at `network` and reloads all wallets there. */
  setNetwork(network: Network): void {
    if (network === this.network()) return;
    this.networkStore.set(network);
    for (const id of Object.keys(this.wallets())) this.refreshInBackground(id);
  }

  /** Drops every wallet, history entry and saved address — used on log out. */
  reset(): void {
    this._walletsByNetwork.set(emptyWallets());
    this._activeWalletId.set('');
    this._addressBook.set([]);
    this._refreshingIds.set(new Set());
  }

  // ---- wallets -------------------------------------------------------------

  switchWallet(id: string): void {
    if (!this.wallets()[id]) return;
    this._activeWalletId.set(id);
    this.refreshInBackground(id);
  }

  /**
   * Ensures an entry exists for a real account from AuthStore, keyed by
   * the same id, and loads its balances from the chain — idempotent,
   * safe to call for accounts that already have one. The first wallet
   * registered becomes the active one.
   */
  ensureWallet(id: string, name: string, address: string): void {
    if (this.wallets()[id]) return;
    // Created on every network at once, so switching network never finds
    // an account without an entry.
    this._walletsByNetwork.update((all) => ({
      mainnet: all.mainnet[id]
        ? all.mainnet
        : { ...all.mainnet, [id]: newWallet(id, name, address) },
      buildnet: all.buildnet[id]
        ? all.buildnet
        : { ...all.buildnet, [id]: newWallet(id, name, address) },
    }));
    if (!this.wallets()[this._activeWalletId()]) this._activeWalletId.set(id);
    this.refreshInBackground(id);
  }

  saveAddress(name: string, address: string): void {
    this._addressBook.update((book) => [...book, { name, address }]);
  }

  /**
   * Re-reads MAS, every MRC-20 balance and roll counts from the chain.
   * Each read is independent: one that fails (RPC hiccup, bad token
   * contract) keeps its previous value instead of failing the rest.
   */
  async refresh(id: string = this._activeWalletId()): Promise<void> {
    const network = this.network();
    const wallet = this.wallets()[id];
    if (!wallet) return;
    const privateKey = this.privateKeyFor(id);
    const tokenList = TOKENS_BY_NETWORK[network];

    this._refreshingIds.update((ids) => new Set(ids).add(id));
    try {
      const [[mas, rolls], tokens] = await Promise.all([
        Promise.allSettled([
          this.provider.getBalance(privateKey),
          this.provider.getRolls(wallet.address),
        ]),
        Promise.allSettled(
          tokenList.map((t) => this.provider.getTokenBalance(privateKey, t.contract)),
        ),
      ]);

      const failures = [mas, rolls, ...tokens].filter((r) => r.status === 'rejected');
      if (failures.length)
        console.warn(`Wallet refresh: ${failures.length} read(s) failed`, failures);

      this.updateWallet(
        id,
        (w) => {
          const balances: TokenBalances = { ...w.balances };
          if (mas.status === 'fulfilled')
            balances.MAS = fromUnits(mas.value, TOKEN_REGISTRY.MAS.decimals);
          tokens.forEach((result, i) => {
            if (result.status !== 'fulfilled') return;
            const { symbol, decimals } = tokenList[i];
            // Sparse: only tokens actually held get a key.
            if (result.value > 0n) balances[symbol] = fromUnits(result.value, decimals);
            else delete balances[symbol];
          });
          return {
            ...w,
            balances,
            rolls: rolls.status === 'fulfilled' ? rolls.value : w.rolls,
          };
        },
        network,
      );
    } finally {
      this._refreshingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }
  }

  // ---- transactions --------------------------------------------------------

  async send(
    token: TokenSymbol,
    toAddress: string,
    amount: number,
  ): Promise<{ internal: boolean }> {
    const network = this.network();
    const wallet = this.activeWallet();
    if (!(amount > 0)) throw new Error('Enter a valid amount');
    if (amount > (wallet.balances[token] ?? 0)) throw new Error('Insufficient balance');

    const meta = TOKEN_REGISTRY[token];
    const units = toUnits(amount, meta.decimals);
    if (units === 0n) throw new Error('Amount is too small');

    const privateKey = this.privateKeyFor(wallet.id);
    const { operationId } = meta.isErc20
      ? await this.provider.transferToken(privateKey, meta.contract, toAddress, units)
      : await this.provider.transferMas(privateKey, toAddress, units);

    this.updateWallet(
      wallet.id,
      (w) => ({
        ...w,
        balances: adjust(w.balances, token, -amount),
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
      }),
      network,
    );

    const targetId = this.walletList().find(
      (w) => w.address === toAddress && w.id !== wallet.id,
    )?.id;
    if (targetId) {
      this.updateWallet(
        targetId,
        (w) => ({
          ...w,
          balances: adjust(w.balances, token, amount),
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
        }),
        network,
      );
    }

    return { internal: !!targetId };
  }

  async buyRolls(rollCount: number): Promise<void> {
    const network = this.network();
    const wallet = this.activeWallet();
    if (!Number.isInteger(rollCount) || rollCount <= 0)
      throw new Error('Enter a valid amount of rolls');
    const cost = rollCount * ROLL_PRICE_MAS;
    if (cost > (wallet.balances.MAS ?? 0)) throw new Error('Insufficient MAS');

    const { operationId } = await this.provider.buyRolls(
      this.privateKeyFor(wallet.id),
      BigInt(rollCount),
    );

    // Bought rolls stay candidate until final; `refresh` picks that up.
    this.updateWallet(
      wallet.id,
      (w) => ({
        ...w,
        balances: adjust(w.balances, 'MAS', -cost),
        rolls: { ...w.rolls, candidate: w.rolls.candidate + rollCount },
        history: [
          this.record({ type: 'buy_rolls', token: 'MAS', amount: cost, rollCount, operationId }),
          ...w.history,
        ],
      }),
      network,
    );
  }

  async sellRolls(rollCount: number): Promise<void> {
    const network = this.network();
    const wallet = this.activeWallet();
    if (!Number.isInteger(rollCount) || rollCount <= 0)
      throw new Error('Enter a valid amount of rolls');
    if (rollCount > wallet.rolls.active) throw new Error('Not enough active rolls');

    const { operationId } = await this.provider.sellRolls(
      this.privateKeyFor(wallet.id),
      BigInt(rollCount),
    );
    const refund = rollCount * ROLL_PRICE_MAS;

    // The MAS refund is a deferred credit, paid out by the chain a few
    // cycles later — `refresh` picks it up, nothing is credited here.
    this.updateWallet(
      wallet.id,
      (w) => ({
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
      }),
      network,
    );
  }

  // ---- internal helpers ----------------------------------------------------

  /** Fire-and-forget `refresh` — logs instead of leaving an unhandled rejection. */
  private refreshInBackground(id: string): void {
    this.refresh(id).catch((err) => console.warn(`Wallet refresh failed for "${id}"`, err));
  }

  /** Throws while the vault is locked — keys only exist in AuthStore when unlocked. */
  private privateKeyFor(id: string): string {
    const account = this.auth.accounts().find((a) => a.id === id);
    if (!account) throw new Error('Wallet is locked');
    return account.privateKey;
  }

  private updateWallet(
    id: string,
    updater: (wallet: WalletState) => WalletState,
    network: Network,
  ): void {
    this._walletsByNetwork.update((all) => {
      const wallets = all[network];
      if (!wallets[id]) return all;
      return { ...all, [network]: { ...wallets, [id]: updater(wallets[id]) } };
    });
  }

  private record(partial: Omit<TransactionRecord, 'id' | 'timestamp'>): TransactionRecord {
    return {
      id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      ...partial,
    };
  }
}
