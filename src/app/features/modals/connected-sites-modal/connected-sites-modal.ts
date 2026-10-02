import { Component, computed, inject, signal } from '@angular/core';
import { CONNECTED_SITES, ConnectedSites } from '../../../core/platform/connected-sites';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { AuthStore } from '../../../core/state/auth-store';
import { toUserMessage } from '../../../core/utils/user-error';
import { Dropdown, DropdownOption } from '../../../shared/ui/dropdown/dropdown';

/**
 * Settings → Connected sites (browser extension): every site connected to the wallet, the one
 * account each can see and ask to sign with, and a way to change it or disconnect the site.
 * The sites hear about it at once (docs/DAPP-CONNECTION.md → events).
 */
@Component({
  selector: 'app-connected-sites-modal',
  imports: [Dropdown],
  templateUrl: './connected-sites-modal.html',
  styleUrl: './connected-sites-modal.scss',
})
export class ConnectedSitesModal {
  protected readonly modal = inject(Modal);
  private readonly connected: ConnectedSites = inject(CONNECTED_SITES)!;
  private readonly auth = inject(AuthStore);
  private readonly toast = inject(Toast);

  protected readonly sites = this.connected.sites;
  protected readonly error = signal<string | null>(null);
  /** The site being changed or disconnected, so its controls wait. */
  protected readonly busyOrigin = signal<string | null>(null);

  /** Accounts by address — what the dropdown picks from. */
  protected readonly accountOptions = computed<DropdownOption[]>(() =>
    this.auth.accounts().map((a) => ({
      value: a.address,
      label: a.name,
      sublabel: `${a.address.slice(0, 6)}…${a.address.slice(-4)}`,
    })),
  );

  protected isKnown(address: string): boolean {
    return this.auth.accounts().some((a) => a.address === address);
  }

  protected since(grantedAt: number): string {
    return new Date(grantedAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected async changeAccount(origin: string, address: string): Promise<void> {
    await this.run(origin, () => this.connected.changeAccount(origin, address));
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
