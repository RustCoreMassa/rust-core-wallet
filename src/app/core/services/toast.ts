import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Toast {
  private readonly _message = signal<string | null>(null);
  readonly message = this._message.asReadonly();

  private hideTimer?: ReturnType<typeof setTimeout>;

  show(message: string, durationMs = 2400): void {
    clearTimeout(this.hideTimer);
    this._message.set(message);
    this.hideTimer = setTimeout(() => this._message.set(null), durationMs);
  }
}
