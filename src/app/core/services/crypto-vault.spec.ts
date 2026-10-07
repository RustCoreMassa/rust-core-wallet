import { CryptoVault } from './crypto-vault';

describe('CryptoVault', () => {
  const vault = new CryptoVault();

  it('encrypts and decrypts with the key derived from the PIN', async () => {
    const { key, salt } = await vault.deriveNewKey('123456');
    const sealed = await vault.encrypt('secret private key', key);
    expect(sealed.ciphertext).not.toContain('secret');

    const sameKey = await vault.deriveExistingKey('123456', salt);
    expect(await vault.decrypt(sealed, sameKey)).toBe('secret private key');
  });

  it('refuses to decrypt with a wrong PIN (authenticated encryption)', async () => {
    const { key, salt } = await vault.deriveNewKey('123456');
    const sealed = await vault.encrypt('secret', key);
    const wrongKey = await vault.deriveExistingKey('654321', salt);
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
    const { key, salt } = await vault.deriveNewKey(composed);
    const sealed = await vault.encrypt('secret', key);
    const sameKey = await vault.deriveExistingKey(decomposed, salt);
    expect(await vault.decrypt(sealed, sameKey)).toBe('secret');
  });

  it('derives non-extractable keys', async () => {
    const { key } = await vault.deriveNewKey('123456');
    expect(key.extractable).toBe(false);
  });
});
