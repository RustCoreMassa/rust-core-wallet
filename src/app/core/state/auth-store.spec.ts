import { TestBed } from '@angular/core/testing';
import { VaultAccount } from '../models/vault.model';
import {
  CryptoVault,
  LEGACY_PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS,
  exportVaultKey,
  importVaultKey,
} from '../services/crypto-vault';
import { SESSION_KEY_STORE, SessionKeyStore } from '../services/session-key-store';
import { VaultStorage } from '../services/vault-storage';
import { AuthStore, FREE_ATTEMPTS, TooManyAttemptsError, unlockWaitMs } from './auth-store';

const main: VaultAccount = {
  id: 'main',
  name: 'wallet_1',
  address: 'AU1main',
  privateKey: 'S1main',
};
const second: VaultAccount = {
  id: 'two',
  name: 'wallet_2',
  address: 'AU1two',
  privateKey: 'S1two',
};

describe('AuthStore', () => {
  let auth: AuthStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(AuthStore);
  });

  it('registers a vault that stores no plaintext key and no PIN', async () => {
    await auth.register('123456', [main]);
    expect(auth.isUnlocked()).toBe(true);
    expect(auth.hasVault()).toBe(true);
    const stored = JSON.stringify(localStorage);
    expect(stored).not.toContain('S1main');
    expect(stored).not.toContain('123456');
  });

  it('unlocks with the right PIN and rejects a wrong one', async () => {
    await auth.register('123456', [main]);
    auth.lock();
    expect(auth.accounts()).toEqual([]);

    expect(await auth.unlock('000000')).toBe(false);
    expect(auth.isUnlocked()).toBe(false);

    expect(await auth.unlock('123456')).toBe(true);
    expect(auth.accounts()).toEqual([main]);
  });

  it('verifies the secret without touching the session', async () => {
    await auth.register('123456', [main]);
    expect(await auth.verifySecret('123456')).toBe(true);
    expect(await auth.verifySecret('111111')).toBe(false);
    expect(auth.isUnlocked()).toBe(true);
  });

  it('persists account changes under the same PIN', async () => {
    await auth.register('123456', [main]);
    await auth.saveAccounts([main, second]);
    auth.lock();
    await auth.unlock('123456');
    expect(auth.accounts().map((a) => a.id)).toEqual(['main', 'two']);
  });

  it('moves the vault to a new secret, keeping the accounts and the session', async () => {
    await auth.register('123456', [main, second]);
    const before = TestBed.inject(VaultStorage).load();
    await auth.changeSecret('correct horse battery');
    const after = TestBed.inject(VaultStorage).load();
    expect(after?.salt).not.toBe(before?.salt);
    expect(auth.isUnlocked()).toBe(true);
    // The session goes on under the new key: saving and session data still work.
    await auth.saveAccounts([main]);
    expect(await auth.decryptForSession(await auth.encryptForSession('x'))).toBe('x');

    expect(await auth.verifySecret('123456')).toBe(false);
    expect(await auth.verifySecret('correct horse battery')).toBe(true);
    auth.lock();
    expect(await auth.unlock('123456')).toBe(false);
    expect(await auth.unlock('correct horse battery')).toBe(true);
    expect(auth.accounts()).toEqual([main]);
    expect(JSON.stringify(localStorage)).not.toContain('correct horse');
  });

  it("can't change the secret while locked", async () => {
    await auth.register('123456', [main]);
    const before = TestBed.inject(VaultStorage).load();
    auth.lock();
    await expect(auth.changeSecret('correct horse battery')).rejects.toThrow(/locked/);
    expect(TestBed.inject(VaultStorage).load()).toEqual(before);
  });

  it('renames with trimming and rejects duplicates (case-insensitive)', async () => {
    await auth.register('123456', [main, second]);
    await auth.renameAccount('two', '  Savings ');
    expect(auth.accounts()[1].name).toBe('Savings');
    await expect(auth.renameAccount('main', 'SAVINGS')).rejects.toThrow(/already used/);
    await expect(auth.renameAccount('main', '   ')).rejects.toThrow(/empty/);
  });

  it('removes an account but never the last one', async () => {
    await auth.register('123456', [main, second]);
    await auth.removeAccount('two');
    expect(auth.accounts()).toEqual([main]);
    await expect(auth.removeAccount('main')).rejects.toThrow(/only wallet/);
  });

  it('logs out by deleting the vault from the device', async () => {
    await auth.register('123456', [main]);
    auth.logout();
    expect(auth.isUnlocked()).toBe(false);
    expect(auth.hasVault()).toBe(false);
    expect(TestBed.inject(VaultStorage).exists()).toBe(false);
  });

  it('encrypts session data only while unlocked', async () => {
    await auth.register('123456', [main]);
    const sealed = await auth.encryptForSession('{"cache":1}');
    expect(await auth.decryptForSession(sealed)).toBe('{"cache":1}');
    auth.lock();
    await expect(auth.encryptForSession('x')).rejects.toThrow(/locked/);
  });

  it('suggests the next free wallet_N name', async () => {
    await auth.register('123456', [main, second]);
    expect(auth.suggestWalletName()).toBe('wallet_3');
  });

  it('keeps no session on the web: a reloaded page needs the PIN', async () => {
    await auth.register('123456', [main]);
    const reloaded = TestBed.runInInjectionContext(() => new AuthStore());
    expect(await reloaded.resume()).toBe(false);
    expect(reloaded.isUnlocked()).toBe(false);
  });
});

