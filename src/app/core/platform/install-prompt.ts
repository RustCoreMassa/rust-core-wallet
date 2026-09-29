import { Injectable, computed, signal } from '@angular/core';

/** Chromium's install event (not in the TS DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * How this browser installs a web app:
 * - `native`: Chromium on Android (Chrome, Edge, Samsung, Opera) — we can open
 *   the browser's own install dialog from a button;
 * - `ios`: every iOS browser — Apple allows no prompt; the user adds it via
 *   Share → "Add to Home Screen";
 * - `manual`: other Android browsers (Firefox…) — via the browser menu.
 */
export type InstallMode = 'native' | 'ios' | 'manual';

const DISMISSED_KEY = 'massa-wallet:install-dismissed-at';
/** After "Not now", ask again only after this long. */
const DISMISS_FOR_MS = 14 * 24 * 60 * 60_000;

/*
 * The install event can fire before Angular bootstraps, so it's captured at
 * module load (main.ts imports this file first) and handed to the service.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // keep the browser's mini-infobar; we show our own banner
  deferredPrompt = event as BeforeInstallPromptEvent;
  promptListeners.forEach((notify) => notify());
});

export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  // iPadOS 13+ reports a desktop "Macintosh" user agent, but has a touch screen.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Already running as an installed app (home-screen icon), on any platform. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function readDismissedAt(): number {
  try {
    return Number(localStorage.getItem(DISMISSED_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Offers "install as app" once per device, until installed or dismissed. */
@Injectable({ providedIn: 'root' })
export class InstallPrompt {
  private readonly _hasNativePrompt = signal(deferredPrompt !== null);
  private readonly _installed = signal(isStandalone());
  private readonly _dismissedAt = signal(readDismissedAt());

  readonly mode = computed<InstallMode>(() => {
    if (this._hasNativePrompt()) return 'native';
    return isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0) ? 'ios' : 'manual';
  });

  readonly visible = computed(
    () => !this._installed() && Date.now() - this._dismissedAt() > DISMISS_FOR_MS,
  );

  constructor() {
    promptListeners.add(() => this._hasNativePrompt.set(true));
    window.addEventListener('appinstalled', () => this._installed.set(true));
  }

  /** Opens the browser's install dialog (`native` mode only). */
  async install(): Promise<void> {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    deferredPrompt = null; // an event can prompt only once
    this._hasNativePrompt.set(false);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') this._installed.set(true);
  }

  dismiss(): void {
    const now = Date.now();
    this._dismissedAt.set(now);
    try {
      localStorage.setItem(DISMISSED_KEY, String(now));
    } catch {
      // Storage unavailable — hidden for this session only.
    }
  }
}
