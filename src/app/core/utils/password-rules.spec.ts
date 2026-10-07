import { MIN_PASSWORD_LENGTH, passwordProblem } from './password-rules';

describe('passwordProblem', () => {
  it('accepts a password of the minimum length with a letter', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1) + '1')).toBeNull();
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });

  it('refuses short passwords, counting characters rather than UTF-16 units', () => {
    expect(passwordProblem('')).toMatch(/at least 8/);
    expect(passwordProblem('abcdefg')).toMatch(/at least 8/);
    // 7 emoji are 14 UTF-16 units but only 7 characters.
    expect(passwordProblem('🔑'.repeat(7))).toMatch(/at least 8/);
    expect(passwordProblem('🔑'.repeat(8))).toBeNull();
  });

  it('refuses digits only, whatever the length (a PIN is not a password)', () => {
    expect(passwordProblem('123456')).toMatch(/at least 8/);
    expect(passwordProblem('12345678')).toMatch(/not only digits/);
    expect(passwordProblem('1234567890123')).toMatch(/not only digits/);
    expect(passwordProblem('1234567a')).toBeNull();
  });
});
