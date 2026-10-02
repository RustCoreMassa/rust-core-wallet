/// <reference types="chrome" />
// Which sites are connected, and to which account — see docs/DAPP-CONNECTION.md.
// Used by the background worker and by Settings → Connected sites, so no Angular here.

/** chrome.storage.local item holding every connected site. */
export const PERMISSIONS_ITEM = 'rustcore:dapp-permissions';

/** One connected site. The address is public on-chain, so it's stored in clear. */
export interface SitePermission {
  /** The one account this site sees and can ask to sign with. */
  readonly address: string;
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

/** Connected sites, kept in chrome.storage.local. Every call reads the stored map afresh. */
export class DappPermissions {
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

  async grant(origin: string, address: string): Promise<SitePermission> {
    const permission: SitePermission = { address, grantedAt: this.now() };
    await this.write({ ...(await this.all()), [origin]: permission });
    return permission;
  }

  /** Points a connected site at another account; false if the site isn't connected. */
  async changeAccount(origin: string, address: string): Promise<boolean> {
    const map = await this.all();
    const current = map[origin];
    if (!current) return false;
    await this.write({ ...map, [origin]: { ...current, address } });
    return true;
  }

  /** Disconnects a site; false if it wasn't connected. */
  async revoke(origin: string): Promise<boolean> {
    const { [origin]: removed, ...rest } = await this.all();
    if (!removed) return false;
    await this.write(rest);
    return true;
  }

  /** Disconnects every site connected to an account (e.g. when the account is removed). */
  async revokeAddress(address: string): Promise<string[]> {
    const map = await this.all();
    const origins = Object.keys(map).filter((o) => map[o].address === address);
    if (origins.length === 0) return [];
    await this.write(Object.fromEntries(Object.entries(map).filter(([o]) => !origins.includes(o))));
    return origins;
  }

  private async write(map: PermissionMap): Promise<void> {
    await this.area.set({ [PERMISSIONS_ITEM]: map });
  }
}

/** A stored value as a permission map; anything damaged or tampered with counts as empty. */
export function toPermissionMap(value: unknown): PermissionMap {
  return isPermissionMap(value) ? value : {};
}

function isPermissionMap(value: unknown): value is PermissionMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([origin, p]) =>
      dappOrigin(origin) === origin &&
      typeof p === 'object' &&
      p !== null &&
      typeof (p as SitePermission).address === 'string' &&
      typeof (p as SitePermission).grantedAt === 'number',
  );
}
