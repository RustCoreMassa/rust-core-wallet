export type TokenSymbol = 'MAS' | 'USDC' | 'WETH';

export interface TokenMeta {
  readonly symbol: TokenSymbol;
  readonly name: string;
  readonly decimals: number;
}

export const TOKEN_REGISTRY: Readonly<Record<TokenSymbol, TokenMeta>> = {
  MAS: { symbol: 'MAS', name: 'Massa', decimals: 2 },
  USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 2 },
  WETH: { symbol: 'WETH', name: 'Wrapped ETH', decimals: 4 },
};

export type TokenBalances = Record<TokenSymbol, number>;
export type TokenPrices = Record<TokenSymbol, number>;
