import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MnsDomain } from '../../../core/models/nft.model';
import { Modal } from '../../../core/services/modal';
import { WalletStore } from '../../../core/state/wallet-store';
import { avatarColorsFor } from '../../../shared/ui/avatar-colors';

/**
 * MNS domains owned by the active wallet, read on-chain from the Massa
 * Name System contract on the current network. They're cached in
 * WalletStore, so revisiting the page shows them instantly; the chain is
 * re-read in the background only when the cached list is stale.
 *
 * NFTs are shown as "coming soon" until an NFT data source is chosen.
 */
@Component({
  selector: 'app-nfts-page',
  imports: [],
  templateUrl: './nfts-page.html',
  styleUrl: './nfts-page.scss',
})
export class NftsPage {
  protected readonly store = inject(WalletStore);
  private readonly modal = inject(Modal);

  protected readonly domains = computed(() => this.store.activeWallet().domains);

  protected readonly hasError = signal(false);

  constructor() {
    // (Re)load on open and whenever the active wallet or network changes.
    effect(() => {
      this.store.activeWalletId();
      this.store.network();
      untracked(() => this.load());
    });
  }

  /** Placeholder rows while the first read is in flight. */
  protected readonly skeletonRows = [0, 1, 2];

  protected avatar(name: string): string {
    const [from, to] = avatarColorsFor(name);
    return `linear-gradient(155deg, ${from}, ${to})`;
  }

  protected openDomain(domain: MnsDomain): void {
    this.modal.open('domain-details', domain);
  }

  private load(): void {
    this.hasError.set(false);
    this.store.loadDomains().catch((err) => {
      this.hasError.set(true);
      console.warn('Loading MNS domains failed', err);
    });
  }
}