/** The extension's kind of store, in memory: keeps the exported raw key. */
class KeepingSessionKeyStore implements SessionKeyStore {
  readonly keepsKey = true;
  raw: string | null = null;
  async save(key: CryptoKey): Promise<void> {
    this.raw = await exportVaultKey(key); // throws unless the key was derived extractable
  }
  async restore(): Promise<CryptoKey | null> {
    return this.raw ? importVaultKey(this.raw) : null;
  }
  async clear(): Promise<void> {
    this.raw = null;
  }
}

describe('AuthStore with a session kept outside the page', () => {
  let sessionKeys: KeepingSessionKeyStore;
  const reopen = () => TestBed.runInInjectionContext(() => new AuthStore());

  beforeEach(() => {
    localStorage.clear();
    sessionKeys = new KeepingSessionKeyStore();
    TestBed.configureTestingModule({
      providers: [{ provide: SESSION_KEY_STORE, useValue: sessionKeys }],
    });
  });

  it('resumes a reopened popup without the PIN, key still usable', async () => {
    await TestBed.inject(AuthStore).register('123456', [main]);
    const popup = reopen();
    expect(await popup.resume()).toBe(true);
    expect(popup.accounts()).toEqual([main]);
    await popup.saveAccounts([main, second]);
    expect(await popup.verifySecret('123456')).toBe(true);
  });

  it('keeps the session under the new key after a change of secret', async () => {
    const auth = TestBed.inject(AuthStore);
    await auth.register('123456', [main]);
    await auth.changeSecret('correct horse battery');
    const popup = reopen();
    expect(await popup.resume()).toBe(true);
    expect(popup.accounts()).toEqual([main]);
  });

  it('keeps the session after a PIN unlock too', async () => {
    const auth = TestBed.inject(AuthStore);
    await auth.register('123456', [main]);
    auth.lock();
    await auth.unlock('123456');
    expect(await reopen().resume()).toBe(true);
  });

  it('ends the kept session on lock and on log out', async () => {
    const auth = TestBed.inject(AuthStore);
    await auth.register('123456', [main]);
    auth.lock();
    await Promise.resolve();
    expect(sessionKeys.raw).toBeNull();
    expect(await reopen().resume()).toBe(false);

    await auth.unlock('123456');
    auth.logout();
    await Promise.resolve();
    expect(await reopen().resume()).toBe(false);
  });

  it("drops a kept key that doesn't open the vault", async () => {
    const auth = TestBed.inject(AuthStore);
    await auth.register('123456', [main]);
    const stale = sessionKeys.raw;
    auth.logout();
    await auth.register('654321', [second]);
    auth.lock();
    sessionKeys.raw = stale;
    expect(await reopen().resume()).toBe(false);
    expect(sessionKeys.raw).toBeNull();
  });
});

