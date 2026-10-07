import { Injectable, computed, inject, signal } from '@angular/core';
import { VaultAccount, VaultPayload } from '../models/vault.model';
import { Ciphertext, CryptoVault } from '../services/crypto-vault';
import { SESSION_KEY_STORE } from '../services/session-key-store';
import { VaultStorage } from '../services/vault-storage';

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
    const { key, salt } = await this.cryptoVault.deriveNewKey(secret, this.sessionKeys.keepsKey);
    const payload: VaultPayload = { accounts };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(JSON.stringify(payload), key);

    this.vaultStorage.save({ salt, iv, ciphertext });
    this.sessionKey = key;
    this._accounts.set(accounts);
    this._isUnlocked.set(true);
    this._hasVault.set(true);
    await this.keepSession(key);
  }

  /** Returns false on a wrong secret instead of throwing — callers just check the result. */
  async unlock(secret: string): Promise<boolean> {
    const envelope = this.vaultStorage.load();
    if (!envelope) return false;

    let key: CryptoKey;
    try {
      key = await this.cryptoVault.deriveExistingKey(
        secret,
        envelope.salt,
        this.sessionKeys.keepsKey,
      );
      await this.open(key);
    } catch {
      // Wrong secret (AES-GCM auth tag mismatch) or a corrupted vault.
      return false;
    }
    await this.keepSession(key);
    return true;
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
    try {
      const key = await this.cryptoVault.deriveExistingKey(secret, envelope.salt);
      await this.cryptoVault.decrypt(envelope, key);
      return true;
    } catch {
      return false;
    }
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
    if (!this.sessionKey) throw new Error('Vault is locked');
    const { key, salt } = await this.cryptoVault.deriveNewKey(secret, this.sessionKeys.keepsKey);
    const payload: VaultPayload = { accounts: this._accounts() };
    const { iv, ciphertext } = await this.cryptoVault.encrypt(JSON.stringify(payload), key);

    this.vaultStorage.save({ salt, iv, ciphertext });
    this.sessionKey = key;
    await this.keepSession(key);
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
