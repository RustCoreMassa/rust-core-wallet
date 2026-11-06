import { CameraDeniedError } from '../app/core/platform/qr-scanner';
import { NativeQrScanner } from './native-qr-scanner';

describe('NativeQrScanner', () => {
  it('gives the text read, or null when the camera was closed', async () => {
    expect(await new NativeQrScanner({ scan: async () => ({ text: 'AU1x' }) }).scan()).toBe('AU1x');
    expect(await new NativeQrScanner({ scan: async () => ({ text: null }) }).scan()).toBeNull();
  });

  it('says when the camera is off for the app', async () => {
    const scanner = new NativeQrScanner({
      scan: async () => {
        throw Object.assign(new Error('Camera access is off'), { code: 'denied' });
      },
    });
    await expect(scanner.scan()).rejects.toBeInstanceOf(CameraDeniedError);
  });
});
