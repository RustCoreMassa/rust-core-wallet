import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CONNECTED_SITES } from '../platform/connected-sites';
import { WalletStore } from './wallet-store';

/**
 * The site in the active tab is connected, but doesn't use the active wallet:
 * - `not-connected`: the wallet isn't one of the accounts it may see;
 * - `not-in-use`: it may see it, but doesn't follow wallet switches (an older dApp) and still
 *   uses another account, `inUseName`.
 */
export interface SiteNotice {
  readonly kind: 'not-connected' | 'not-in-use';
  readonly origin: string;
  readonly host: string;
  readonly address: string;
  readonly name: string;
  /** For `not-in-use`: the wallet's name for the account the site uses; null if unknown. */
  readonly inUseName: string | null;
}

/**
 * The extension's link between the active wallet and connected sites, as in MetaMask:
 * - switching wallets makes it the account in use on every site that may see it and follows
 *   the wallet (older dApps don't: they'd sign from another account than the one they show);
 * - when the site in the browser's active tab is connected, but doesn't use the active wallet,
 *   the Home screen says so and offers to connect it / use it there (`notice`, `connectActive`).
 * Does nothing in the web app (no CONNECTED_SITES).
 */
@Injectable({ providedIn: 'root' })
export class SiteConnection {
  private readonly sites = inject(CONNECTED_SITES);
  private readonly store = inject(WalletStore);

  /** The active tab's site; null when there's none or it can't host a dApp. */
  private readonly tabOrigin = signal<string | null>(null);
  /** Notices the user closed, as `origin address`; they stay closed while the shell is open. */
  private readonly dismissed = signal<ReadonlySet<string>>(new Set());

  private readonly activeAddress = computed(
    () => this.store.wallets()[this.store.activeWalletId()]?.address ?? null,
  );

  readonly notice = computed<SiteNotice | null>(() => {
    const origin = this.tabOrigin();
    const wallet = this.store.wallets()[this.store.activeWalletId()];
    if (!this.sites || !origin || !wallet) return null;
    const site = this.sites.sites().find((s) => s.origin === origin);
    if (!site || site.addresses[0] === wallet.address) return null;
    const kind = site.addresses.includes(wallet.address) ? 'not-in-use' : 'not-connected';
    // A site that follows the wallet moves to it at the switch; the list may lag a moment.
    if (kind === 'not-in-use' && site.followsWallet) return null;
    if (this.dismissed().has(`${origin} ${wallet.address}`)) return null;
    const inUse = site.addresses[0];
    return {
      kind,
      origin,
      host: new URL(origin).host,
      address: wallet.address,
      name: wallet.name,
      inUseName: Object.values(this.store.wallets()).find((w) => w.address === inUse)?.name ?? null,
    };
  });

  /**
   * Starts following the active wallet and tab. Call from the shell's constructor: both stop
   * with it. Only a switch counts: the wallet the shell opens with changes no site — after a
   * lock it is simply the first one, not the user's choice.
   */
  start(): void {
    const sites = this.sites;
    if (!sites) return;
    let previous: string | null = null;
    effect(() => {
      const address = this.activeAddress();
      const switched = previous !== null && address !== null && address !== previous;
      previous = address ?? previous;
      if (switched) {
        untracked(() =>
          sites
            .useAccount(address)
            .catch((err) => console.warn('Moving connected sites to the wallet failed', err)),
        );
      }
    });
    const readTab = () =>
      sites
        .activeTabOrigin()
        .then((origin) => this.tabOrigin.set(origin))
        .catch(() => this.tabOrigin.set(null));
    void readTab();
    inject(DestroyRef).onDestroy(sites.watchActiveTab(() => void readTab()));
  }

  /** Lets the site see the active wallet (if it didn't), and use it. */
  async connectActive(): Promise<void> {
    const notice = this.notice();
    if (!notice || !this.sites) return;
    await this.sites.addAccount(notice.origin, notice.address, true);
  }

  dismiss(): void {
    const notice = this.notice();
    if (!notice) return;
    this.dismissed.update((keys) => new Set([...keys, `${notice.origin} ${notice.address}`]));
  }
}
