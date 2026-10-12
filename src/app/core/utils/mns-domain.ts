/**
 * Massa Name System rules, as the MNS contract enforces them
 * (massa-name-system, smart-contract/assembly/contracts/main.ts).
 */

/**
 * What `dnsAllocCost` adds to the registration fee for the name's on-chain
 * storage. The contract refunds whatever the storage doesn't use.
 */
export const MNS_STORAGE_DEPOSIT_MAS = 0.1;

const MIN_LENGTH = 2;
const MAX_LENGTH = 100;

/** What the user typed → the name the contract expects: lowercase, no spaces, no ".massa". */
export function normalizeDomainName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\.massa$/, '');
}

/** Why the contract would refuse `name` (`isValidDomain`), or null when it's well formed. */
export function domainNameError(name: string): string | null {
  if (!name) return 'Enter a name';
  if (!/^[a-z0-9-]+$/.test(name)) return 'Use only letters a–z, digits 0–9 and hyphens';
  if (name.length < MIN_LENGTH) return `A name needs at least ${MIN_LENGTH} characters`;
  if (name.length > MAX_LENGTH) return `A name can have at most ${MAX_LENGTH} characters`;
  return null;
}

/**
 * The contract's registration fee in MAS (`calculateCreationCost`): the
 * shorter the name, the higher the fee. For the price shown while typing —
 * what a registration actually sends is read from the contract.
 */
export function domainRegistrationFee(name: string): number {
  switch (name.length) {
    case 2:
      return 10_000;
    case 3:
      return 1_000;
    case 4:
      return 100;
    case 5:
      return 10;
    default:
      return 1;
  }
}

/**
 * The MNS contract's reason for refusing a registration in a test run, in
 * plain words; the raw error goes to the console only.
 */
export function rejectedRegistrationMessage(raw: string, name: string): string {
  console.error('[domain registration simulation]', raw);
  if (/Domain already registered/i.test(raw)) return `${name}.massa is already taken`;
  if (/allocation is locked/i.test(raw)) {
    return 'The Massa Name System has paused new registrations. Try again later.';
  }
  return 'The Massa Name System rejected this registration in a test run, so it would fail.';
}
