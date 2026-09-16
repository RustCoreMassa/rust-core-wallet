import { Component, computed, inject } from '@angular/core';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-nfts-page',
  imports: [],
  templateUrl: './nfts-page.html',
  styleUrl: './nfts-page.scss',
})
export class NftsPage {
  private readonly store = inject(WalletStore);

  protected readonly nfts = computed(() => this.store.activeWallet().nfts);
}
