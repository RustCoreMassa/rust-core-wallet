import { Component, computed, inject } from '@angular/core';
import { MnsDomain } from '../../../core/models/nft.model';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';
import { ShortAddressPipe } from '../../../shared/pipes/short-address-pipe';
import { avatarColorsFor } from '../../../shared/ui/avatar-colors';

/** The public explorer only routes mainnet (`/mainnet/address/:hash`). */
const EXPLORER_ADDRESS_URL = 'https://explorer.massa.net/mainnet/address/';

/** Details of one owned MNS domain — opened with the MnsDomain as payload. */
@Component({
  selector: 'app-domain-details-modal',
  imports: [ShortAddressPipe],
  templateUrl: './domain-details-modal.html',
  styleUrl: './domain-details-modal.scss',
})
export class DomainDetailsModal {
  protected readonly modal = inject(Modal);
  private readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly domain = computed(() => this.modal.payload<MnsDomain>());

  protected readonly avatar = computed(() => {
    const [from, to] = avatarColorsFor(this.domain()?.name ?? '');
    return `linear-gradient(155deg, ${from}, ${to})`;
  });

  protected readonly pointsToThisWallet = computed(
    () => this.domain()?.target === this.store.activeWallet().address,
  );

  protected readonly explorerUrl = computed(() => {
    const target = this.domain()?.target;
    return target && this.store.network() === 'mainnet' ? EXPLORER_ADDRESS_URL + target : null;
  });

  protected copy(value: string, label: string): void {
    navigator.clipboard
      .writeText(value)
      .then(() => this.toast.show(`${label} copied`))
      .catch(() => this.toast.show('Could not copy — copy manually'));
  }
}
