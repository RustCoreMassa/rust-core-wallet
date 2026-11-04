import { TestBed } from '@angular/core/testing';
import { LaunchpadRegistry } from './launchpad-registry';
import { MAX_METADATA_BYTES, NFT_FETCH, NftMetadataReader } from './nft-metadata-reader';

const COLLECTION = 'AS125HSzXL9sphoniiqezuYKX3mGNuuS19yLQKvaJUGyEkfALpVTB';
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

/** A real Response; `body` as JSON, or a raw string. */
function response(status: number, body: unknown = {}, init: { url?: string } = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const answer = new Response(status === 204 ? null : text, { status });
  if (init.url) {
    Object.defineProperty(answer, 'url', { value: init.url });
    Object.defineProperty(answer, 'redirected', { value: true });
  }
  return answer;
}

describe('NftMetadataReader', () => {
  let tokenUri: ReturnType<typeof vi.fn>;
  let http: ReturnType<typeof vi.fn>;

  function setUp(): NftMetadataReader {
    tokenUri = vi.fn(async (_network: string, _collection: string, id: bigint) => {
      return `ipfs://${CID}/${id}.json`;
    });
    http = vi.fn(async () => response(200, { name: 'Keeper' }));
    TestBed.configureTestingModule({
      providers: [
        { provide: LaunchpadRegistry, useValue: { tokenUri } },
        { provide: NFT_FETCH, useValue: http },
      ],
    });
    return TestBed.inject(NftMetadataReader);
  }

  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("reads the NFT's uri, then its JSON without credentials or referrer", async () => {
    const reader = setUp();
    const metadata = await reader.get('mainnet', COLLECTION, 7n);

    expect(metadata?.name).toBe('Keeper');
    expect(tokenUri).toHaveBeenCalledWith('mainnet', COLLECTION, 7n);
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://ipfs.io/ipfs/${CID}/7.json`);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('keeps results for the session', async () => {
    const reader = setUp();
    await reader.get('mainnet', COLLECTION, 1n);
    await reader.get('mainnet', COLLECTION, 1n);
    expect(http).toHaveBeenCalledOnce();
    await reader.get('buildnet', COLLECTION, 1n);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("reads from RustCore's NFT server", async () => {
    const reader = setUp();
    tokenUri.mockResolvedValue('https://nft.rustcoremassa.com/metadata/7');
    expect((await reader.get('mainnet', COLLECTION, 7n))?.name).toBe('Keeper');
    expect(http.mock.calls[0][0]).toBe('https://nft.rustcoremassa.com/metadata/7');
  });

  it('never fetches from any other server', async () => {
    const reader = setUp();
    for (const uri of [
      'https://nft.example.com/1.json',
      'https://nft.rustcoremassa.com.evil.example/1.json',
      'https://cloudflare-ipfs.com/ipfs/bafy/1.json',
    ]) {
      tokenUri.mockResolvedValueOnce(uri);
    }
    for (let i = 1n; i <= 3n; i++) expect(await reader.get('mainnet', COLLECTION, i)).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });

  it('never fetches plain http links', async () => {
    const reader = setUp();
    tokenUri.mockResolvedValue('http://nft.example.com/1.json');
    expect(await reader.get('mainnet', COLLECTION, 1n)).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });

  it('keeps "no metadata" when the server says it has none (404, not JSON)', async () => {
    const reader = setUp();
    http.mockResolvedValueOnce(response(404));
    http.mockResolvedValueOnce(response(200, '<html>not JSON</html>'));
    expect(await reader.get('mainnet', COLLECTION, 1n)).toBeNull();
    expect(await reader.get('mainnet', COLLECTION, 2n)).toBeNull();
    await reader.get('mainnet', COLLECTION, 1n);
    await reader.get('mainnet', COLLECTION, 2n);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('tries again next time after a failure that may pass (RPC, network, 5xx, 429)', async () => {
    const reader = setUp();
    tokenUri.mockRejectedValueOnce(new Error('RPC down'));
    http.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    http.mockResolvedValueOnce(response(503));
    http.mockResolvedValueOnce(response(429));

    for (let i = 0; i < 4; i++) expect(await reader.get('mainnet', COLLECTION, 1n)).toBeNull();
    expect((await reader.get('mainnet', COLLECTION, 1n))?.name).toBe('Keeper');
  });

  it('runs at most 4 reads at once', async () => {
    const reader = setUp();
    let running = 0;
    let most = 0;
    http.mockImplementation(async () => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return response(200, { name: 'x' });
    });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => reader.get('mainnet', COLLECTION, BigInt(i))),
    );
    expect(http).toHaveBeenCalledTimes(12);
    expect(most).toBe(4);
  });

  it('drops images on other servers', async () => {
    const reader = setUp();
    http.mockResolvedValue(response(200, { name: 'K', image: 'https://cdn.example.com/1.png' }));
    expect((await reader.get('mainnet', COLLECTION, 1n))?.image).toBe('');
  });

  it('refuses a redirect that leaves the allowed servers', async () => {
    const reader = setUp();
    http.mockResolvedValueOnce(
      response(200, { name: 'x' }, { url: 'https://evil.example/1.json' }),
    );
    expect(await reader.get('mainnet', COLLECTION, 1n)).toBeNull();
    http.mockResolvedValueOnce(
      response(200, { name: 'Moved' }, { url: 'https://nft.rustcoremassa.com/metadata/2' }),
    );
    expect((await reader.get('mainnet', COLLECTION, 2n))?.name).toBe('Moved');
  });

  it('refuses metadata larger than MAX_METADATA_BYTES, declared or not', async () => {
    const reader = setUp();
    const huge = JSON.stringify({ name: 'x'.repeat(MAX_METADATA_BYTES) });
    http.mockResolvedValueOnce(response(200, huge));
    const declared = response(200, { name: 'small' });
    declared.headers.set('content-length', String(MAX_METADATA_BYTES + 1));
    http.mockResolvedValueOnce(declared);
    expect(await reader.get('mainnet', COLLECTION, 1n)).toBeNull();
    expect(await reader.get('mainnet', COLLECTION, 2n)).toBeNull();
    http.mockResolvedValueOnce(response(200, { name: 'x'.repeat(1000) }));
    expect((await reader.get('mainnet', COLLECTION, 3n))?.name).toHaveLength(100);
  });

  it('forgets everything on reset', async () => {
    const reader = setUp();
    await reader.get('mainnet', COLLECTION, 1n);
    reader.reset();
    await reader.get('mainnet', COLLECTION, 1n);
    expect(http).toHaveBeenCalledTimes(2);
  });
});
