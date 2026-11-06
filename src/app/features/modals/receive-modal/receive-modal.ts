import { Component, computed, inject } from '@angular/core';
import { QrCodeComponent } from 'ng-qrcode';
import { SHARE_SHEET } from '../../../core/platform/share-sheet';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-receive-modal',
  imports: [QrCodeComponent],
  templateUrl: './receive-modal.html',
  styleUrl: './receive-modal.scss',
})
export class ReceiveModal {
  protected readonly modal = inject(Modal);
  protected readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);
  /** The apps: the phone's share menu (Messages, Mail, Telegram…). */
  protected readonly shareSheet = inject(SHARE_SHEET);

  /** Encoded as the bare address — what Massa wallets expect when scanning. */
  protected readonly address = computed(() => this.store.activeWallet().address);

  protected copyAddress(): void {
    navigator.clipboard
      .writeText(this.address())
      .then(() => this.toast.show('Address copied'))
      .catch(() => this.toast.show('Could not copy — copy manually'));
  }

  protected shareAddress(): void {
    this.shareSheet
      ?.share(this.address())
      .catch(() => this.toast.show('Could not share — copy the address instead'));
  }
}
