import { TokenBalances } from './token.model';
import { HistoryPaging, TransactionRecord } from './transaction.model';

export interface RollsState {
  readonly active: number;
  readonly candidate: number;
  readonly deferred: number;
}

export interface WalletState {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly balances: TokenBalances;
  readonly rolls: RollsState;
  readonly history: readonly TransactionRecord[];
  /** Explorer pagination; `null` until the first page is loaded (always, on buildnet). */
  readonly historyPaging: HistoryPaging | null;
}
