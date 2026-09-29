import { Component, computed, inject, resource } from '@angular/core';
import { MASSA_PROVIDER } from '../../../core/services/massa-provider';
import { WalletStore } from '../../../core/state/wallet-store';

/**
 * MNS domains owned by the active wallet, read on-chain from the Massa
 * Name System contract on the current network; reloads whenever the
 * active wallet or the network changes.
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
  private readonly store = inject(WalletStore);
  private readonly provider = inject(MASSA_PROVIDER);

  protected readonly address = computed(() => this.store.activeWallet().address);

  protected readonly domains = resource({
    params: () => ({ address: this.address(), network: this.store.network() }),
    loader: ({ params }) => this.provider.getOwnedDomains(params.address),
  });
}
