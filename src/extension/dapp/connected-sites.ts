/// <reference types="chrome" />
// The extension's ConnectedSites: the permissions the background router keeps in
// chrome.storage.local, for Settings → Connected sites and the Home notice. Writes go straight to
// storage; the router hears about them (chrome.storage.onChanged) and tells the sites.
import { Signal, signal } from '@angular/core';
import { ConnectedSite, ConnectedSites } from '../../app/core/platform/connected-sites';
import { ORIGIN_QUERY } from './content';
import {
  DappPermissions,
  PERMISSIONS_ITEM,
  PermissionMap,
  dappOrigin,
  toPermissionMap,
} from './permissions';

type LocalArea = ConstructorParameters<typeof DappPermissions>[0];
type OnChanged = Pick<typeof chrome.storage.onChanged, 'addListener'>;
/** The parts of chrome.tabs used to find the active tab's site — none needs a permission. */
export type TabsApi = Pick<
  typeof chrome.tabs,
  'query' | 'sendMessage' | 'onActivated' | 'onUpdated'
>;

export class ChromeConnectedSites implements ConnectedSites {
  private readonly permissions: DappPermissions;
  private readonly _sites = signal<readonly ConnectedSite[]>([]);
  readonly sites: Signal<readonly ConnectedSite[]> = this._sites.asReadonly();

  constructor(
    area: LocalArea,
    onChanged: OnChanged,
    private readonly tabs: TabsApi | null = null,
  ) {
    this.permissions = new DappPermissions(area);
    onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[PERMISSIONS_ITEM]) {
        this._sites.set(toSites(toPermissionMap(changes[PERMISSIONS_ITEM].newValue)));
      }
    });
    this.permissions
      .all()
      .then((map) => this._sites.set(toSites(map)))
      .catch((err) => console.warn('Reading connected sites failed', err));
  }

  async addAccount(origin: string, address: string, current: boolean): Promise<void> {
    await this.permissions.addAccount(origin, address, current);
    await this.reload();
  }

  async removeAccount(origin: string, address: string): Promise<void> {
    await this.permissions.removeAccount(origin, address);
    await this.reload();
  }

  async useAccount(address: string): Promise<void> {
    await this.permissions.useAccount(address);
    await this.reload();
  }

  async disconnect(origin: string): Promise<void> {
    await this.permissions.revoke(origin);
    await this.reload();
  }

  async forgetAccount(address: string): Promise<void> {
    await this.permissions.removeAddress(address);
    await this.reload();
  }

  async clear(): Promise<void> {
    await this.permissions.clear();
    await this.reload();
  }

  /**
   * Asks the content script of the active tab which site it shows. A tab without it (a browser
   * page, the wallet's own tab, a site it can't run on) has no answer: null.
   */
  async activeTabOrigin(): Promise<string | null> {
    if (!this.tabs) return null;
    try {
      const [tab] = await this.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) return null;
      const answer: unknown = await this.tabs.sendMessage(tab.id, ORIGIN_QUERY, { frameId: 0 });
      return typeof answer === 'string' && dappOrigin(answer) === answer ? answer : null;
    } catch {
      return null;
    }
  }

  watchActiveTab(callback: () => void): () => void {
    if (!this.tabs) return () => {};
    const activated = () => callback();
    const updated = (_tabId: number, info: { status?: string }) => {
      if (info.status === 'complete') callback();
    };
    this.tabs.onActivated.addListener(activated);
    this.tabs.onUpdated.addListener(updated);
    return () => {
      this.tabs?.onActivated.removeListener(activated);
      this.tabs?.onUpdated.removeListener(updated);
    };
  }

  /** Our own writes show at once, without waiting for the change event. */
  private async reload(): Promise<void> {
    this._sites.set(toSites(await this.permissions.all()));
  }
}

function toSites(map: PermissionMap): ConnectedSite[] {
  return Object.entries(map)
    .map(([origin, p]) => ({ origin, addresses: p.addresses, grantedAt: p.grantedAt }))
    .sort((a, b) => a.grantedAt - b.grantedAt);
}
