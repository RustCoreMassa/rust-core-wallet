import { Injectable, InjectionToken, inject } from '@angular/core';
import { NftMetadata } from '../models/nft.model';
import { Network } from '../state/network-store';
import { mediaUrl } from '../utils/media-hosts';
import { parseNftMetadata } from '../utils/nft-metadata';
import { LaunchpadRegistry } from './launchpad-registry';

/** The HTTP client used for metadata JSON. Replaced in tests. */
export const NFT_FETCH = new InjectionToken<typeof fetch>('NFT_FETCH', {
  providedIn: 'root',
  factory: () => (input, init) => fetch(input, init),
});

/** NFTs read (uri + metadata) at once — the public RPC rejects bursts. */
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;
/** Largest metadata JSON read; NFT metadata is a few KB. */
export const MAX_METADATA_BYTES = 256 * 1024;

/** The metadata link's server answered, but not with metadata: kept as "none" for the session. */
class NotMetadata extends Error {}

/**
 * Metadata of one NFT: its `uri(id)` from the collection, then the JSON at
 * that link — only from MEDIA_HOSTS (ipfs:// through the IPFS gateway, or
 * RustCore's NFT server). No cookies, no referrer, a timeout, at most
 * MAX_METADATA_BYTES, a redirect may not leave those servers, and only known
 * fields are kept, as text.
 *
 * Calls go through one shared queue, so a page full of NFTs never fires
 * dozens of requests at once. Results are kept for the session; a failed read
 * (network, RPC) is forgotten so the next view retries.
 */
@Injectable({ providedIn: 'root' })
export class NftMetadataReader {
  private readonly registry = inject(LaunchpadRegistry);
  private readonly http = inject(NFT_FETCH);
  private readonly cache = new Map<string, Promise<NftMetadata | null>>();
  private readonly waiting: (() => void)[] = [];
  private running = 0;

  /** null when the NFT has no usable metadata (or it couldn't be read this time). */
  get(network: Network, collection: string, id: bigint): Promise<NftMetadata | null> {
    const key = `${network}:${collection}:${id}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.throttled(() => this.read(network, collection, id)).catch((err) => {
        if (!(err instanceof NotMetadata)) {
          this.cache.delete(key);
          console.warn(`NFT metadata of ${collection} #${id} failed`, err);
        }
        return null;
      });
      this.cache.set(key, entry);
    }
    return entry;
  }

  /** Forgets every result — used on log out. */
  reset(): void {
    this.cache.clear();
  }

  private async read(network: Network, collection: string, id: bigint): Promise<NftMetadata> {
    const link = mediaUrl(await this.registry.tokenUri(network, collection, id));
    if (!link) throw new NotMetadata();
    const response = await this.http(link, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    });
    if (!response.ok) {
      // 404 & co.: the server is there, the metadata isn't. 5xx / 429: try again later.
      if (response.status >= 500 || response.status === 429) {
        throw new Error(`HTTP ${response.status}`);
      }
      throw new NotMetadata();
    }
    // Followed redirects must end on an allowed server too.
    if (response.redirected && !mediaUrl(response.url)) throw new NotMetadata();
    const body = await readCapped(response, MAX_METADATA_BYTES);
    if (body === null) throw new NotMetadata();
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new NotMetadata();
    }
    const metadata = parseNftMetadata(json);
    if (!metadata) throw new NotMetadata();
    return metadata;
  }

  private async throttled<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY) await new Promise<void>((go) => this.waiting.push(go));
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

/** The body as text, or null when it's larger than `maxBytes` (stops reading there). */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) return null;
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).length > maxBytes ? null : text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
