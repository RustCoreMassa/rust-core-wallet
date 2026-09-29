import { TokenSymbol } from './token.model';

export type TransactionType =
  | 'send'
  | 'receive'
  | 'swap'
  | 'buy_rolls'
  | 'sell_rolls'
  | 'reward'
  | 'contract_call';

/**
 * `pending` — sent from this app, not yet seen by the explorer;
 * `failed` — included on chain but its execution failed.
 */
export type TransactionStatus = 'pending' | 'final' | 'failed';

export interface TransactionRecord {
  readonly id: string;
  readonly type: TransactionType;
  readonly token: TokenSymbol;
  readonly amount: number;
  readonly timestamp: number;
  readonly status?: TransactionStatus;
  /** Recorded by this app when sent; replaced once the explorer reports it. */
  readonly local?: boolean;
  /** Network fee paid, in MAS — only for operations this address created. */
  readonly fee?: number;
  /** Set for 'swap' transactions. */
  readonly toToken?: TokenSymbol;
  readonly received?: number;
  /** Truncated counterparty address (or a token name for known contracts). */
  readonly counterparty?: string;
  /** Full sender / recipient addresses, for the details view. */
  readonly from?: string;
  readonly to?: string;
  /** Number of rolls, for buy_rolls/sell_rolls. */
  readonly rollCount?: number;
  /**
   * On-chain operation id. Several records can share one: a smart
   * contract call and the transfers it generated back to this address.
   */
  readonly operationId?: string;
}

/** The explorer pages operations this address created and received separately. */
export type HistoryStream = 'created' | 'received';

export interface HistoryStreamState {
  /** Opaque explorer cursor for the next page; `null` once fully loaded. */
  readonly cursor: string | null;
  /** Oldest block time (ms) loaded so far from this stream. */
  readonly oldest: number;
}

export type HistoryPaging = Readonly<Record<HistoryStream, HistoryStreamState>>;
