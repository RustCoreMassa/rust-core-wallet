import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TokenSymbol } from '../../../core/models/token.model';
import { Modal } from '../../../core/services/modal';
import { Toast } from '../../../core/services/toast';
import { WalletStore } from '../../../core/state/wallet-store';

@Component({
  selector: 'app-swap-modal',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './swap-modal.html',
  styleUrl: './swap-modal.scss',
})
export class SwapModal {
  protected readonly modal = inject(Modal);
  protected readonly store = inject(WalletStore);
  private readonly toast = inject(Toast);

  protected readonly tokens: TokenSymbol[] = ['MAS', 'USDC', 'WETH'];

  protected readonly fromToken = signal<TokenSymbol>('MAS');
  protected readonly toToken = signal<TokenSymbol>('USDC');
  protected readonly fromAmount = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly isSwapping = signal(false);

  protected readonly availableBalance = computed(
    () => this.store.activeWallet().balances[this.fromToken()],
  );

  protected readonly rate = computed(() => {
    const prices = this.store.prices();
    return prices[this.fromToken()] / prices[this.toToken()];
  });

  protected readonly estimatedReceive = computed(() => (this.fromAmount() ?? 0) * this.rate());

  protected setFromToken(token: TokenSymbol): void {
    this.fromToken.set(token);
  }

  protected setToToken(token: TokenSymbol): void {
    this.toToken.set(token);
  }

  protected setMax(): void {
    this.fromAmount.set(this.availableBalance());
  }

  protected flip(): void {
    const from = this.fromToken();
    this.fromToken.set(this.toToken());
    this.toToken.set(from);
  }

  protected async submit(): Promise<void> {
    const amount = this.fromAmount() ?? 0;
    this.error.set(null);
    this.isSwapping.set(true);
    try {
      const result = await this.store.swap(this.fromToken(), this.toToken(), amount);
      this.toast.show(
        `Swapped ${amount} ${this.fromToken()} → ${result.received.toFixed(4)} ${this.toToken()}`,
      );
      this.fromAmount.set(null);
      this.modal.close();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.isSwapping.set(false);
    }
  }
}
