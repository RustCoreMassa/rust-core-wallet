import { DeviceSignals, isMobileDevice } from './device';

const desktop: DeviceSignals = {
  touchPrimary: false,
  uaDataMobile: false,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  maxTouchPoints: 0,
};

describe('isMobileDevice', () => {
  it('rejects a desktop, however narrow its window', () => {
    expect(isMobileDevice(desktop)).toBe(false);
    expect(
      isMobileDevice({
        ...desktop,
        uaDataMobile: undefined,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/140.0',
      }),
    ).toBe(false);
  });

  it('accepts an Android phone', () => {
    expect(
      isMobileDevice({
        touchPrimary: true,
        uaDataMobile: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('accepts an iPhone (no userAgentData in Safari)', () => {
    expect(
      isMobileDevice({
        touchPrimary: true,
        uaDataMobile: undefined,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('accepts an iPad that reports a desktop Macintosh user agent', () => {
    expect(isMobileDevice({ ...desktop, uaDataMobile: undefined, maxTouchPoints: 5 })).toBe(true);
  });

  it('accepts DevTools device emulation (touch-primary signals)', () => {
    expect(isMobileDevice({ ...desktop, touchPrimary: true })).toBe(true);
  });

  it('does not treat a Windows touchscreen laptop (mouse + touch) as mobile', () => {
    // Macs have no touchscreen, so "Macintosh + touch" means iPad; on Windows it doesn't.
    expect(
      isMobileDevice({
        touchPrimary: false,
        uaDataMobile: false,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
        maxTouchPoints: 10,
      }),
    ).toBe(false);
  });
});
