import {
  Component,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { UNLOCK_SECRET } from '../../../core/platform/unlock-secret';
import { PIN_LENGTH } from '../../../core/utils/password-rules';
import { PinPad } from '../pin-pad/pin-pad';

/**
 * Asks for the existing unlock secret (UNLOCK_SECRET): the web app's PIN pad, which submits on
 * the 6th digit, or the extension's password field with a submit button. The parent checks the
 * secret and calls `clear()` when it's wrong.
 */
@Component({
  selector: 'app-secret-entry',
  imports: [PinPad],
  templateUrl: './secret-entry.html',
  styleUrl: './secret-entry.scss',
})
export class SecretEntry {
  protected readonly kind = inject(UNLOCK_SECRET);

  /** While the parent checks a submitted secret: input is ignored. */
  readonly busy = input(false);
  /** Password mode: the button's label. */
  readonly submitLabel = input('Confirm');
  /** Less space under the PIN dots (inside a bottom sheet). */
  readonly compact = input(false, { transform: booleanAttribute });
  readonly submitted = output<string>();

  protected readonly value = signal('');
  protected readonly shown = signal(false);
  protected readonly dots = computed(() =>
    Array.from({ length: PIN_LENGTH }, (_, i) => i < this.value().length),
  );

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  constructor() {
    // The extension's popup opens straight onto this field: type right away.
    afterNextRender(() => this.field()?.nativeElement.focus());
  }

  /** Empties the entry, e.g. after a wrong secret. */
  clear(): void {
    this.value.set('');
    const field = this.field()?.nativeElement;
    if (!field) return;
    // Directly too: the [value] binding may not have seen the typed text yet, so '' → '' would
    // look like no change and leave it in the field.
    field.value = '';
    field.focus();
  }

  protected onDigit(digit: string): void {
    if (this.busy() || this.value().length >= PIN_LENGTH) return;
    this.value.update((current) => current + digit);
    if (this.value().length === PIN_LENGTH) this.submitted.emit(this.value());
  }

  protected onBackspace(): void {
    if (!this.busy()) this.value.update((current) => current.slice(0, -1));
  }

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }

  protected submitPassword(event: Event): void {
    event.preventDefault();
    if (!this.busy() && this.value()) this.submitted.emit(this.value());
  }
}
