import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CustomToken,
  TOKEN_LIST,
  TOKEN_REGISTRY,
  TokenId,
  TokenMeta,
  customTokenMeta,
} from '../models/token.model';
import { KeyValueStore, LOCAL_STORE } from '../platform/app-storage';
import { MASSA_PROVIDER, TokenInfo } from '../services/massa-provider';
import { Network, NetworkStore } from './network-store';

const STORAGE_KEY = 'massa-wallet:custom-tokens';

/** A smart-contract address: `AS` + base58 (user addresses, `AU…`, hold no token). */
const CONTRACT_ADDRESS = /^AS[1-9A-HJ-NP-Za-km-z]{40,60}$/;

/** Longest symbol / name kept (code points); longer ones are cut with "…". */
const MAX_SYMBOL_LENGTH = 16;
const MAX_NAME_LENGTH = 40;
/** MRC-20 stores decimals in a byte; past this, amounts stop making sense to show. */
const MAX_DECIMALS = 30;

/** The built-in MRC-20s live on mainnet only; buildnet starts with MAS alone. */
const BUILTIN_BY_NETWORK: Readonly<Record<Network, readonly TokenMeta[]>> = {
  mainnet: TOKEN_LIST,
  buildnet: [TOKEN_REGISTRY.MAS],
};

/** Symbols a custom token may not take: the built-in tokens' (an imitation's favourite). */
const RESERVED_SYMBOLS = new Set(TOKEN_LIST.map((t) => comparable(t.symbol)));

const BUILTIN_CONTRACTS = new Set(TOKEN_LIST.map((t) => t.contract).filter(Boolean));

type CustomTokens = Record<Network, readonly CustomToken[]>;

const NETWORK_LABEL: Readonly<Record<Network, string>> = {
  mainnet: 'Mainnet',
  buildnet: 'Buildnet',
};

/** Case- and lookalike-insensitive form (NFKC folds e.g. full-width "ＵＳＤＣ"). */
function comparable(symbol: string): string {
  return symbol.normalize('NFKC').toUpperCase();
}

/**
 * A contract's own text, made safe to show: control and invisible
 * characters (zero-width spaces, right-to-left overrides…) removed —
 * they can make one symbol look like another — whitespace collapsed,
 * length capped.
 */
export function cleanTokenText(text: string, maxLength: number): string {
  const clean = text
    .normalize('NFC')
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...clean];
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}…` : clean;
}

/** Checks a token's on-chain metadata; throws a user-facing message when it can't be added. */
export function toCustomToken(contract: string, info: TokenInfo): CustomToken {
  const symbol = cleanTokenText(info.symbol, MAX_SYMBOL_LENGTH);
  const name = cleanTokenText(info.name, MAX_NAME_LENGTH) || symbol;
  if (!symbol) throw new Error('This token has no symbol, so it would be hard to tell apart');
  if (RESERVED_SYMBOLS.has(comparable(symbol))) {
    throw new Error(
      `${symbol} is the symbol of a token RustCore already lists — this contract isn't that token`,
    );
  }
  if (!Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > MAX_DECIMALS) {
    throw new Error(`This token uses ${info.decimals} decimals, which RustCore can't show`);
  }
  return { contract, symbol, name, decimals: info.decimals };
}

function isCustomToken(value: unknown): value is CustomToken {
  const t = value as CustomToken;
  return (
    !!t &&
    typeof t.contract === 'string' &&
    CONTRACT_ADDRESS.test(t.contract) &&
    typeof t.symbol === 'string' &&
    typeof t.name === 'string' &&
    Number.isInteger(t.decimals)
  );
}

function load(store: KeyValueStore): CustomTokens {
  const empty: CustomTokens = { mainnet: [], buildnet: [] };
  try {
    const saved = JSON.parse(store.getItem(STORAGE_KEY) ?? 'null') as Partial<CustomTokens> | null;
    if (!saved) return empty;
    return {
      mainnet: (Array.isArray(saved.mainnet) ? saved.mainnet : []).filter(isCustomToken),
      buildnet: (Array.isArray(saved.buildnet) ? saved.buildnet : []).filter(isCustomToken),
    };
  } catch {
    return empty;
  }
}

/**
 * Which tokens the wallet shows on each network: MAS, the built-in MRC-20s
 * (mainnet), then the ones the user added by contract address.
 *
 * Custom tokens are a device preference, like the network choice: saved
 * per network in LOCAL_STORE, in plain text (they're public contracts) —
 * and cleared on log out with the rest. They are never vetted: anyone can
 * deploy a token with any name, so the UI always marks them as added by
 * the user and shows their contract.
 */
@Injectable({ providedIn: 'root' })
export class TokenCatalog {
  private readonly provider = inject(MASSA_PROVIDER);
  private readonly networkStore = inject(NetworkStore);
  private readonly store = inject(LOCAL_STORE);

  private readonly _custom = signal<CustomTokens>(load(this.store));

  /** Custom tokens on the current network, in the order they were added. */
  readonly custom = computed(() => this._custom()[this.networkStore.network()]);

  /** Every token on the current network: MAS first. */
  readonly tokens = computed(() => this.tokensOn(this.networkStore.network()));

  tokensOn(network: Network): readonly TokenMeta[] {
    return [...BUILTIN_BY_NETWORK[network], ...this._custom()[network].map(customTokenMeta)];
  }

  /** The MRC-20s whose balances are read on `network`. */
  mrc20On(network: Network): readonly TokenMeta[] {
    return this.tokensOn(network).filter((t) => t.isErc20);
  }

  /** The token with this id on the current network; `undefined` once a custom one is removed. */
  meta(id: TokenId): TokenMeta | undefined {
    return this.tokens().find((t) => t.id === id);
  }

  /**
   * What a history row or a message calls a token: its symbol, or — for a
   * custom token since removed — its shortened contract.
   */
  symbolOf(id: TokenId): string {
    const meta = this.meta(id);
    if (meta) return meta.symbol;
    return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  }

  /**
   * Reads the token at `contract` on the current network, for the user to
   * review before adding it. Nothing is saved.
   */
  async lookup(contract: string): Promise<{ network: Network; token: CustomToken }> {
    const network = this.networkStore.network();
    const address = contract.trim();
    if (!CONTRACT_ADDRESS.test(address)) {
      throw new Error('Enter a token contract address — it starts with AS');
    }
    if (BUILTIN_CONTRACTS.has(address) && network === 'mainnet') {
      throw new Error('This token is already in RustCore Wallet');
    }
    if (this._custom()[network].some((t) => t.contract === address)) {
      throw new Error("You've already added this token");
    }
    const info = await this.provider.getTokenInfo(address);
    if (!info) {
      throw new Error(`This address isn't an MRC-20 token on ${NETWORK_LABEL[network]}`);
    }
    return { network, token: toCustomToken(address, info) };
  }

  /** Saves a token returned by `lookup` (idempotent). */
  add(network: Network, token: CustomToken): void {
    if (this._custom()[network].some((t) => t.contract === token.contract)) return;
    this.update((all) => ({ ...all, [network]: [...all[network], token] }));
  }

  remove(network: Network, contract: string): void {
    this.update((all) => ({
      ...all,
      [network]: all[network].filter((t) => t.contract !== contract),
    }));
  }

  /** Forgets every custom token — on log out. */
  clear(): void {
    this._custom.set({ mainnet: [], buildnet: [] });
    try {
      this.store.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable — nothing was saved either.
    }
  }

  private update(change: (all: CustomTokens) => CustomTokens): void {
    const next = change(this._custom());
    this._custom.set(next);
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable or full — the list still holds until reload.
    }
  }
}
