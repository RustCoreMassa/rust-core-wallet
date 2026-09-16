import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-receive-modal',
  imports: [],
  templateUrl: './receive-modal.html',
  styleUrl: './receive-modal.scss',
})
export class ReceiveModal {
  protected readonly modal = inject(Modal);
  protected readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('qrCanvas');

  constructor() {
    effect(() => {
      const canvas = this.canvasRef()?.nativeElement;
      const address = this.store.activeWallet().address;
      if (canvas) drawFakeQr(canvas, address);
    });
  }

  protected copyAddress(): void {
    const address = this.store.activeWallet().address;
    navigator.clipboard
      .writeText(address)
      .then(() => this.toast.show('Address copied'))
      .catch(() => this.toast.show('Could not copy — copy manually'));
  }
}

/** Deterministic, purely visual QR-like pattern — not a real scannable code. */
function drawFakeQr(canvas: HTMLCanvasElement, address: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = 14;
  const cell = canvas.width / size;
  ctx.fillStyle = '#f6f6f8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let seed = 0;
  for (let i = 0; i < address.length; i++) seed += address.charCodeAt(i) * (i * 7 + 3);
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  ctx.fillStyle = '#0a0a0a';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inCorner = (r < 3 && c < 3) || (r < 3 && c >= size - 3) || (r >= size - 3 && c < 3);
      if (inCorner) continue;
      if (rand() > 0.52) ctx.fillRect(c * cell, r * cell, cell - 1, cell - 1);
    }
  }

  const finder = (x0: number, y0: number) => {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x0 * cell, y0 * cell, 3 * cell - 1, 3 * cell - 1);
    ctx.fillStyle = '#f6f6f8';
    ctx.fillRect((x0 + 0.5) * cell, (y0 + 0.5) * cell, 2 * cell - 1, 2 * cell - 1);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect((x0 + 1) * cell, (y0 + 1) * cell, cell - 1, cell - 1);
  };
  finder(0, 0);
  finder(size - 3, 0);
  finder(0, size - 3);
}
