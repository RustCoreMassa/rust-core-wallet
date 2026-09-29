/**
 * Massa staking reward economics — network-wide constants, so the
 * estimates below depend only on the total number of rolls staked.
 */
export const STAKING_ECONOMICS = {
  /** Block slots per day (2 per second: 32 threads, one period every 16 s). */
  blockADay: 172_800,
  /** MAS minted per day as staking rewards (blockADay × rewardABlock). */
  tokensADay: 69_120,
  /** MAS reward per block. */
  rewardABlock: 0.4,
} as const;

function daysInYear(date: Date): number {
  const year = date.getFullYear();
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * Yearly return of staking, in % of the MAS locked in rolls. The year's
 * rewards are shared across every roll in the network, one roll costing
 * 100 MAS — so this is the yearly MAS earned per roll, as a percentage.
 */
export function stakingAprPercent(totalRolls: number, now = new Date()): number {
  const { blockADay, rewardABlock } = STAKING_ECONOMICS;
  return ((daysInYear(now) * blockADay * rewardABlock) / (totalRolls * 100)) * 100;
}

/** Expected MAS per day for `rolls` — their share of the network's rolls × the daily rewards. */
export function dailyStakingReward(rolls: number, totalRolls: number): number {
  const sharePercent = (rolls * 100) / totalRolls;
  return (STAKING_ECONOMICS.tokensADay * sharePercent) / 100;
}
