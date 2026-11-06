import { InjectionToken, Signal } from '@angular/core';

/**
 * What the phone unlocks with: Face ID / Touch ID (iOS); a fingerprint, or — face, iris, several —
 * "biometrics" (Android, which doesn't say which one the user enrolled).
 */
export type BiometryKind = 'face' | 'touch' | 'fingerprint' | 'biometric';

/** The phone's biometrics changed (a face or finger added) or the kept PIN is gone: it is off. */
export class BiometryChangedError extends Error {
  constructor() {
    super('Biometric unlock is no longer available on this phone');
    this.name = 'BiometryChangedError';
  }
}

/** Not recognised, locked out after too many tries, or not confirmed when turning it on. */
export class BiometryFailedError extends Error {
  constructor() {
    super('Biometric unlock failed');
    this.name = 'BiometryFailedError';
  }
}

/**
 * Unlocking with Face ID / Touch ID instead of typing the PIN — the iOS / Android apps only
 * (src/native). The PIN is kept in the phone's secure storage behind the biometrics and only
 * ever used to unlock: showing or copying a private key, removing a wallet and logging out still
 * ask for the PIN typed (user decision 2026-11-06).
 */
export interface BiometricUnlock {
  /** On or off (read at once from LOCAL_STORE). */
  readonly enabled: Signal<boolean>;
  /** What this phone can use now; null without the hardware, an enrolled face/finger or a passcode. */
  available(): Promise<BiometryKind | null>;
  /**
   * Keeps `secret` behind the biometrics, then asks for them once to confirm they work. Throws
   * BiometryFailedError (and stays off) when the user doesn't confirm.
   */
  enable(secret: string): Promise<void>;
  /**
   * Asks for Face ID / Touch ID: the kept secret, or null when the user cancelled. Throws
   * BiometryChangedError (and turns itself off) when the secret can't be read any more, and
   * BiometryFailedError when the biometrics didn't work this time.
   */
  readSecret(): Promise<string | null>;
  /** Off, and the kept secret deleted. */
  disable(): Promise<void>;
}

/** `null` in the web app and the extension. */
export const BIOMETRIC_UNLOCK = new InjectionToken<BiometricUnlock | null>('BIOMETRIC_UNLOCK', {
  providedIn: 'root',
  factory: () => null,
});

const NAMES: Record<BiometryKind, string> = {
  face: 'Face ID',
  touch: 'Touch ID',
  fingerprint: 'Fingerprint',
  biometric: 'Biometrics',
};

export function biometryName(kind: BiometryKind): string {
  return NAMES[kind];
}
