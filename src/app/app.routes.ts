import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard } from './core/guard/auth-guard';
import { DAPP_APPROVALS } from './core/platform/dapp-approvals';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/pin-lock-page/pin-lock-page').then((m) => m.PinLockPage),
  },
  {
    path: '',
    loadComponent: () => import('./layout/main-layout/main-layout').then((m) => m.MainLayout),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      {
        path: 'home',
        loadComponent: () => import('./features/home/home-page/home-page').then((m) => m.HomePage),
      },
      {
        path: 'nfts',
        loadComponent: () => import('./features/nfts/nfts-page/nfts-page').then((m) => m.NftsPage),
      },
      {
        path: 'staking',
        loadComponent: () =>
          import('./features/staking/staking-page/staking-page').then((m) => m.StakingPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings-page/settings-page').then((m) => m.SettingsPage),
      },
    ],
  },
  {
    // The extension's approval window for dApp requests (docs/DAPP-CONNECTION.md).
    path: 'approve',
    canMatch: [() => inject(DAPP_APPROVALS) !== null],
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/approve/approve-page/approve-page').then((m) => m.ApprovePage),
  },
  { path: '**', redirectTo: 'login' },
];
