export type TokenSymbol =
  'MAS' | 'PUR' | 'DUSA' | 'USDC.e' | 'WETH.e' | 'DAI.e' | 'WBTC.e' | 'WETH.b' | 'USDT.b';

export interface TokenMeta {
  readonly symbol: TokenSymbol;
  readonly name: string;
  readonly decimals: number;
  /** MRC-20 contract address; empty string for the native MAS coin. */
  readonly contract: string;
  readonly isErc20: boolean;
  readonly asset: string;
}

/**
 * The real Massa mainnet token list (mirrors the `getTokens()` list from
 * the reference MassaService). MAS is the native coin (`contract: ''`,
 * 9 decimals — nanoMAS); everything else is an MRC-20 token read/written
 * through the `MRC20` contract wrapper at its `contract` address.
 */
export const TOKEN_REGISTRY: Readonly<Record<TokenSymbol, TokenMeta>> = {
  MAS: {
    symbol: 'MAS',
    name: 'Massa',
    decimals: 9,
    contract: '',
    isErc20: false,
    asset: 'assets/massa-token.png',
  },
  PUR: {
    symbol: 'PUR',
    name: 'Pur',
    decimals: 18,
    contract: 'AS133eqPPaPttJ6hJnk3sfoG5cjFFqBDi1VGxdo2wzWkq8AfZnan',
    isErc20: true,
    asset: 'assets/charlie.webp',
  },
  DUSA: {
    symbol: 'DUSA',
    name: 'Dusa',
    decimals: 18,
    contract: 'AS12HT1JQUne9nkHevS9Q7HcsoAaYLXWPNgoWPuruV7Gw6Mb92ACL',
    isErc20: true,
    asset: 'assets/DUSA.png',
  },
  'USDC.e': {
    symbol: 'USDC.e',
    name: 'USD Coin (bridged)',
    decimals: 18,
    contract: 'AS1hCJXjndR4c9vekLWsXGnrdigp4AaZ7uYG3UKFzzKnWVsrNLPJ',
    isErc20: true,
    asset: 'assets/USDC.png',
  },
  'WETH.e': {
    symbol: 'WETH.e',
    name: 'Wrapped ETH (Etherscan bridge)',
    decimals: 18,
    contract: 'AS124vf3YfAJCSCQVYKczzuWWpXrximFpbTmX4rheLs5uNSftiiRY',
    isErc20: true,
    asset: 'assets/WETH.png',
  },
  'DAI.e': {
    symbol: 'DAI.e',
    name: 'Dai (bridged)',
    decimals: 18,
    contract: 'AS1ZGF1upwp9kPRvDKLxFAKRebgg7b3RWDnhgV7VvdZkZsUL7Nuv',
    isErc20: true,
    asset: 'assets/DAI.png',
  },
  'WBTC.e': {
    symbol: 'WBTC.e',
    name: 'Wrapped BTC (bridged)',
    decimals: 18,
    contract: 'AS12fr54YtBY575Dfhtt7yftpT8KXgXb1ia5Pn1LofoLFLf9WcjGL',
    isErc20: true,
    asset: 'assets/BTC.png',
  },
  'WETH.b': {
    symbol: 'WETH.b',
    name: 'Wrapped ETH (Base bridge)',
    decimals: 18,
    contract: 'AS125oPLYRTtfVjpWisPZVTLjBhCFfQ1jDsi75XNtRm1NZux54eCj',
    isErc20: true,
    asset: 'assets/WETH.png',
  },
  'USDT.b': {
    symbol: 'USDT.b',
    name: 'Tether USD (Base bridge)',
    decimals: 18,
    contract: 'AS12LKs9txoSSy8JgFJgV96m8k5z9pgzjYMYSshwN67mFVuj3bdUV',
    isErc20: true,
    asset: 'assets/USDT.png',
  },
};

export const TOKEN_LIST: readonly TokenMeta[] = Object.values(TOKEN_REGISTRY);

/**
 * Sparse on purpose: a real wallet holds a handful of these tokens at
 * most, never all nine. Absence of a key means "0 / not held", not
 * "unknown" — components should treat `balances[symbol] ?? 0` as the
 * held amount.
 */
export type TokenBalances = Partial<Record<TokenSymbol, number>>;
export type TokenPrices = Partial<Record<TokenSymbol, number>>;
