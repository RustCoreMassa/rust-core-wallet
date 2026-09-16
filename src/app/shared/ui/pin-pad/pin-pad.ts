import { Component, output } from '@angular/core';

@Component({
  selector: 'app-pin-pad',
  imports: [],
  templateUrl: './pin-pad.html',
  styleUrl: './pin-pad.scss',
})
export class PinPad {
  readonly digit = output<string>();
  readonly backspace = output<void>();

  protected press(key: string): void {
    this.digit.emit(key);
  }

  protected pressBackspace(): void {
    this.backspace.emit();
  }
}
