import { Injectable, computed, inject, signal } from '@angular/core';
import { SavedAddress } from '../models/saved-address.model';
import { VaultAccount, VaultEnvelope, VaultPayload } from '../models/vault.model';
import { LOCAL_STORE } from '../platform/app-storage';
import {
  Ciphertext,
  CryptoVault,
  LEGACY_PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS,
} from '../services/crypto-vault';
import { SESSION_KEY_STORE } from '../services/session-key-store';
import { VaultStorage } from '../services/vault-storage';

/** Where wrong-secret attempts are counted (survives reloads, so reopening doesn't reset it). */
const FAILURES_KEY = 'massa-wallet:unlock-failures';
/** Wrong secrets allowed before the wallet makes the user wait. */
export const FREE_ATTEMPTS = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 60 * 60_000;

/**
 * How long after the last wrong secret the next try is allowed: nothing for the first
 * FREE_ATTEMPTS, then 30 s, doubling with every further one, at most an hour — so trying every
 * 6-digit PIN on the device itself would take a century.
 */
export function unlockWaitMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(FIRST_WAIT_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_WAIT_MS);
}

/**
 * Thrown by `register` when this device already has a vault — e.g. made meanwhile in another
 * tab or extension view: creating one more would overwrite it, and the keys it holds.
 */
export class VaultExistsError extends Error {
  constructor() {
    super('A wallet was already set up on this device, in another window. Unlock it instead.');
    this.name = 'VaultExistsError';
  }
}

/** Longest saved-address label kept. */
const MAX_ADDRESS_NAME = 60;
/** Most saved addresses. */
const MAX_SAVED_ADDRESSES = 200;
const MASSA_ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;

/** The saved addresses of a decrypted payload; anything malformed is left out. */
function toAddressBook(value: unknown): SavedAddress[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (e): e is SavedAddress =>
        !!e &&
        typeof e === 'object' &&
        typeof e.name === 'string' &&
        typeof e.address === 'string' &&
        MASSA_ADDRESS.test(e.address),
    )
    .slice(0, MAX_SAVED_ADDRESSES)
    .map(({ name, address }) => ({ name: name.slice(0, MAX_ADDRESS_NAME), address }));
}

/** Thrown instead of checking a secret while the wallet makes the user wait. */
export class TooManyAttemptsError extends Error {
  constructor(readonly waitMs: number) {
    super(`Too many wrong attempts — try again in ${formatWait(waitMs)}`);
    this.name = 'TooManyAttemptsError';
  }
}

