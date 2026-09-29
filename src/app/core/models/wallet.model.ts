import { TokenBalances, TokenSymbol } from './token.model';
import { MnsDomain } from './nft.model';
import { HistoryPaging, TransactionRecord } from './transaction.model';

export interface RollsState {
  readonly active: number;
  readonly candidate: number;
  readonly deferred: number;
}

/**
 * Block-production view of staking, summed over the recent cycles the node
 * reports (the current one included).
 */
export interface StakingStats {
  /** Rolls counted in the current cycle's draw — 0 until bought rolls activate (3 cycles). */
  readonly activeRolls: number;
  /** Slots (blocks + endorsements) produced / missed. Misses mean the staking node was offline. */
  readonly produced: number;
  readonly missed: number;
  /** Upcoming slots this address has been drawn for. */
  readonly nextBlockDraws: number;
  readonly nextEndorsementDraws: number;
}

export interface WalletState {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  /** False until balances/rolls have been read from the chain once — the UI shows a placeholder, not 0. */
  readonly loaded: boolean;
  /** Human-readable amounts for display and checks (a JS number: ~16 significant digits). */
  readonly balances: TokenBalances;
  /**
   * The exact on-chain balances in smallest units, as decimal strings (so they
   * survive JSON caching). `balances` can't hold 18-decimal precision — a
   * Max amount rounded up in the last digits would exceed what's held — so
   * spends are clamped against these (see WalletStore.spendableUnits).
   */
  readonly rawBalances: Partial<Record<TokenSymbol, string>>;
  readonly rolls: RollsState;
  /** `null` until first read from the chain. */
  readonly staking: StakingStats | null;
  readonly history: readonly TransactionRecord[];
  /** Explorer pagination; `null` until the first page is loaded (always, on buildnet). */
  readonly historyPaging: HistoryPaging | null;
  /** MNS domains owned by this address; `null` until first loaded. */
  readonly domains: readonly MnsDomain[] | null;
}
