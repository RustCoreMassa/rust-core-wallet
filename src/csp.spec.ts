import manifest from './extension/manifest.json';
import { MEDIA_HOSTS } from './app/core/utils/media-hosts';

/*
 * The extension's CSP (manifest.json). The web app's (<meta> in src/index.html) must be the same
 * minus frame-ancestors: scripts/build-extension.mjs checks that at every extension build, and
 * scripts/smoke-boot.mjs that the built index.html has it and no inline code.
 */
const csp = new Map(
  manifest.content_security_policy.extension_pages
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .map(([name, ...sources]) => [name, sources] as const),
);
const media = MEDIA_HOSTS.map((host) => `https://${host}`);

describe('Content Security Policy', () => {
  it('refuses anything it does not list', () => {
    expect(csp.get('default-src')).toEqual(["'none'"]);
    expect(csp.get('font-src')).toEqual(["'self'"]); // fonts are bundled, never a CDN
    // Angular adds component styles as <style> elements.
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get('manifest-src')).toEqual(["'self'"]);
    expect(csp.get('worker-src')).toEqual(["'self'"]);
    expect(csp.has('frame-src')).toBe(false); // → default-src: no frames at all
  });

  it('runs only scripts the app itself serves, no plugins, no forms, no framing', () => {
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
    expect(csp.get('form-action')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('connects only to the Massa nodes, the explorer API and MEDIA_HOSTS', () => {
    expect(csp.get('connect-src')).toEqual([
      "'self'",
      'https://mainnet.massa.net',
      'https://buildnet.massa.net',
      'https://explorer-api.massa.net',
      ...media,
    ]);
  });

  it('loads images only from the app and MEDIA_HOSTS', () => {
    expect(csp.get('img-src')).toEqual(["'self'", 'data:', ...media]);
  });
});
