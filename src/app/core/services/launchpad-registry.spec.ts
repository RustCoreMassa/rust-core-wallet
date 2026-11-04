import { Args, JsonRpcPublicProvider, U256 } from '@massalabs/massa-web3';
import {
  LAUNCHPAD_CONTRACTS,
  LaunchpadRegistry,
  idsFromOwnedKeys,
  readCollectionPage,
} from './launchpad-registry';

const HOLDER = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';

/**
 * `getProjects(1, 0, 50)` as mainnet's Launchpad (v1.4.0) answered it on 2026-11-04: one
 * collection, Core Keepers (id 2; id 1 was removed by the admin).
 */
const MAINNET_PAGE = Uint8Array.from(
  atob(
    'AgAAAAAAAACaAwAAAQIAAAAAAAAANQAAAEFTMTI1SFN6WEw5c3Bob25paXFlenVZS1gzbUdOdXVTMTl5TFFLdmFKVUd5RWtmQUxwVlRCADUAAABBVTEyNnM5M1p4YlQ0UVVKY1pZcXNBeHlNYzN3djhua0hKWUtZQ3RnUXlFblo4VkdSTTk5UCgF9GihAQAAAgAAACAAAADPhjq+VAEPupuU9Ln/AZYrAm/FIE339vgrsQiXzB1Y7gwAAABDb3JlIEtlZXBlcnMFAAAAQ0tFRVAAAAEBAPQBNQAAAEFVMTI2czkzWnhiVDRRVUpjWllxc0F4eU1jM3d2OG5rSEpZS1lDdGdReUVuWjhWR1JNOTlQwAEAADEsMDAwIGNhcnRvb24gY3JhYnMsIHRoZSBORlQgY29sbGVjdGlvbiBvZiB0aGUgUnVzdENvcmUgdGVhbS4gU2FtZSBjcmFiLCBzYW1lIHBvc2U6IG9ubHkgdGhlIGNvbG9ycyBhbmQgdHJhaXRzIGNoYW5nZSwgYW5kIGV2ZXJ5IEtlZXBlciBjYXJyaWVzIHNvbWUgcnVzdC4gMTAgR2VuZXNpcyBvbmUtb2Ytb25lcyAoIzEtIzEwKSBhbmQgOTkwIEtlZXBlcnMgd2l0aCB1bmlxdWUgdHJhaXQgY29tYmluYXRpb25zLiBUaGUgbWludCBmdW5kcyB0aGUgZGV2ZWxvcG1lbnQgYW5kIG1haW50ZW5hbmNlIG9mIFJ1c3RDb3JlJ3Mgc2VydmljZXMsIGV4aXN0aW5nIGFuZCBuZXcuIEhvbGRlcnMgZ2V0IGEgZGlzY291bnQgb24gUnVzdENvcmUgTGF1bmNocGFkIGZlZXMsIHdpdGggbW9yZSBiZW5lZml0cyB0byBjb21lLiBBcnQgYW5kIGEgc3VwcG9ydGVyIGJhZGdlLCBub3QgYW4gaW52ZXN0bWVudC4xAAAAaHR0cHM6Ly9uZnQucnVzdGNvcmVtYXNzYS5jb20vY29sbGVjdGlvbi9sb2dvLnBuZzMAAABodHRwczovL25mdC5ydXN0Y29yZW1hc3NhLmNvbS9jb2xsZWN0aW9uL2Jhbm5lci5wbmcfAAAAaHR0cHM6Ly9ydXN0Y29yZS5tYXNzYS5uZXR3b3JrLxsAAABodHRwczovL3guY29tL1J1c3RDb3JlTWFzc2EbAAAAaHR0cHM6Ly90Lm1lL3J1c3Rjb3JlX21hc3NhAAAAAA==',
  ),
  (c) => c.charCodeAt(0),
);

interface Fixture {
  kind?: number;
  address: string;
  name?: string;
  symbol?: string;
  verified?: boolean;
  hidden?: boolean;
  logoUrl?: string;
}

/** One record in the contract's field order (rust-core-launchpad records.ts → writeProject). */
function record(args: Args, f: Fixture): Args {
  return args
    .addU8(BigInt(f.kind ?? 1))
    .addU64(7n)
    .addString(f.address)
    .addU8(0n)
    .addString(HOLDER)
    .addU64(1_790_000_000_000n)
    .addU32(2n)
    .addUint8Array(new Uint8Array(32).fill(9))
    .addString(f.name ?? 'Crabs')
    .addString(f.symbol ?? 'CRAB')
    .addU8(0n)
    .addBool(false)
    .addU8(1n)
    .addBool(f.verified ?? false)
    .addBool(f.hidden ?? false)
    .addU16(500n)
    .addString(HOLDER)
    .addString('A description')
    .addString(f.logoUrl ?? 'ipfs://bafylogo/logo.png')
    .addString('https://banner')
    .addString('https://site')
    .addString('@x')
    .addString('t.me/x')
    .addString('discord');
}

function page(total: number, fixtures: Fixture[]): Uint8Array {
  const records = new Args();
  for (const f of fixtures) record(records, f);
  return new Args().addU64(BigInt(total)).addUint8Array(records.serialize()).serialize();
}

const address = (n: number) => `AS1collection${String(n).padStart(4, '0')}`;

