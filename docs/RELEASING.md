# Releasing RustCore Wallet

How versions are published, how anyone can verify a build, and how the wallet is deployed to
DeWeb. For day-to-day development, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Versioning

Versions follow [Semantic Versioning](https://semver.org): major for breaking changes, minor for
new features, patch for fixes. Every version has a section in [CHANGELOG.md](../CHANGELOG.md)
([Keep a Changelog](https://keepachangelog.com) format).

## Publishing a release

1. Bump the version: `npm version 1.1.0 --no-git-tag-version`
2. In `CHANGELOG.md`, rename the `## [Unreleased]` section (where changes collect between
   releases) to `## [1.1.0] — <date>` and add its link at the bottom.
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
- builds for production, then boots that build in a simulated phone browser — if the app
  doesn't render, nothing is published;
- publishes a [GitHub Release](https://github.com/RustCoreMassa/rust-core-wallet/releases) with
  the changelog notes, the build as `rust-core-wallet-vX.Y.Z.zip`, and `SHA256SUMS`.

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
web. What gets uploaded is the **folder** with the built app — `index.html` at its root plus the
scripts, styles, icons and assets next to it.

A GitHub Release can only hold files, so the release carries that folder as
`rust-core-wallet-vX.Y.Z.zip`. Unzip it and upload the resulting folder; it's identical to
`dist/rust-core-wallet/browser` from a local `npm run build`.

Before uploading, check every file against the release's `SHA256SUMS`, from inside the folder:

```bash
unzip rust-core-wallet-v1.0.2.zip -d rust-core-wallet-v1.0.2
cd rust-core-wallet-v1.0.2
shasum -a 256 -c ../SHA256SUMS --ignore-missing   # Linux: sha256sum -c ../SHA256SUMS --ignore-missing
```

Every line must say `OK`. (`ngsw.json` isn't listed — it records the build time — and
`--ignore-missing` only skips the zip's own line, since the zip isn't inside the folder.) Then
upload this folder to DeWeb.

Nothing in the app needs changing for DeWeb:

- **Links to any screen work**, including on reload: when a path like `/staking` isn't a file,
  the DeWeb server falls back to `index.html` (its built-in single-page-app support), and the
  wallet's router takes it from there.
- **Installing as an app works**: gateways serve the site over HTTPS, which the service worker
  requires.
- The app talks to the Massa RPC and explorer directly, so it doesn't depend on which gateway it
  was loaded from.
