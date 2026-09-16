import { Component, inject, signal } from '@angular/core';
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
  selector: 'app-wallets-modal',
  imports: [ShortAddressPipe],
  templateUrl: './wallets-modal.html',
  styleUrl: './wallets-modal.scss',
})
export class WalletsModal {
  protected readonly modal = inject(Modal);
  protected readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly isAdding = signal(false);

  protected avatarColors(index: number): [string, string] {
    return AVATAR_COLORS[index % AVATAR_COLORS.length];
  }

  protected initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  protected select(id: string): void {
    this.store.switchWallet(id);
    this.modal.close();
    this.toast.show(`Switched to ${this.store.activeWallet().name}`);
  }

  protected async addWallet(): Promise<void> {
    this.isAdding.set(true);
    try {
      await this.store.addWallet();
      this.toast.show('New wallet created');
    } finally {
      this.isAdding.set(false);
    }
  }
}
