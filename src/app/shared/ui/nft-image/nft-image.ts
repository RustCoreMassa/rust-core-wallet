import { Component, computed, input, signal } from '@angular/core';
import { avatarColorsFor } from '../avatar-colors';

/**
 * A square NFT picture: a shimmer while its metadata loads, the image once
 * known, or a gradient badge with the collection's symbol when there's none
 * or it fails to load. Images come from the creator's server (or the IPFS
 * gateway): `no-referrer` keeps the wallet's own address out of the request.
 */
@Component({
  selector: 'app-nft-image',
  templateUrl: './nft-image.html',
  styleUrl: './nft-image.scss',
})
export class NftImage {
  /** A loadable https URL, '' when there's none. */
  readonly src = input('');
  readonly symbol = input.required<string>();
  readonly alt = input('');
  readonly loading = input(false);

  /** The source that failed — a new link gets its own chance. */
  private readonly failedSrc = signal<string | null>(null);
  protected readonly showImage = computed(() => !!this.src() && this.failedSrc() !== this.src());

  protected readonly badge = computed(() => {
    const [from, to] = avatarColorsFor(this.symbol());
    return `linear-gradient(155deg, ${from}, ${to})`;
  });

  protected onError(): void {
    this.failedSrc.set(this.src());
  }
}
