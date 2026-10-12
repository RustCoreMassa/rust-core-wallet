import {
  domainNameError,
  domainRegistrationFee,
  normalizeDomainName,
  rejectedRegistrationMessage,
} from './mns-domain';

describe('mns-domain', () => {
  it('normalizes what the user typed to the contract’s form', () => {
    expect(normalizeDomainName('  Alice.MASSA ')).toBe('alice');
    expect(normalizeDomainName('my-site')).toBe('my-site');
  });

  it('accepts only what the contract’s isValidDomain accepts', () => {
    expect(domainNameError('ab')).toBeNull();
    expect(domainNameError('a-1-b')).toBeNull();
    expect(domainNameError('x'.repeat(100))).toBeNull();
    expect(domainNameError('')).toMatch(/Enter a name/);
    expect(domainNameError('a')).toMatch(/at least 2/);
    expect(domainNameError('x'.repeat(101))).toMatch(/at most 100/);
    for (const bad of ['Ab', 'a b', 'a.b', 'a_b', 'ăb', 'a​b']) {
      expect(domainNameError(bad)).toMatch(/only letters/);
    }
  });

  it('prices names like the contract’s calculateCreationCost', () => {
    expect(
      ['ab', 'abc', 'abcd', 'abcde', 'abcdef', 'x'.repeat(100)].map(domainRegistrationFee),
    ).toEqual([10_000, 1_000, 100, 10, 1, 1]);
  });

  it('explains the contract’s refusals in plain words', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(rejectedRegistrationMessage('… Domain already registered at main.ts:201', 'bob')).toBe(
      'bob.massa is already taken',
    );
    expect(rejectedRegistrationMessage('Domain allocation is locked', 'bob')).toMatch(/paused/);
    expect(rejectedRegistrationMessage('VM Error ~lib/whatever', 'bob')).toMatch(/test run/);
  });
});
