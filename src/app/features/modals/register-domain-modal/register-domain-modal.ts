import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../core/services/modal';
import { NETWORK_FEE_MAS } from '../../../core/services/massa-provider';
import { Toast } from '../../../core/services/toast';
import { DomainRegistration, WalletStore } from '../../../core/state/wallet-store';
import {
  MNS_STORAGE_DEPOSIT_MAS,
  domainNameError,
  domainRegistrationFee,
  normalizeDomainName,
} from '../../../core/utils/mns-domain';
import { fromUnits, toUnits } from '../../../core/utils/token-amount';
import { toUserMessage } from '../../../core/utils/user-error';
import { ConfirmDetails, ConfirmRow } from '../../../shared/ui/confirm-details/confirm-details';

const MAS_DECIMALS = 9;

/**
 * Registers a .massa name to the active wallet: it becomes the owner (the
 * name is an NFT of the MNS contract) and the name points to its address.
 * Review checks the name on-chain and runs the registration read-only
 * first, so the Review step only ever shows a registration that would go
 * through.
 */
@Component({
  selector: 'app-register-domain-modal',
  imports: [FormsModule, ConfirmDetails],
  templateUrl: './register-domain-modal.html',
  styleUrl: './register-domain-modal.scss',
})
export class RegisterDomainModal {
  protected readonly modal = inject(Modal);
  private readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly input = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly isChecking = signal(false);
  protected readonly isRegistering = signal(false);
  /** Set once Review has checked and priced the name: the confirm step. */
  protected readonly registration = signal<DomainRegistration | null>(null);

  protected readonly name = computed(() => normalizeDomainName(this.input()));
  /** Shown as soon as something is typed; an empty field just waits. */
  protected readonly nameError = computed(() =>
    this.input().trim() ? domainNameError(this.name()) : null,
  );
  protected readonly priceHint = computed(() => {
    const name = this.name();
    if (domainNameError(name)) return null;
    return `${name}.massa · ${fmt(domainRegistrationFee(name))} MAS`;
  });

  protected readonly deposit = MNS_STORAGE_DEPOSIT_MAS;
  protected readonly networkFee = NETWORK_FEE_MAS;

  protected readonly confirmRows = computed<ConfirmRow[]>(() => {
    const r = this.registration();
    if (!r) return [];
    const wallet = this.store.wallets()[r.walletId];
    const total = r.coins + toUnits(NETWORK_FEE_MAS, MAS_DECIMALS);
    const balance = BigInt(wallet?.rawBalances.MAS ?? '0');
    const after = balance > total ? balance - total : 0n;
    return [
      { label: 'Domain', value: `${r.name}.massa`, strong: true },
      { label: 'Owner', value: wallet?.name ?? '' },
      { label: 'Points to', value: r.target, mono: true },
      { label: 'Registration fee', value: `${fmt(r.fee)} MAS` },
      { label: 'Storage deposit', value: `${fmt(r.deposit)} MAS` },
      { label: 'Network fee', value: `${NETWORK_FEE_MAS} MAS` },
      { label: 'Total', value: `${fmt(fromUnits(total, MAS_DECIMALS))} MAS`, strong: true },
      { label: 'Balance after', value: `${fmt(fromUnits(after, MAS_DECIMALS))} MAS` },
    ];
  });

  protected readonly confirmNote =
    'The name is yours as long as this wallet holds it. The part of the storage deposit ' +
    "the name doesn't use comes back to this wallet. This can't be reversed.";

  protected async review(): Promise<void> {
    if (this.isChecking()) return;
    this.error.set(null);
    this.isChecking.set(true);
    try {
      this.registration.set(await this.store.prepareDomainRegistration(this.input()));
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isChecking.set(false);
    }
  }

  protected back(): void {
    this.error.set(null);
    this.registration.set(null);
  }

  protected async confirm(): Promise<void> {
    const registration = this.registration();
    if (!registration) return;
    this.error.set(null);
    this.isRegistering.set(true);
    try {
      await this.store.registerDomain(registration);
      this.toast.show(`Registered ${registration.name}.massa`);
      this.modal.close();
    } catch (err) {
      this.error.set(toUserMessage(err));
    } finally {
      this.isRegistering.set(false);
    }
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 9 });
}
