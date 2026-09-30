// Builds the browser extension into dist/extension/browser (load it unpacked from there):
// the Angular popup (angular.json → "extension"), the background worker, the manifest and
// its icons — then checks the popup is loadable under the extension's CSP.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const out = 'dist/extension/browser';

execFileSync('npx', ['ng', 'build', '--configuration', 'production,extension'], {
  stdio: 'inherit',
});

await build({
  entryPoints: ['src/extension/background.ts'],
  outfile: join(out, 'background.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

// One version everywhere: the manifest takes package.json's.
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('src/extension/manifest.json', 'utf8'));
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ...manifest, version }, null, 2) + '\n');

for (const icon of readdirSync('src/extension/icons')) {
  copyFileSync(join('src/extension/icons', icon), join(out, 'icons', icon));
}

// MV3 pages run only scripts loaded from the extension itself: an inline <script> or an
// on*="…" handler (e.g. Angular's critical-CSS loader) would silently never run.
const html = readFileSync(join(out, 'index.html'), 'utf8');
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+\s*=/i);
if (inline) {
  console.error(`index.html has inline code the extension's CSP blocks: ${inline[0]}`);
  process.exit(1);
}

console.log(`Extension ${version} built in ${out} — load it unpacked from there.`);
