import { Injectable } from '@angular/core';
import { Args, JsonRpcPublicProvider, U256 } from '@massalabs/massa-web3';
import { NftCollection } from '../models/nft.model';
import { Network } from '../state/network-store';
import { cleanContractText } from '../utils/contract-text';

/**
 * RustCore Launchpad's contract on each network (rust-core-launchpad,
 * src/app/core/network/networks.ts). Its registry decides which NFT
 * collections the wallet shows. Buildnet's gets redeployed with new
 * Launchpad versions: keep it in step with the Launchpad app.
 */
export const LAUNCHPAD_CONTRACTS: Readonly<Record<Network, string>> = {
  mainnet: 'AS1LbJFfhZpq8DehV7Uw5XQxCyfXtwgUUoiZSTsHcyhEGB7RPWyP',
  buildnet: 'AS12TLJkNQinjSRdWdB6LxrHWzXwfgr9QGWjfsTa5UR9P1XCYT99d',
};

/** The registry's project kinds (Launchpad records.ts): 0 = token, 1 = collection. */
const KIND_COLLECTION = 1;
/** Most records one `getProjects` call returns (the contract's MAX_PAGE). */
export const REGISTRY_PAGE_SIZE = 50;
/** Safety cap on how many collections are read (the Launchpad app's own cap). */
export const MAX_COLLECTIONS = 2_000;

/** sc-standards MRC-721 Enumerable index: `ownedTokens` + owner address + token id (u256 LE). */
const OWNED_TOKENS_PREFIX = 'ownedTokens';
const TOKEN_ID_BYTES = 32;

const MAX_NAME = 64;
const MAX_SYMBOL = 16;

/** A registry record as far as the wallet needs it. */
export interface RegistryCollection extends NftCollection {
  /** Hidden by the Launchpad's admin (spam, scam…): the Launchpad doesn't list it. */
  readonly hidden: boolean;
}

/**
 * Decodes a `getProjects` answer: the total count (u64), then the records as
 * one byte array. Field order mirrors the contract's `Project` record
 * (rust-core-launchpad smart-contract/assembly/lib/launchpad/records.ts) —
 * Args has no field names, so every field is read, used or not.
 */
export function readCollectionPage(bytes: Uint8Array): {
  total: number;
  collections: RegistryCollection[];
} {
  const args = new Args(bytes);
  const total = Number(args.nextU64());
  const records = new Args(args.nextUint8Array());
  const end = records.serialize().length;
  const collections: RegistryCollection[] = [];
  while (records.getOffset() < end) {
    const kind = Number(records.nextU8());
    records.nextU64(); // id
    const address = records.nextString();
    records.nextU8(); // source: launched / imported
    records.nextString(); // creator
    records.nextU64(); // createdAt
    records.nextU32(); // templateVersion
    records.nextUint8Array(); // codeHash
    const name = records.nextString();
    const symbol = records.nextString();
    records.nextU8(); // decimals
    records.nextBool(); // mutable
    records.nextU8(); // category
    const verified = records.nextBool();
    const hidden = records.nextBool();
    records.nextU16(); // royaltyBps
    records.nextString(); // royaltyReceiver
    records.nextString(); // info.description
    const logoUrl = records.nextString();
    for (let i = 0; i < 5; i++) records.nextString(); // banner, website, twitter, telegram, discord
    if (kind !== KIND_COLLECTION) continue;
    const cleanSymbol = cleanContractText(symbol, MAX_SYMBOL);
    collections.push({
      address,
      name: cleanContractText(name, MAX_NAME) || cleanSymbol || 'Unnamed collection',
      symbol: cleanSymbol,
      logoUrl: logoUrl.trim(),
      verified,
      hidden,
    });
  }
  return { total, collections };
}

/** Token ids from Enumerable index keys (`prefix` + 32-byte id); other keys are ignored. */
export function idsFromOwnedKeys(keys: readonly Uint8Array[], prefixLength: number): bigint[] {
  return keys
    .filter((key) => key.length === prefixLength + TOKEN_ID_BYTES)
    .map((key) => U256.fromBytes(key.slice(prefixLength)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Read-only calls to RustCore Launchpad and the collections it lists, the way
 * the Launchpad app reads them ("My NFTs", chain mode). Every call takes the
 * network explicitly, so a read started before a network switch stays on its
 * own network. Reads use the candidate state (like readSC): an NFT received
 * seconds ago already shows.
 */
@Injectable({ providedIn: 'root' })
export class LaunchpadRegistry {
  /**
   * The collections the network's Launchpad lists **and its team verified**
   * (not hidden), newest first. Anyone can launch or import a collection on the
   * Launchpad and send its NFTs to any address — with a phishing name or
   * description — so unverified ones are never shown.
   */
  async collections(network: Network): Promise<NftCollection[]> {
    const provider = this.provider(network);
    const found: RegistryCollection[] = [];
    let total = Infinity;
    // Pages are counted in ids, not records: ids the admin removed leave gaps, so a page can
    // hold fewer records than its size.
    for (let offset = 0; offset < Math.min(total, MAX_COLLECTIONS); offset += REGISTRY_PAGE_SIZE) {
      const result = await provider.readSC({
        target: LAUNCHPAD_CONTRACTS[network],
        func: 'getProjects',
        parameter: new Args()
          .addU8(BigInt(KIND_COLLECTION))
          .addU64(BigInt(offset))
          .addU32(BigInt(REGISTRY_PAGE_SIZE)),
      });
      if (result.info.error) throw new Error(result.info.error);
      const page = readCollectionPage(result.value);
      total = page.total;
      found.push(...page.collections);
    }
    return found
      .filter((c) => c.verified && !c.hidden)
      .map(({ hidden: _, ...collection }) => collection);
  }

  /**
   * Ids of (at most `limit`) NFTs `holder` owns in `collection`, from its
   * Enumerable index (RC-Collection and any enumerable MRC-721) — one
   * storage-keys request for `limit + 1` keys, whatever the index holds: a
   * contract can't make the wallet read thousands of entries. `more` tells
   * there were others.
   */
  async ownedIds(
    network: Network,
    collection: string,
    holder: string,
    limit: number,
  ): Promise<{ ids: bigint[]; more: boolean }> {
    const prefix = new TextEncoder().encode(OWNED_TOKENS_PREFIX + holder);
    const [entry] = await this.provider(network).client.getAddressesDatastoreKeys([
      { address: collection, final: false, prefix, inclusiveStartKey: true, maxCount: limit + 1 },
    ]);
    const keys = entry?.keys ?? [];
    return {
      ids: idsFromOwnedKeys(keys.slice(0, limit), prefix.length),
      more: keys.length > limit,
    };
  }

  /** The NFT's metadata link (`uri(tokenId)`), as the collection returns it. */
  async tokenUri(network: Network, collection: string, id: bigint): Promise<string> {
    const result = await this.provider(network).readSC({
      target: collection,
      func: 'uri',
      parameter: new Args().addU256(id),
    });
    if (result.info.error) throw new Error(result.info.error);
    return new TextDecoder().decode(result.value);
  }

  private provider(network: Network): JsonRpcPublicProvider {
    return network === 'buildnet'
      ? JsonRpcPublicProvider.buildnet()
      : JsonRpcPublicProvider.mainnet();
  }
}
