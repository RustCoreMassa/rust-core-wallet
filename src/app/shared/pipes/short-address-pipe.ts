import { Pipe, PipeTransform } from '@angular/core';

/** Truncates a Massa address to `AU12k9…8h3f` for compact display. */
@Pipe({ name: 'shortAddress' })
export class ShortAddressPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  }
}
