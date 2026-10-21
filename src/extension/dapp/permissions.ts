/// <reference types="chrome" />
// Which sites are connected, and to which account — see docs/DAPP-CONNECTION.md.
// Used by the background worker and by Settings → Connected sites, so no Angular here.

/** chrome.storage.local item holding every connected site. */
export const PERMISSIONS_ITEM = 'rustcore:dapp-permissions';

/** One connected site. Addresses are public on-chain, so they're stored in clear. */
export interface SitePermission {
  /**
   * The accounts this site may see and ask to sign with, never empty. The first is the site's
   * current account: the one it uses unless it names another (`from`). For a site that
   * `followsWallet`, like MetaMask, it is the wallet's most recently active account among them.
   */
  readonly addresses: readonly string[];
  /**
   * The site showed it handles several accounts (it asked for `accounts`, or named its signer
   * with `from`), so it follows the wallet the user switches to. Sites that never did — dApps
   * on an older wallet-provider, sites connected before 1.6.0 — sign without `from` and show
   * the account they were given: their current account changes only by hand, or a signature
   * could come from another account than the one the dApp shows (docs/DAPP-CONNECTION.md).
   */
  readonly followsWallet: boolean;
  /** When the user approved the connection (ms epoch). */
  readonly grantedAt: number;
}

export type PermissionMap = Readonly<Record<string, SitePermission>>;

type LocalArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

/**
 * The origin of a page allowed to talk to the wallet, or null. Only https pages qualify, plus
 * http on localhost / 127.0.0.1 for dApp developers. Takes the URL the browser reports for the
 * sender — never anything the page itself sent.
 */
export function dappOrigin(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'https:') return parsed.origin;
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    return parsed.origin;
  }
  return null;
}

/**
 * Connected sites, kept in chrome.storage.local. Every call reads the stored map afresh; changes
 * run one at a time, so two at once (two sites asking for their accounts together) can't
 * overwrite each other.
 */
export class DappPermissions {
  /** The last change started; the next one waits for it. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly area: LocalArea,
    private readonly now: () => number = Date.now,
  ) {}

  async all(): Promise<PermissionMap> {
    return toPermissionMap((await this.area.get(PERMISSIONS_ITEM))[PERMISSIONS_ITEM]);
  }

  async get(origin: string): Promise<SitePermission | null> {
    return (await this.all())[origin] ?? null;
  }

  /** Connects a site to `addresses` (at least one); the first becomes its current account. */
  async grant(origin: string, addresses: readonly string[]): Promise<SitePermission> {
    const list = unique(addresses);
    if (list.length === 0) throw new Error('A site needs at least one account');
    const permission: SitePermission = {
      addresses: list,
      followsWallet: false,
      grantedAt: this.now(),
    };
    return this.change((map) => [{ ...map, [origin]: permission }, permission]);
  }

  /**
   * Lets a connected site see one more account — as its current account when `current`, else
   * after the others. False if the site isn't connected.
   */
  async addAccount(origin: string, address: string, current: boolean): Promise<boolean> {
    return this.change((map) => {
      const site = map[origin];
      if (!site) return [null, false];
      const others = site.addresses.filter((a) => a !== address);
      const addresses = current ? [address, ...others] : [...others, address];
      if (sameList(addresses, site.addresses)) return [null, true];
      return [{ ...map, [origin]: { ...site, addresses } }, true];
    });
  }

  /**
   * Takes one account away from a site; the site is disconnected when it was its last one.
   * False if the site didn't have it.
   */
  async removeAccount(origin: string, address: string): Promise<boolean> {
    return this.change((map) =>
      map[origin]?.addresses.includes(address)
        ? [withoutAddress(map, address, origin), true]
        : [null, false],
    );
  }

  /**
   * The site showed it handles several accounts: from now on it follows the wallet the user
   * switches to. False if the site isn't connected.
   */
  async followWallet(origin: string): Promise<boolean> {
    return this.change((map) => {
      const site = map[origin];
      if (!site) return [null, false];
      if (site.followsWallet) return [null, true];
      return [{ ...map, [origin]: { ...site, followsWallet: true } }, true];
    });
  }

