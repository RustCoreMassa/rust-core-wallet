import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../state/auth-store';
import { WalletStore } from '../state/wallet-store';

/**
 * Blocks the main app shell until the PIN screen has unlocked the
 * session; redirects to /login otherwise. A session kept by the
 * extension (popup reopened before auto-lock) resumes without the PIN.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const wallet = inject(WalletStore);
  const router = inject(Router);
  if (auth.isUnlocked()) return true;
  if (await auth.resume()) {
    await wallet.restoreCache();
    return true;
  }
  return router.createUrlTree(['/login']);
};
