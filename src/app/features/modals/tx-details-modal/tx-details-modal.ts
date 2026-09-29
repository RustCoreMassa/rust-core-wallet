import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { TransactionRecord, TransactionStatus } from '../../../core/models/transaction.model';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';
import { HistoryRow } from '../../../shared/ui/history-row/history-row';

/** The public explorer only routes mainnet (`/mainnet/operation/:hash`). */
const EXPLORER_OPERATION_URL = 'https://explorer.massa.net/mainnet/operation/';

const STATUS_LABEL: Record<TransactionStatus, string> = {
  pending: 'Pending',
  final: 'Final',
  failed: 'Failed',
};

/** Full details of one history entry — opened with the record as payload. */
@Component({
  selector: 'app-tx-details-modal',
  imports: [DatePipe, DecimalPipe, HistoryRow],
  templateUrl: './tx-details-modal.html',
  styleUrl: './tx-details-modal.scss',
})
export class TxDetailsModal {
  protected readonly modal = inject(Modal);
  private readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly tx = computed(() => this.modal.payload<TransactionRecord>());

  protected readonly statusLabel = computed(() => {
    const status = this.tx()?.status;
    return status ? STATUS_LABEL[status] : null;
  });

  protected readonly explorerUrl = computed(() => {
    const operationId = this.tx()?.operationId;
    return operationId && this.store.network() === 'mainnet'
      ? EXPLORER_OPERATION_URL + operationId
      : null;
  });

  protected copy(value: string, label: string): void {
    navigator.clipboard
      .writeText(value)
      .then(() => this.toast.show(`${label} copied`))
      .catch(() => this.toast.show('Could not copy — copy manually'));
  }
}
