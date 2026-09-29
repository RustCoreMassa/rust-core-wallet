import { InjectionToken } from '@angular/core';
import { MnsDomain } from '../models/nft.model';

/** Fixed by the Massa network config — one roll always costs 100 MAS. */
export const ROLL_PRICE_MAS = 100;

/**
 * Fee paid (in MAS) by every operation this wallet sends — MAS transfers,
 * MRC-20 transfers (smart contract calls) and roll buys/sells alike.
 */
export const NETWORK_FEE_MAS = 0.01;

/**
 * `active` is the final roll count. `candidate` is only the pending
 * delta on top of it (rolls bought but not yet final), and `deferred`
 * is rolls sold whose MAS refund hasn't been credited yet — so
 * `active + candidate + deferred` is everything currently locked.
 */
export interface RollCounts {
  readonly active: number;
  readonly candidate: number;
  readonly deferred: number;
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
 * to/from human-readable `number` values happens at the UI edge (see
 * the `Mas`/token amount helpers), never inside this interface or its
 * implementations.
 *
 * Write methods take a raw `privateKey` rather than a massa-web3
 * `Account` object, so no massa-web3 type ever has to leak past this
 * file into the rest of the app — the real implementation derives an
 * `Account` from it internally (`Account.fromPrivateKey`), same as the
 * reference MassaService does.
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
  getRolls(address: string): Promise<RollCounts>;
  buyRolls(privateKey: string, rollCount: bigint): Promise<OperationResult>;
  sellRolls(privateKey: string, rollCount: bigint): Promise<OperationResult>;

  // ---- Massa Name System ----------------------------------------------------
  /** Domains owned by `address`, each with the address it resolves to. */
  getOwnedDomains(address: string): Promise<MnsDomain[]>;
}

export const MASSA_PROVIDER = new InjectionToken<MassaProvider>('MASSA_PROVIDER');
