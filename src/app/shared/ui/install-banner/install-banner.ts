import { Component, inject, signal } from '@angular/core';
import { InstallPrompt } from '../../../core/platform/install-prompt';
import { AuthStore } from '../../../core/state/auth-store';

/**
 * "Install as app" card. One button where the browser allows it (Android
 * Chromium); step-by-step instructions everywhere else, since iOS and
 * Firefox offer no install prompt a page can trigger.
 */
@Component({
  selector: 'app-install-banner',
  templateUrl: './install-banner.html',
  styleUrl: './install-banner.scss',
})
export class InstallBanner {
  protected readonly installer = inject(InstallPrompt);
  /** iOS gives the installed app its own storage — the warning depends on this. */
  protected readonly hasVault = inject(AuthStore).hasVault;
  protected readonly showSteps = signal(false);

  protected install(): void {
    this.installer.install().catch((err) => console.warn('Install prompt failed', err));
  }
}
