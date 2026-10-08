export type TokenSymbol =
  'MAS' | 'PUR' | 'DUSA' | 'USDC.e' | 'WETH.e' | 'DAI.e' | 'WBTC.e' | 'WETH.b' | 'USDT.b';

/**
 * A token's key in balances, prices and history: its symbol for a built-in
 * token, its contract address for one the user added (two custom tokens may
 * share a symbol, and a symbol proves nothing — the contract does).
 */
export type TokenId = string;

export interface TokenMeta<S extends string = string> {
  readonly id: TokenId;
  readonly symbol: S;
  readonly name: string;
  readonly decimals: number;
  /** MRC-20 contract address; empty string for the native MAS coin. */
  readonly contract: string;
  readonly isErc20: boolean;
  /** Icon path; empty for custom tokens (the UI shows a symbol badge). */
  readonly asset: string;
  /** Added by the user from its contract address — not vetted by RustCore. */
  readonly custom?: boolean;
}

/** An MRC-20 token the user added, as saved per network. */
export interface CustomToken {
  readonly contract: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/**
 * The Massa mainnet tokens the wallet supports. MAS is the native coin
 * (`contract: ''`, 9 decimals — nanoMAS); everything else is an MRC-20 token
 * read/written through the `MRC20` contract wrapper at its `contract`
 * address. `decimals` are the contracts' own (`decimals()`): USDC.e has 6,
 * WBTC.e 8, the rest 18 — never assume 18.
 */
export const TOKEN_REGISTRY: Readonly<Record<TokenSymbol, TokenMeta<TokenSymbol>>> = {
  MAS: {
    id: 'MAS',
    symbol: 'MAS',
    name: 'Massa',
    decimals: 9,
    contract: '',
    isErc20: false,
    asset: 'assets/massa-token.png',
  },
  PUR: {
    id: 'PUR',
    symbol: 'PUR',
    name: 'Pur',
    decimals: 18,
    contract: 'AS133eqPPaPttJ6hJnk3sfoG5cjFFqBDi1VGxdo2wzWkq8AfZnan',
    isErc20: true,
    asset: 'assets/PUR.png',
  },
  DUSA: {
    id: 'DUSA',
    symbol: 'DUSA',
    name: 'Dusa',
    decimals: 18,
    contract: 'AS12HT1JQUne9nkHevS9Q7HcsoAaYLXWPNgoWPuruV7Gw6Mb92ACL',
    isErc20: true,
    asset: 'assets/DUSA.png',
  },
  'USDC.e': {
    id: 'USDC.e',
    symbol: 'USDC.e',
    name: 'USD Coin',
    decimals: 6,
    contract: 'AS1hCJXjndR4c9vekLWsXGnrdigp4AaZ7uYG3UKFzzKnWVsrNLPJ',
    isErc20: true,
    asset: 'assets/USDC.png',
  },
  'WETH.e': {
    id: 'WETH.e',
    symbol: 'WETH.e',
    name: 'Wrapped Ether',
    decimals: 18,
    contract: 'AS124vf3YfAJCSCQVYKczzuWWpXrximFpbTmX4rheLs5uNSftiiRY',
    isErc20: true,
    asset: 'assets/WETH.png',
  },
  'DAI.e': {
    id: 'DAI.e',
    symbol: 'DAI.e',
    name: 'Dai',
    decimals: 18,
    contract: 'AS1ZGF1upwp9kPRvDKLxFAKRebgg7b3RWDnhgV7VvdZkZsUL7Nuv',
    isErc20: true,
    asset: 'assets/DAI.png',
  },
  'WBTC.e': {
    id: 'WBTC.e',
    symbol: 'WBTC.e',
    name: 'Wrapped BTC',
    decimals: 8,
    contract: 'AS12fr54YtBY575Dfhtt7yftpT8KXgXb1ia5Pn1LofoLFLf9WcjGL',
    isErc20: true,
    asset: 'assets/BTC.png',
  },
  'WETH.b': {
    id: 'WETH.b',
    symbol: 'WETH.b',
    name: 'Wrapped Ether',
    decimals: 18,
    contract: 'AS125oPLYRTtfVjpWisPZVTLjBhCFfQ1jDsi75XNtRm1NZux54eCj',
    isErc20: true,
    asset: 'assets/WETH.png',
  },
  'USDT.b': {
    id: 'USDT.b',
    symbol: 'USDT.b',
    name: 'Tether USD',
    decimals: 18,
    contract: 'AS12LKs9txoSSy8JgFJgV96m8k5z9pgzjYMYSshwN67mFVuj3bdUV',
    isErc20: true,
    asset: 'assets/USDT.png',
  },
};

export const TOKEN_LIST: readonly TokenMeta<TokenSymbol>[] = Object.values(TOKEN_REGISTRY);

/** The meta of a custom token, shaped like a built-in one. */
export function customTokenMeta(token: CustomToken): TokenMeta {
  return { ...token, id: token.contract, isErc20: true, asset: '', custom: true };
}

/** A value per token id; the built-in symbols are spelled out so `.MAS` reads as a property. */
export type TokenMap<V> = Partial<Record<TokenSymbol, V>> & Partial<Record<TokenId, V>>;

/**
 * Sparse on purpose: a real wallet holds a handful of tokens at most.
 * Absence of a key means "0 / not held", not "unknown" — components should
 * treat `balances[id] ?? 0` as the held amount.
 */
export type TokenBalances = TokenMap<number>;
export type TokenPrices = TokenMap<number>;
