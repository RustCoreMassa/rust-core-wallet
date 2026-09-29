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

/** How long auto-refresh leaves a wallet alone after a write (see `autoRefresh`). */
const WRITE_SETTLE_MS = 8000;

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
    rolls: { active: 0, candidate: 0, deferred: 0 },
    history: [],
    historyPaging: null,
    domains: null,
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
  // Sends only: a contract call's payouts share its operation id and
  // would otherwise shadow the send record in this map.
  const knownSends = new Map(
    existing.filter((r) => r.type === 'send').map((r) => [r.operationId, r]),
  );
  const incomingOps = new Set(incoming.map((r) => r.operationId));

  const byId = new Map<string, TransactionRecord>();
  for (const r of existing) {
    const settled = incomingOps.has(r.operationId) || Date.now() - r.timestamp > PENDING_TTL_MS;
    if (!(r.local && settled)) byId.set(r.id, r);
  }
  for (const r of incoming) {
    const mine = knownSends.get(r.operationId);
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
 * reconciles. History comes from the Massa explorer API (mainnet only),
 * paged by cursor (`loadMoreHistory`) and merged with operations just
 * sent from this app that it hasn't indexed yet (see `mergeHistory`);
 * on buildnet it is local only. Prices are not wired to any source yet.
 *
 * The whole state (minus private keys, which never live here) is cached
 * encrypted in localStorage via WalletCache: `restoreCache` paints the
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

  private readonly _walletsByNetwork = signal<WalletsByNetwork>(emptyWallets());
  private readonly _activeWalletId = signal<string>('');
  private readonly _addressBook = signal<SavedAddress[]>([]);
  private readonly _prices = signal<TokenPrices>(DEMO_PRICES);
  private readonly _dayChangePct = signal<TokenPrices>(DEMO_DAY_CHANGE_PCT);
  private readonly _refreshingIds = signal<ReadonlySet<string>>(new Set());
  private readonly _loadingHistory = signal(false);
  private readonly _loadingDomains = signal(false);
  /** Per wallet id: auto-refresh is skipped until this timestamp. */
  private readonly settleUntil = new Map<string, number>();
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
  readonly dayChangePct = this._dayChangePct.asReadonly();

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
  }

  /** Background refresh of every wallet on the current network. */
  refreshAll(): void {
    for (const id of Object.keys(this.wallets())) this.refreshInBackground(id);
  }

  /** Drops every wallet, history entry and saved address — used on log out. */
  reset(): void {
    this._walletsByNetwork.set(emptyWallets());
    this._activeWalletId.set('');
    this._addressBook.set([]);
    this._refreshingIds.set(new Set());
    this.settleUntil.clear();
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

  saveAddress(name: string, address: string): void {
    this._addressBook.update((book) => [...book, { name, address }]);
  }

  /**
   * Periodic refresh of the active wallet (driven by MainLayout). Skipped
   * while a refresh is already in flight, and for a few seconds after a
   * write — a read that races the operation's inclusion would otherwise
   * overwrite the optimistic balance with the stale pre-write one.
   */
  autoRefresh(): void {
    const id = this._activeWalletId();
    if (!id || this._refreshingIds().has(id)) return;
    if (Date.now() < (this.settleUntil.get(id) ?? 0)) return;
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
      const [[mas, rolls], tokens, [history]] = await Promise.all([
        Promise.allSettled([
          // Candidate (not final) balance: already includes operations
          // that are executed but not yet final, so sends show up in
          // seconds instead of after finality.
          this.provider.getBalance(privateKey, false),
          this.provider.getRolls(wallet.address),
        ]),
        Promise.allSettled(
          tokenList.map((t) => this.provider.getTokenBalance(privateKey, t.contract)),
        ),
        Promise.allSettled([readHistory ? this.explorer.getHistory(wallet.address) : null]),
      ]);
      if (history.status === 'fulfilled' && history.value) {
        this.historyFetchedAt.set(historyKey, Date.now());
      }

      const failures = [mas, rolls, ...tokens, history].filter((r) => r.status === 'rejected');
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
            loaded: w.loaded || mas.status === 'fulfilled',
            rolls: rolls.status === 'fulfilled' ? rolls.value : w.rolls,
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

  // ---- transactions --------------------------------------------------------

  async send(
    token: TokenSymbol,
    toAddress: string,
    amount: number,
  ): Promise<{ internal: boolean }> {
    const network = this.network();
    const wallet = this.activeWallet();
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
        balances: adjust(adjust(w.balances, token, -amount), 'MAS', -NETWORK_FEE_MAS),
        history: [
          this.record(
            {
              type: 'send',
              token,
              amount,
              counterparty: shortAddress(toAddress),
              from: wallet.address,
              to: toAddress,
              operationId,
            },
            network,
          ),
          ...w.history,
        ],
      }),
      network,
    );

    this.markWritten(wallet.id);

    const targetId = this.walletList().find(
      (w) => w.address === toAddress && w.id !== wallet.id,
    )?.id;
    if (targetId) {
      this.markWritten(targetId);
      this.updateWallet(
        targetId,
        (w) => ({
          ...w,
          balances: adjust(w.balances, token, amount),
          history: [
            this.record(
              {
                type: 'receive',
                token,
                amount,
                counterparty: shortAddress(wallet.address),
                from: wallet.address,
                to: toAddress,
                operationId,
              },
              network,
            ),
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
    assertMasForFee(
      wallet.balances.MAS ?? 0,
      cost,
      `Insufficient MAS — ${NETWORK_FEE_MAS} MAS is needed for the network fee`,
    );

    const { operationId } = await this.provider.buyRolls(
      this.privateKeyFor(wallet.id),
      BigInt(rollCount),
    );

    this.markWritten(wallet.id);
    // Bought rolls stay candidate until final; `refresh` picks that up.
    this.updateWallet(
      wallet.id,
      (w) => ({
        ...w,
        balances: adjust(w.balances, 'MAS', -(cost + NETWORK_FEE_MAS)),
        rolls: { ...w.rolls, candidate: w.rolls.candidate + rollCount },
        history: [
          this.record(
            {
              type: 'buy_rolls',
              token: 'MAS',
              amount: cost,
              rollCount,
              operationId,
              from: wallet.address,
            },
            network,
          ),
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
    assertMasForFee(
      wallet.balances.MAS ?? 0,
      0,
      `You need ${NETWORK_FEE_MAS} MAS for the network fee`,
    );

    const { operationId } = await this.provider.sellRolls(
      this.privateKeyFor(wallet.id),
      BigInt(rollCount),
    );
    const refund = rollCount * ROLL_PRICE_MAS;
    this.markWritten(wallet.id);

    // The MAS refund is a deferred credit, paid out by the chain a few
    // cycles later — `refresh` picks it up, nothing is credited here.
    this.updateWallet(
      wallet.id,
      (w) => ({
        ...w,
        balances: adjust(w.balances, 'MAS', -NETWORK_FEE_MAS),
        rolls: {
          ...w.rolls,
          active: w.rolls.active - rollCount,
          deferred: w.rolls.deferred + rollCount,
        },
        history: [
          this.record(
            {
              type: 'sell_rolls',
              token: 'MAS',
              amount: refund,
              rollCount,
              operationId,
              from: wallet.address,
            },
            network,
          ),
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

  /** Holds off auto-refresh briefly, then forces a fresh history read. */
  private markWritten(id: string): void {
    this.settleUntil.set(id, Date.now() + WRITE_SETTLE_MS);
    this.historyFetchedAt.delete(`${this.network()}:${id}`);
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
   * A record for an operation just sent from this app. On mainnet it
   * shows as pending until the explorer reports it; buildnet has no
   * explorer, so there it carries no status at all.
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
