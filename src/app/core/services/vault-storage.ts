import { Injectable } from '@angular/core';
import { VaultEnvelope } from '../models/vault.model';

const STORAGE_KEY = 'massa-wallet:vault';

/**
 * Thin wrapper around localStorage for the encrypted vault envelope.
 *
 * localStorage (not IndexedDB) is deliberate here: the vault is a single
 * small JSON blob, read once at startup and written only when accounts
 * change — exactly the case localStorage's simple synchronous API suits.
 * If the vault ever needs to grow past a small JSON blob, or needs
 * cross-tab change notifications, IndexedDB is the natural upgrade —
 * and because nothing else in the app touches storage directly, that
 * swap only ever means rewriting this one file.
 */
@Injectable({ providedIn: 'root' })
export class VaultStorage {
  exists(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  load(): VaultEnvelope | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as VaultEnvelope;
    } catch {
      // Corrupted or foreign data under our key — treat as "no vault".
      return null;
    }
  }

  save(envelope: VaultEnvelope): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}
