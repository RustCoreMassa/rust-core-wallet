// Serves the test dApp (scripts/test-dapp) at http://127.0.0.1:4300 — `npm run test-dapp`.
// esbuild bundles main.ts with massa-web3 in memory on each request: nothing is written to disk.
// The extension's content scripts run on http://127.0.0.1 and http://localhost pages, so the
// page gets window.rustcore. Local development only; see docs/DAPP-CONNECTION.md.
import { context } from 'esbuild';

const dir = 'scripts/test-dapp';
const ctx = await context({
  entryPoints: [`${dir}/main.ts`],
  outdir: dir,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  write: false,
  logLevel: 'warning',
});
const { port } = await ctx.serve({ servedir: dir, host: '127.0.0.1', port: 4300 });
console.log(`Test dApp: http://127.0.0.1:${port}  (Ctrl+C to stop)`);
