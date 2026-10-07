/// <reference types="chrome" />
// The extension's SiteAccess: are the dApp scripts (manifest → content_scripts) allowed to run
// on websites? Users can withdraw that access in Firefox (the extension's Permissions tab) and
// in Chromium browsers (Site access → On click / On specific sites).
import { Signal, signal } from '@angular/core';
import { SiteAccess } from '../../app/core/platform/site-access';

/** The pages content.js and inpage.js are declared for (src/extension/manifest.json). */
export const SITE_ORIGINS = ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];

type PermissionsApi = Pick<
  typeof chrome.permissions,
  'contains' | 'request' | 'onAdded' | 'onRemoved'
>;

export class ChromeSiteAccess implements SiteAccess {
  private readonly _granted = signal<boolean | null>(null);
  readonly granted: Signal<boolean | null> = this._granted.asReadonly();

  constructor(private readonly permissions: PermissionsApi | undefined) {
    if (!permissions) return; // no permissions API: nothing to show either way
    const check = () =>
      permissions
        // Websites in general; localhost is only for developers.
        .contains({ origins: ['https://*/*'] })
        .then((granted) => this._granted.set(granted))
        .catch((err) => console.warn('Checking site access failed', err));
    permissions.onAdded.addListener(() => void check());
    permissions.onRemoved.addListener(() => void check());
    void check();
  }

  request(): Promise<boolean> {
    if (!this.permissions) return Promise.resolve(false);
    // Called first thing in the click handler: nothing may be awaited before it.
    return this.permissions.request({ origins: SITE_ORIGINS }).then((granted) => {
      if (granted) this._granted.set(true);
      return granted;
    });
  }
}
