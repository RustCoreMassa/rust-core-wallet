import { Injectable } from '@angular/core';

/** PBKDF2-HMAC-SHA256 iterations for new vaults: OWASP's recommendation (2023). */
export const PBKDF2_ITERATIONS = 600_000;
/** What vaults made before 1.7.0 used — they move to PBKDF2_ITERATIONS at their next unlock. */
export const LEGACY_PBKDF2_ITERATIONS = 300_000;
/** Above this a stored count can only be tampering: refused rather than derived for hours. */
const MAX_PBKDF2_ITERATIONS = 10_000_000;
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

export interface DerivedKey {
  readonly key: CryptoKey; // non-extractable unless asked for — see deriveKey
  readonly salt: string; // base64 — safe to persist alongside the ciphertext
  readonly iterations: number; // persisted too, so the key can be derived again
}

export interface Ciphertext {
  readonly iv: string; // base64
  readonly ciphertext: string; // base64
}

/**
 * Turns the unlock secret (the web app's PIN or the extension's password,
 * see UNLOCK_SECRET) into vault encryption using the browser's native Web
 * Crypto API (`crypto.subtle`) — no third-party crypto library.
 *
 * The secret itself is never written to storage, and never held onto in
 * memory either: `deriveNewKey`/`deriveExistingKey` are the only places
 * it's read, and what they return is a non-extractable `CryptoKey` —
 * usable for encrypt/decrypt, but never exportable back to raw bytes.
 * AuthStore holds onto that derived key for the session (so re-saving
 * the vault after adding a wallet doesn't need the secret again), which is
 * strictly safer than caching the secret itself would be.
 *
 * AES-GCM (not AES-CBC) because it's an authenticated mode: decrypting
 * with the wrong key throws instead of silently returning garbage —
 * that's what lets the app treat "decryption failed" as "wrong PIN/password"
 * with zero network calls.
 */
@Injectable({ providedIn: 'root' })
export class CryptoVault {
  /** Registration: no salt yet, so generate one. */
  async deriveNewKey(secret: string, extractable = false): Promise<DerivedKey> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    return {
      key: await this.deriveKey(secret, salt, extractable, PBKDF2_ITERATIONS),
      salt: toBase64(salt),
      iterations: PBKDF2_ITERATIONS,
    };
  }

  /**
   * Unlock: re-derive using the salt and iteration count stored alongside the vault —
   * `iterations` undefined means a vault from before 1.7.0 (LEGACY_PBKDF2_ITERATIONS). Required on
   * purpose: deriving with the wrong count gives a key that silently fails to open the vault.
   */
  async deriveExistingKey(
    secret: string,
    saltBase64: string,
    iterations: number | undefined,
    extractable = false,
  ): Promise<CryptoKey> {
    return this.deriveKey(
      secret,
      fromBase64(saltBase64),
      extractable,
      iterations ?? LEGACY_PBKDF2_ITERATIONS,
    );
  }

  async encrypt(plaintext: string, key: CryptoKey): Promise<Ciphertext> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const buffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext),
    );
    return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(buffer)) };
  }

  /** Throws (DOMException) when `key` doesn't match — treat as a wrong PIN/password. */
  async decrypt(payload: Ciphertext, key: CryptoKey): Promise<string> {
    const iv = fromBase64(payload.iv);
    const ciphertext = fromBase64(payload.ciphertext);
    const buffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(buffer);
  }

  /**
   * `extractable` only for a SessionKeyStore that keeps the session alive
   * outside this page (the extension popup) — the web app never asks for it.
   *
   * NFC: a password with accents typed on another keyboard or OS may arrive
   * composed differently (é as one code point or as e + ◌́); both must open the
   * vault. Digits are the same either way, so existing PIN vaults are unaffected.
   */
  private async deriveKey(
    secret: string,
    salt: Uint8Array,
    extractable: boolean,
    iterations: number,
  ): Promise<CryptoKey> {
    if (
      !Number.isInteger(iterations) ||
      iterations < LEGACY_PBKDF2_ITERATIONS ||
      iterations > MAX_PBKDF2_ITERATIONS
    ) {
      // A tampered vault mustn't make the wallet derive a weak key, nor hang it for hours.
      throw new Error('Unsupported vault');
    }
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret.normalize('NFC')),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: KEY_LENGTH_BITS },
      extractable,
      ['encrypt', 'decrypt'],
    );
  }
}

/** Raw bytes (base64) of an extractable vault key, for a SessionKeyStore to keep. */
export async function exportVaultKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

/** Back from `exportVaultKey` — non-extractable again. */
export async function importVaultKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(raw) as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
