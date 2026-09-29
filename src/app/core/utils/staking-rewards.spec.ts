import { STAKING_ECONOMICS, dailyStakingReward, stakingAprPercent } from './staking-rewards';

describe('staking rewards', () => {
  const totalRolls = 2_493_615; // mainnet, September 2026

  it('uses the network constants', () => {
    expect(STAKING_ECONOMICS.tokensADay).toBe(
      STAKING_ECONOMICS.blockADay * STAKING_ECONOMICS.rewardABlock,
    );
  });

  it('computes APR from the total rolls staked', () => {
    expect(stakingAprPercent(totalRolls, new Date('2026-09-29'))).toBeCloseTo(10.1174, 3);
  });

  it('accounts for leap years', () => {
    const regular = stakingAprPercent(totalRolls, new Date('2026-06-01'));
    const leap = stakingAprPercent(totalRolls, new Date('2028-06-01'));
    expect(leap / regular).toBeCloseTo(366 / 365, 10);
  });

  it('gives each roll its share of the daily rewards', () => {
    expect(dailyStakingReward(124_724, totalRolls)).toBeCloseTo(3457.2, 1);
    expect(dailyStakingReward(0, totalRolls)).toBe(0);
  });

  it('is consistent: one roll (100 MAS) earns APR% MAS per year', () => {
    const now = new Date('2026-09-29');
    expect(dailyStakingReward(1, totalRolls) * 365).toBeCloseTo(
      stakingAprPercent(totalRolls, now),
      6,
    );
  });
});
