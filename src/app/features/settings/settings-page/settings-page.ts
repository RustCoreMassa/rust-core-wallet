import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-settings-page',
  imports: [],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);
  private readonly toast = inject(Toast);
  private readonly router = inject(Router);

  protected readonly walletsCountLabel = computed(() => {
    const count = this.store.walletList().length;
    return `${count} wallet${count > 1 ? 's' : ''}`;
  });

  protected readonly isTestnet = computed(() => this.store.network() === 'testnet');

  protected lockWallet(): void {
    this.store.lock();
    this.router.navigateByUrl('/login');
  }

  protected backupPhrase(): void {
    this.toast.show('Backup flow — mocked, not implemented');
  }

  protected logOut(): void {
    this.toast.show('Logged out (mock)');
  }
}
