import { Component, computed, input, signal } from '@angular/core';

/**
 * A token's round icon; a badge with its symbol when there's none or it
 * fails to load. A custom token's icon is a remote link: `no-referrer`
 * keeps the wallet's own address out of that request.
 */
@Component({
  selector: 'app-token-icon',
  templateUrl: './token-icon.html',
  styleUrl: './token-icon.scss',
})
export class TokenIcon {
  readonly src = input<string>('');
  readonly symbol = input.required<string>();

  /** The source that failed — a new link gets its own chance. */
  private readonly failedSrc = signal<string | null>(null);
  protected readonly showBadge = computed(() => !this.src() || this.failedSrc() === this.src());

  protected onError(): void {
    this.failedSrc.set(this.src());
  }
}
