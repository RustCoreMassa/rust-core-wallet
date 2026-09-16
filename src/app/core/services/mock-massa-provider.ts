import { Injectable } from '@angular/core';
import { TokenSymbol } from '../models/token.model';
import {
  MassaProvider,
  OperationResult,
  RollCounts,
  RollOperationParams,
  SwapParams,
  TransferParams,
} from './massa-provider';

export const ROLL_PRICE_MAS = 100;
const NETWORK_LATENCY_MS = 650;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const randomOperationId = () =>
  'O' + Array.from({ length: 44 }, () => Math.floor(Math.random() * 36).toString(36)).join('');

/**
 * In-memory stand-in for a real `@massalabs/massa-web3` backed provider.
 *
 * Every method mirrors the shape a production implementation would have:
 * it awaits a simulated network round trip and, for write operations,
 * resolves with an on-chain operation id — exactly what a real node
 * returns before the operation is finalized. Swapping this for a real
 * implementation is a one-line change in `app.config.ts`:
 *
 *   { provide: MASSA_PROVIDER, useClass: Web3MassaProvider }
 *
 * A production `Web3MassaProvider` would wrap `@massalabs/massa-web3`
 * roughly like this:
 *
 *   const provider = JsonRpcProvider.mainnet();
 *   const balance = await provider.balanceOf(address);          // read
 *   const op = await provider.transfer({ to, amount });         // write
 *   await op.waitSpeculativeExecution();                        // confirm
 *
 * The store never talks to the SDK directly — only to this interface —
 * so none of that detail leaks outside this file.
 */
@Injectable({ providedIn: 'root' })
export class MockMassaProvider implements MassaProvider {
  async getBalance(_address: string, _token: TokenSymbol): Promise<number> {
    await wait(NETWORK_LATENCY_MS);
    // The demo keeps balances client-side in WalletStore; a real provider
    // would be the single source of truth and this call would return it.
    return 0;
  }

  async getRolls(_address: string): Promise<RollCounts> {
    await wait(NETWORK_LATENCY_MS);
    return { active: 0, candidate: 0, deferred: 0 };
  }

  async transfer(_params: TransferParams): Promise<OperationResult> {
    await wait(NETWORK_LATENCY_MS);
    return { operationId: randomOperationId() };
  }

  async swap(params: SwapParams): Promise<OperationResult & { received: number }> {
    await wait(NETWORK_LATENCY_MS + 150);
    return { operationId: randomOperationId(), received: 0 };
  }

  async buyRolls(_params: RollOperationParams): Promise<OperationResult> {
    await wait(NETWORK_LATENCY_MS);
    return { operationId: randomOperationId() };
  }

  async sellRolls(_params: RollOperationParams): Promise<OperationResult> {
    await wait(NETWORK_LATENCY_MS);
    return { operationId: randomOperationId() };
  }

  async generateWalletAddress(): Promise<string> {
    await wait(200);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const body = Array.from(
      { length: 42 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join('');
    return 'AU' + body;
  }
}
