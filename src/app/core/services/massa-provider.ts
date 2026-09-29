import { InjectionToken } from '@angular/core';
import { MnsDomain } from '../models/nft.model';
import { RollsState, StakingStats } from '../models/wallet.model';

/** Fixed by the Massa network config — one roll always costs 100 MAS. */
export const ROLL_PRICE_MAS = 100;

/**
 * Fee paid (in MAS) by every operation this wallet sends — MAS transfers,
 * MRC-20 transfers (smart contract calls) and roll buys/sells alike.
 */
export const NETWORK_FEE_MAS = 0.01;

export interface StakingInfo {
  readonly rolls: RollsState;
  readonly stats: StakingStats;
}

export interface OperationResult {
  readonly operationId: string;
}

export interface GeneratedAccount {
  readonly privateKey: string;
  readonly address: string;
}

/**
 * Adapter boundary between the app and the Massa blockchain.
 *
 * Amounts here are `bigint`, in each token's smallest unit (nanoMAS for
 * MAS — 9 decimals; each MRC-20's own `decimals` from TOKEN_REGISTRY
 * otherwise) — exactly what massa-web3 itself deals in. Conversion
 * to/from human-readable `number` values happens in WalletStore (see
 * `toUnits`/`fromUnits` in utils/token-amount.ts), never inside this
 * interface or its implementations.
 *
 * Write methods take a raw `privateKey` rather than a massa-web3
 * `Account` object, so no massa-web3 type ever has to leak past this
 * file into the rest of the app — the real implementation derives an
 * `Account` from it internally (`Account.fromPrivateKey`).
 *
 * Write methods resolve only once the chain has actually executed the
 * operation successfully — never on mere submission — so callers can
 * treat a resolved promise as "it happened". Otherwise they reject with
 * OperationFailedError (executed, but failed) or OperationTimeoutError
 * (not seen in time — it may still go through).
 */
export interface MassaProvider {
  // ---- wallet ---------------------------------------------------------
  generateAccount(): Promise<GeneratedAccount>;
  /** Resolves the address for a private key, or `null` if it isn't valid. */
  resolveAddress(privateKey: string): Promise<string | null>;

  // ---- native MAS -------------------------------------------------------
  getBalance(privateKey: string, isFinal?: boolean): Promise<bigint>;
  transferMas(privateKey: string, toAddress: string, amount: bigint): Promise<OperationResult>;

  // ---- MRC-20 tokens ------------------------------------------------------
  getTokenBalance(privateKey: string, contractAddress: string): Promise<bigint>;
  transferToken(
    privateKey: string,
    contractAddress: string,
    toAddress: string,
    amount: bigint,
  ): Promise<OperationResult>;

  // ---- rolls (staking) ----------------------------------------------------
  /** Roll counts plus block-production stats, from one address-info read. */
  getStaking(address: string): Promise<StakingInfo>;
  /** Rolls staked across the whole network (sum over all stakers). */
  getTotalRolls(): Promise<number>;
  buyRolls(privateKey: string, rollCount: bigint): Promise<OperationResult>;
  sellRolls(privateKey: string, rollCount: bigint): Promise<OperationResult>;

  // ---- Massa Name System ----------------------------------------------------
  /** Domains owned by `address`, each with the address it resolves to. */
  getOwnedDomains(address: string): Promise<MnsDomain[]>;
}

/** The chain executed the operation and it failed — nothing changed except the fee. */
export class OperationFailedError extends Error {
  constructor(
    readonly operationId: string,
    reason: string,
  ) {
    super(`Transaction failed: ${reason}`);
  }
}

/** The operation wasn't seen executing in time; it may still go through later. */
export class OperationTimeoutError extends Error {
  constructor(readonly operationId: string) {
    super('Not confirmed yet — it may still go through. Check History in a minute.');
  }
}

export const MASSA_PROVIDER = new InjectionToken<MassaProvider>('MASSA_PROVIDER');
