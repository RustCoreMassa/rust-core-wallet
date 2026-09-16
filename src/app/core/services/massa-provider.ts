import { InjectionToken } from '@angular/core';
import { TokenSymbol } from '../models/token.model';

export interface RollCounts {
  readonly active: number;
  readonly candidate: number;
  readonly deferred: number;
}

export interface OperationResult {
  readonly operationId: string;
}

export interface TransferParams {
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly token: TokenSymbol;
  readonly amount: number;
}

export interface SwapParams {
  readonly address: string;
  readonly fromToken: TokenSymbol;
  readonly toToken: TokenSymbol;
  readonly amount: number;
}

export interface RollOperationParams {
  readonly address: string;
  readonly rollCount: number;
}

/**
 * Adapter boundary between the app and the Massa blockchain.
 *
 * Every method is async because every real implementation talks to a node
 * over JSON-RPC (balance reads) or submits/awaits a smart-contract
 * operation (transfers, swaps, roll buy/sell). The rest of the app only
 * ever depends on this interface — never on a concrete SDK — so the mock
 * implementation used for this demo can be swapped for one backed by
 * `@massalabs/massa-web3` (JsonRpcProvider / Account / smart-contract
 * calls) without touching a single component or the store.
 */
export interface MassaProvider {
  getBalance(address: string, token: TokenSymbol): Promise<number>;
  getRolls(address: string): Promise<RollCounts>;
  transfer(params: TransferParams): Promise<OperationResult>;
  swap(params: SwapParams): Promise<OperationResult & { received: number }>;
  buyRolls(params: RollOperationParams): Promise<OperationResult>;
  sellRolls(params: RollOperationParams): Promise<OperationResult>;
  generateWalletAddress(): Promise<string>;
}

export const MASSA_PROVIDER = new InjectionToken<MassaProvider>('MASSA_PROVIDER');
