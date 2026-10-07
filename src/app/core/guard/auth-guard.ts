import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../state/auth-store';
import { WalletStore } from '../state/wallet-store';

/**
 * Blocks the main app shell until the PIN screen has unlocked the
 * session; redirects to /login otherwise. A session kept by the
 * extension (popup reopened before auto-lock) resumes without the PIN.
 * The extension's approval window goes back to its request once unlocked.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthStore);
  const wallet = inject(WalletStore);
  const router = inject(Router);
  if (auth.isUnlocked()) return true;
  if (await auth.resume()) {
    await wallet.restoreCache();
    return true;
  }
  const queryParams = state.url.startsWith('/approve') ? { next: 'approve' } : {};
  return router.createUrlTree(['/login'], { queryParams });
};