describe('readCollectionPage', () => {
  it("decodes the real mainnet answer (the contract's own byte layout)", () => {
    const { total, collections } = readCollectionPage(MAINNET_PAGE);
    expect(total).toBe(2);
    expect(collections).toEqual([
      {
        address: 'AS125HSzXL9sphoniiqezuYKX3mGNuuS19yLQKvaJUGyEkfALpVTB',
        name: 'Core Keepers',
        symbol: 'CKEEP',
        logoUrl: 'https://nft.rustcoremassa.com/collection/logo.png',
        verified: true,
        hidden: false,
      },
    ]);
  });

  it('reads every record, keeps collections only, and cleans their text', () => {
    const { total, collections } = readCollectionPage(
      page(3, [
        { address: address(1), name: 'Cra​bs‮', verified: true, hidden: true },
        { address: 'AS1token', kind: 0, name: 'A token' },
        { address: address(2), name: '', symbol: 'ONLY', logoUrl: '  ' },
      ]),
    );
    expect(total).toBe(3);
    expect(collections).toEqual([
      {
        address: address(1),
        name: 'Crabs',
        symbol: 'CRAB',
        logoUrl: 'ipfs://bafylogo/logo.png',
        verified: true,
        hidden: true,
      },
      {
        address: address(2),
        name: 'ONLY',
        symbol: 'ONLY',
        logoUrl: '',
        verified: false,
        hidden: false,
      },
    ]);
  });

  it('reads an empty page', () => {
    expect(readCollectionPage(page(0, []))).toEqual({ total: 0, collections: [] });
  });
});

describe('idsFromOwnedKeys', () => {
  it('turns Enumerable index keys into sorted token ids, ignoring other keys', () => {
    const prefix = new TextEncoder().encode('ownedTokens' + HOLDER);
    const key = (id: bigint) => Uint8Array.from([...prefix, ...U256.toBytes(id)]);
    const ids = idsFromOwnedKeys(
      [key(300n), key(2n), Uint8Array.from([...prefix, 1, 2]), key(17n)],
      prefix.length,
    );
    expect(ids).toEqual([2n, 17n, 300n]);
  });
});

describe('LaunchpadRegistry', () => {
  function fakeProvider(answers: Uint8Array[], error: string | null = null) {
    const provider = {
      readSC: vi.fn(async () => ({ value: answers.shift()!, info: { error } })),
      client: {
        getAddressesDatastoreKeys: vi.fn(
          async (_requests: unknown[]): Promise<{ keys: Uint8Array[] }[]> => [{ keys: [] }],
        ),
      },
    };
    vi.spyOn(JsonRpcPublicProvider, 'mainnet').mockReturnValue(
      provider as unknown as JsonRpcPublicProvider,
    );
    vi.spyOn(JsonRpcPublicProvider, 'buildnet').mockReturnValue(
      provider as unknown as JsonRpcPublicProvider,
    );
    return provider;
  }

  afterEach(() => vi.restoreAllMocks());

  it('pages through the registry and keeps verified, visible collections only', async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({
      address: address(i),
      verified: i !== 7,
      hidden: i === 3,
    }));
    const provider = fakeProvider([
      page(60, first),
      page(60, [{ address: address(50), verified: true }]),
    ]);

    const collections = await new LaunchpadRegistry().collections('mainnet');

    expect(provider.readSC).toHaveBeenCalledTimes(2);
    const offsets = provider.readSC.mock.calls.map((call) => {
      const { target, func, parameter } = (
        call as unknown as [{ target: string; func: string; parameter: Args }]
      )[0];
      expect(target).toBe(LAUNCHPAD_CONTRACTS.mainnet);
      expect(func).toBe('getProjects');
      const args = new Args(parameter.serialize());
      expect(args.nextU8()).toBe(1n);
      const offset = args.nextU64();
      expect(args.nextU32()).toBe(50n);
      return offset;
    });
    expect(offsets).toEqual([0n, 50n]);
    expect(collections).toHaveLength(49);
    expect(collections.map((c) => c.address)).not.toContain(address(3)); // hidden
    expect(collections.map((c) => c.address)).not.toContain(address(7)); // not verified
    expect(collections.every((c) => c.verified)).toBe(true);
    expect(collections[0]).not.toHaveProperty('hidden');
  });

  it('asks the network it is given', async () => {
    fakeProvider([page(0, [])]);
    await new LaunchpadRegistry().collections('buildnet');
    expect(JsonRpcPublicProvider.buildnet).toHaveBeenCalled();
    expect(JsonRpcPublicProvider.mainnet).not.toHaveBeenCalled();
  });

  it('fails when the contract refuses the read', async () => {
    fakeProvider([new Uint8Array()], 'VM error');
    await expect(new LaunchpadRegistry().collections('mainnet')).rejects.toThrow('VM error');
  });

  it("reads a holder's ids from the collection's Enumerable index, one capped request", async () => {
    const provider = fakeProvider([]);
    const prefix = new TextEncoder().encode('ownedTokens' + HOLDER);
    const key = (id: bigint) => Uint8Array.from([...prefix, ...U256.toBytes(id)]);
    provider.client.getAddressesDatastoreKeys.mockResolvedValue([{ keys: [key(9n), key(5n)] }]);

    const owned = await new LaunchpadRegistry().ownedIds('mainnet', address(1), HOLDER, 3);

    expect(owned).toEqual({ ids: [5n, 9n], more: false });
    expect(provider.client.getAddressesDatastoreKeys).toHaveBeenCalledExactlyOnceWith([
      { address: address(1), final: false, prefix, inclusiveStartKey: true, maxCount: 4 },
    ]);
  });

  it('tells when the index holds more than the limit, and keeps only the limit', async () => {
    const provider = fakeProvider([]);
    const prefix = new TextEncoder().encode('ownedTokens' + HOLDER);
    const keys = [1n, 2n, 3n].map((id) => Uint8Array.from([...prefix, ...U256.toBytes(id)]));
    provider.client.getAddressesDatastoreKeys.mockResolvedValue([{ keys }]);

    const owned = await new LaunchpadRegistry().ownedIds('mainnet', address(1), HOLDER, 2);

    expect(owned).toEqual({ ids: [1n, 2n], more: true });
  });
});
