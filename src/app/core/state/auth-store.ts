import { Injectable, computed, inject, signal } from '@angular/core';
import { VaultAccount, VaultPayload } from '../models/vault.model';
import { CryptoVault } from '../services/crypto-vault';
import { VaultStorage } from '../services/vault-storage';

/**
 * Owns the PIN-gated vault lifecycle: whether a vault exists on this
 * device, whether the current session is unlocked, and — only while
 * unlocked — the decrypted accounts and the derived encryption key
 * needed to re-save the vault after a change (e.g. adding a wallet).
 *
 * The PIN itself never lives in a field on this class. It passes
 * through `unlock`/`register` as a local parameter and is handed to
 * CryptoVault, which returns a `CryptoKey` — that key is what gets
 * cached in `sessionKey`, never the PIN.
 *
 * A 6-digit PIN only has 1,000,000 possible values. PBKDF2 (in
 * CryptoVault) makes each offline guess expensive, but it cannot make
 * a 6-digit space itself resistant to a well-resourced offline
 * attacker — that's a property of the PIN length, not of this code.
 * It's the same trade-off real wallets accept for a fast unlock code,
 * resting on the assumption that the encrypted vault blob itself
 * doesn't leak.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly cryptoVault = inject(CryptoVault);
  private readonly vaultStorage = inject(VaultStorage);

  private readonly _isUnlocked = signal(false);
  private readonly _accounts = signal<VaultAccount[]>([]);
  private readonly _hasVault = signal(this.vaultStorage.exists());

  private sessionKey: CryptoKey | null = null;

  readonly isUnlocked = this._isUnlocked.asReadonly();
  readonly accounts = this._accounts.asReadonly();
  readonly hasVault = this._hasVault.asReadonly();

  readonly activeAccount = computed(() => this._accounts()[0] ?? null);

  /** First-time setup: encrypts `accounts` under a fresh PIN and unlocks. */
  async register(pin: string, accounts: VaultAccount[]): Promise<void> {
    const { key, salt } = await this.cryptoVault.deriveNewKey(pin);
    const payload: VaultPayload = { accounts };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(JSON.stringify(payload), key);

    this.vaultStorage.save({ salt, iv, ciphertext });
    this.sessionKey = key;
    this._accounts.set(accounts);
    this._isUnlocked.set(true);
    this._hasVault.set(true);
  }

  /** Returns false on a wrong PIN instead of throwing — callers just check the result. */
  async unlock(pin: string): Promise<boolean> {
    const envelope = this.vaultStorage.load();
    if (!envelope) return false;

    try {
      const key = await this.cryptoVault.deriveExistingKey(pin, envelope.salt);
      const plaintext = await this.cryptoVault.decrypt(envelope, key);
      const payload = JSON.parse(plaintext) as VaultPayload;

      this.sessionKey = key;
      this._accounts.set(payload.accounts);
      this._isUnlocked.set(true);
      return true;
    } catch {
      // Wrong PIN (AES-GCM auth tag mismatch) or a corrupted vault.
      return false;
    }
  }

  lock(): void {
    this._isUnlocked.set(false);
    this._accounts.set([]);
    this.sessionKey = null;
  }

  /**
   * Re-checks a PIN against the stored vault WITHOUT touching session
   * state (`isUnlocked`, `accounts`, `sessionKey` are all left alone).
   * For step-up confirmation before revealing something sensitive
   * (e.g. a backup phrase) while already unlocked.
   */
  async verifyPin(pin: string): Promise<boolean> {
    const envelope = this.vaultStorage.load();
    if (!envelope) return false;
    try {
      const key = await this.cryptoVault.deriveExistingKey(pin, envelope.salt);
      await this.cryptoVault.decrypt(envelope, key);
      return true;
    } catch {
      return false;
    }
  }

  /** Persists an updated account list under the already-derived session key. */
  async saveAccounts(accounts: VaultAccount[]): Promise<void> {
    if (!this.sessionKey) throw new Error('Vault is locked');
    const envelope = this.vaultStorage.load();
    if (!envelope) throw new Error('No vault to update');

    const payload: VaultPayload = { accounts };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(
      JSON.stringify(payload),
      this.sessionKey,
    );

    this.vaultStorage.save({ salt: envelope.salt, iv, ciphertext });
    this._accounts.set(accounts);
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
