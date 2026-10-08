import { Component, inject, signal } from '@angular/core';
import { MOVED_TO } from '../../../core/platform/gateway';
import { AuthStore } from '../../../core/state/auth-store';

/**
 * Shown only on an old gateway (see core/platform/gateway.ts): the wallet
 * now lives at the official address, and a wallet saved here doesn't follow
 * it — browser storage stays with the address it was written on. The user
 * moves it by hand: back up the key here, import it there.
 */
@Component({
  selector: 'app-move-notice',
  templateUrl: './move-notice.html',
  // The same floating card as the install banner (which this page never shows).
  styleUrls: ['../install-banner/install-banner.scss', './move-notice.scss'],
})
export class MoveNotice {
  protected readonly url = inject(MOVED_TO);
  protected readonly host = this.url ? new URL(this.url).host : '';
  protected readonly hasVault = inject(AuthStore).hasVault;
  protected readonly showSteps = signal(false);
  /** "Later" hides it until the app is opened again — never for good. */
  protected readonly hidden = signal(false);
}
