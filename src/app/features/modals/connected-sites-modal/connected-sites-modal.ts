import { Component, computed, inject, signal } from '@angular/core';
import {
  CONNECTED_SITES,
  ConnectedSite,
  ConnectedSites,
} from '../../../core/platform/connected-sites';
import { SITE_ACCESS } from '../../../core/platform/site-access';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { AuthStore } from '../../../core/state/auth-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { toUserMessage } from '../../../core/utils/user-error';

/** One account a site can see, as listed under it. */
interface SiteAccount {
  readonly address: string;
  /** The wallet's name for it; null when it's no longer in the wallet. */
  readonly name: string | null;
  readonly short: string;
  /** The account the site uses now (the first of its list). */
  readonly inUse: boolean;
}

/**
 * Settings → Connected sites (browser extension): every site connected to the wallet, the
 * accounts each can see and ask to sign with — the one in use first — and ways to add or take
 * away an account, or disconnect the site. Like MetaMask, the site uses the most recently active
 * wallet among them — or, for an older dApp that doesn't follow wallet switches, the one chosen
 * here. The sites hear about it at once (docs/DAPP-CONNECTION.md → events).
 */
@Component({
  selector: 'app-connected-sites-modal',
  templateUrl: './connected-sites-modal.html',
  styleUrl: './connected-sites-modal.scss',
})
export class ConnectedSitesModal {
  protected readonly modal = inject(Modal);
  private readonly connected: ConnectedSites = inject(CONNECTED_SITES)!;
  private readonly auth = inject(AuthStore);
  private readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly sites = this.connected.sites;
  private readonly siteAccess = inject(SITE_ACCESS);
  /** The browser has withdrawn the extension's access to websites: no site can connect. */
  protected readonly accessOff = computed(() => this.siteAccess?.granted() === false);
  protected readonly error = signal<string | null>(null);
  /** The site being changed or disconnected, so its controls wait. */
  protected readonly busyOrigin = signal<string | null>(null);

  protected accountsOf(site: ConnectedSite): SiteAccount[] {
    const accounts = this.auth.accounts();
    return site.addresses.map((address, i) => ({
      address,
      name: accounts.find((a) => a.address === address)?.name ?? null,
      short: short(address),
      inUse: i === 0,
    }));
  }

  /** The wallets the site can't see yet, to add. */
  protected addable(site: ConnectedSite): { address: string; name: string }[] {
    return this.auth
      .accounts()
      .filter((a) => !site.addresses.includes(a.address))
      .map((a) => ({ address: a.address, name: a.name }));
  }

  /** Straight from the click — the browser only shows its prompt for a user gesture. */
  protected allowSites(): void {
    this.error.set(null);
    this.siteAccess
      ?.request()
      .then((granted) => {
        if (granted) this.toast.show('Sites can connect to RustCore Wallet again');
      })
      .catch((err) => this.error.set(toUserMessage(err)));
  }

  protected since(grantedAt: number): string {
    return new Date(grantedAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  /** The active wallet, once added, is the one the site uses; any other goes after. */
  protected async addAccount(origin: string, address: string): Promise<void> {
    const active = this.store.wallets()[this.store.activeWalletId()]?.address;
    await this.run(origin, () => this.connected.addAccount(origin, address, address === active));
  }

  /** For a site that doesn't follow the wallet: the account it uses from now on. */
  protected async useOn(origin: string, address: string): Promise<void> {
    await this.run(origin, () => this.connected.addAccount(origin, address, true));
  }

  protected async removeAccount(origin: string, address: string): Promise<void> {
    await this.run(origin, () => this.connected.removeAccount(origin, address));
  }

  protected async disconnect(origin: string): Promise<void> {
    if (await this.run(origin, () => this.connected.disconnect(origin))) {
      this.toast.show(`${new URL(origin).host} disconnected`);
    }
  }

  private async run(origin: string, action: () => Promise<void>): Promise<boolean> {
    this.busyOrigin.set(origin);
    this.error.set(null);
    try {
      await action();
      return true;
    } catch (err) {
      this.error.set(toUserMessage(err));
      return false;
    } finally {
      this.busyOrigin.set(null);
    }
  }
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
