import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../state/auth-store';

/**
 * Blocks the main app shell until the PIN screen has unlocked the
 * session; redirects to /login otherwise.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const unlocked = auth.isUnlocked();
  return unlocked ? true : router.createUrlTree(['/login']);
};
