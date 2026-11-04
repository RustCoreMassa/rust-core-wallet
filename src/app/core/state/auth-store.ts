import { Injectable, computed, inject, signal } from '@angular/core';
import { VaultAccount, VaultEnvelope, VaultPayload } from '../models/vault.model';
import { LOCAL_STORE } from '../platform/app-storage';
import { Ciphertext, CryptoVault, PBKDF2_ITERATIONS } from '../services/crypto-vault';
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
  private readonly _hasVault = signal(this.vaultStorage.exists());

  private sessionKey: CryptoKey | null = null;

  readonly isUnlocked = this._isUnlocked.asReadonly();
  readonly accounts = this._accounts.asReadonly();
  readonly hasVault = this._hasVault.asReadonly();

  readonly activeAccount = computed(() => this._accounts()[0] ?? null);

  /** First-time setup: encrypts `accounts` under a fresh secret and unlocks. */
  async register(secret: string, accounts: VaultAccount[]): Promise<void> {
    const { key, salt, iterations } = await this.cryptoVault.deriveNewKey(
      secret,
      this.sessionKeys.keepsKey,
    );
    const payload: VaultPayload = { accounts };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(JSON.stringify(payload), key);

    this.vaultStorage.save({ salt, iterations, iv, ciphertext });
    this.clearFailures();
    this.sessionKey = key;
    this._accounts.set(accounts);
    this._isUnlocked.set(true);
    this._hasVault.set(true);
    await this.keepSession(key);
  }

  /**
   * Returns false on a wrong secret instead of throwing — callers just check the result. Throws
   * TooManyAttemptsError, without checking the secret, while the user must wait.
   */
  async unlock(secret: string): Promise<boolean> {
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
    if (envelope.iterations !== PBKDF2_ITERATIONS) {
      // A vault from before 1.7.0: re-encrypt it with today's stronger key while we have the
      // secret. Best effort — the session goes on under the old key if it fails.
      try {
        await this.strengthen(secret, envelope.salt);
        return true;
      } catch (err) {
        console.warn('Strengthening the vault failed', err);
      }
    }
    await this.keepSession(key);
    return true;
  }

  /**
   * Re-encrypts a vault from before 1.7.0 with PBKDF2_ITERATIONS, **keeping its salt**: a window
   * still running an older version that saves over it then writes a valid older vault (its own
   * key, that salt, no iteration count), which the next unlock strengthens again — never one that
   * no secret opens.
   */
  private async strengthen(secret: string, salt: string): Promise<void> {
    await this.currentVault();
    const key = await this.cryptoVault.deriveExistingKey(
      secret,
      salt,
      PBKDF2_ITERATIONS,
      this.sessionKeys.keepsKey,
    );
    const payload: VaultPayload = { accounts: this._accounts() };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(JSON.stringify(payload), key);
    this.vaultStorage.save({ salt, iterations: PBKDF2_ITERATIONS, iv, ciphertext });
    this.sessionKey = key;
    await this.keepSession(key);
  }

  /**
   * The stored vault, checked to still open with this session's key before anything overwrites
   * it. Another window (a second tab, the extension's side panel) may have re-encrypted it
   * meanwhile — a new secret, a stronger key: writing over it with this older key would leave a
   * vault no secret opens. Then nothing is written and the user unlocks again.
   */
  private async currentVault(): Promise<VaultEnvelope> {
    if (!this.sessionKey) throw new Error('Vault is locked');
    const envelope = this.vaultStorage.load();
    if (!envelope) throw new Error('No vault to update');
    try {
      await this.cryptoVault.decrypt(envelope, this.sessionKey);
    } catch {
      throw new Error(
        'The wallet was changed in another window. Lock it and unlock it again, then retry.',
      );
    }
    return envelope;
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
    await this.currentVault();
    const { key, salt, iterations } = await this.cryptoVault.deriveNewKey(
      secret,
      this.sessionKeys.keepsKey,
    );
    const payload: VaultPayload = { accounts: this._accounts() };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(JSON.stringify(payload), key);

    this.vaultStorage.save({ salt, iterations, iv, ciphertext });
    this.sessionKey = key;
    await this.keepSession(key);
  }

  /** Persists an updated account list under the already-derived session key. */
  async saveAccounts(accounts: VaultAccount[]): Promise<void> {
    const envelope = await this.currentVault();
    const payload: VaultPayload = { accounts };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(
      JSON.stringify(payload),
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
