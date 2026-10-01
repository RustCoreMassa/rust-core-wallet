import { Pipe, PipeTransform } from '@angular/core';
import { formatDisplayAmount } from '../../core/utils/display-amount';

/** `{{ balance | amount }}` → "1,467.46": 2 decimals, cut, never rounded up. */
@Pipe({ name: 'amount' })
export class AmountPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value == null ? '' : formatDisplayAmount(value);
  }
}
