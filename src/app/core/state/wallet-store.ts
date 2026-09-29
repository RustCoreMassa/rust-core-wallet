import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { MnsDomain } from '../models/nft.model';
import { SavedAddress } from '../models/saved-address.model';
import {
  TOKEN_LIST,
  TOKEN_REGISTRY,
  TokenBalances,
  TokenPrices,
  TokenSymbol,
} from '../models/token.model';
import { HistoryPaging, HistoryStream, TransactionRecord } from '../models/transaction.model';
import { WalletState } from '../models/wallet.model';
import { DusaPrices } from '../services/dusa-prices';
import { DusaSwap, SWAP_STORAGE_COST_MAS, SwapQuote } from '../services/dusa-swap';
import { ExplorerApi, HistoryPage } from '../services/explorer-api';
import { MASSA_PROVIDER, NETWORK_FEE_MAS, ROLL_PRICE_MAS } from '../services/massa-provider';
import { WalletCache } from '../services/wallet-cache';
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

/** Token prices are re-read from Dusa at most this often. */
const PRICES_REFRESH_MS = 60_000;

/** The network's total roll count moves slowly — re-read at most this often. */
const TOTAL_ROLLS_REFRESH_MS = 10 * 60_000;

/** MNS ownership rarely changes — re-read at most this often when the NFT page is opened. */
const DOMAINS_REFRESH_MS = 60_000;
/** Coalesces bursts of state changes into one encrypted cache write. */
const CACHE_SAVE_DEBOUNCE_MS = 1000;

/** The newest history page is re-read at most this often, not on every balance poll. */
const HISTORY_REFRESH_MS = 30_000;
/** A local pending record the explorer never confirms (e.g. expired op) is dropped after this. */
const PENDING_TTL_MS = 10 * 60_000;

type WalletsByNetwork = Record<Network, Record<string, WalletState>>;

const emptyWallets = (): WalletsByNetwork => ({ mainnet: {}, buildnet: {} });

