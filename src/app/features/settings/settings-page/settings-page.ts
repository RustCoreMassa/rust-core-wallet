import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { VaultAccount } from '../../../core/models/vault.model';
import { APP_PLATFORM, EXTENSION_VIEWS } from '../../../core/platform/app-platform';
import { APP_VERSION } from '../../../core/platform/app-version';
import { CONNECTED_SITES } from '../../../core/platform/connected-sites';
import { AuthStore } from '../../../core/state/auth-store';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { AVATAR_COLORS } from '../../../shared/ui/avatar-colors';

@Component({
  selector: 'app-settings-page',
  imports: [ShortAddressPipe],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);
  protected readonly authStore = inject(AuthStore);
  private readonly toast = inject(Toast);
  private readonly router = inject(Router);
  /** Extension only: switch between popup, side panel and full-screen tab. */
  protected readonly views = inject(EXTENSION_VIEWS);
  /** Extension only: sites connected through the dApp bridge. */
  protected readonly connectedSites = inject(CONNECTED_SITES);

  protected readonly connectedSitesLabel = computed(() => {
    const count = this.connectedSites?.sites().length ?? 0;
    return count === 0 ? 'None' : `${count} site${count > 1 ? 's' : ''}`;
  });

  /** For information only, at the bottom: which build is running. */
  protected readonly versionLabel = `RustCore Wallet ${APP_VERSION}${
    inject(APP_PLATFORM) === 'extension' ? ' · browser extension' : ''
  }`;

  protected readonly walletsCountLabel = computed(() => {
    const count = this.authStore.accounts().length;
    return `${count} wallet${count > 1 ? 's' : ''}`;
  });

  protected readonly isBuildnet = computed(() => this.store.network() === 'buildnet');

  protected readonly activeAccount = computed(
    () => this.authStore.accounts().find((a) => a.id === this.store.activeWalletId()) ?? null,
  );

  protected avatarColors(index: number): readonly [string, string] {
    return AVATAR_COLORS[index % AVATAR_COLORS.length];
  }

  protected initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  protected openRename(account: VaultAccount): void {
    this.modal.open('rename-account', account);
  }

  protected lockWallet(): void {
    this.authStore.lock();
    this.router.navigateByUrl('/login');
  }

  protected backupPhrase(): void {
    this.modal.open('backup-phrase');
  }

  protected toggleNetwork(): void {
    const next = this.isBuildnet() ? 'mainnet' : 'buildnet';
    this.store.setNetwork(next);
    this.toast.show(`Switched to ${next === 'mainnet' ? 'Mainnet' : 'Buildnet'}`);
  }

  protected logOut(): void {
    this.modal.open('logout');
  }
}
