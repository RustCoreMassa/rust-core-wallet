import { TestBed } from '@angular/core/testing';
import { NftCollection } from '../models/nft.model';
import { LaunchpadRegistry } from '../services/launchpad-registry';
import { NftMetadataReader } from '../services/nft-metadata-reader';
import {
  COLLECTIONS_REFRESH_MS,
  MAX_NFTS,
  MAX_NFTS_PER_COLLECTION,
  NFTS_REFRESH_MS,
  NftStore,
} from './nft-store';

const ME = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const OTHER = 'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz';

function collection(address: string): NftCollection {
  return { address, name: address, symbol: 'S', logoUrl: '', verified: true };
}

const NEW = collection('AS1new');
const KEEPERS = collection('AS1keepers');
const EMPTY = collection('AS1empty');

const range = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => BigInt(from + i));

describe('NftStore', () => {
  let store: NftStore;
  let registry: { collections: ReturnType<typeof vi.fn>; ownedIds: ReturnType<typeof vi.fn> };
  let metadata: { reset: ReturnType<typeof vi.fn> };
  /** Ids per `${collection}:${holder}`; the fake registry applies `limit` like the real one. */
  let held: Record<string, bigint[]>;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    held = { [`AS1new:${ME}`]: [4n], [`AS1keepers:${ME}`]: [1n, 9n] };
    registry = {
      collections: vi.fn(async () => [NEW, KEEPERS, EMPTY]),
      ownedIds: vi.fn(async (_network: string, address: string, holder: string, limit: number) => {
        const ids = held[`${address}:${holder}`] ?? [];
        return { ids: ids.slice(0, limit), more: ids.length > limit };
      }),
    };
    metadata = { reset: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: LaunchpadRegistry, useValue: registry },
        { provide: NftMetadataReader, useValue: metadata },
      ],
    });
    store = TestBed.inject(NftStore);
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps the collections the wallet holds, in the registry order', async () => {
    expect(store.galleryOf('mainnet', ME)).toBeNull();
    await store.load('mainnet', ME);
    expect(store.galleryOf('mainnet', ME)).toEqual({
      holdings: [
        { collection: NEW, ids: [4n] },
        { collection: KEEPERS, ids: [1n, 9n] },
      ],
      complete: true,
    });
    expect(registry.ownedIds).toHaveBeenCalledTimes(3);
    expect(registry.ownedIds).toHaveBeenCalledWith(
      'mainnet',
      'AS1keepers',
      ME,
      MAX_NFTS_PER_COLLECTION,
    );
  });

  it('shows an empty list (not null) for a wallet without NFTs', async () => {
    await store.load('mainnet', OTHER);
    expect(store.galleryOf('mainnet', OTHER)).toEqual({ holdings: [], complete: true });
  });

  it('reads at most MAX_NFTS_PER_COLLECTION from one collection', async () => {
    held[`AS1keepers:${ME}`] = range(1, MAX_NFTS_PER_COLLECTION + 50);
    await store.load('mainnet', ME);
    const gallery = store.galleryOf('mainnet', ME)!;
    expect(gallery.holdings[1].ids).toHaveLength(MAX_NFTS_PER_COLLECTION);
    expect(gallery.complete).toBe(false);
  });

  it('reads at most MAX_NFTS in all, and no collection past that', async () => {
    const many = Array.from({ length: 5 }, (_, i) => collection(`AS1c${i}`));
    registry.collections.mockResolvedValue(many);
    for (const c of many) held[`${c.address}:${ME}`] = range(1, MAX_NFTS_PER_COLLECTION);

    await store.load('mainnet', ME);

    const gallery = store.galleryOf('mainnet', ME)!;
    const count = gallery.holdings.reduce((n, h) => n + h.ids.length, 0);
    expect(count).toBe(MAX_NFTS);
    expect(gallery.complete).toBe(false);
    const limits = registry.ownedIds.mock.calls.map((call) => call[3]);
    expect(limits).toEqual([200, 200, 100]);
  });

  it('keeps networks and wallets apart', async () => {
    await store.load('buildnet', ME);
    expect(registry.collections).toHaveBeenCalledWith('buildnet');
    expect(store.galleryOf('buildnet', ME)?.holdings).toHaveLength(2);
    expect(store.galleryOf('mainnet', ME)).toBeNull();
    expect(store.galleryOf('buildnet', OTHER)).toBeNull();
  });

  it('re-reads the wallet only after NFTS_REFRESH_MS, the registry after COLLECTIONS_REFRESH_MS', async () => {
    await store.load('mainnet', ME);
    await store.load('mainnet', ME);
    expect(registry.ownedIds).toHaveBeenCalledTimes(3);

    now += NFTS_REFRESH_MS;
    held[`AS1empty:${ME}`] = [2n];
    await store.load('mainnet', ME);
    expect(registry.ownedIds).toHaveBeenCalledTimes(6);
    expect(store.galleryOf('mainnet', ME)?.holdings).toHaveLength(3);
    expect(registry.collections).toHaveBeenCalledOnce();

    await store.load('mainnet', OTHER);
    expect(registry.collections).toHaveBeenCalledOnce();
    now += COLLECTIONS_REFRESH_MS;
    await store.load('mainnet', OTHER);
    expect(registry.collections).toHaveBeenCalledTimes(2);
  });

  it('shares one read between callers', async () => {
    await Promise.all([store.load('mainnet', ME), store.load('mainnet', ME)]);
    expect(registry.ownedIds).toHaveBeenCalledTimes(3);
  });

  it('fails as a whole when one collection cannot be read, keeping what it showed', async () => {
    await store.load('mainnet', ME);
    const before = store.galleryOf('mainnet', ME);
    now += NFTS_REFRESH_MS;
    registry.ownedIds.mockRejectedValueOnce(new Error('RPC down'));
    await expect(store.load('mainnet', ME)).rejects.toThrow('RPC down');
    expect(store.galleryOf('mainnet', ME)).toBe(before);
    // Not counted as read: the next visit asks again.
    await store.load('mainnet', ME);
    expect(registry.ownedIds).toHaveBeenCalledTimes(7);
  });

  it('asks for the registry again after it failed', async () => {
    registry.collections.mockRejectedValueOnce(new Error('RPC down'));
    await expect(store.load('mainnet', ME)).rejects.toThrow('RPC down');
    await store.load('mainnet', ME);
    expect(registry.collections).toHaveBeenCalledTimes(2);
    expect(store.galleryOf('mainnet', ME)?.holdings).toHaveLength(2);
  });

  it('forgets everything on reset, including a read still running', async () => {
    await store.load('mainnet', ME);
    now += NFTS_REFRESH_MS;
    const running = store.load('mainnet', OTHER);
    store.reset();
    await running;
    expect(store.galleryOf('mainnet', ME)).toBeNull();
    expect(store.galleryOf('mainnet', OTHER)).toBeNull();
    expect(metadata.reset).toHaveBeenCalledOnce();
  });
});
