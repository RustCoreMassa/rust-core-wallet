import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MnsDomain, OwnedNft } from '../../../core/models/nft.model';
import { Modal } from '../../../core/services/modal';
import { NftStore } from '../../../core/state/nft-store';
import { WalletStore } from '../../../core/state/wallet-store';
import { avatarColorsFor } from '../../../shared/ui/avatar-colors';
import { NftDetailsPayload } from '../../modals/nft-details-modal/nft-details-modal';
import { NftCard } from '../nft-card/nft-card';

/**
 * MNS domains and NFTs owned by the active wallet, read on-chain on the
 * current network.
 *
 * Domains come from the Massa Name System contract and are cached in
 * WalletStore, so revisiting the page shows them instantly; the chain is
 * re-read in the background only when the cached list is stale. New names
 * are registered from here (RegisterDomainModal).
 *
 * NFTs come only from collections listed on RustCore Launchpad (NftStore):
 * NFTs any other contract sends to the wallet are never shown.
 */
@Component({
  selector: 'app-nfts-page',
  imports: [NftCard],
  templateUrl: './nfts-page.html',
  styleUrl: './nfts-page.scss',
})
export class NftsPage {
  protected readonly store = inject(WalletStore);
  private readonly nftStore = inject(NftStore);
  private readonly modal = inject(Modal);

  protected readonly domains = computed(() => this.store.activeWallet().domains);

  protected readonly hasError = signal(false);

  private readonly gallery = computed(() =>
    this.nftStore.galleryOf(this.store.network(), this.store.activeWallet().address),
  );

  /** The wallet's NFTs, one entry per token; null until the first read. */
  protected readonly nfts = computed(() => {
    const gallery = this.gallery();
    return gallery
      ? gallery.holdings.flatMap(({ collection, ids }) =>
          ids.map((id) => ({ key: `${collection.address}:${id}`, nft: { collection, id } })),
        )
      : null;
  });

  /** A read limit cut the list short. */
  protected readonly partial = computed(() => this.gallery()?.complete === false);

  protected readonly nftsError = signal(false);

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
  protected readonly skeletonTiles = [0, 1];

  protected avatar(name: string): string {
    const [from, to] = avatarColorsFor(name);
    return `linear-gradient(155deg, ${from}, ${to})`;
  }

  protected openDomain(domain: MnsDomain): void {
    this.modal.open('domain-details', domain);
  }

  protected registerDomain(): void {
    this.modal.open('register-domain');
  }

  protected openNft(nft: OwnedNft): void {
    const payload: NftDetailsPayload = { nft, network: this.store.network() };
    this.modal.open('nft-details', payload);
  }

  private load(): void {
    this.hasError.set(false);
    this.store.loadDomains().catch((err) => {
      this.hasError.set(true);
      console.warn('Loading MNS domains failed', err);
    });

    this.nftsError.set(false);
    this.nftStore.load(this.store.network(), this.store.activeWallet().address).catch((err) => {
      this.nftsError.set(true);
      console.warn('Loading NFTs failed', err);
    });
  }
}
