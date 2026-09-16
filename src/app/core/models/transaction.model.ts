import { TokenSymbol } from './token.model';

export type TransactionType = 'send' | 'receive' | 'swap' | 'buy_rolls' | 'sell_rolls' | 'reward';

export interface TransactionRecord {
  readonly id: string;
  readonly type: TransactionType;
  readonly token: TokenSymbol;
  readonly amount: number;
  readonly timestamp: number;
  /** Set for 'swap' transactions. */
  readonly toToken?: TokenSymbol;
  readonly received?: number;
  /** Truncated counterparty address, for send/receive. */
  readonly counterparty?: string;
  /** Number of rolls, for buy_rolls/sell_rolls. */
  readonly rollCount?: number;
  /** On-chain operation id returned by the provider (mocked here). */
  readonly operationId?: string;
}
