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
- builds the browser extension and boots its popup the same way;
- publishes a [GitHub Release](https://github.com/RustCoreMassa/rust-core-wallet/releases) with
  the changelog notes, the build as `rust-core-wallet-vX.Y.Z.zip`, and `SHA256SUMS`, plus the
  extension as `rustcore-wallet-extension-chromium-vX.Y.Z.zip` and
  `rustcore-wallet-extension-firefox-vX.Y.Z.zip`, each with its own `SHA256SUMS-chromium` /
  `SHA256SUMS-firefox` (the two differ only in `manifest.json`).

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

The extension is checked the same way — `npm run build:extension`, then inside
`dist/extension/chromium` (or `firefox`) compare
`find . -type f | sort | xargs shasum -a 256` with `SHA256SUMS-chromium` (or `-firefox`).
Every file matches; the extension has no `ngsw.json`.

## Deploying to DeWeb

The wallet is hosted on [DeWeb](https://docs.massa.net/docs/deweb/home), Massa's decentralized
web, as **`rustcore.massa`** (public gateway: https://rustcore.deweb.half-red.net). Each release
replaces the site's files there. What gets uploaded is the **folder** with the built app — `index.html` at its root plus the
scripts, styles, icons and assets next to it.

A GitHub Release can only hold files, so the release carries that folder as
`rust-core-wallet-vX.Y.Z.zip`. Unzip it and upload the resulting folder; it's identical to
`dist/rust-core-wallet/browser` from a local `npm run build`.

Before uploading, check every file against the release's `SHA256SUMS`, from inside the folder:

```bash
unzip rust-core-wallet-v1.1.0.zip -d rust-core-wallet-v1.1.0
cd rust-core-wallet-v1.1.0
shasum -a 256 -c ../SHA256SUMS --ignore-missing   # Linux: sha256sum -c ../SHA256SUMS --ignore-missing
```

Every line must say `OK`. (`ngsw.json` isn't listed — it records the build time — and
`--ignore-missing` only skips the zip's own line, since the zip isn't inside the folder.) Then
upload this folder to the `rustcore.massa` site.

After uploading, open the site on a phone and check that the app loads and shows its first
screen. Installed copies update themselves: the service worker downloads the new version on one
launch and switches to it on the next.

Nothing in the app needs changing for DeWeb:

- **Links to any screen work**, including on reload: when a path like `/staking` isn't a file,
  the DeWeb server falls back to `index.html` (its built-in single-page-app support), and the
  wallet's router takes it from there.
- **Installing as an app works**: gateways serve the site over HTTPS, which the service worker
  requires.
- The app talks to the Massa RPC and explorer directly, so it doesn't depend on which gateway it
  was loaded from.

## Publishing the browser extension

Upload the zips from the GitHub Release, never a local build, so what's in each store is exactly
what anyone can rebuild and check. Each zip has `manifest.json` at its root, as the stores
expect. Check it against its `SHA256SUMS-*` first.

| Store | Zip | Covers |
|---|---|---|
| [Chrome Web Store](https://chrome.google.com/webstore/devconsole) | `…-chromium-vX.Y.Z.zip` | Chrome, Brave, Opera, Vivaldi, Arc |
| [Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge) | `…-chromium-vX.Y.Z.zip` | Edge |
| [Firefox Add-ons (AMO)](https://addons.mozilla.org/developers/) | `…-firefox-vX.Y.Z.zip` | Firefox desktop and Android |

What the stores ask for:

- **Permissions**, to justify in the listing: `storage` (the encrypted vault and preferences),
  `alarms` (auto-lock after 15 minutes), `sidePanel` (Chromium only — the side-panel view).
  No host permissions, no content scripts.
- **Data**: none is collected. Firefox's manifest declares it
  (`data_collection_permissions: none`); the Chrome Web Store asks in its Privacy tab.
- **Privacy policy**: the README's security & privacy section, which lists every network
  destination.
- **Firefox source code**: AMO reviews readable code, and the bundle is minified, so each upload
  needs the source — the release tag's source archive from GitHub — and these build steps:
  install Node.js from `.nvmrc`, then `npm ci && npm run build:extension`; the result is
  `dist/extension/firefox`, byte-identical to the zip. Mozilla's linter
  (`npx web-ext lint --source-dir dist/extension/firefox`) reports no errors; its only warnings
  are `Function("return this")` fallbacks inside `google-protobuf` and `lodash` (pulled in by
  `@massalabs/massa-web3`), which look up the global object and are never reached in a browser —
  `self` is found first — and the extension's CSP forbids running them anyway.
- The Firefox add-on ID is `rustcore-wallet@whisky098` (`browser_specific_settings` in
  `src/extension/manifest.json`). It identifies the add-on on AMO for good — never change it.

Store reviews take from a few days to a few weeks; wallets get extra scrutiny.
