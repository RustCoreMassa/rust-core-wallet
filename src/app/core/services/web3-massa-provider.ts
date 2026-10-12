import { Injectable, inject } from '@angular/core';
import {
  Account,
  Args,
  JsonRpcPublicProvider,
  MNS,
  MRC20,
  Mas,
  U8,
  Web3Provider,
  bytesToStr,
  rpcTypes,
  strToBytes,
} from '@massalabs/massa-web3';
import { MnsDomain } from '../models/nft.model';
import { NetworkStore } from '../state/network-store';
import { waitExecuted } from './operation-execution';
import {
  CallSimulation,
  ContractCallParams,
  GeneratedAccount,
  MassaProvider,
  NETWORK_FEE_MAS,
  OperationResult,
  ROLL_PRICE_MAS,
  SignedMessage,
  StakingInfo,
  TokenInfo,
} from './massa-provider';

/** MNS datastore prefix of a name's target (DOMAIN_SEPARATOR_KEY + TARGET_KEY_PREFIX). */
const MNS_TARGET_KEY_PREFIX = [0x42, 0x02];

/**
 * Real implementation backed by `@massalabs/massa-web3`, bound to
 * MASSA_PROVIDER in app.config.ts.
 *
 * Every write method re-derives an `Account` from the raw private key
 * and opens a fresh `Web3Provider` for that one call, on whichever
 * network NetworkStore currently points at — no key or provider is
 * ever cached across calls, so a network switch applies immediately.
 *
 * `getStaking` needs no key: roll counts aren't on the `Provider` wrapper,
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
    return waitExecuted(await provider.transfer(toAddress, amount));
  }

  async getTokenBalance(privateKey: string, contractAddress: string): Promise<bigint> {
    const provider = await this.providerFor(privateKey);
    const token = new MRC20(provider, contractAddress);
    return token.balanceOf(provider.address);
  }

  async getTokenInfo(contractAddress: string): Promise<TokenInfo | null> {
    const provider = this.publicProvider();
    // What MRC20.name()/symbol()/decimals() read — in one call, and with a
    // missing entry coming back as null instead of an error we can't tell
    // apart from an RPC failure.
    const [name, symbol, decimals] = await provider.readStorage(
      contractAddress,
      ['NAME', 'SYMBOL', 'DECIMALS'],
      true,
    );
    if (!name || !symbol || decimals?.length !== 1) return null;
    // Any contract can store those three keys; a token also answers balanceOf.
    const probe = await provider.readSC({
      target: contractAddress,
      func: 'balanceOf',
      parameter: new Args().addString(contractAddress).serialize(),
    });
    if (probe.info.error || probe.value.length !== 32) return null;
    return {
      name: bytesToStr(name),
      symbol: bytesToStr(symbol),
      decimals: Number(U8.fromBytes(decimals)),
    };
  }

  async transferToken(
    privateKey: string,
    contractAddress: string,
    toAddress: string,
    amount: bigint,
  ): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    const token = new MRC20(provider, contractAddress);
    return waitExecuted(await token.transfer(toAddress, amount));
  }

  async getStaking(address: string): Promise<StakingInfo> {
    // Explicit type: massa-web3's own publicAPI.d.ts imports its RPC types
    // from an unresolvable 'src/generated/' path, so they arrive as `any`.
    const info: rpcTypes.AddressInfo = await this.publicProvider().client.getAddressInfo(address);
    // Deferred credits are MAS amounts (decimal strings) from sold rolls
    // still waiting to be paid out — convert back to a roll count.
    const deferredNanoMas = info.deferred_credits.reduce(
      (sum, credit) => sum + (credit.amount ? Mas.fromString(credit.amount) : 0n),
      0n,
    );
    // Oldest → newest; the last entry is the current (non-final) cycle.
    const cycles = info.cycle_infos;
    return {
      rolls: {
        active: info.final_roll_count,
        candidate: Math.max(0, info.candidate_roll_count - info.final_roll_count),
        deferred: Number(deferredNanoMas / Mas.fromString(String(ROLL_PRICE_MAS))),
      },
      stats: {
        activeRolls: Number(cycles.at(-1)?.active_rolls ?? 0),
        produced: cycles.reduce((sum, c) => sum + Number(c.ok_count), 0),
        missed: cycles.reduce((sum, c) => sum + Number(c.nok_count), 0),
        nextBlockDraws: info.next_block_draws.length,
        nextEndorsementDraws: info.next_endorsement_draws.length,
      },
    };
  }

  async getTotalRolls(): Promise<number> {
    const client = this.publicProvider().client;
    const limit = 1000;
    let total = 0;
    // Each staker comes back as an [address, rollCount] pair.
    for (let offset = 0; ; offset += limit) {
      const page = (await client.getStakers({ offset, limit })) as unknown as [string, number][];
      total += page.reduce((sum, [, rolls]) => sum + Number(rolls), 0);
      if (page.length < limit) return total;
    }
  }

  async buyRolls(privateKey: string, rollCount: bigint): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    return waitExecuted(await provider.buyRolls(rollCount));
  }

  async sellRolls(privateKey: string, rollCount: bigint): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    return waitExecuted(await provider.sellRolls(rollCount));
  }

  async getOwnedDomains(address: string): Promise<MnsDomain[]> {
    const mns = this.mns(this.publicProvider());
    const names = await mns.getOwnedDomains(address);
    if (!names.length) return [];
    const targets = await mns.getTargets(names);
    return names
      .map((name, i) => ({ name, target: targets[i] || null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getDomainCost(name: string): Promise<bigint | null> {
    const provider = this.publicProvider();
    const mns = this.mns(provider);
    // The entry dnsAlloc itself checks ("Domain already registered"): the
    // name's target. MNS.resolve can't be used — it returns "" both for a
    // free name and for any failed read. Speculative (not final), so a name
    // registered seconds ago already counts as taken.
    const [target] = await provider.readStorage(
      mns.address,
      [Uint8Array.from([...MNS_TARGET_KEY_PREFIX, ...strToBytes(name)])],
      false,
    );
    if (target !== null) return null;
    return mns.dnsAllocCost(name);
  }

  simulateDomainRegistration(
    caller: string,
    name: string,
    target: string,
    coins: bigint,
  ): Promise<CallSimulation> {
    return this.simulateCall(caller, this.domainRegistration(name, target, coins));
  }

  registerDomain(
    privateKey: string,
    name: string,
    target: string,
    coins: bigint,
  ): Promise<OperationResult> {
    return this.callContract(privateKey, this.domainRegistration(name, target, coins));
  }

  /**
   * `dnsAlloc(name, target)`: the caller becomes the owner. (massa-web3's
   * `MNS.alloc(name, owner)` passes its second argument as the target.)
   */
  private domainRegistration(name: string, target: string, coins: bigint): ContractCallParams {
    return {
      target: this.mns(this.publicProvider()).address,
      func: 'dnsAlloc',
      parameter: new Args().addString(name).addString(target).serialize(),
      coins,
      fee: Mas.fromString(String(NETWORK_FEE_MAS)),
    };
  }

  private mns(provider: JsonRpcPublicProvider): MNS {
    return this.networkStore.network() === 'buildnet'
      ? MNS.buildnet(provider)
      : MNS.mainnet(provider);
  }

  async signMessage(privateKey: string, data: Uint8Array): Promise<SignedMessage> {
    // What JsonRpcProvider.sign does, without opening a provider for it.
    const account = await Account.fromPrivateKey(privateKey);
    const signature = await account.sign(data);
    return { publicKey: account.publicKey.toString(), signature: signature.toString() };
  }

  async simulateCall(caller: string, call: ContractCallParams): Promise<CallSimulation> {
    const result = await this.publicProvider().readSC({
      target: call.target,
      func: call.func,
      parameter: call.parameter,
      coins: call.coins,
      fee: call.fee,
      maxGas: call.maxGas,
      caller,
    });
    return { error: result.info.error || null, gasCost: BigInt(result.info.gasCost) };
  }

  async callContract(privateKey: string, call: ContractCallParams): Promise<OperationResult> {
    const provider = await this.providerFor(privateKey);
    return waitExecuted(
      await provider.callSC({
        target: call.target,
        func: call.func,
        parameter: call.parameter,
        coins: call.coins,
        fee: call.fee,
        maxGas: call.maxGas,
      }),
    );
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
