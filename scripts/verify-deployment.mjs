// Checks that the deployed wallet is exactly a release: downloads every file a release's
// SHA256SUMS lists from the site and compares its checksum (docs/RELEASING.md → Watching the
// deployed site).
//
//   node scripts/verify-deployment.mjs <path to SHA256SUMS> [site URL]
//
// The site defaults to the official gateway. Exits 1 if any file differs or is missing (the
// DeWeb server answers a missing file with index.html, which then differs too). Run it after
// every upload, and from time to time: whoever holds the site's keys — or runs a gateway — could
// serve other code, and every user's wallet would load it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [sumsPath, site = 'https://wrustcore.massa.network'] = process.argv.slice(2);
if (!sumsPath) {
  console.error('Usage: node scripts/verify-deployment.mjs <SHA256SUMS> [site URL]');
  process.exit(2);
}

// "<sha256>  ./path/in/the/build" — the release zip's own line has no "./" and isn't served.
const files = readFileSync(sumsPath, 'utf8')
  .split('\n')
  .map((line) => /^([0-9a-f]{64})\s+\*?\.\/(.+)$/.exec(line.trim()))
  .filter(Boolean)
  .map(([, sha256, path]) => ({ sha256, path }));
if (files.length === 0) {
  console.error(`${sumsPath} lists no build files`);
  process.exit(2);
}

const base = new URL(site.endsWith('/') ? site : `${site}/`);
let failures = 0;
for (const { sha256, path } of files) {
  const url = new URL(path.split('/').map(encodeURIComponent).join('/'), base);
  let actual;
  try {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    actual = createHash('sha256')
      .update(Buffer.from(await response.arrayBuffer()))
      .digest('hex');
  } catch (err) {
    failures++;
    console.log(`FAILED   ${path} — ${err.message}`);
    continue;
  }
  if (actual === sha256) {
    console.log(`OK       ${path}`);
  } else {
    failures++;
    console.log(`DIFFERS  ${path}`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${files.length} files served by ${base.origin} match ${sumsPath}.`
    : `\n${failures} of ${files.length} files served by ${base.origin} do NOT match ${sumsPath}.`,
);
process.exit(failures === 0 ? 0 : 1);
