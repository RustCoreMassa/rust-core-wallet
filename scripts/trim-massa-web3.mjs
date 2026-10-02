// Runs after `npm install` / `npm ci` (package.json → "postinstall").
//
// @massalabs/massa-web3 ships a gRPC client next to its JSON-RPC one. The app only uses JSON-RPC,
// but the package doesn't declare "sideEffects", so the bundler has to keep everything its index
// re-exports: the protoc-generated gRPC code plus google-protobuf and grpc-web, which npm ships
// already minified (Closure Compiler output) — about 0.9 MB of code nobody runs, and code a
// reviewer can't read. This adds a "sideEffects" list to the installed package.json naming every
// part of the package except the gRPC code, so the bundler can drop what's unused there.
//
// Nothing else changes: all other files keep their load order (main.ts depends on it). If
// massa-web3's layout changes, this stops the install, so the list gets reviewed again.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = 'node_modules/@massalabs/massa-web3';
const unused = ['dist/esm/provider/grpcProvider', 'dist/esm/generated/grpc'];

for (const dir of unused) {
  if (!existsSync(join(pkgDir, dir))) {
    console.error(`trim-massa-web3: ${pkgDir}/${dir} is gone — review scripts/trim-massa-web3.mjs`);
    process.exit(1);
  }
}

// Every directory and file under dist/esm, except the unused ones. dist/cmd (CommonJS) is
// left whole.
const withSideEffects = ['./dist/cmd/**'];
const walk = (dir) => {
  for (const entry of readdirSync(join(pkgDir, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (!entry.isDirectory() || unused.includes(path)) continue;
    if (unused.some((u) => u.startsWith(`${path}/`))) walk(path);
    else withSideEffects.push(`./${path}/**`);
  }
  withSideEffects.push(`./${dir}/*.js`);
};
walk('dist/esm');

const file = join(pkgDir, 'package.json');
const pkg = JSON.parse(readFileSync(file, 'utf8'));
if (JSON.stringify(pkg.sideEffects) !== JSON.stringify(withSideEffects)) {
  writeFileSync(file, JSON.stringify({ ...pkg, sideEffects: withSideEffects }, null, 4) + '\n');
}
