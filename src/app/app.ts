import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { QrCodeComponent } from 'ng-qrcode';
import { APP_PLATFORM } from './core/platform/app-platform';
import { Device, MOBILE_ONLY } from './core/platform/device';
import { InstallBanner } from './shared/ui/install-banner/install-banner';

@Component({
  imports: [RouterOutlet, QrCodeComponent, InstallBanner],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly device = inject(Device);
  private readonly mobileOnly = inject(MOBILE_ONLY);

  /** On desktop the wallet never starts: no routes, no vault access. */
  protected readonly blocked = computed(() => this.mobileOnly && !this.device.isMobile());

  /** Only the web app installs as an app; the extension already is one. */
  protected readonly installable = inject(APP_PLATFORM) === 'web';

  /** Scanning this opens the same page on the phone. */
  protected readonly pageUrl = location.href;
}
