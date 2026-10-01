import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

/**
 * Whether the wallet refuses to run on desktop (it's a phone UI). Provided
 * in app.config.ts; a desktop build — the planned browser extension — sets
 * it to false.
 */
export const MOBILE_ONLY = new InjectionToken<boolean>('MOBILE_ONLY', {
  factory: () => true,
});

/** What the browser tells us about the device — injectable for tests. */
export interface DeviceSignals {
  /** Primary input is touch and there's no hover (phones, tablets). */
  readonly touchPrimary: boolean;
  /** `navigator.userAgentData.mobile` (Chromium); undefined elsewhere. */
  readonly uaDataMobile: boolean | undefined;
  readonly userAgent: string;
  readonly maxTouchPoints: number;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i;

/**
 * A phone or tablet — decided by the kind of device, not the window size:
 * a desktop window shrunk to phone width is still a desktop, and a tablet
 * is still a touch device. DevTools device emulation sets these same
 * signals, so developing on desktop keeps working.
 */
export function isMobileDevice(d: DeviceSignals): boolean {
  if (d.uaDataMobile === true) return true;
  if (d.touchPrimary) return true;
  if (MOBILE_UA.test(d.userAgent)) return true;
  // iPadOS 13+ reports a desktop "Macintosh" user agent, but has a touch screen.
  return /Macintosh/.test(d.userAgent) && d.maxTouchPoints > 1;
}

const TOUCH_PRIMARY_QUERY = '(pointer: coarse) and (hover: none)';

export function readDeviceSignals(): DeviceSignals {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    touchPrimary: window.matchMedia(TOUCH_PRIMARY_QUERY).matches,
    uaDataMobile: nav.userAgentData?.mobile,
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
  };
}

/** Live mobile/desktop state; follows DevTools toggling device emulation. */
@Injectable({ providedIn: 'root' })
export class Device {
  private readonly _isMobile = signal(isMobileDevice(readDeviceSignals()));
  readonly isMobile = this._isMobile.asReadonly();

  constructor() {
    const query = window.matchMedia(TOUCH_PRIMARY_QUERY);
    const update = () => this._isMobile.set(isMobileDevice(readDeviceSignals()));
    query.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
}