function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.ceil(seconds / 60)} min`;
}

interface Failures {
  readonly count: number;
  /** ms epoch of the last wrong secret. */
  readonly at: number;
}

/**
 * Owns the vault lifecycle, gated by the unlock secret (the web app's PIN
 * or the extension's password, see UNLOCK_SECRET): whether a vault exists on this
 * device, whether the current session is unlocked, and — only while
 * unlocked — the decrypted accounts and the derived encryption key
 * needed to re-save the vault after a change (e.g. adding a wallet).
 *
 * The secret itself never lives in a field on this class. It passes
 * through `unlock`/`register` as a local parameter and is handed to
 * CryptoVault, which returns a `CryptoKey` — that key is what gets
 * cached in `sessionKey`, never the secret. A SessionKeyStore may keep that
 * key beyond this page (the extension popup, see `resume`); the web app's
 * keeps nothing.
 *
 * A 6-digit PIN only has 1,000,000 possible values. PBKDF2 (in
 * CryptoVault) makes each offline guess expensive, but it cannot make
 * a 6-digit space itself resistant to a well-resourced offline
 * attacker — that's a property of the PIN length, not of this code.
 * It's the same trade-off real wallets accept for a fast unlock code,
 * resting on the assumption that the encrypted vault blob itself
 * doesn't leak — acceptable on a phone; the browser extension, where
 * that assumption is weaker, uses a password instead.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly cryptoVault = inject(CryptoVault);
  private readonly vaultStorage = inject(VaultStorage);
  private readonly sessionKeys = inject(SESSION_KEY_STORE);
  private readonly store = inject(LOCAL_STORE);

  private readonly _isUnlocked = signal(false);
  private readonly _accounts = signal<VaultAccount[]>([]);
  private readonly _addressBook = signal<SavedAddress[]>([]);
  private readonly _hasVault = signal(this.vaultStorage.exists());

  private sessionKey: CryptoKey | null = null;

  readonly isUnlocked = this._isUnlocked.asReadonly();
  readonly accounts = this._accounts.asReadonly();
  /**
   * The addresses the user saved for sending (Send → "Save this address"), with their labels.
   * Kept inside the encrypted vault: they reveal who the user pays, and must outlive the session.
   */
  readonly addressBook = this._addressBook.asReadonly();
  readonly hasVault = this._hasVault.asReadonly();

  readonly activeAccount = computed(() => this._accounts()[0] ?? null);

  /**
   * First-time setup: encrypts `accounts` under a fresh secret and unlocks. Throws
   * VaultExistsError when a vault exists already (another tab or view made one meanwhile):
   * never overwrites one.
   */
  async register(secret: string, accounts: VaultAccount[]): Promise<void> {
    this.assertNoVault();
    const { key, salt, iterations } = await this.cryptoVault.deriveNewKey(
      secret,
      this.sessionKeys.keepsKey,
    );
    const payload: VaultPayload = { accounts, addressBook: [] };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(JSON.stringify(payload), key);

    // Checked again: deriving the key took a while, another window may have saved one since.
    this.assertNoVault();
    this.vaultStorage.save({ salt, iterations, iv, ciphertext });
    this.clearFailures();
    this.sessionKey = key;
    this._accounts.set(accounts);
    this._addressBook.set([]);
    this._isUnlocked.set(true);
    this._hasVault.set(true);
    await this.keepSession(key);
  }

  private assertNoVault(): void {
    if (this.vaultStorage.exists()) {
      this._hasVault.set(true);
      throw new VaultExistsError();
    }
  }

  /**
   * Returns false on a wrong secret instead of throwing — callers just check the result. Throws
   * TooManyAttemptsError, without checking the secret, while the user must wait.
   *
   * `keepSession: false` opens the vault for this page only: nothing a reopened popup could
   * resume — for a vault that must move to a password first (the session is kept once it has).
   */
  async unlock(
    secret: string,
    { keepSession = true }: { keepSession?: boolean } = {},
  ): Promise<boolean> {
    const envelope = this.vaultStorage.load();
    if (!envelope) return false;
    this.assertMayTry();

    let key: CryptoKey;
    try {
      key = await this.cryptoVault.deriveExistingKey(
        secret,
        envelope.salt,
        envelope.iterations,
        this.sessionKeys.keepsKey,
      );
      await this.open(key);
    } catch {
      // Wrong secret (AES-GCM auth tag mismatch) or a corrupted vault.
      this.recordFailure();
      return false;
    }
    this.clearFailures();
    if ((envelope.iterations ?? LEGACY_PBKDF2_ITERATIONS) < PBKDF2_ITERATIONS) {
      // A vault from before 1.7.0: re-encrypt it with today's stronger key while we have the
      // secret. Best effort — the session goes on under the old key if it fails. (A vault with
      // more iterations, from a newer version, is left as it is.)
      try {
        await this.strengthen(secret, envelope.salt, keepSession);
        return true;
      } catch (err) {
        console.warn('Strengthening the vault failed', err);
      }
    }
    if (keepSession) await this.keepSession(key);
    return true;
  }

  /**
   * Re-encrypts a vault from before 1.7.0 with PBKDF2_ITERATIONS, **keeping its salt**: a window
   * still running an older version that saves over it then writes a valid older vault (its own
   * key, that salt, no iteration count), which the next unlock strengthens again — never one that
   * no secret opens.
   */
  private async strengthen(secret: string, salt: string, keepSession: boolean): Promise<void> {
    await this.currentVault();
    const key = await this.cryptoVault.deriveExistingKey(
      secret,
      salt,
      PBKDF2_ITERATIONS,
      this.sessionKeys.keepsKey,
    );
    const { iv, ciphertext } = await this.cryptoVault.encrypt(this.currentPayload(), key);
    this.vaultStorage.save({ salt, iterations: PBKDF2_ITERATIONS, iv, ciphertext });
    this.sessionKey = key;
    if (keepSession) await this.keepSession(key);
  }

  /** What the vault holds now, as encrypted: the accounts and the saved addresses. */
  private currentPayload(
    accounts: VaultAccount[] = this._accounts(),
    addressBook: SavedAddress[] = this._addressBook(),
  ): string {
    return JSON.stringify({ accounts, addressBook } satisfies VaultPayload);
  }

  /**
   * The stored vault, checked to still open with this session's key before anything overwrites
   * it. Another window (a second tab, the extension's side panel) may have re-encrypted it
   * meanwhile — a new secret, a stronger key: writing over it with this older key would leave a
   * vault no secret opens. Then nothing is written and the user unlocks again.
   */
  private async currentVault(): Promise<{ envelope: VaultEnvelope; stored: VaultPayload }> {
    if (!this.sessionKey) throw new Error('Vault is locked');
    const envelope = this.vaultStorage.load();
    if (!envelope) throw new Error('No vault to update');
    let plaintext: string;
    try {
      plaintext = await this.cryptoVault.decrypt(envelope, this.sessionKey);
    } catch {
      throw new Error(
        'The wallet was changed in another window. Lock it and unlock it again, then retry.',
      );
    }
    return { envelope, stored: JSON.parse(plaintext) as VaultPayload };
  }

  /** How long the user must still wait before the next try; 0 when they may try now. */
  waitBeforeNextTry(): number {
    const failures = this.failures();
    if (!failures) return 0;
    return Math.max(0, failures.at + unlockWaitMs(failures.count) - Date.now());
  }

  /**
   * Unlocks without the secret when the SessionKeyStore still holds this
   * session's key (the extension popup reopened before auto-lock). Always
   * false on the web.
   */
  async resume(): Promise<boolean> {
    if (this._isUnlocked()) return true;
    const key = await this.sessionKeys.restore().catch(() => null);
    if (!key) return false;
    try {
      await this.open(key);
      return true;
    } catch {
      // No vault any more, or a key from another one (logged out and re-created meanwhile).
      await this.sessionKeys.clear().catch(() => {});
      return false;
    }
  }

  lock(): void {
    this._isUnlocked.set(false);
    this._accounts.set([]);
    this._addressBook.set([]);
    this.sessionKey = null;
    this.sessionKeys.clear().catch((err) => console.warn('Clearing the session key failed', err));
  }

  /**
   * Full log out: locks the session AND deletes the encrypted vault from
   * this device. Irreversible — the wallets can only come back by
   * importing their private keys again under a new secret.
   */
  logout(): void {
    this.lock();
    this.vaultStorage.clear();
    this.clearFailures();
    this._hasVault.set(false);
  }

  /**
   * Re-checks the secret against the stored vault WITHOUT touching session
   * state (`isUnlocked`, `accounts`, `sessionKey` are all left alone).
   * For step-up confirmation before revealing something sensitive
   * (e.g. a private key backup) while already unlocked.
   */
  async verifySecret(secret: string): Promise<boolean> {
    const envelope = this.vaultStorage.load();
    if (!envelope) return false;
    // Counted like unlock: whoever holds an unlocked phone mustn't guess the PIN to see the keys.
    this.assertMayTry();
    try {
      const key = await this.cryptoVault.deriveExistingKey(
        secret,
        envelope.salt,
        envelope.iterations,
      );
      await this.cryptoVault.decrypt(envelope, key);
    } catch {
      this.recordFailure();
      return false;
    }
    this.clearFailures();
    return true;
  }

  // ---- wrong-secret throttling ---------------------------------------------

  private assertMayTry(): void {
    const wait = this.waitBeforeNextTry();
    if (wait > 0) throw new TooManyAttemptsError(wait);
  }

  private failures(): Failures | null {
    try {
      const saved = JSON.parse(this.store.getItem(FAILURES_KEY) ?? 'null') as Failures | null;
      return saved && Number.isInteger(saved.count) && Number.isFinite(saved.at) ? saved : null;
    } catch {
      return null;
    }
  }

  private recordFailure(): void {
    const count = (this.failures()?.count ?? 0) + 1;
    this.store.setItem(FAILURES_KEY, JSON.stringify({ count, at: Date.now() } satisfies Failures));
  }

  private clearFailures(): void {
    this.store.removeItem(FAILURES_KEY);
  }

  /** Throws when `key` doesn't decrypt the stored vault; state changes only on success. */
  private async open(key: CryptoKey): Promise<void> {
    const envelope = this.vaultStorage.load();
    if (!envelope) throw new Error('No vault');
    const payload = JSON.parse(await this.cryptoVault.decrypt(envelope, key)) as VaultPayload;
    this.sessionKey = key;
    this._accounts.set(payload.accounts);
    // Vaults saved before the address book moved in (or by an older version) have none.
    this._addressBook.set(toAddressBook(payload.addressBook));
    this._isUnlocked.set(true);
  }

  /** Best-effort: without it the session just ends with this page. */
  private async keepSession(key: CryptoKey): Promise<void> {
    await this.sessionKeys
      .save(key)
      .catch((err) => console.warn('Keeping the session failed', err));
  }

  /**
   * Re-encrypts the vault under a new secret (new salt, new key) — how the
   * extension moves a vault made with a PIN to a password. Unlocked only;
   * the session continues under the new key. Data encrypted under the old
   * key (the wallet cache) just stops decrypting and is rebuilt.
   */
  async changeSecret(secret: string): Promise<void> {
    const { stored } = await this.currentVault();
    const { key, salt, iterations } = await this.cryptoVault.deriveNewKey(
      secret,
      this.sessionKeys.keepsKey,
    );
    const addressBook = toAddressBook(stored.addressBook);
    const { iv, ciphertext } = await this.cryptoVault.encrypt(
      this.currentPayload(this._accounts(), addressBook),
      key,
    );

    this.vaultStorage.save({ salt, iterations, iv, ciphertext });
    this.sessionKey = key;
    this._addressBook.set(addressBook);
    await this.keepSession(key);
  }

  /** Persists an updated account list under the already-derived session key. */
  async saveAccounts(accounts: VaultAccount[]): Promise<void> {
    // The address book as stored: another window may have saved an address since this one read it.
    await this.persist(accounts, (stored) => toAddressBook(stored.addressBook));
  }

  /**
   * Adds a generated or imported wallet. Refuses one whose address is already in the vault:
   * two entries for one key would split its connected sites and history.
   */
  async addAccount(account: VaultAccount): Promise<void> {
    const accounts = this._accounts();
    if (accounts.some((a) => a.address === account.address)) {
      throw new Error('This wallet is already in RustCore Wallet');
    }
    if (accounts.some((a) => a.id === account.id)) throw new Error('Duplicate wallet id');
    await this.saveAccounts([...accounts, account]);
  }

  /** Saves an address for sending, under a label; an address saved before gets the new label. */
  async saveAddress(name: string, address: string): Promise<void> {
    if (!MASSA_ADDRESS.test(address)) throw new Error('Enter a valid Massa address');
    const label = name.trim().slice(0, MAX_ADDRESS_NAME) || address;
    await this.persist(this._accounts(), (stored) => {
      // Added to the book as stored, so an address another window saved meanwhile stays.
      const others = toAddressBook(stored.addressBook).filter((e) => e.address !== address);
      if (others.length >= MAX_SAVED_ADDRESSES) throw new Error('Your address book is full');
      return [...others, { name: label, address }];
    });
  }

  /**
   * Re-encrypts the vault with `accounts` and the address book `book` makes from the stored one,
   * under the session key.
   */
  private async persist(
    accounts: VaultAccount[],
    book: (stored: VaultPayload) => SavedAddress[],
  ): Promise<void> {
    const { envelope, stored } = await this.currentVault();
    const addressBook = book(stored);
    const { iv, ciphertext } = await this.cryptoVault.encrypt(
      this.currentPayload(accounts, addressBook),
      this.sessionKey!,
    );

    // Same key, so same salt and iteration count: dropping either would lock the user out.
    this.vaultStorage.save({
      salt: envelope.salt,
      iterations: envelope.iterations,
      iv,
      ciphertext,
    });
    this._accounts.set(accounts);
    this._addressBook.set(addressBook);
  }

  /**
   * Encrypts arbitrary app data (e.g. the wallet cache) under the same
   * session key as the vault, without ever handing the key out.
   */
  async encryptForSession(plaintext: string): Promise<Ciphertext> {
    if (!this.sessionKey) throw new Error('Vault is locked');
    return this.cryptoVault.encrypt(plaintext, this.sessionKey);
  }

  /** Throws when locked, or when `payload` wasn't encrypted under this vault's key. */
  async decryptForSession(payload: Ciphertext): Promise<string> {
    if (!this.sessionKey) throw new Error('Vault is locked');
    return this.cryptoVault.decrypt(payload, this.sessionKey);
  }

  /**
   * Removes one account from the vault (re-encrypted and saved). The last
   * account can't be removed — the vault always holds at least one; a full
   * log out is how that one goes.
   */
  async removeAccount(id: string): Promise<void> {
    const accounts = this._accounts();
    if (accounts.length <= 1)
      throw new Error("You can't remove your only wallet — log out instead");
    if (!accounts.some((a) => a.id === id)) throw new Error('Unknown wallet');
    await this.saveAccounts(accounts.filter((a) => a.id !== id));
  }

  // ---- naming ------------------------------------------------------------

  /** Next unused "wallet_N" — used to auto-name a freshly generated wallet. */
  suggestWalletName(): string {
    const taken = new Set(this._accounts().map((a) => normalizeName(a.name)));
    let n = 1;
    while (taken.has(normalizeName(`wallet_${n}`))) n++;
    return `wallet_${n}`;
  }

  /** Case-insensitive, trimmed comparison — `excludeId` lets a wallet keep its own name while renaming. */
  isNameTaken(name: string, excludeId?: string): boolean {
    const normalized = normalizeName(name);
    return this._accounts().some((a) => a.id !== excludeId && normalizeName(a.name) === normalized);
  }

  /** Throws if the name is empty or already used by another wallet. */
  async renameAccount(id: string, newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    if (this.isNameTaken(trimmed, id))
      throw new Error('That name is already used by another wallet');

    const updated = this._accounts().map((a) => (a.id === id ? { ...a, name: trimmed } : a));
    await this.saveAccounts(updated);
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
