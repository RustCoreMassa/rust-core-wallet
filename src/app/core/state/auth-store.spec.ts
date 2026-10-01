import { TestBed } from '@angular/core/testing';
import { VaultAccount } from '../models/vault.model';
import { exportVaultKey, importVaultKey } from '../services/crypto-vault';
import { SESSION_KEY_STORE, SessionKeyStore } from '../services/session-key-store';
import { VaultStorage } from '../services/vault-storage';
import { AuthStore } from './auth-store';

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

  it('verifies the PIN without touching the session', async () => {
    await auth.register('123456', [main]);
    expect(await auth.verifyPin('123456')).toBe(true);
    expect(await auth.verifyPin('111111')).toBe(false);
    expect(auth.isUnlocked()).toBe(true);
  });

  it('persists account changes under the same PIN', async () => {
    await auth.register('123456', [main]);
    await auth.saveAccounts([main, second]);
    auth.lock();
    await auth.unlock('123456');
    expect(auth.accounts().map((a) => a.id)).toEqual(['main', 'two']);
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
    expect(await popup.verifyPin('123456')).toBe(true);
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
