import { Component, input, output } from '@angular/core';

export interface ConfirmRow {
  readonly label: string;
  readonly value: string;
  /** Monospace, wrapping — for addresses. */
  readonly mono?: boolean;
  /** Highlighted — for the total. */
  readonly strong?: boolean;
}

/**
 * Review step shown before any operation that spends funds: a list of
 * what's about to happen, then Cancel / Confirm. Used inside the Send,
 * Buy roll and Sell roll modals, which keep their form state underneath.
 */
@Component({
  selector: 'app-confirm-details',
  templateUrl: './confirm-details.html',
  styleUrl: './confirm-details.scss',
})
export class ConfirmDetails {
  readonly rows = input.required<readonly ConfirmRow[]>();
  readonly confirmLabel = input('Confirm');
  readonly busyLabel = input('Sending…');
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
