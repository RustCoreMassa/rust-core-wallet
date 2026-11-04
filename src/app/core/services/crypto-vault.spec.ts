import { CryptoVault } from './crypto-vault';

describe('CryptoVault', () => {
  const vault = new CryptoVault();

  it('encrypts and decrypts with the key derived from the PIN', async () => {
    const { key, salt, iterations } = await vault.deriveNewKey('123456');
    const sealed = await vault.encrypt('secret private key', key);
    expect(sealed.ciphertext).not.toContain('secret');

    const sameKey = await vault.deriveExistingKey('123456', salt, iterations);
    expect(await vault.decrypt(sealed, sameKey)).toBe('secret private key');
  });

  it('refuses to decrypt with a wrong PIN (authenticated encryption)', async () => {
    const { key, salt, iterations } = await vault.deriveNewKey('123456');
    const sealed = await vault.encrypt('secret', key);
    const wrongKey = await vault.deriveExistingKey('654321', salt, iterations);
    await expect(vault.decrypt(sealed, wrongKey)).rejects.toBeDefined();
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = await vault.deriveNewKey('123456');
    const b = await vault.deriveNewKey('123456');
    expect(a.salt).not.toBe(b.salt);
    const one = await vault.encrypt('same', a.key);
    const two = await vault.encrypt('same', a.key);
    expect(one.iv).not.toBe(two.iv);
    expect(one.ciphertext).not.toBe(two.ciphertext);
  });

  it('opens the vault whatever the Unicode composition of the password', async () => {
    const composed = 'parolă-mea-é'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const { key, salt, iterations } = await vault.deriveNewKey(composed);
    const sealed = await vault.encrypt('secret', key);
    const sameKey = await vault.deriveExistingKey(decomposed, salt, iterations);
    expect(await vault.decrypt(sealed, sameKey)).toBe('secret');
  });

  it('derives non-extractable keys', async () => {
    const { key } = await vault.deriveNewKey('123456');
    expect(key.extractable).toBe(false);
  });
});

describe('CryptoVault — iteration counts', () => {
  const vault = new CryptoVault();

  it('refuses counts no wallet version wrote (a tampered vault)', async () => {
    const { salt } = await vault.deriveNewKey('123456');
    for (const iterations of [0, 1_000, 299_999, 10_000_001, 1.5]) {
      await expect(
        vault.deriveExistingKey('123456', salt, iterations),
        String(iterations),
      ).rejects.toThrow('Unsupported vault');
    }
  });
});
