import { NftItem } from './nft.model';
import { TokenBalances } from './token.model';
import { TransactionRecord } from './transaction.model';

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
  readonly nfts: readonly NftItem[];
}
