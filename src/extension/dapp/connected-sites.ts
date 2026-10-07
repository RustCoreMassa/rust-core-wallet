/// <reference types="chrome" />
// The extension's ConnectedSites: the permissions the background router keeps in
// chrome.storage.local, for Settings → Connected sites. Writes go straight to storage; the
// router hears about them (chrome.storage.onChanged) and tells the sites.
import { Signal, signal } from '@angular/core';
import { ConnectedSite, ConnectedSites } from '../../app/core/platform/connected-sites';
import { DappPermissions, PERMISSIONS_ITEM, PermissionMap, toPermissionMap } from './permissions';

type LocalArea = ConstructorParameters<typeof DappPermissions>[0];
type OnChanged = Pick<typeof chrome.storage.onChanged, 'addListener'>;

export class ChromeConnectedSites implements ConnectedSites {
  private readonly permissions: DappPermissions;
  private readonly _sites = signal<readonly ConnectedSite[]>([]);
  readonly sites: Signal<readonly ConnectedSite[]> = this._sites.asReadonly();

  constructor(area: LocalArea, onChanged: OnChanged) {
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

  async changeAccount(origin: string, address: string): Promise<void> {
    await this.permissions.changeAccount(origin, address);
    await this.reload();
  }

  async disconnect(origin: string): Promise<void> {
    await this.permissions.revoke(origin);
    await this.reload();
  }

  async forgetAccount(address: string): Promise<void> {
    await this.permissions.revokeAddress(address);
    await this.reload();
  }

  async clear(): Promise<void> {
    await this.permissions.clear();
    await this.reload();
  }

  /** Our own writes show at once, without waiting for the change event. */
  private async reload(): Promise<void> {
    this._sites.set(toSites(await this.permissions.all()));
  }
}

function toSites(map: PermissionMap): ConnectedSite[] {
  return Object.entries(map)
    .map(([origin, p]) => ({ origin, address: p.address, grantedAt: p.grantedAt }))
    .sort((a, b) => a.grantedAt - b.grantedAt);
}
