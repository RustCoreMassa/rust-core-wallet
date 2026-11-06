import { InjectionToken } from '@angular/core';

/** The user refused the app access to the camera (it can be allowed again in the phone's settings). */
export class CameraDeniedError extends Error {
  constructor() {
    super('Camera access is off');
    this.name = 'CameraDeniedError';
  }
}

/** Reads a QR code with the phone's camera — the iOS / Android apps (src/native). */
export interface QrScanner {
  /**
   * Opens the camera full screen: the text of the first QR code it sees, or null when the user
   * closes it. Throws CameraDeniedError when the app may not use the camera.
   */
  scan(): Promise<string | null>;
}

/** `null` in the web app and the extension: no Scan button there. */
export const QR_SCANNER = new InjectionToken<QrScanner | null>('QR_SCANNER', {
  providedIn: 'root',
  factory: () => null,
});
