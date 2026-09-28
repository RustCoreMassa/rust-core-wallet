import { Injectable, signal } from '@angular/core';

export type ModalId =
  | 'receive'
  | 'send'
  | 'swap'
  | 'buy-roll'
  | 'sell-roll'
  | 'wallets'
  | 'rename-account'
  | 'backup-phrase'
  | null;

@Injectable({ providedIn: 'root' })
export class Modal {
  private readonly _active = signal<ModalId>(null);
  private readonly _payload = signal<unknown>(null);

  readonly active = this._active.asReadonly();

  /** Optional data the opening caller wants the modal to have — e.g. which account to rename. */
  open(id: ModalId, payload: unknown = null): void {
    this._active.set(id);
    this._payload.set(payload);
  }

  close(): void {
    this._active.set(null);
    this._payload.set(null);
  }

  /** Cast to whatever shape the currently-open modal expects. */
  payload<T>(): T | null {
    return this._payload() as T | null;
  }
}
