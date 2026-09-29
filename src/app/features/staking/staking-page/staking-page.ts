import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Modal } from '../../../core/services/modal';
import { ROLL_PRICE_MAS } from '../../../core/services/massa-provider';
import { WalletStore } from '../../../core/state/wallet-store';
import { dailyStakingReward, stakingAprPercent } from '../../../core/utils/staking-rewards';

/** Official Massa staking guide. */
const STAKING_DOCS_URL = 'https://docs.massa.net/docs/node/stake';

/**
 * - `idle`: no rolls at all — the page explains how to start.
 * - `activating`: rolls bought, not yet in the draw (takes 3 cycles).
 * - `active`: in the draw, no missed slots.
 * - `missing`: in the draw but missing slots — the staking node looks offline.
 * - `unstaking`: every roll sold, MAS refund still deferred.
 */
type StakingStatus = 'idle' | 'activating' | 'active' | 'missing' | 'unstaking';

@Component({
  selector: 'app-staking-page',
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './staking-page.html',
  styleUrl: './staking-page.scss',
})
export class StakingPage {
  protected readonly store = inject(WalletStore);
  protected readonly modal = inject(Modal);

  protected readonly docsUrl = STAKING_DOCS_URL;
  protected readonly rollPrice = ROLL_PRICE_MAS;

  protected readonly wallet = this.store.activeWallet;
  protected readonly stats = computed(() => this.wallet().staking);

  protected readonly status = computed<StakingStatus>(() => {
    const { active, candidate, deferred } = this.wallet().rolls;
    const stats = this.stats();
    if (active + candidate === 0) return deferred > 0 ? 'unstaking' : 'idle';
    if (!stats || stats.activeRolls === 0) return 'activating';
    return stats.missed > 0 ? 'missing' : 'active';
  });

  /** Share of drawn slots actually produced, over the recent cycles. */
  protected readonly successRate = computed(() => {
    const stats = this.stats();
    const total = stats ? stats.produced + stats.missed : 0;
    return total > 0 ? (stats!.produced / total) * 100 : null;
  });

  protected readonly finalMas = computed(() => this.wallet().balances.MAS ?? 0);

  protected readonly stakedMas = computed(() => {
    const rolls = this.wallet().rolls;
    return (rolls.active + rolls.candidate + rolls.deferred) * ROLL_PRICE_MAS;
  });

  protected readonly totalMas = computed(() => this.finalMas() + this.stakedMas());

  protected readonly masPrice = computed(() => this.store.prices().MAS ?? 0);

  /** Network-wide APR (%) — same for every staker; `null` until total rolls are known. */
  protected readonly apr = computed(() => {
    const total = this.store.totalRolls();
    return total ? stakingAprPercent(total) : null;
  });

  /** Expected MAS per day for this wallet's final rolls. */
  protected readonly dailyReward = computed(() => {
    const total = this.store.totalRolls();
    return total ? dailyStakingReward(this.wallet().rolls.active, total) : null;
  });

  constructor() {
    // Prefetched at login; this only re-reads it if it has gone stale.
    this.store.loadTotalRolls().catch((err) => console.warn('Loading total rolls failed', err));
  }

  /** How many rolls the free balance could buy right now. */
  protected readonly affordableRolls = computed(() =>
    Math.floor(this.finalMas() / ROLL_PRICE_MAS),
  );
}
