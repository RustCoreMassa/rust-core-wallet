import { Component, computed, input } from '@angular/core';
import { TransactionRecord, TransactionStatus } from '../../../core/models/transaction.model';

interface HistoryRowView {
  icon: 'up' | 'down' | 'swap' | 'rolls';
  glyph: string;
  title: string;
  subtitle: string;
  amountText: string;
  amountPositive: boolean;
}

const STATUS_LABEL: Partial<Record<TransactionStatus, string>> = {
  pending: 'Pending',
  failed: 'Failed',
};

function formatAmount(amount: number): string {
  return amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function timeAgo(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

@Component({
  selector: 'app-history-row',
  imports: [],
  templateUrl: './history-row.html',
  styleUrl: './history-row.scss',
})
export class HistoryRow {
  readonly tx = input.required<TransactionRecord>();

  protected readonly timeLabel = computed(() => timeAgo(this.tx().timestamp));

  /** Only shown when it's not the normal, final state. */
  protected readonly statusLabel = computed(
    () => STATUS_LABEL[this.tx().status ?? 'final'] ?? null,
  );

  protected readonly view = computed<HistoryRowView>(() => {
    const tx = this.tx();
    const amount = formatAmount(tx.amount);
    switch (tx.type) {
      case 'send':
        return {
          icon: 'down',
          glyph: '↑',
          title: `Sent ${tx.token}`,
          subtitle: `to ${tx.counterparty ?? ''}`,
          amountText: `-${amount} ${tx.token}`,
          amountPositive: false,
        };
      case 'receive':
        return {
          icon: 'up',
          glyph: '↓',
          title: `Received ${tx.token}`,
          subtitle: `from ${tx.counterparty ?? ''}`,
          amountText: `+${amount} ${tx.token}`,
          amountPositive: true,
        };
      case 'swap':
        return {
          icon: 'swap',
          glyph: '⇄',
          title: `Swap ${tx.token} → ${tx.toToken}`,
          subtitle: 'rate applied at execution',
          amountText: `-${amount} ${tx.token}`,
          amountPositive: false,
        };
      case 'buy_rolls':
        return {
          icon: 'rolls',
          glyph: '●',
          title: `Bought ${tx.rollCount} roll${(tx.rollCount ?? 0) > 1 ? 's' : ''}`,
          subtitle: 'Node staking',
          amountText: `-${amount} MAS`,
          amountPositive: false,
        };
      case 'sell_rolls':
        return {
          icon: 'rolls',
          glyph: '●',
          title: `Sold ${tx.rollCount} roll${(tx.rollCount ?? 0) > 1 ? 's' : ''}`,
          subtitle: 'Unstaking (deferred)',
          amountText: `+${amount} MAS`,
          amountPositive: true,
        };
      case 'contract_call':
        return {
          icon: 'swap',
          glyph: '⌘',
          title: 'Contract call',
          subtitle: `to ${tx.counterparty ?? ''}`,
          // Coins attached to the call; most calls send none.
          amountText: tx.amount > 0 ? `-${amount} MAS` : '—',
          amountPositive: false,
        };
      case 'reward':
      default:
        return {
          icon: 'up',
          glyph: '↓',
          title: 'Staking reward',
          subtitle: 'Auto-credited',
          amountText: `+${amount} MAS`,
          amountPositive: true,
        };
    }
  });
}
