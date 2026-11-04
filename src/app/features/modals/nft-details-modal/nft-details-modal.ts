import { Component, computed, effect, inject, signal } from '@angular/core';
import { NftMetadata, OwnedNft } from '../../../core/models/nft.model';
import { Modal } from '../../../core/services/modal';
import { NftMetadataReader } from '../../../core/services/nft-metadata-reader';
import { Toast } from '../../../core/services/toast';
import { Network } from '../../../core/state/network-store';
import { mediaUrl } from '../../../core/utils/media-hosts';
import { NftImage } from '../../../shared/ui/nft-image/nft-image';

/** The public explorer only routes mainnet (`/mainnet/address/:hash`). */
const EXPLORER_ADDRESS_URL = 'https://explorer.massa.net/mainnet/address/';

/** What NftsPage opens the modal with. */
export interface NftDetailsPayload {
  readonly nft: OwnedNft;
  readonly network: Network;
}

/** One NFT held by the wallet: picture, description, traits and its collection. */
@Component({
  selector: 'app-nft-details-modal',
  imports: [NftImage],
  templateUrl: './nft-details-modal.html',
  styleUrl: './nft-details-modal.scss',
})
export class NftDetailsModal {
  protected readonly modal = inject(Modal);
  private readonly reader = inject(NftMetadataReader);
  private readonly toast = inject(Toast);

  protected readonly payload = computed(() => this.modal.payload<NftDetailsPayload>());
  protected readonly metadata = signal<NftMetadata | null>(null);
  protected readonly loading = signal(true);

  protected readonly image = computed(() => {
    const nft = this.payload()?.nft;
    return this.metadata()?.image || (nft ? mediaUrl(nft.collection.logoUrl) : '');
  });

  protected readonly title = computed(() => {
    const nft = this.payload()?.nft;
    return this.metadata()?.name || (nft ? `${nft.collection.name} #${nft.id}` : '');
  });

  protected readonly explorerUrl = computed(() => {
    const payload = this.payload();
    return payload?.network === 'mainnet'
      ? EXPLORER_ADDRESS_URL + payload.nft.collection.address
      : null;
  });

  constructor() {
    effect((onCleanup) => {
      const payload = this.payload();
      if (!payload) return;
      let current = true;
      onCleanup(() => (current = false));
      // Usually already read by the gallery card: the reader keeps it for the session.
      void this.reader
        .get(payload.network, payload.nft.collection.address, payload.nft.id)
        .then((metadata) => {
          if (!current) return;
          this.metadata.set(metadata);
          this.loading.set(false);
        });
    });
  }

  protected copy(value: string, label: string): void {
    navigator.clipboard
      .writeText(value)
      .then(() => this.toast.show(`${label} copied`))
      .catch(() => this.toast.show('Could not copy — copy manually'));
  }
}
