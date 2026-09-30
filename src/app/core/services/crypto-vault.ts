import { Injectable } from '@angular/core';

const PBKDF2_ITERATIONS = 300_000;
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

export interface DerivedKey {
  readonly key: CryptoKey; // non-extractable unless asked for — see deriveKey
  readonly salt: string; // base64 — safe to persist alongside the ciphertext
}

export interface Ciphertext {
  readonly iv: string; // base64
  readonly ciphertext: string; // base64
}

/**
 * Turns a PIN into vault encryption using the browser's native Web
 * Crypto API (`crypto.subtle`) — no third-party crypto library.
 *
 * The PIN itself is never written to storage, and never held onto in
 * memory either: `deriveNewKey`/`deriveExistingKey` are the only places
 * it's read, and what they return is a non-extractable `CryptoKey` —
 * usable for encrypt/decrypt, but never exportable back to raw bytes.
 * AuthStore holds onto that derived key for the session (so re-saving
 * the vault after adding a wallet doesn't need the PIN again), which is
 * strictly safer than caching the PIN itself would be.
 *
 * AES-GCM (not AES-CBC) because it's an authenticated mode: decrypting
 * with the wrong key throws instead of silently returning garbage —
 * that's what lets the app treat "decryption failed" as "wrong PIN"
 * with zero network calls.
 */
@Injectable({ providedIn: 'root' })
export class CryptoVault {
  /** Registration: no salt yet, so generate one. */
  async deriveNewKey(pin: string, extractable = false): Promise<DerivedKey> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    return { key: await this.deriveKey(pin, salt, extractable), salt: toBase64(salt) };
  }

  /** Unlock: re-derive using the salt that was stored alongside the vault. */
  async deriveExistingKey(
    pin: string,
    saltBase64: string,
    extractable = false,
  ): Promise<CryptoKey> {
    return this.deriveKey(pin, fromBase64(saltBase64), extractable);
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

  /** Throws (DOMException) when `key` doesn't match — treat as wrong PIN. */
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
   */
  private async deriveKey(pin: string, salt: Uint8Array, extractable: boolean): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: PBKDF2_ITERATIONS,
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