  /**
   * The wallet switched to `address`: it becomes the current account of every site that may
   * see it and follows the wallet. Returns the sites whose current account changed.
   */
  async useAccount(address: string): Promise<string[]> {
    return this.change((map) => {
      const moved = Object.keys(map).filter(
        (o) =>
          map[o].followsWallet &&
          map[o].addresses.includes(address) &&
          map[o].addresses[0] !== address,
      );
      if (moved.length === 0) return [null, []];
      const next = { ...map };
      for (const origin of moved) {
        const site = map[origin];
        next[origin] = {
          ...site,
          addresses: [address, ...site.addresses.filter((a) => a !== address)],
        };
      }
      return [next, moved];
    });
  }

  /** Disconnects a site; false if it wasn't connected. */
  async revoke(origin: string): Promise<boolean> {
    return this.change((map) => {
      const { [origin]: removed, ...rest } = map;
      return removed ? [rest, true] : [null, false];
    });
  }

  /**
   * Takes an account away from every site (it was removed from the wallet). Sites left without
   * an account are disconnected; returns them.
   */
  async removeAddress(address: string): Promise<string[]> {
    return this.change((map) => {
      if (!Object.values(map).some((site) => site.addresses.includes(address))) return [null, []];
      const next = withoutAddress(map, address);
      return [next, Object.keys(map).filter((origin) => !next[origin])];
    });
  }

  /** Disconnects every site (log out: the wallets they were connected to are gone). */
  async clear(): Promise<void> {
    return this.change(() => [{}, undefined]);
  }

  /**
   * Reads the map, lets `edit` say what it becomes (null: unchanged) and what to return, and
   * writes it — after every change started before this one.
   */
  private change<T>(edit: (map: PermissionMap) => [PermissionMap | null, T]): Promise<T> {
    const run = this.queue.then(async () => {
      const [next, result] = edit(await this.all());
      if (next) await this.area.set({ [PERMISSIONS_ITEM]: next });
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** `map` without `address` (on one site, or on all); sites left with no account are dropped. */
function withoutAddress(map: PermissionMap, address: string, onlyOrigin?: string): PermissionMap {
  const next: Record<string, SitePermission> = {};
  for (const [origin, site] of Object.entries(map)) {
    if (onlyOrigin !== undefined && origin !== onlyOrigin) {
      next[origin] = site;
      continue;
    }
    const addresses = site.addresses.filter((a) => a !== address);
    if (addresses.length > 0) next[origin] = { ...site, addresses };
  }
  return next;
}

function unique(addresses: readonly string[]): string[] {
  return [...new Set(addresses)];
}

/** Same accounts in the same order? */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * A stored value as a permission map; anything damaged or tampered with counts as empty. Sites
 * saved before multiple accounts (`{ address, grantedAt }`) read as connected to that one, and
 * not following the wallet.
 */
export function toPermissionMap(value: unknown): PermissionMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const map: Record<string, SitePermission> = {};
  for (const [origin, stored] of Object.entries(value)) {
    const site = toSitePermission(stored);
    if (!site || dappOrigin(origin) !== origin) return {};
    map[origin] = site;
  }
  return map;
}

function toSitePermission(value: unknown): SitePermission | null {
  if (typeof value !== 'object' || value === null) return null;
  const { addresses, address, followsWallet, grantedAt } = value as Record<string, unknown>;
  if (typeof grantedAt !== 'number') return null;
  if (Array.isArray(addresses)) {
    if (addresses.length === 0 || !addresses.every((a) => typeof a === 'string')) return null;
    return { addresses: unique(addresses), followsWallet: followsWallet === true, grantedAt };
  }
  return typeof address === 'string'
    ? { addresses: [address], followsWallet: false, grantedAt }
    : null;
}
