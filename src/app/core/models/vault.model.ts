/** One account held inside the encrypted vault. */
export interface VaultAccount {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly privateKey: string;
}

/** Decrypted shape of the vault payload — never written to storage as-is. */
export interface VaultPayload {
  readonly accounts: VaultAccount[];
}

/**
 * What actually gets written to localStorage. Nothing in here is secret
 * by itself — salt and iv are meant to be public — only `ciphertext` is
 * opaque, and only decryptable with the correct PIN.
 */
export interface VaultEnvelope {
  readonly salt: string; // base64, PBKDF2 salt
  readonly iv: string; // base64, AES-GCM nonce
  readonly ciphertext: string; // base64, AES-GCM output (payload + auth tag)
}