function newWallet(id: string, name: string, address: string): WalletState {
  return {
    id,
    name,
    address,
    loaded: false,
    balances: { MAS: 0 },
    rawBalances: {},
    rolls: { active: 0, candidate: 0, deferred: 0 },
    staking: null,
    history: [],
    historyPaging: null,
    domains: null,
  };
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Merges an explorer page into the history already held: records are
 * keyed by id, so re-reading the newest page (polling) or appending an
 * older one (load more) both just upsert.
 *
 * Local records (sent from this app) are dropped once the explorer
 * reports their operation, or after PENDING_TTL_MS if it never does.
 * MRC-20 transfers reach the explorer as a bare `CallSC` (no token, no
 * amount), so when a send we know about matches one by operation id, the
 * known token/amount is kept and only status/time/fee come from chain.
 */
function mergeHistory(
  existing: readonly TransactionRecord[],
  incoming: readonly TransactionRecord[],
): TransactionRecord[] {
  // Token sends and swaps only (both reach the explorer as a bare CallSC);
  // a contract call's payouts share its operation id and would otherwise
  // shadow the record in this map.
  const knownCalls = new Map(
    existing.filter((r) => r.type === 'send' || r.type === 'swap').map((r) => [r.operationId, r]),
  );
  const incomingOps = new Set(incoming.map((r) => r.operationId));

  const byId = new Map<string, TransactionRecord>();
  for (const r of existing) {
    const settled = incomingOps.has(r.operationId) || Date.now() - r.timestamp > PENDING_TTL_MS;
    if (!(r.local && settled)) byId.set(r.id, r);
  }
  for (const r of incoming) {
    const mine = knownCalls.get(r.operationId);
    byId.set(
      r.id,
      mine && r.type === 'contract_call'
        ? { ...mine, id: r.id, local: false, status: r.status, timestamp: r.timestamp, fee: r.fee }
        : r,
    );
  }
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}

const HISTORY_STREAMS: readonly HistoryStream[] = ['created', 'received'];

const EMPTY_PAGING: HistoryPaging = {
  created: { cursor: null, oldest: Infinity },
  received: { cursor: null, oldest: Infinity },
};

/**
 * Oldest timestamp the loaded history is complete down to. A stream with
 * more pages only covers down to its oldest loaded record; anything older
 * from the other stream could have gaps before it, so it stays hidden
 * until that stream catches up. 0 = everything loaded, show it all.
 */
function historyCutoff(paging: HistoryPaging | null): number {
  if (!paging) return 0;
  return HISTORY_STREAMS.reduce(
    (cutoff, s) => (paging[s].cursor ? Math.max(cutoff, paging[s].oldest) : cutoff),
    0,
  );
}

function advancePaging(paging: HistoryPaging, page: HistoryPage): HistoryPaging {
  const next = { ...paging };
  for (const s of HISTORY_STREAMS) {
    const fetched = page.streams[s];
    if (fetched)
      next[s] = { cursor: fetched.cursor, oldest: Math.min(paging[s].oldest, fetched.oldest) };
  }
  return next;
}

/** Applies vault names; returns `wallets` itself when nothing changed (no signal churn). */
function withNames(
  wallets: Record<string, WalletState>,
  names: ReadonlyMap<string, string>,
): Record<string, WalletState> {
  let changed = false;
  const next: Record<string, WalletState> = {};
  for (const [id, wallet] of Object.entries(wallets)) {
    const name = names.get(id);
    changed ||= !!name && name !== wallet.name;
    next[id] = name && name !== wallet.name ? { ...wallet, name } : wallet;
  }
  return changed ? next : wallets;
}

/**
 * Shape check for a Massa address: `AU` (user) or `AS` (smart contract)
 * followed by base58. The chain does the real validation on send; this
 * just catches typos before the confirmation step.
 */
const MASSA_ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;

/** Smallest amount the Send flow accepts, in any token. */
export const MIN_SEND_AMOUNT = 0.01;

const MAS_DECIMALS = TOKEN_REGISTRY.MAS.decimals;

/** `a - b` in MAS, exact to the nanoMAS (no float drift like 3.1 - 0.01). */
function subtractMas(a: number, b: number): number {
  const diff = toUnits(a, MAS_DECIMALS) - toUnits(b, MAS_DECIMALS);
  return diff > 0n ? fromUnits(diff, MAS_DECIMALS) : 0;
}

/** Throws unless the wallet holds `required` MAS on top of the network fee. */
function assertMasForFee(held: number, required: number, message: string): void {
  if (
    toUnits(required, MAS_DECIMALS) + toUnits(NETWORK_FEE_MAS, MAS_DECIMALS) >
    toUnits(held, MAS_DECIMALS)
  ) {
    throw new Error(message);
  }
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
 * Balances and rolls only ever come from the chain (`refresh`) — writes
 * wait for the chain to execute the operation, then re-read it; nothing
 * is updated optimistically. History comes from the Massa explorer API (mainnet only),
 * paged by cursor (`loadMoreHistory`) and merged with operations just
 * sent from this app that it hasn't indexed yet (see `mergeHistory`);
 * on buildnet it is local only. USD prices come from the Dusa DEX
 * (`refreshPrices`); tokens without Dusa liquidity have no price.
 *
 * The whole state (minus private keys, which never live here) is cached
 * encrypted in sessionStorage via WalletCache: `restoreCache` paints the
 * last-known values right after unlock, and every change is saved back,
 * debounced. Names always follow AuthStore (see the constructor).
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
  private readonly explorer = inject(ExplorerApi);
  private readonly cache = inject(WalletCache);
  private readonly dusa = inject(DusaPrices);
  private readonly dusaSwap = inject(DusaSwap);

  private readonly _walletsByNetwork = signal<WalletsByNetwork>(emptyWallets());
  private readonly _activeWalletId = signal<string>('');
  private readonly _addressBook = signal<SavedAddress[]>([]);
  private readonly _prices = signal<TokenPrices>({});
  private pricesFetchedAt = 0;
  private readonly _totalRolls = signal<Partial<Record<Network, number>>>({});
  private readonly totalRollsFetchedAt = new Map<Network, number>();
  private pricesInFlight = false;
  private readonly _refreshingIds = signal<ReadonlySet<string>>(new Set());
  private readonly _loadingHistory = signal(false);
  private readonly _loadingDomains = signal(false);
  /** Per `${network}:${id}`: when history was last read from the explorer. */
  private readonly historyFetchedAt = new Map<string, number>();
  /** Per `${network}:${id}`: when MNS domains were last read. */
  private readonly domainsFetchedAt = new Map<string, number>();
  private cacheSaveTimer: ReturnType<typeof setTimeout> | undefined;

  readonly network = this.networkStore.network;
  readonly wallets = computed(() => this._walletsByNetwork()[this.network()]);
  readonly activeWalletId = this._activeWalletId.asReadonly();
  readonly addressBook = this._addressBook.asReadonly();
  readonly prices = this._prices.asReadonly();

  readonly walletList = computed(() => Object.values(this.wallets()));

  readonly activeWallet = computed<WalletState>(() => {
    const wallet = this.wallets()[this._activeWalletId()];
    if (!wallet) throw new Error(`Unknown active wallet id "${this._activeWalletId()}"`);
    return wallet;
  });

  /** Every token that exists on the current network, registry order. */
  readonly availableTokens = computed<readonly TokenSymbol[]>(() => [
    'MAS',
    ...TOKENS_BY_NETWORK[this.network()].map((t) => t.symbol),
  ]);

  /** Active wallet's history, cut where it's still incomplete (see `historyCutoff`). */
  readonly visibleHistory = computed(() => {
    const { history, historyPaging } = this.activeWallet();
    const cutoff = historyCutoff(historyPaging);
    return cutoff ? history.filter((r) => r.timestamp >= cutoff) : history;
  });

  readonly hasMoreHistory = computed(() => {
    const paging = this.activeWallet().historyPaging;
    return !!paging && HISTORY_STREAMS.some((s) => paging[s].cursor);
  });

  readonly isLoadingHistory = this._loadingHistory.asReadonly();

  /** Rolls staked across the current network; `null` until first read. */
  readonly totalRolls = computed(() => this._totalRolls()[this.network()] ?? null);

  /** First explorer page is in (always true on buildnet, where history is local only). */
  readonly isHistoryLoaded = computed(
    () => this.network() !== 'mainnet' || this.activeWallet().historyPaging !== null,
  );
  readonly isLoadingDomains = this._loadingDomains.asReadonly();

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

  constructor() {
    // Persist every state change (debounced), but only while unlocked —
    // the cache is encrypted under the session key.
    effect(() => {
      const snapshot = {
        wallets: this._walletsByNetwork(),
        activeWalletId: this._activeWalletId(),
        addressBook: this._addressBook(),
        prices: this._prices(),
      };
      if (!this.auth.isUnlocked() || !snapshot.activeWalletId) return;
      clearTimeout(this.cacheSaveTimer);
      this.cacheSaveTimer = setTimeout(() => {
        this.cache.save(snapshot).catch((err) => console.warn('Wallet cache save failed', err));
      }, CACHE_SAVE_DEBOUNCE_MS);
    });

    // Wallet names follow the vault — covers renames and names restored
    // from an older cache.
    effect(() => {
      const names = new Map(this.auth.accounts().map((a) => [a.id, a.name]));
      untracked(() =>
        this._walletsByNetwork.update((all) => {
          const mainnet = withNames(all.mainnet, names);
          const buildnet = withNames(all.buildnet, names);
          return mainnet === all.mainnet && buildnet === all.buildnet ? all : { mainnet, buildnet };
        }),
      );
    });
  }

  // ---- network & session ---------------------------------------------------

  /** Points every chain call at `network` and reloads all wallets there. */
  setNetwork(network: Network): void {
    if (network === this.network()) return;
    this.networkStore.set(network);
    this.refreshAll();
    this.loadDomains().catch((err) => console.warn('Loading MNS domains failed', err));
    this.loadTotalRolls().catch((err) => console.warn('Loading total rolls failed', err));
  }

  /**
   * Paints the last-known state from the encrypted cache, right after
   * unlock and before the shell renders. Skipped when this session already
   * holds state (a lock → unlock keeps it in memory, and it's newer).
   * Only accounts still in the vault are restored.
   */
  async restoreCache(): Promise<void> {
    const hasState = Object.keys(this._walletsByNetwork().mainnet).length > 0;
    if (hasState) return;
    const snapshot = await this.cache.load();
    if (!snapshot) return;

    const accountIds = new Set(this.auth.accounts().map((a) => a.id));
    const keep = (wallets: Record<string, WalletState>) =>
      Object.fromEntries(Object.entries(wallets).filter(([id]) => accountIds.has(id)));
    this._walletsByNetwork.set({
      mainnet: keep(snapshot.wallets.mainnet),
      buildnet: keep(snapshot.wallets.buildnet),
    });
    if (accountIds.has(snapshot.activeWalletId)) this._activeWalletId.set(snapshot.activeWalletId);
    this._addressBook.set([...snapshot.addressBook]);
    this._prices.set(snapshot.prices);
  }

  /** Background refresh of every wallet on the current network, plus prices. */
  refreshAll(): void {
    for (const id of Object.keys(this.wallets())) this.refreshInBackground(id);
    this.refreshPricesInBackground();
  }

  /**
   * Re-reads USD prices from Dusa, at most every PRICES_REFRESH_MS. A
   * token missing from a read keeps its previous price — an RPC hiccup
   * and "no liquidity" look the same from here, and a flickering price
   * is worse than a one-minute-old one.
   */
  async refreshPrices(): Promise<void> {
    if (this.pricesInFlight || Date.now() - this.pricesFetchedAt < PRICES_REFRESH_MS) return;
    this.pricesInFlight = true;
    try {
      const fresh = await this.dusa.getUsdPrices();
      this._prices.update((prev) => ({ ...prev, ...fresh }));
      this.pricesFetchedAt = Date.now();
    } finally {
      this.pricesInFlight = false;
    }
  }

  /** Drops every wallet, history entry and saved address — used on log out. */
  reset(): void {
    this._walletsByNetwork.set(emptyWallets());
    this._activeWalletId.set('');
    this._addressBook.set([]);
    this._refreshingIds.set(new Set());
    this.historyFetchedAt.clear();
    this.domainsFetchedAt.clear();
    clearTimeout(this.cacheSaveTimer);
    this.cache.clear();
  }

  // ---- wallets -------------------------------------------------------------

  switchWallet(id: string): void {
    if (!this.wallets()[id]) return;
    this._activeWalletId.set(id);
    this.refreshInBackground(id);
  }

  /**
   * Ensures an entry exists for a real account from AuthStore, keyed by
   * the same id — idempotent, safe to call for accounts that already have
   * one. The first wallet registered becomes the active one. Loading its
   * chain data is up to the caller (`switchWallet` / `refreshAll`).
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
  }

  /**
   * Loads the active wallet's MNS domains. Cached values show immediately;
   * the chain is re-read only when they're older than DOMAINS_REFRESH_MS.
   */
  async loadDomains(): Promise<void> {
    const network = this.network();
    const wallet = this.activeWallet();
    const key = `${network}:${wallet.id}`;
    const isFresh = Date.now() - (this.domainsFetchedAt.get(key) ?? 0) < DOMAINS_REFRESH_MS;
    if ((isFresh && wallet.domains) || this._loadingDomains()) return;

    this._loadingDomains.set(true);
    try {
      const domains: MnsDomain[] = await this.provider.getOwnedDomains(wallet.address);
      this.domainsFetchedAt.set(key, Date.now());
      this.updateWallet(wallet.id, (w) => ({ ...w, domains }), network);
    } finally {
      this._loadingDomains.set(false);
    }
  }

  /**
   * Largest amount of `token` the active wallet can send: for MAS the
   * balance minus the network fee, for MRC-20s the whole token balance
   * (their fee is paid in MAS).
   */
  maxSendable(token: TokenSymbol): number {
    const held = this.activeWallet().balances[token] ?? 0;
    return token === 'MAS' ? subtractMas(held, NETWORK_FEE_MAS) : held;
  }

  /** Reads the network's total roll count (for APR), at most every TOTAL_ROLLS_REFRESH_MS. */
  async loadTotalRolls(): Promise<void> {
    const network = this.network();
    if (Date.now() - (this.totalRollsFetchedAt.get(network) ?? 0) < TOTAL_ROLLS_REFRESH_MS) return;
    this.totalRollsFetchedAt.set(network, Date.now());
    try {
      const total = await this.provider.getTotalRolls();
      this._totalRolls.update((all) => ({ ...all, [network]: total }));
    } catch (err) {
      this.totalRollsFetchedAt.delete(network); // retry on the next call
      throw err;
    }
  }

  /**
   * Drops a removed account's state on every network. If it was the active
   * wallet, the first remaining one becomes active and is refreshed.
   */
  removeWallet(id: string): void {
    this._walletsByNetwork.update((all) => {
      const { [id]: _mainnet, ...mainnet } = all.mainnet;
      const { [id]: _buildnet, ...buildnet } = all.buildnet;
      return { mainnet, buildnet };
    });
    for (const network of ['mainnet', 'buildnet'] as const) {
      this.historyFetchedAt.delete(`${network}:${id}`);
      this.domainsFetchedAt.delete(`${network}:${id}`);
    }
    if (this._activeWalletId() === id) {
      const next = Object.keys(this.wallets())[0] ?? '';
      this._activeWalletId.set(next);
      if (next) this.refreshInBackground(next);
    }
  }

  saveAddress(name: string, address: string): void {
    this._addressBook.update((book) => [...book, { name, address }]);
  }

  /** Periodic refresh of the active wallet (driven by MainLayout); skipped while one is in flight. */
  autoRefresh(): void {
    this.refreshPricesInBackground();
    const id = this._activeWalletId();
    if (!id || this._refreshingIds().has(id)) return;
    this.refreshInBackground(id);
  }

  /**
   * Re-reads MAS, every MRC-20 balance and roll counts from the chain,
   * and the history from the explorer (at most every HISTORY_REFRESH_MS).
   * Each read is independent: one that fails (RPC hiccup, bad token
   * contract, explorer down) keeps its previous value instead of failing
   * the rest.
   */
  async refresh(id: string = this._activeWalletId()): Promise<void> {
    const network = this.network();
    const wallet = this.wallets()[id];
    if (!wallet) return;
    const privateKey = this.privateKeyFor(id);
    const tokenList = TOKENS_BY_NETWORK[network];
    const historyKey = `${network}:${id}`;
    const readHistory =
      network === 'mainnet' &&
      Date.now() - (this.historyFetchedAt.get(historyKey) ?? 0) >= HISTORY_REFRESH_MS;

    this._refreshingIds.update((ids) => new Set(ids).add(id));
    try {
      const [[mas, staking], tokens, [history]] = await Promise.all([
        Promise.allSettled([
          // Candidate (not final) balance: already includes operations
          // that are executed but not yet final, so sends show up in
          // seconds instead of after finality.
          this.provider.getBalance(privateKey, false),
          this.provider.getStaking(wallet.address),
        ]),
        Promise.allSettled(
          tokenList.map((t) => this.provider.getTokenBalance(privateKey, t.contract)),
        ),
        Promise.allSettled([readHistory ? this.explorer.getHistory(wallet.address) : null]),
      ]);
      if (history.status === 'fulfilled' && history.value) {
        this.historyFetchedAt.set(historyKey, Date.now());
      }

      const failures = [mas, staking, ...tokens, history].filter((r) => r.status === 'rejected');
      if (failures.length)
        console.warn(`Wallet refresh: ${failures.length} read(s) failed`, failures);

      this.updateWallet(
        id,
        (w) => {
          const balances: TokenBalances = { ...w.balances };
          const rawBalances: Partial<Record<TokenSymbol, string>> = { ...w.rawBalances };
          if (mas.status === 'fulfilled') {
            balances.MAS = fromUnits(mas.value, TOKEN_REGISTRY.MAS.decimals);
            rawBalances.MAS = mas.value.toString();
          }
          tokens.forEach((result, i) => {
            if (result.status !== 'fulfilled') return;
            const { symbol, decimals } = tokenList[i];
            // Sparse: only tokens actually held get a key.
            if (result.value > 0n) {
              balances[symbol] = fromUnits(result.value, decimals);
              rawBalances[symbol] = result.value.toString();
            } else {
              delete balances[symbol];
              delete rawBalances[symbol];
            }
          });
          return {
            ...w,
            balances,
            rawBalances,
            loaded: w.loaded || mas.status === 'fulfilled',
            rolls: staking.status === 'fulfilled' ? staking.value.rolls : w.rolls,
            staking: staking.status === 'fulfilled' ? staking.value.stats : w.staking,
            ...(history.status === 'fulfilled' && history.value
              ? {
                  history: mergeHistory(w.history, history.value.records),
                  // Polling re-reads only the newest page; once paging
                  // exists, older pages already loaded stay as they are.
                  historyPaging: w.historyPaging ?? advancePaging(EMPTY_PAGING, history.value),
                }
              : {}),
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

  // ---- pre-flight checks (the UI runs these before asking to confirm) -------

  /** Throws a user-facing message when the transfer can't go through. */
  validateSend(token: TokenSymbol, toAddress: string, amount: number): void {
    const wallet = this.activeWallet();
    if (!MASSA_ADDRESS.test(toAddress)) throw new Error('Enter a valid Massa address');
    if (toAddress === wallet.address) throw new Error("That's this wallet's own address");
    if (!(amount >= MIN_SEND_AMOUNT)) throw new Error(`Minimum amount is ${MIN_SEND_AMOUNT}`);
    const masHeld = wallet.balances.MAS ?? 0;
    if (token === 'MAS') {
      assertMasForFee(
        masHeld,
        amount,
        `Insufficient balance — ${NETWORK_FEE_MAS} MAS is kept for the network fee`,
      );
    } else {
      if (amount > (wallet.balances[token] ?? 0)) throw new Error('Insufficient balance');
      assertMasForFee(masHeld, 0, `You need ${NETWORK_FEE_MAS} MAS for the network fee`);
    }
    if (toUnits(amount, TOKEN_REGISTRY[token].decimals) === 0n) {
      throw new Error('Amount is too small');
    }
  }

  validateBuyRolls(rollCount: number): void {
    if (!Number.isInteger(rollCount) || rollCount <= 0) {
      throw new Error('Enter a valid amount of rolls');
    }
    assertMasForFee(
      this.activeWallet().balances.MAS ?? 0,
      rollCount * ROLL_PRICE_MAS,
      `Insufficient MAS — ${NETWORK_FEE_MAS} MAS is needed for the network fee`,
    );
  }

  validateSellRolls(rollCount: number): void {
    const wallet = this.activeWallet();
    if (!Number.isInteger(rollCount) || rollCount <= 0) {
      throw new Error('Enter a valid amount of rolls');
    }
    if (rollCount > wallet.rolls.active) throw new Error('Not enough active rolls');
    assertMasForFee(
      wallet.balances.MAS ?? 0,
      0,
      `You need ${NETWORK_FEE_MAS} MAS for the network fee`,
    );
  }

  /**
   * Swap checks: Dusa is mainnet-only; the router takes a 0.1 MAS storage
   * deposit on top of the network fee — plus a second fee for the token
   * approval when the input isn't MAS.
   */
  validateSwap(from: TokenSymbol, to: TokenSymbol, amount: number): void {
    if (this.network() !== 'mainnet') throw new Error('Swaps are available on Mainnet only');
    if (from === to) throw new Error('Choose two different tokens');
    if (!(amount > 0)) throw new Error('Enter an amount');
    const balances = this.activeWallet().balances;
    const masHeld = balances.MAS ?? 0;
    if (from === 'MAS') {
      assertMasForFee(
        masHeld,
        amount + SWAP_STORAGE_COST_MAS,
        `Insufficient MAS — keep ${SWAP_STORAGE_COST_MAS} MAS for the swap deposit plus the fee`,
      );
    } else {
      if (amount > (balances[from] ?? 0)) throw new Error(`Insufficient ${from}`);
      assertMasForFee(
        masHeld,
        SWAP_STORAGE_COST_MAS + NETWORK_FEE_MAS,
        `You need ${SWAP_STORAGE_COST_MAS + 2 * NETWORK_FEE_MAS} MAS for the swap deposit and fees`,
      );
    }
  }

  /** Largest `from` amount a swap can spend (MAS keeps back the deposit and fee). */
  maxSwappable(from: TokenSymbol): number {
    const held = this.activeWallet().balances[from] ?? 0;
    return from === 'MAS' ? subtractMas(held, SWAP_STORAGE_COST_MAS + NETWORK_FEE_MAS) : held;
  }

  quoteSwap(
    from: TokenSymbol,
    to: TokenSymbol,
    amount: number,
    slippageBps: number,
  ): Promise<SwapQuote> {
    return this.dusaSwap.quote(from, to, this.spendableUnits(from, amount), slippageBps);
  }

  /**
   * `amount` in smallest units, never above what's actually held. The
   * displayed balance is a float: for an 18-decimal token, Max can come out
   * a few units above the real on-chain balance once converted back (e.g.
   * 0.999797356704804 DAI → …804000 units vs …803912 held), and the token
   * contract rejects that with "insufficient funds". Validation has already
   * checked `amount` against the displayed balance, so anything above the
   * exact balance is only that rounding — clamp it.
   */
  private spendableUnits(token: TokenSymbol, amount: number): bigint {
    const units = toUnits(amount, TOKEN_REGISTRY[token].decimals);
    const raw = this.activeWallet().rawBalances[token];
    const held = raw !== undefined ? BigInt(raw) : null;
    return held !== null && units > held ? held : units;
  }

  // ---- transactions --------------------------------------------------------

  /*
   * Write flow — nothing on screen is ever guessed. The provider resolves
   * only after the chain executed the operation successfully; only then is
   * it added to the history, and balances/rolls are re-read from the chain
   * before the call returns. A failed or unconfirmed operation changes
   * nothing locally (the chain is re-read anyway in case it went through).
   */

  async send(
    token: TokenSymbol,
    toAddress: string,
    amount: number,
  ): Promise<{ internal: boolean }> {
    const network = this.network();
    const wallet = this.activeWallet();
    this.validateSend(token, toAddress, amount);
    const meta = TOKEN_REGISTRY[token];
    const units = this.spendableUnits(token, amount);
    const targetId = this.walletList().find(
      (w) => w.address === toAddress && w.id !== wallet.id,
    )?.id;
    const touched = targetId ? [wallet.id, targetId] : [wallet.id];

    const privateKey = this.privateKeyFor(wallet.id);
    const { operationId } = await this.afterWrite(touched, network, () =>
      meta.isErc20
        ? this.provider.transferToken(privateKey, meta.contract, toAddress, units)
        : this.provider.transferMas(privateKey, toAddress, units),
    );

    const details = { token, amount, from: wallet.address, to: toAddress, operationId };
    this.addHistory(
      wallet.id,
      { type: 'send', counterparty: shortAddress(toAddress), ...details },
      network,
    );
    if (targetId) {
      this.addHistory(
        targetId,
        { type: 'receive', counterparty: shortAddress(wallet.address), ...details },
        network,
      );
    }
    await this.refreshTouched(touched, network);
    return { internal: !!targetId };
  }

  async buyRolls(rollCount: number): Promise<void> {
    const network = this.network();
    const wallet = this.activeWallet();
    this.validateBuyRolls(rollCount);

    const { operationId } = await this.afterWrite([wallet.id], network, () =>
      this.provider.buyRolls(this.privateKeyFor(wallet.id), BigInt(rollCount)),
    );
    this.addHistory(
      wallet.id,
      {
        type: 'buy_rolls',
        token: 'MAS',
        amount: rollCount * ROLL_PRICE_MAS,
        rollCount,
        operationId,
        from: wallet.address,
      },
      network,
    );
    await this.refreshTouched([wallet.id], network);
  }

  async sellRolls(rollCount: number): Promise<void> {
    const network = this.network();
    const wallet = this.activeWallet();
    this.validateSellRolls(rollCount);

    const { operationId } = await this.afterWrite([wallet.id], network, () =>
      this.provider.sellRolls(this.privateKeyFor(wallet.id), BigInt(rollCount)),
    );
    this.addHistory(
      wallet.id,
      {
        type: 'sell_rolls',
        token: 'MAS',
        amount: rollCount * ROLL_PRICE_MAS,
        rollCount,
        operationId,
        from: wallet.address,
      },
      network,
    );
    await this.refreshTouched([wallet.id], network);
  }

  /**
   * Executes a Dusa swap quoted by `quoteSwap`. The router enforces the
   * quote's minimum output, so a price that moved beyond the slippage
   * tolerance makes the swap fail on-chain instead of filling badly.
   */
  async swap(q: SwapQuote): Promise<void> {
    const network = this.network();
    const wallet = this.activeWallet();
    const amount = fromUnits(q.amountIn, TOKEN_REGISTRY[q.from].decimals);
    this.validateSwap(q.from, q.to, amount);

    const { operationId } = await this.afterWrite([wallet.id], network, () =>
      this.dusaSwap.execute(this.privateKeyFor(wallet.id), q),
    );
    this.addHistory(
      wallet.id,
      {
        type: 'swap',
        token: q.from,
        toToken: q.to,
        amount,
        // Quoted output — the exact fill is within the slippage tolerance.
        received: fromUnits(q.amountOut, TOKEN_REGISTRY[q.to].decimals),
        operationId,
        from: wallet.address,
        counterparty: 'Dusa',
      },
      network,
    );
    await this.refreshTouched([wallet.id], network);
  }

  // ---- internal helpers ----------------------------------------------------

  private refreshPricesInBackground(): void {
    this.refreshPrices().catch((err) => console.warn('Dusa price refresh failed', err));
  }

  /** Fire-and-forget `refresh` — logs instead of leaving an unhandled rejection. */
  private refreshInBackground(id: string): void {
    this.refresh(id).catch((err) => console.warn(`Wallet refresh failed for "${id}"`, err));
  }

  /**
   * Loads the next explorer page — only for the stream(s) currently
   * limiting `visibleHistory`; the other one already reaches further back.
   */
  async loadMoreHistory(): Promise<void> {
    const network = this.network();
    const wallet = this.activeWallet();
    const paging = wallet.historyPaging;
    if (!paging || this._loadingHistory()) return;

    const cutoff = historyCutoff(paging);
    const cursors: Partial<Record<HistoryStream, string>> = {};
    for (const s of HISTORY_STREAMS) {
      const { cursor, oldest } = paging[s];
      if (cursor && oldest >= cutoff) cursors[s] = cursor;
    }
    if (!Object.keys(cursors).length) return;

    this._loadingHistory.set(true);
    try {
      const page = await this.explorer.getHistory(wallet.address, cursors);
      this.updateWallet(
        wallet.id,
        (w) => ({
          ...w,
          history: mergeHistory(w.history, page.records),
          historyPaging: w.historyPaging && advancePaging(w.historyPaging, page),
        }),
        network,
      );
    } finally {
      this._loadingHistory.set(false);
    }
  }

  /**
   * Runs a write; if it fails or times out, re-reads the touched wallets in
   * the background (a timed-out operation may still have gone through)
   * and rethrows — the local state is never changed on a failure.
   */
  private async afterWrite<T>(
    ids: string[],
    network: Network,
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (err) {
      this.refreshTouched(ids, network).catch(() => undefined);
      throw err;
    }
  }

  /** Forces a fresh chain + explorer read of the given wallets (if still on `network`). */
  private async refreshTouched(ids: string[], network: Network): Promise<void> {
    if (this.network() !== network) return;
    for (const id of ids) this.historyFetchedAt.delete(`${network}:${id}`);
    await Promise.allSettled(ids.map((id) => this.refresh(id)));
  }

  private addHistory(
    id: string,
    partial: Omit<TransactionRecord, 'id' | 'timestamp'>,
    network: Network,
  ): void {
    this.updateWallet(
      id,
      (w) => ({ ...w, history: [this.record(partial, network), ...w.history] }),
      network,
    );
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

  /**
   * A record for an operation this app sent and the chain has already
   * executed (never for a merely submitted one). On mainnet it shows as
   * pending — executed, not yet final/indexed — until the explorer
   * reports it; buildnet has no explorer, so there it carries no status.
   */
  private record(
    partial: Omit<TransactionRecord, 'id' | 'timestamp'>,
    network: Network,
  ): TransactionRecord {
    return {
      id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      local: true,
      status: network === 'mainnet' ? 'pending' : undefined,
      ...partial,
    };
  }
}
