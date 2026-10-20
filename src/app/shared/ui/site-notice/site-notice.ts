import { Component, inject, signal } from '@angular/core';
import { SiteConnection } from '../../../core/state/site-connection';
import { toUserMessage } from '../../../core/utils/user-error';

/**
 * Extension, Home: the site in the active tab is connected, but not to the active wallet (as
 * MetaMask's "Not connected"). The site keeps using one of the accounts it may see; one tap
 * lets it see this one too, and use it.
 */
@Component({
  selector: 'app-site-notice',
  templateUrl: './site-notice.html',
  styleUrl: './site-notice.scss',
})
export class SiteNoticeCard {
  protected readonly connection = inject(SiteConnection);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async connect(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.connection.connectActive();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
