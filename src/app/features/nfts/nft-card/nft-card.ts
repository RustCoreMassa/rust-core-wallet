import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NftMetadata, OwnedNft } from '../../../core/models/nft.model';
import { NftMetadataReader } from '../../../core/services/nft-metadata-reader';
import { Network } from '../../../core/state/network-store';
import { mediaUrl } from '../../../core/utils/media-hosts';
import { NftImage } from '../../../shared/ui/nft-image/nft-image';

/** One NFT in the gallery: its picture and name from the metadata, else the collection's logo. */
@Component({
  selector: 'app-nft-card',
  imports: [NftImage],
  templateUrl: './nft-card.html',
  styleUrl: './nft-card.scss',
})
export class NftCard {
  readonly nft = input.required<OwnedNft>();
  readonly network = input.required<Network>();
  readonly opened = output<void>();

  private readonly reader = inject(NftMetadataReader);
  private readonly metadata = signal<NftMetadata | null>(null);
  protected readonly loading = signal(true);

  protected readonly image = computed(
    () => this.metadata()?.image || mediaUrl(this.nft().collection.logoUrl),
  );
  protected readonly title = computed(() => this.metadata()?.name || `#${this.nft().id}`);

  constructor() {
    effect((onCleanup) => {
      const nft = this.nft();
      const network = this.network();
      let current = true;
      onCleanup(() => (current = false));
      untracked(() => {
        this.metadata.set(null);
        this.loading.set(true);
      });
      void this.reader.get(network, nft.collection.address, nft.id).then((metadata) => {
        if (!current) return;
        this.metadata.set(metadata);
        this.loading.set(false);
      });
    });
  }
}
