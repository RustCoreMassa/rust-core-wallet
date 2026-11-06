import { signal } from '@angular/core';
import { KeyValueStore } from '../app/core/platform/app-storage';
import {
  BiometricUnlock,
  BiometryChangedError,
  BiometryFailedError,
  BiometryKind,
} from '../app/core/platform/biometric-unlock';

/** The native side: ios/App/App/BiometricUnlockPlugin.swift. */
export interface BiometricUnlockPlugin {
  availability(): Promise<{ kind: BiometryKind | 'none' }>;
  save(options: { secret: string }): Promise<void>;
  /** Rejects with `code` "canceled", "unavailable" or "failed". */
  read(options: { reason: string }): Promise<{ secret: string }>;
  remove(): Promise<void>;
}

/** In LOCAL_STORE (the Keychain): "on" while unlocking with biometrics is turned on. */
export const BIOMETRIC_UNLOCK_KEY = 'massa-wallet:biometric-unlock';

const REASON = 'Unlock your wallet';

export class NativeBiometricUnlock implements BiometricUnlock {
  private readonly on = signal(false);
  readonly enabled = this.on.asReadonly();

  constructor(
    private readonly plugin: BiometricUnlockPlugin,
    private readonly store: KeyValueStore,
  ) {
    this.on.set(store.getItem(BIOMETRIC_UNLOCK_KEY) === 'on');
  }

  async available(): Promise<BiometryKind | null> {
    try {
      const { kind } = await this.plugin.availability();
      return kind === 'face' || kind === 'touch' ? kind : null;
    } catch {
      return null;
    }
  }

  async enable(secret: string): Promise<void> {
    await this.plugin.save({ secret });
    // Once now, so the first use isn't the moment the user finds out it doesn't work (and iOS
    // asks its one-time permission here).
    let confirmed: string | null = null;
    try {
      confirmed = (await this.plugin.read({ reason: REASON })).secret;
    } catch {
      // Cancelled or not recognised: handled below.
    }
    if (confirmed !== secret) {
      await this.plugin.remove().catch(() => {});
      throw new BiometryFailedError();
    }
    this.store.setItem(BIOMETRIC_UNLOCK_KEY, 'on');
    this.on.set(true);
  }

  async readSecret(): Promise<string | null> {
    try {
      return (await this.plugin.read({ reason: REASON })).secret;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 'canceled') return null;
      if (code === 'unavailable') {
        await this.disable();
        throw new BiometryChangedError();
      }
      throw new BiometryFailedError();
    }
  }

  async disable(): Promise<void> {
    this.store.removeItem(BIOMETRIC_UNLOCK_KEY);
    this.on.set(false);
    await this.plugin
      .remove()
      .catch((err) => console.warn('Deleting the PIN kept for biometric unlock failed', err));
  }
}
