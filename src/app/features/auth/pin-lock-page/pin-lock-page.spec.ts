import { needsPasswordUpgrade } from './pin-lock-page';

describe('needsPasswordUpgrade', () => {
  it('moves a vault opened with a PIN to a password, in the extension only', () => {
    expect(needsPasswordUpgrade('password', '123456')).toBe(true);
    expect(needsPasswordUpgrade('password', 'correct horse battery')).toBe(false);
    expect(needsPasswordUpgrade('pin', '123456')).toBe(false);
  });
});
