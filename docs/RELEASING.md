# Releasing RustCore Wallet

How versions are published, how anyone can verify a build, and how the wallet is deployed to
DeWeb. For day-to-day development, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Versioning

Versions follow [Semantic Versioning](https://semver.org): major for breaking changes, minor for
new features, patch for fixes. Every version has a section in [CHANGELOG.md](../CHANGELOG.md)
([Keep a Changelog](https://keepachangelog.com) format).

## Publishing a release

1. Bump the version: `npm version 1.1.0 --no-git-tag-version`
2. Add a `## [1.1.0]` section to `CHANGELOG.md`.
3. Commit, then push a matching tag:

```bash
git tag v1.1.0
git push origin master v1.1.0
```

Pushing the tag starts the [release workflow](../.github/workflows/release.yml) on GitHub
Actions. It builds from exactly the tagged commit, in public, and:

- refuses a tag that doesn't match `package.json`, has no changelog section, was already
  released, or isn't higher than the latest release — a version can only move forward;
- runs the tests — if one fails, nothing is published;
- builds for production and publishes a
  [GitHub Release](https://github.com/RustCoreMassa/rust-core-wallet/releases) with the
  changelog notes, the build as `rust-core-wallet-vX.Y.Z.zip`, and `SHA256SUMS`.

A version bump without a tag publishes nothing.

## Verifying a build

Anyone can check that a release is exactly what the source code says. Check out the release tag,
build it with the Node.js version from [`.nvmrc`](../.nvmrc) and compare the checksums with the
release's `SHA256SUMS`:

```bash
git checkout v1.0.0
npm ci
npm run build
cd dist/rust-core-wallet/browser
find . -type f ! -name ngsw.json | sort | xargs shasum -a 256
```

With the same Node.js version (dependencies are pinned by `package-lock.json`) the build is
reproducible: every file matches except `ngsw.json`, the service worker's manifest, which records
the build time — it's left out of `SHA256SUMS` for that reason.

## Deploying to DeWeb

The wallet is hosted on [DeWeb](https://docs.massa.net/docs/deweb/home), Massa's decentralized
web. The release zip is ready to upload as-is — it has `index.html` at its root, which is what
[`deweb-cli`](https://docs.massa.net/docs/deweb/cli/upload) expects:

```bash
shasum -a 256 -c SHA256SUMS --ignore-missing   # check the zip first (Linux: sha256sum -c …)
deweb-cli upload -w <wallet> -n https://mainnet.massa.net/api/v2 ./rust-core-wallet-v1.0.0.zip
```

Nothing in the app needs changing for DeWeb:

- **Links to any screen work**, including on reload: when a path like `/staking` isn't a file,
  the DeWeb server falls back to `index.html` (its built-in single-page-app support), and the
  wallet's router takes it from there.
- **Installing as an app works**: gateways serve the site over HTTPS, which the service worker
  requires.
- The app talks to the Massa RPC and explorer directly, so it doesn't depend on which gateway it
  was loaded from.
