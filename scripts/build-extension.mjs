// Builds the browser extension, one package per browser family, from a single build:
//
//   dist/extension/chromium   Chrome, Edge, Brave, Opera, Vivaldi, Arc
//   dist/extension/firefox    Firefox (desktop and Android)
//
// Both hold the same files — the Angular popup (angular.json → "extension"), the background
// worker, the dApp-connection scripts injected into web pages and the icons; only manifest.json
// differs, each keeping just the keys its browser knows (src/extension/manifest.json holds them
// all). Load either unpacked from its folder.
// Finally checks the popup is loadable under the extension's CSP.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = 'dist/extension';
const angularOut = join(root, 'browser');

execFileSync('npx', ['ng', 'build', '--configuration', 'production,extension'], {
  stdio: 'inherit',
});

// Scripts outside Angular, each bundled on its own as a classic script: the background worker
// (Chromium runs it as a service worker, Firefox as a background script), and the two scripts
// every https page gets for dApp connections (manifest → content_scripts).
await build({
  entryPoints: {
    background: 'src/extension/background.ts',
    inpage: 'src/extension/dapp/inpage-entry.ts',
    content: 'src/extension/dapp/content-entry.ts',
  },
  outdir: angularOut,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

for (const icon of readdirSync('src/extension/icons')) {
  copyFileSync(join('src/extension/icons', icon), join(angularOut, 'icons', icon));
}

// MV3 pages run only scripts loaded from the extension itself: an inline <script> or an
// on*="…" handler (e.g. Angular's critical-CSS loader) would silently never run.
const html = readFileSync(join(angularOut, 'index.html'), 'utf8');
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+\s*=/i);
if (inline) {
  console.error(`index.html has inline code the extension's CSP blocks: ${inline[0]}`);
  process.exit(1);
}

// massa-web3's unused gRPC client (protoc-generated code, plus google-protobuf and grpc-web,
// both minified on npm) must stay out: AMO reviewers can't read it. scripts/trim-massa-web3.mjs
// (postinstall) lets the bundler drop it.
for (const file of readdirSync(angularOut).filter((f) => f.endsWith('.js'))) {
  if (/\bjspb\b|proto\.massa\./.test(readFileSync(join(angularOut, file), 'utf8'))) {
    console.error(`${file} contains massa-web3's gRPC code — did scripts/trim-massa-web3.mjs run?`);
    process.exit(1);
  }
}

// One version everywhere: the manifests take package.json's.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = { ...JSON.parse(readFileSync('src/extension/manifest.json', 'utf8')), version };

const targets = {
  chromium: ({ sidebar_action, browser_specific_settings, background, ...m }) => ({
    ...m,
    background: { service_worker: background.service_worker },
  }),
  firefox: ({ side_panel, minimum_chrome_version, background, permissions, ...m }) => ({
    ...m,
    background: { scripts: background.scripts },
    permissions: permissions.filter((p) => p !== 'sidePanel'),
  }),
};

for (const [target, toManifest] of Object.entries(targets)) {
  const dir = join(root, target);
  rmSync(dir, { recursive: true, force: true });
  cpSync(angularOut, dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(toManifest(manifest), null, 2) + '\n');
}
rmSync(angularOut, { recursive: true, force: true });

console.log(
  `Extension ${version} built: ${Object.keys(targets)
    .map((t) => join(root, t))
    .join(', ')} — load either unpacked from its folder.`,
);
