import { DestroyRef, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SESSION_KEY_STORE } from '../services/session-key-store';
import { AUTO_LOCK_MS } from '../utils/auto-lock-time';
import { AuthStore } from './auth-store';

/** What counts as the user doing something in the page. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** How often the web app checks how long the user has been away. */
const CHECK_EVERY_MS = 15_000;

/**
 * Locks the wallet when the user leaves it alone, and when it's locked elsewhere:
 * - web: after AUTO_LOCK_MS without a tap, click, key or scroll in this page (time spent with
 *   the page hidden counts — the phone in a pocket, the app in the background); a lock in another
 *   tab locks this one too;
 * - extension: every input extends the shared session, which ends AUTO_LOCK_MS after the last
 *   one in any of the wallet's pages (or when the computer locks) — then, or after a Lock in any
 *   view, every open view locks. No view locks on its own timer: the user may be busy in another.
 *
 * Locking clears the keys from memory and goes to the lock screen. Started by the unlocked
 * pages (the shell, the approval window); stops with them.
 */
@Injectable({ providedIn: 'root' })
export class AutoLock {
  private readonly auth = inject(AuthStore);
  private readonly sessionKeys = inject(SESSION_KEY_STORE);
  private readonly router = inject(Router);

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
    const onVisibility = () => {
      if (!document.hidden) check();
    };

    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const unwatch = this.sessionKeys.watch(lockNow);

    destroyRef.onDestroy(() => {
      for (const type of ACTIVITY_EVENTS) {
        document.removeEventListener(type, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
      unwatch();
    });
  }
}
