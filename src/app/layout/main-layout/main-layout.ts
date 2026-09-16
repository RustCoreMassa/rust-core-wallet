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
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  protected readonly modal = inject(Modal);

  protected onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.modal.close();
  }
}
