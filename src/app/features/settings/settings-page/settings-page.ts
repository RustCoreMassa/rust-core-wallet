import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { VaultAccount } from '../../../core/models/vault.model';
import { AuthStore } from '../../../core/state/auth-store';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';

const AVATAR_COLORS: readonly [string, string][] = [
  ['#ff2d42', '#7a0f1c'],
  ['#4361ff', '#1c2a8f'],
  ['#ff8a3d', '#a84f10'],
  ['#33d17a', '#0f6b3a'],
];

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

  protected readonly walletsCountLabel = computed(() => {
    const count = this.authStore.accounts().length;
    return `${count} wallet${count > 1 ? 's' : ''}`;
  });

  protected readonly isBuildnet = computed(() => this.store.network() === 'buildnet');

  protected readonly activeAccount = computed(
    () => this.authStore.accounts().find((a) => a.id === this.store.activeWalletId()) ?? null,
  );

  protected avatarColors(index: number): [string, string] {
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
