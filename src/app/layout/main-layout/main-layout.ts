import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Modal } from '../../core/services/modal';
import { BottomNav } from '../../shared/ui/bottom-nav/bottom-nav';
import { ToastHost } from '../../shared/ui/toast-host/toast-host';
import { BuyRollModal } from '../../features/modals/buy-roll-modal/buy-roll-modal';
import { ReceiveModal } from '../../features/modals/receive-modal/receive-modal';
import { SellRollModal } from '../../features/modals/sell-roll-modal/sell-roll-modal';
import { SendModal } from '../../features/modals/send-modal/send-modal';
import { SwapModal } from '../../features/modals/swap-modal/swap-modal';
import { WalletsModal } from '../../features/modals/wallets-modal/wallets-modal';
import { RenameAccountModal } from '../../features/modals/rename-account-modal/rename-account-modal';
import { BackupPhraseModal } from '../../features/modals/backup-phrase-modal/backup-phrase-modal';
import { WalletStore } from '../../core/state/wallet-store';
import { AuthStore } from '../../core/state/auth-store';

@Component({
  selector: 'app-main-layout',
  imports: [
    RouterOutlet,
    BottomNav,
    ToastHost,
    ReceiveModal,
    SendModal,
    SwapModal,
    BuyRollModal,
    SellRollModal,
    WalletsModal,
    RenameAccountModal,
    BackupPhraseModal,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  protected readonly modal = inject(Modal);

  constructor() {
    const authStore = inject(AuthStore);
    const walletStore = inject(WalletStore);
    // Guarantee every real account has a matching demo-economy entry —
    // covers accounts added in a session before this shell last loaded.
    for (const account of authStore.accounts()) {
      walletStore.ensureWallet(account.id, account.name, account.address);
    }
  }

  protected onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.modal.close();
  }
}
