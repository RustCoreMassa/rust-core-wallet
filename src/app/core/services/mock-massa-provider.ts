import { Injectable } from '@angular/core';
import { TokenSymbol } from '../models/token.model';
import {
  GeneratedAccount,
  MassaProvider,
  OperationResult,
  RollCounts,
  RollOperationParams,
  SwapParams,
  TransferParams,
} from './massa-provider';

export const ROLL_PRICE_MAS = 100;
const NETWORK_LATENCY_MS = 650;
const ADDRESS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Real Massa secret keys are versioned/base58check-encoded and start
// with "S1"; the mock only checks the shape, not real cryptography.
const PRIVATE_KEY_PATTERN = /^S1[A-Za-z0-9]{40,60}$/;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const randomOperationId = () =>
  'O' + Array.from({ length: 44 }, () => Math.floor(Math.random() * 36).toString(36)).join('');

const randomAddressBody = () =>
  Array.from(
    { length: 42 },
    () => ADDRESS_ALPHABET[Math.floor(Math.random() * ADDRESS_ALPHABET.length)],
  ).join('');

const randomPrivateKey = () =>
  'S1' +
  Array.from(
    { length: 48 },
    () => ADDRESS_ALPHABET[Math.floor(Math.random() * ADDRESS_ALPHABET.length)],
  ).join('');

/** Deterministic (same key → same address) so re-importing a key is stable. */
function deriveAddressFromKey(privateKey: string): string {
  let seed = 0;
  for (let i = 0; i < privateKey.length; i++) seed += privateKey.charCodeAt(i) * (i * 7 + 3);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const body = Array.from(
    { length: 42 },
    () => ADDRESS_ALPHABET[Math.floor(rand() * ADDRESS_ALPHABET.length)],
  ).join('');
  return 'AU' + body;
}

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
    return 'AU' + randomAddressBody();
  }

  async generateAccount(): Promise<GeneratedAccount> {
    await wait(300);
    const privateKey = randomPrivateKey();
    return { privateKey, address: deriveAddressFromKey(privateKey) };
  }

  async resolveAddress(privateKey: string): Promise<string | null> {
    await wait(NETWORK_LATENCY_MS);
    if (!PRIVATE_KEY_PATTERN.test(privateKey.trim())) return null;
    return deriveAddressFromKey(privateKey.trim());
  }
}
