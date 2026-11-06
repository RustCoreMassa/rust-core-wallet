import { DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SESSION_KEY_STORE } from '../services/session-key-store';
import { AUTO_LOCK_MS } from '../utils/auto-lock-time';
import { AuthStore } from './auth-store';

/** What counts as the user doing something in the page. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** How often the web app checks how long the user has been away. */
const CHECK_EVERY_MS = 15_000;

/**
 * The iOS / Android apps lock when they come back after at least this long in the background
 * (APP_BACKGROUND_LOCK_MS). `null` — the web app and the extension — means no such rule: there
 * a hidden page only counts towards the idle time.
 */
export const BACKGROUND_LOCK_MS = new InjectionToken<number | null>('BACKGROUND_LOCK_MS', {
  providedIn: 'root',
  factory: () => null,
});

/**
 * Locks the wallet when the user leaves it alone, and when it's locked elsewhere:
 * - web: after AUTO_LOCK_MS without a tap, click, key or scroll in this page (time spent with
 *   the page hidden counts — the phone in a pocket, the app in the background); a lock in another
 *   tab locks this one too;
 * - extension: every input extends the shared session, which ends AUTO_LOCK_MS after the last
 *   one in any of the wallet's pages (or when the computer locks) — then, or after a Lock in any
 *   view, every open view locks. No view locks on its own timer: the user may be busy in another.
 * - iOS / Android apps: as the web, and also when the app comes back after BACKGROUND_LOCK_MS in
 *   the background — on Capacitor's `resume`, sent before the app is on screen again.
 *
 * Locking clears the keys from memory and goes to the lock screen. Started by the unlocked
 * pages (the shell, the approval window); stops with them.
 */
@Injectable({ providedIn: 'root' })
export class AutoLock {
  private readonly auth = inject(AuthStore);
  private readonly sessionKeys = inject(SESSION_KEY_STORE);
  private readonly router = inject(Router);
  private readonly backgroundLockMs = inject(BACKGROUND_LOCK_MS);

  /** Call from the component's constructor; `loginUrl` is where a lock leads. */
  start(loginUrl = '/login'): void {
    const destroyRef = inject(DestroyRef);
    const now = () => Date.now();
    let lastActivity = now();

    const lockNow = () => {
      if (!this.auth.isUnlocked()) return;
      this.auth.lock();
      void this.router.navigateByUrl(loginUrl);
    };
    const onActivity = () => {
      lastActivity = now();
      this.sessionKeys.touch();
    };
    // Only where the page owns its session: an extension view must not end the shared one
    // while the user works in another view.
    const check = () => {
      if (!this.sessionKeys.keepsKey && now() - lastActivity >= AUTO_LOCK_MS) lockNow();
    };
    // Away = the page hidden (any build) or, in the apps, Capacitor's `pause` — whichever came
    // first; back = shown again or `resume`.
    let awaySince: number | null = null;
    const onAway = () => {
      awaySince ??= now();
    };
    const onBack = () => {
      const away = awaySince === null ? 0 : now() - awaySince;
      awaySince = null;
      if (this.backgroundLockMs !== null && away >= this.backgroundLockMs) lockNow();
      else check();
    };
    const onVisibility = () => (document.hidden ? onAway() : onBack());
    const appEvents = this.backgroundLockMs === null ? [] : (['pause', 'resume'] as const);
    const onAppEvent = (event: Event) => (event.type === 'pause' ? onAway() : onBack());

    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    for (const type of appEvents) document.addEventListener(type, onAppEvent);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const unwatch = this.sessionKeys.watch(lockNow);

    destroyRef.onDestroy(() => {
      for (const type of ACTIVITY_EVENTS) {
        document.removeEventListener(type, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', onVisibility);
      for (const type of appEvents) document.removeEventListener(type, onAppEvent);
      clearInterval(timer);
      unwatch();
    });
  }
}
