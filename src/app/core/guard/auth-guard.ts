import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { WalletStore } from '../state/wallet-store';

/**
 * Blocks the main app shell until the PIN screen has unlocked the
 * session; redirects to /login otherwise.
 */
export const authGuard: CanActivateFn = () => {
  const store = inject(WalletStore);
  const router = inject(Router);
  return store.isUnlocked() ? true : router.createUrlTree(['/login']);
};
