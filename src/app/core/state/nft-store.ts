import { Injectable, inject, signal } from '@angular/core';
import { NftCollection, NftGallery, NftHolding } from '../models/nft.model';
import { LaunchpadRegistry } from '../services/launchpad-registry';
import { NftMetadataReader } from '../services/nft-metadata-reader';
import { Network } from './network-store';

/** A wallet's NFTs are re-read when the NFTs page opens, at most this often. */
export const NFTS_REFRESH_MS = 60_000;
/** New collections on the Launchpad are rare: its registry is re-read at most this often. */
export const COLLECTIONS_REFRESH_MS = 10 * 60_000;
/** Most NFTs read from one collection — a contract can't flood the page or the RPC. */
export const MAX_NFTS_PER_COLLECTION = 200;
/** Most NFTs read in all, for one wallet. */
export const MAX_NFTS = 500;

function keyOf(network: Network, address: string): string {
  return `${network}:${address}`;
}

/**
 * The NFTs each wallet holds, **only in collections listed on RustCore
 * Launchpad and verified by its team** (LaunchpadRegistry.collections).
 * Anything sent to the wallet from another contract never shows, so spam,
 * phishing or look-alike NFTs can't reach the screen. At most
 * MAX_NFTS_PER_COLLECTION per collection and MAX_NFTS in all are read.
 *
 * Public chain data, kept in memory only (per network and address); a
 * failed read keeps what was shown before. `reset()` on log out.
 */
@Injectable({ providedIn: 'root' })
export class NftStore {
  private readonly registry = inject(LaunchpadRegistry);
  private readonly metadata = inject(NftMetadataReader);

  private readonly _galleries = signal<Readonly<Record<string, NftGallery>>>({});
  private readonly fetchedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly collectionsByNetwork = new Map<
    Network,
    { at: number; list: Promise<NftCollection[]> }
  >();
  /** Bumped by reset(): reads started before it are dropped. */
  private generation = 0;

  /** The wallet's NFTs, by collection (newest collection first); null until first read. */
  galleryOf(network: Network, address: string): NftGallery | null {
    return this._galleries()[keyOf(network, address)] ?? null;
  }

  /** Reads the wallet's NFTs unless they were read less than NFTS_REFRESH_MS ago. */
  load(network: Network, address: string): Promise<void> {
    const key = keyOf(network, address);
    const running = this.inFlight.get(key);
    if (running) return running;
    const fresh = Date.now() - (this.fetchedAt.get(key) ?? 0) < NFTS_REFRESH_MS;
    if (fresh && this.galleryOf(network, address)) return Promise.resolve();

    const generation = this.generation;
    const task = this.read(network, address)
      .then((gallery) => {
        if (generation !== this.generation) return;
        this.fetchedAt.set(key, Date.now());
        this._galleries.update((all) => ({ ...all, [key]: gallery }));
      })
      .finally(() => {
        if (this.inFlight.get(key) === task) this.inFlight.delete(key);
      });
    this.inFlight.set(key, task);
    return task;
  }

  /** Forgets every wallet's NFTs and their metadata — used on log out. */
  reset(): void {
    this.generation++;
    this._galleries.set({});
    this.fetchedAt.clear();
    this.inFlight.clear();
    this.collectionsByNetwork.clear();
    this.metadata.reset();
  }

  private async read(network: Network, address: string): Promise<NftGallery> {
    const collections = await this.collections(network);
    const holdings: NftHolding[] = [];
    let count = 0;
    let complete = true;
    // One collection at a time: the public RPC rejects bursts. A failed read fails the whole
    // load (an RPC error must never look like "no NFTs").
    for (const collection of collections) {
      const limit = Math.min(MAX_NFTS_PER_COLLECTION, MAX_NFTS - count);
      if (limit <= 0) {
        complete = false;
        break;
      }
      const { ids, more } = await this.registry.ownedIds(
        network,
        collection.address,
        address,
        limit,
      );
      if (more) complete = false;
      if (ids.length) holdings.push({ collection, ids });
      count += ids.length;
    }
    return { holdings, complete };
  }

  private collections(network: Network): Promise<NftCollection[]> {
    const cached = this.collectionsByNetwork.get(network);
    if (cached && Date.now() - cached.at < COLLECTIONS_REFRESH_MS) return cached.list;
    const list = this.registry.collections(network);
    const entry = { at: Date.now(), list };
    this.collectionsByNetwork.set(network, entry);
    // A failed read isn't kept: the next load asks again.
    list.catch(() => {
      if (this.collectionsByNetwork.get(network) === entry)
        this.collectionsByNetwork.delete(network);
    });
    return list;
  }
}
