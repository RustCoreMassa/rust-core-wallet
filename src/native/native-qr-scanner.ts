import { CameraDeniedError, QrScanner } from '../app/core/platform/qr-scanner';

/** The native side: ios/App/App/QrScannerPlugin.swift. */
export interface QrScannerPlugin {
  /** `text` null: closed without a code. Rejects with `code` "denied" without camera access. */
  scan(): Promise<{ text: string | null }>;
}

export class NativeQrScanner implements QrScanner {
  constructor(private readonly plugin: QrScannerPlugin) {}

  async scan(): Promise<string | null> {
    try {
      const { text } = await this.plugin.scan();
      return typeof text === 'string' ? text : null;
    } catch (err) {
      if ((err as { code?: unknown }).code === 'denied') throw new CameraDeniedError();
      throw err;
    }
  }
}
