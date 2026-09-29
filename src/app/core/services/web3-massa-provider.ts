import { Injectable, inject } from '@angular/core';
import {
  Account,
  JsonRpcPublicProvider,
  MRC20,
  Mas,
  Web3Provider,
  rpcTypes,
} from '@massalabs/massa-web3';
import { NetworkStore } from '../state/network-store';
import {
  GeneratedAccount,
  MassaProvider,
  OperationResult,
  ROLL_PRICE_MAS,
  RollCounts,
} from './massa-provider';

/**
 * Real implementation backed by `@massalabs/massa-web3`, bound to
 * MASSA_PROVIDER in app.config.ts.
 *
 * Every write method re-derives an `Account` from the raw private key
 * and opens a fresh `Web3Provider` for that one call, on whichever
 * network NetworkStore currently points at — no key or provider is
 * ever cached across calls, so a network switch applies immediately.
 *
 * `getRolls` needs no key: roll counts aren't on the `Provider` wrapper,
 * so it goes through the raw JSON-RPC client (`getAddressInfo`) of a
 * keyless `JsonRpcPublicProvider` — `Web3Provider` is itself just an
 * alias of `JsonRpcProvider`, which wraps the same client.
 */
@Injectable({ providedIn: 'root' })
export class Web3MassaProvider implements MassaProvider {
  private readonly networkStore = inject(NetworkStore);

  async generateAccount(): Promise<GeneratedAccount> {
    const account = await Account.generate();
    return {
      privateKey: account.privateKey.toString(),
      address: account.address.toString(),
    };
  }

  async resolveAddress(privateKey: string): Promise<string | null> {
    try {
      const account = await Account.fromPrivateKey(privateKey);
      return account.address.toString();
    } catch {
      return null;
    }
  }

  async getBalance(privateKey: string, isFinal = true): Promise<bigint> {
    const provider = await this.providerFor(privateKey);
    return provider.balance(isFinal);
  }

  async transferMas(
    privateKey: string,
    toAddress: string,
    amount: bigint,
  ): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    const operation = await provider.transfer(toAddress, amount);
    return { operationId: operation.id };
  }

  async getTokenBalance(privateKey: string, contractAddress: string): Promise<bigint> {
    const provider = await this.providerFor(privateKey);
    const token = new MRC20(provider, contractAddress);
    return token.balanceOf(provider.address);
  }

  async transferToken(
    privateKey: string,
    contractAddress: string,
    toAddress: string,
    amount: bigint,
  ): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    const token = new MRC20(provider, contractAddress);
    const operation = await token.transfer(toAddress, amount);
    return { operationId: operation.id };
  }

  async getRolls(address: string): Promise<RollCounts> {
    // Explicit type: massa-web3's own publicAPI.d.ts imports its RPC types
    // from an unresolvable 'src/generated/' path, so they arrive as `any`.
    const info: rpcTypes.AddressInfo =
      await this.publicProvider().client.getAddressInfo(address);
    // Deferred credits are MAS amounts (decimal strings) from sold rolls
    // still waiting to be paid out — convert back to a roll count.
    const deferredNanoMas = info.deferred_credits.reduce(
      (sum, credit) => sum + (credit.amount ? Mas.fromString(credit.amount) : 0n),
      0n,
    );
    return {
      active: info.final_roll_count,
      candidate: Math.max(0, info.candidate_roll_count - info.final_roll_count),
      deferred: Number(deferredNanoMas / Mas.fromString(String(ROLL_PRICE_MAS))),
    };
  }

  async buyRolls(privateKey: string, rollCount: bigint): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    const operation = await provider.buyRolls(rollCount);
    return { operationId: operation.id };
  }

  async sellRolls(privateKey: string, rollCount: bigint): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    const operation = await provider.sellRolls(rollCount);
    return { operationId: operation.id };
  }

  private async providerFor(privateKey: string) {
    const account = await Account.fromPrivateKey(privateKey);
    return this.networkStore.network() === 'buildnet'
      ? Web3Provider.buildnet(account)
      : Web3Provider.mainnet(account);
  }

  private publicProvider(): JsonRpcPublicProvider {
    return this.networkStore.network() === 'buildnet'
      ? JsonRpcPublicProvider.buildnet()
      : JsonRpcPublicProvider.mainnet();
  }
}
