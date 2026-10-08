import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { QrCodeComponent } from 'ng-qrcode';
import { APP_PLATFORM } from './core/platform/app-platform';
import { Device, MOBILE_ONLY } from './core/platform/device';
import { MOVED_TO } from './core/platform/gateway';
import { InstallBanner } from './shared/ui/install-banner/install-banner';
import { MoveNotice } from './shared/ui/move-notice/move-notice';

@Component({
  imports: [RouterOutlet, QrCodeComponent, InstallBanner, MoveNotice],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly device = inject(Device);
  private readonly mobileOnly = inject(MOBILE_ONLY);

  /** On desktop the wallet never starts: no routes, no vault access. */
  protected readonly blocked = computed(() => this.mobileOnly && !this.device.isMobile());

  /** On an old gateway: the official address, where the wallet now lives. */
  protected readonly movedTo = inject(MOVED_TO);

  /**
   * Only the web app installs as an app; the extension already is one. Never
   * from an old gateway — the app would be installed at the address it left.
   */
  protected readonly installable = inject(APP_PLATFORM) === 'web' && this.movedTo === null;

  /** Scanning this opens the same page on the phone (at its official address). */
  protected readonly pageUrl = this.movedTo ?? location.href;
}