describe('AuthStore — wrong-secret throttling', () => {
  let auth: AuthStore;
  let now: number;

  beforeEach(() => {
    localStorage.clear();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    TestBed.configureTestingModule({});
    auth = TestBed.inject(AuthStore);
  });

  afterEach(() => vi.restoreAllMocks());

  it('waits 30 s after 5 wrong secrets, doubling up to an hour', () => {
    expect([0, 4, 5, 6, 7, 10, 12, 30].map(unlockWaitMs)).toEqual([
      0, 0, 30_000, 60_000, 120_000, 960_000, 3_600_000, 3_600_000,
    ]);
    expect(FREE_ATTEMPTS).toBe(5);
  });

  it('refuses to even check the secret while the user must wait, then lets them retry', async () => {
    await auth.register('123456', [main]);
    auth.lock();
    for (let i = 0; i < FREE_ATTEMPTS; i++) expect(await auth.unlock('000000')).toBe(false);

    // Even the right PIN isn't tried during the wait.
    await expect(auth.unlock('123456')).rejects.toBeInstanceOf(TooManyAttemptsError);
    await expect(auth.unlock('123456')).rejects.toThrow('try again in 30 s');
    expect(auth.isUnlocked()).toBe(false);

    now += 30_000;
    expect(await auth.unlock('000000')).toBe(false); // 6th failure: 1 min
    await expect(auth.unlock('123456')).rejects.toThrow('try again in 1 min');
    now += 59_000;
    await expect(auth.unlock('123456')).rejects.toThrow('try again in 1 s');
    now += 1_000;
    expect(await auth.unlock('123456')).toBe(true);
    expect(auth.waitBeforeNextTry()).toBe(0); // a right secret starts the count over
  });

  it('counts step-up checks (reveal key, remove wallet, log out) too', async () => {
    await auth.register('123456', [main]);
    for (let i = 0; i < FREE_ATTEMPTS; i++) expect(await auth.verifySecret('000000')).toBe(false);
    await expect(auth.verifySecret('123456')).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it('keeps counting across a reload, and forgets on log out', async () => {
    await auth.register('123456', [main]);
    auth.lock();
    for (let i = 0; i < FREE_ATTEMPTS; i++) await auth.unlock('000000');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(AuthStore);
    await expect(reloaded.unlock('123456')).rejects.toBeInstanceOf(TooManyAttemptsError);

    reloaded.logout();
    expect(reloaded.waitBeforeNextTry()).toBe(0);
  });
});

describe('AuthStore — vault key strength', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  /** A vault as versions before 1.7.0 wrote it: 300 000 iterations, no `iterations` field. */
  async function legacyVault(pin: string, accounts: VaultAccount[]): Promise<void> {
    const crypto = TestBed.inject(CryptoVault);
    const salt = btoa(
      String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(16))),
    );
    const key = await crypto.deriveExistingKey(pin, salt, LEGACY_PBKDF2_ITERATIONS);
    const { iv, ciphertext } = await crypto.encrypt(JSON.stringify({ accounts }), key);
    TestBed.inject(VaultStorage).save({ salt, iv, ciphertext });
  }

  it('creates new vaults with 600 000 iterations', async () => {
    await TestBed.inject(AuthStore).register('123456', [main]);
    expect(TestBed.inject(VaultStorage).load()?.iterations).toBe(PBKDF2_ITERATIONS);
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it('moves an older vault to 600 000 iterations at its next unlock, same PIN', async () => {
    await legacyVault('123456', [main]);
    const before = TestBed.inject(VaultStorage).load()!;
    const auth = TestBed.inject(AuthStore);

    expect(await auth.unlock('123456')).toBe(true);
    const after = TestBed.inject(VaultStorage).load()!;
    expect(after.iterations).toBe(PBKDF2_ITERATIONS);
    expect(after.ciphertext).not.toBe(before.ciphertext);
    // Same salt, on purpose: see the next test.
    expect(after.salt).toBe(before.salt);

    // Still the same wallets and PIN, and changes keep the new strength.
    await auth.saveAccounts([main, second]);
    expect(TestBed.inject(VaultStorage).load()?.iterations).toBe(PBKDF2_ITERATIONS);
    auth.lock();
    expect(await auth.unlock('123456')).toBe(true);
    expect(auth.accounts()).toEqual([main, second]);
    expect(await auth.verifySecret('123456')).toBe(true);
  });

  it('keeps an older vault usable while it is not moved yet (account changes, step-up checks)', async () => {
    await legacyVault('123456', [main]);
    const auth = TestBed.inject(AuthStore);
    expect(await auth.verifySecret('123456')).toBe(true);
    expect(TestBed.inject(VaultStorage).load()?.iterations).toBeUndefined();
  });

  it('survives a window still running an older version saving over a strengthened vault', async () => {
    await legacyVault('123456', [main]);
    expect(await TestBed.inject(AuthStore).unlock('123456')).toBe(true); // strengthened

    // What versions before 1.7.0 do on "add wallet": their 300 000-iteration key, the stored
    // salt, no iteration count.
    const storage = TestBed.inject(VaultStorage);
    const crypto = TestBed.inject(CryptoVault);
    const { salt } = storage.load()!;
    const oldKey = await crypto.deriveExistingKey('123456', salt, LEGACY_PBKDF2_ITERATIONS);
    const written = await crypto.encrypt(JSON.stringify({ accounts: [main, second] }), oldKey);
    storage.save({ salt, ...written });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(AuthStore);
    expect(await reloaded.unlock('123456')).toBe(true);
    expect(reloaded.accounts()).toEqual([main, second]);
    expect(TestBed.inject(VaultStorage).load()?.iterations).toBe(PBKDF2_ITERATIONS);
  });

  it('never overwrites a vault another window re-encrypted meanwhile', async () => {
    const first = TestBed.inject(AuthStore);
    await first.register('123456', [main]);
    const second_ = TestBed.runInInjectionContext(() => new AuthStore());
    expect(await second_.unlock('123456')).toBe(true);

    // The first window moves the vault to a new secret (the extension's PIN → password step).
    await first.changeSecret('correct horse battery');

    await expect(second_.saveAccounts([main, second])).rejects.toThrow(
      'The wallet was changed in another window',
    );
    first.lock();
    expect(await first.unlock('correct horse battery')).toBe(true);
    expect(first.accounts()).toEqual([main]);
  });

  it('refuses a vault whose iteration count was tampered with', async () => {
    const auth = TestBed.inject(AuthStore);
    await auth.register('123456', [main]);
    auth.lock();
    const storage = TestBed.inject(VaultStorage);
    for (const iterations of [1_000, 100_000_000]) {
      storage.save({ ...storage.load()!, iterations });
      expect(await auth.unlock('123456')).toBe(false);
    }
  });
});
