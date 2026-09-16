import { Injectable, signal } from '@angular/core';

export type ModalId = 'receive' | 'send' | 'swap' | 'buy-roll' | 'sell-roll' | 'wallets' | null;

@Injectable({ providedIn: 'root' })
export class Modal {
  private readonly _active = signal<ModalId>(null);
  readonly active = this._active.asReadonly();

  open(id: ModalId): void {
    this._active.set(id);
  }

  close(): void {
    this._active.set(null);
  }
}
