import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CustomToken } from '../../../core/models/token.model';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { Network } from '../../../core/state/network-store';
import { TokenCatalog } from '../../../core/state/token-catalog';
import { WalletStore } from '../../../core/state/wallet-store';
import { toUserMessage } from '../../../core/utils/user-error';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';

/** Opened with this payload, the modal starts on the "add a token" form. */
export type TokensModalPayload = 'add';

const NETWORK_LABEL: Readonly<Record<Network, string>> = {
  mainnet: 'Mainnet',
  buildnet: 'Buildnet',
};

/**
 * Custom tokens: the MRC-20s the user added on the current network, a way
 * to remove one, and the add flow — contract address → the token's own
 * name, symbol and decimals read from the chain → review → add.
 */
@Component({
  selector: 'app-tokens-modal',
  imports: [FormsModule, ConfirmDetails],
  templateUrl: './tokens-modal.html',
  styleUrl: './tokens-modal.scss',
})
export class TokensModal {
  protected readonly modal = inject(Modal);
  private readonly store = inject(WalletStore);
  private readonly catalog = inject(TokenCatalog);
  private readonly toast = inject(Toast);

  protected readonly step = signal<'list' | 'add' | 'review'>(
    this.modal.payload<TokensModalPayload>() === 'add' ? 'add' : 'list',
  );
  protected readonly custom = this.catalog.custom;
  protected readonly networkLabel = computed(() => NETWORK_LABEL[this.store.network()]);

  protected readonly contract = signal('');
  protected readonly found = signal<{ network: Network; token: CustomToken } | null>(null);
  protected readonly isLooking = signal(false);
  protected readonly isAdding = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly reviewRows = computed<ConfirmRow[]>(() => {
    const found = this.found();
    if (!found) return [];
    const { token, network } = found;
    return [
      { label: 'Name', value: token.name },
      { label: 'Symbol', value: token.symbol, strong: true },
      { label: 'Decimals', value: String(token.decimals) },
      { label: 'Contract', value: token.contract, mono: true },
      { label: 'Network', value: NETWORK_LABEL[network] },
    ];
  });

  protected readonly reviewNote =
    'Anyone can create a token with any name and symbol, and RustCore doesn’t check the ones ' +
    'you add. Add it only if this contract address comes from a source you trust.';

  protected startAdd(): void {
    this.error.set(null);
    this.step.set('add');
  }

  protected backToList(): void {
    this.error.set(null);
    this.contract.set('');
    this.step.set('list');
  }

  /** Reads the token's metadata from the chain, then shows it for review. */
  protected async lookUp(): Promise<void> {
    this.error.set(null);
    this.isLooking.set(true);
    try {
      this.found.set(await this.catalog.lookup(this.contract()));
      this.step.set('review');
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isLooking.set(false);
    }
  }

  protected async add(): Promise<void> {
    const found = this.found();
    if (!found) return;
    if (found.network !== this.store.network()) {
      this.error.set(`Switch back to ${NETWORK_LABEL[found.network]} to add this token`);
      return;
    }
    this.isAdding.set(true);
    try {
      await this.store.addCustomToken(found.network, found.token);
      this.toast.show(`${found.token.symbol} added`);
      this.modal.close();
    } finally {
      this.isAdding.set(false);
    }
  }

  protected cancelReview(): void {
    this.found.set(null);
    this.error.set(null);
    this.step.set('add');
  }

  protected remove(token: CustomToken): void {
    this.store.removeCustomToken(this.store.network(), token.contract);
    this.toast.show(`${token.symbol} removed — its balance stays on the blockchain`);
  }

  protected short(address: string): string {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }
}
