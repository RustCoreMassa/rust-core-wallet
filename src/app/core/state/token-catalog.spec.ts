import { TestBed } from '@angular/core/testing';
import { TOKEN_REGISTRY } from '../models/token.model';
import { MASSA_PROVIDER, TokenInfo } from '../services/massa-provider';
import { NetworkStore } from './network-store';
import { TokenCatalog, cleanTokenText, toCustomToken } from './token-catalog';

const TOKEN = 'AS12FW5Rs5YN2zdpEnqwj4iHUUPt9R4Eqjq2qtpJFNKW3mn33RuLU';
const OTHER = 'AS1MYYTKxPSbPFDWm48yxQLq2sDsJdUEHsjo9GmJw7dtQUxhpnu1';
const USER = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const WMAS: TokenInfo = { name: 'Wrapped Massa', symbol: 'WMAS', decimals: 9 };

describe('toCustomToken', () => {
  it('keeps a well-formed token as the contract describes it', () => {
    expect(toCustomToken(TOKEN, WMAS)).toEqual({
      contract: TOKEN,
      symbol: 'WMAS',
      name: 'Wrapped Massa',
      decimals: 9,
    });
  });

  it('refuses the symbol of a built-in token, however it is disguised', () => {
    for (const symbol of ['USDC.e', 'usdc.e', 'ＵＳＤＣ.e', 'US​DC.e', '‮MAS', ' DUSA ']) {
      expect(() => toCustomToken(TOKEN, { ...WMAS, symbol })).toThrow(/already lists/);
    }
  });

  it('strips invisible and control characters from what it shows', () => {
    expect(cleanTokenText('W​M‮A\u0000S', 16)).toBe('WMAS');
    expect(cleanTokenText('  Wrapped \n  Massa ', 40)).toBe('Wrapped Massa');
  });

  it('caps long names and symbols', () => {
    const token = toCustomToken(TOKEN, { ...WMAS, name: 'x'.repeat(100), symbol: 'Y'.repeat(30) });
    expect([...token.name]).toHaveLength(40);
    expect(token.name.endsWith('…')).toBe(true);
    expect([...token.symbol]).toHaveLength(16);
  });

  it('needs a symbol, and falls back to it for a missing name', () => {
    expect(() => toCustomToken(TOKEN, { ...WMAS, symbol: '​ ' })).toThrow(/no symbol/);
    expect(toCustomToken(TOKEN, { ...WMAS, name: '' }).name).toBe('WMAS');
  });

  it('refuses decimals the amounts code cannot handle', () => {
    expect(() => toCustomToken(TOKEN, { ...WMAS, decimals: 31 })).toThrow(/decimals/);
    expect(() => toCustomToken(TOKEN, { ...WMAS, decimals: 1.5 })).toThrow(/decimals/);
    expect(toCustomToken(TOKEN, { ...WMAS, decimals: 0 }).decimals).toBe(0);
  });
});

describe('TokenCatalog', () => {
  let getTokenInfo: ReturnType<typeof vi.fn>;

  function create(): TokenCatalog {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: MASSA_PROVIDER, useValue: { getTokenInfo } }],
    });
    return TestBed.inject(TokenCatalog);
  }

  beforeEach(() => {
    localStorage.clear();
    getTokenInfo = vi.fn(async (contract: string) => (contract === TOKEN ? WMAS : null));
  });

  it('shows MAS and the built-in tokens on mainnet, MAS alone on buildnet', () => {
    const catalog = create();
    expect(catalog.tokens().map((t) => t.id)).toEqual(Object.keys(TOKEN_REGISTRY));
    TestBed.inject(NetworkStore).set('buildnet');
    expect(catalog.tokens().map((t) => t.id)).toEqual(['MAS']);
  });

  it('reads a token from its contract for review, without saving it', async () => {
    const catalog = create();
    await expect(catalog.lookup(` ${TOKEN} `)).resolves.toEqual({
      network: 'mainnet',
      token: { contract: TOKEN, symbol: 'WMAS', name: 'Wrapped Massa', decimals: 9 },
    });
    expect(catalog.custom()).toEqual([]);
  });

  it('says so when the address holds no token on this network', async () => {
    const catalog = create();
    await expect(catalog.lookup(OTHER)).rejects.toThrow(/isn't an MRC-20 token on Mainnet/);
  });

  it('refuses addresses that cannot be a token before asking the chain', async () => {
    const catalog = create();
    await expect(catalog.lookup(USER)).rejects.toThrow(/starts with AS/);
    await expect(catalog.lookup('hello')).rejects.toThrow(/starts with AS/);
    await expect(catalog.lookup(TOKEN_REGISTRY['DAI.e'].contract)).rejects.toThrow(/already in/);
    expect(getTokenInfo).not.toHaveBeenCalled();
  });

  it('adds a token on one network only, under its contract address', async () => {
    const catalog = create();
    const { network, token } = await catalog.lookup(TOKEN);
    catalog.add(network, token);
    expect(catalog.meta(TOKEN)).toMatchObject({ id: TOKEN, symbol: 'WMAS', custom: true });
    expect(catalog.mrc20On('mainnet').at(-1)?.contract).toBe(TOKEN);
    expect(catalog.mrc20On('buildnet')).toEqual([]);
    await expect(catalog.lookup(TOKEN)).rejects.toThrow(/already added/);
  });

  it('remembers custom tokens across restarts, and forgets them on log out', async () => {
    const first = create();
    const { network, token } = await first.lookup(TOKEN);
    first.add(network, token);

    const second = create();
    expect(second.custom()).toEqual([token]);
    second.clear();
    expect(create().custom()).toEqual([]);
  });

  it('ignores a damaged saved list instead of failing', () => {
    localStorage.setItem(
      'massa-wallet:custom-tokens',
      '{"mainnet":[{"contract":"x"}],"buildnet":7',
    );
    expect(create().custom()).toEqual([]);
    localStorage.setItem(
      'massa-wallet:custom-tokens',
      JSON.stringify({ mainnet: [{ contract: 'AU1nope', symbol: 'X', name: 'X', decimals: 2 }] }),
    );
    expect(create().custom()).toEqual([]);
  });

  it('names a removed token by its shortened contract in history', async () => {
    const catalog = create();
    const { network, token } = await catalog.lookup(TOKEN);
    catalog.add(network, token);
    expect(catalog.symbolOf(TOKEN)).toBe('WMAS');
    catalog.remove('mainnet', TOKEN);
    expect(catalog.symbolOf(TOKEN)).toBe(`${TOKEN.slice(0, 6)}…${TOKEN.slice(-4)}`);
    expect(catalog.symbolOf('DAI.e')).toBe('DAI.e');
  });
});
