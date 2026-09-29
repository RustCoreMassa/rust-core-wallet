<p align="center">
  <img src="src/assets/logo.png" alt="RustCore Wallet" width="120" />
</p>

<h1 align="center">RustCore Wallet</h1>

<p align="center">
  A self-custodial, transparent wallet for the <a href="https://massa.net">Massa</a> blockchain —
  the first product of the <b>RustCore</b> team.
</p>

<p align="center">
  <img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue" />
  <img alt="Network: Massa" src="https://img.shields.io/badge/network-Massa-red" />
  <img alt="Built with Angular" src="https://img.shields.io/badge/built%20with-Angular-dd0031" />
  <img alt="Version 1.0.0" src="https://img.shields.io/badge/version-1.0.0-brightgreen" />
</p>

---

## Why RustCore Wallet

A wallet holds the keys to people's money, so "trust us" is not good enough. RustCore Wallet is
built on three principles:

- **Your keys never leave your device.** Private keys are encrypted locally with your PIN and are
  never sent anywhere — there is no RustCore server at all.
- **Everything is verifiable.** The full source code is public so anyone can audit exactly what the
  wallet does with their data — and confirm that it takes none.
- **What you see is what's on-chain.** Balances, rolls and history come from the blockchain. The
  wallet never shows a transaction as done before the network has actually executed it.
- **Served from the blockchain, too.** The wallet is hosted on [DeWeb](https://docs.massa.net/docs/deweb/home),
  Massa's decentralized web: its files are stored on-chain and delivered by DeWeb gateways — there
  is no RustCore web server to take down or tamper with.

> **Version 1.0.0 — first production release** ([changelog](CHANGELOG.md)). RustCore Wallet
> works on Massa **mainnet with real funds**. It has not yet had an independent security audit:
> start with small amounts and always keep a backup of your private keys.

## Features

| | |
|---|---|
| 🔐 **Encrypted vault** | 6-digit PIN → PBKDF2 (300 000 iterations) → AES-GCM, via the browser's native Web Crypto API. The PIN is never stored. |
| 👛 **Multiple wallets** | Create new wallets or import existing private keys; rename, switch, back up or remove them. |
| 💸 **Send & receive** | MAS and MRC-20 tokens, with a review step before anything is signed and a scannable QR code for receiving. |
| 🔄 **Swap** | Token swaps through the [Dusa](https://dusa.io) DEX, with live quotes, price impact and slippage protection. |
| 🥩 **Staking** | Buy and sell rolls, see whether your wallet is actively staking, produced/missed slots, estimated APR and daily rewards. |
| 🧾 **History** | Full on-chain history from the Massa explorer, with per-transaction details and explorer links. |
| 🌐 **MNS domains** | `.massa` names owned by your wallet (Massa Name System). |
| 💲 **Prices** | USD prices read directly from Dusa's on-chain quoters — no third-party price API. |
| 🔀 **Networks** | Mainnet and Buildnet. |
| 📲 **Installable** | Add it to your phone's home screen (Android and iOS) and it runs full screen like a native app. |

Supported tokens: MAS, PUR, DUSA, USDC.e, WETH.e, DAI.e, WBTC.e, WETH.b, USDT.b.

## Security & privacy model

**What stays on your device**

- The encrypted vault (`localStorage`). Only the ciphertext, salt and IV are stored — nothing is
  readable without your PIN.
- While unlocked, the decrypted keys live in memory only. Locking the wallet or closing the tab
  drops them.
- A per-tab cache of balances and history (`sessionStorage`), encrypted with the same key and
  deleted when the tab closes.

**What goes over the network — the complete list**

| Destination | Why |
|---|---|
| The DeWeb gateway you open the wallet from | Delivers the wallet's own files (the app itself), read from the Massa blockchain. |
| `mainnet.massa.net` / `buildnet.massa.net` | Massa public JSON-RPC: balances, rolls, token and DEX contract reads, and the signed operations you confirm. |
| `explorer-api.massa.net` | Transaction history for your address. |

That's all. There is no RustCore backend, no analytics, no tracking and no telemetry. The
installable app's service worker caches only the wallet's own files, never chain or explorer
data. Links to `explorer.massa.net` and `docs.massa.net` open only when you click them.

**Safeguards**

- Every operation that spends funds (send, swap, buy/sell rolls) goes through a review screen
  and runs pre-flight checks (balance, network fee, address format) before signing.
- Sensitive actions (revealing a private key, removing a wallet, logging out) require the PIN
  again.
- Swaps are sent with a minimum-output limit, so the DEX reverts instead of filling at a bad price.

**Known limitations**

- A 6-digit PIN has 1 000 000 combinations. PBKDF2 makes each guess slow, but if an attacker
  obtains your encrypted vault file, a determined offline attack is possible. Protect your device.
- No independent audit yet (see [Roadmap](#roadmap)).

Found a vulnerability? Please **do not open a public issue** — see [Security](#security).

## How it's built

| Layer | Technology |
|---|---|
| UI | [Angular](https://angular.dev) — standalone components, signals, new control flow |
| Blockchain | [`@massalabs/massa-web3`](https://github.com/massalabs/massa-web3) |
| Crypto | Web Crypto API (`crypto.subtle`) — no third-party crypto library for the vault |
| DEX | Dusa Liquidity Book contracts (quoter + router), called directly on-chain |
| History | Massa explorer API |
| QR codes | [`ng-qrcode`](https://github.com/mnahkies/ng-qrcode) |
| Hosting | [DeWeb](https://docs.massa.net/docs/deweb/home) — static files stored on the Massa blockchain |

```
src/app/
├── core/
│   ├── models/      Tokens, wallets, transactions, vault, MNS
│   ├── services/    Massa provider, Dusa prices & swap, explorer API,
│   │                encrypted vault & session cache, on-chain execution tracking
│   ├── state/       AuthStore (vault & session), WalletStore (balances, history,
│   │                staking, swaps), NetworkStore
│   └── utils/       Exact decimal ↔ on-chain amount conversion, staking rewards
├── features/        Screens: PIN/unlock, Home, NFTs & domains, Staking, Settings, modals
├── layout/          App shell, navigation, auto-refresh
└── shared/          Reusable UI: dropdown, confirmation step, token/history rows, PIN pad
```

Key design rules:

- **Private keys stay in the vault.** Everything else asks for them only when signing.
- **No optimistic updates.** After a transaction, the wallet waits for on-chain execution and then
  re-reads the chain; a failed transaction changes nothing on screen.
- **Exact amounts.** Token amounts are converted through decimal strings, never floating-point
  multiplication, so 18-decimal tokens keep full precision.

## Getting started

**Requirements:** [Node.js](https://nodejs.org) `^22.22.3`, `^24.15.0` or `>=26` and npm.

```bash
git clone https://github.com/RustCoreMassa/rust-core-wallet.git
cd rust-core-wallet
npm install
npm start            # http://localhost:4200
```

RustCore Wallet is a mobile app: on a desktop browser it shows an "open on your phone" screen
with a QR code instead of the wallet. To develop on desktop, open DevTools and turn on device
emulation (Chrome: *Toggle device toolbar*, Firefox: *Responsive Design Mode* with touch
simulation), then reload. The restriction is the `MOBILE_ONLY` flag in `app.config.ts`.

The service worker that makes the app installable runs in production builds only
(`npm run build`), and browsers offer installation only over HTTPS (or on `localhost`).

| Command | What it does |
|---|---|
| `npm start` | Development server with live reload |
| `npm run build` | Production build into `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npx tsc -p tsconfig.app.json --noEmit` | Type-check |
| `npx prettier --write .` | Format the code |

## Releases

Every release is a git tag (`v1.0.0`, …) with a
[GitHub Release](https://github.com/RustCoreMassa/rust-core-wallet/releases) that contains the
release notes from the [changelog](CHANGELOG.md), the production build as a zip, and a
`SHA256SUMS` file. Releases are built and published by
[GitHub Actions](.github/workflows/release.yml) from the tagged commit — the tests must pass
first — so the build log is public too.

To check that a build is exactly what the source says, check out the release tag, build it and
compare the checksums with the release's `SHA256SUMS`:

```bash
git checkout v1.0.0
npm ci
npm run build
cd dist/rust-core-wallet/browser
find . -type f ! -name ngsw.json | sort | xargs shasum -a 256
```

With the same Node.js version (pinned in `.nvmrc`; dependencies are pinned by
`package-lock.json`) the build is
reproducible: every file matches except `ngsw.json`, the service worker's manifest, which records
the build time — it's left out of `SHA256SUMS` for that reason.

Versions follow [Semantic Versioning](https://semver.org): major for breaking changes, minor for
new features, patch for fixes.

**Publishing a release (maintainers):** bump the version (`npm version 1.1.0 --no-git-tag-version`),
add a `## [1.1.0]` section to `CHANGELOG.md`, commit, then push a matching tag:

```bash
git tag v1.1.0
git push origin master v1.1.0
```

The workflow refuses a tag that doesn't match `package.json`, has no changelog section, was
already released, or isn't higher than the latest release — so a version can only move forward.

### Deploying to DeWeb

The release zip is ready to upload as-is — it has `index.html` at its root, which is what
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

## Roadmap

**Phase 1 — Web wallet** *(current)*
- [x] Encrypted multi-wallet vault with PIN
- [x] Send / receive MAS and MRC-20 tokens
- [x] On-chain history with transaction details
- [x] Staking: rolls, status, APR and rewards
- [x] Swaps through Dusa
- [x] MNS domains
- [x] Installable app (PWA)
- [ ] Published on DeWeb
- [ ] NFT gallery
- [ ] Independent security audit
- [ ] Translations (i18n)

**Phase 2 — Browser extension**
- [ ] Chrome / Brave / Edge and Firefox extension
- [ ] dApp connectivity: sign transactions requested by Massa dApps, with a review screen
- [ ] Per-site permissions

**Phase 3 — Mobile apps**
- [ ] iOS and Android apps
- [ ] Biometric unlock (Face ID / fingerprint)
- [ ] Push notifications for incoming transfers

**Later**
- [ ] Hardware-wallet support
- [x] Reproducible builds with published checksums (see [Releases](#releases))
- [x] Automated release builds in CI

## Support the project

RustCore Wallet is free and built in the open. If it's useful to you and you'd like to help fund
its development (the browser extension, mobile apps and a security audit), you can send a
voluntary donation in MAS or any Massa token to:

```
AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P
```

Donations are entirely optional and don't unlock any features — the wallet is the same for
everyone. Before sending, always check the address against this README in the official repository —
nobody from RustCore will ever DM you asking for funds or give you a different address.

Not in a position to donate? Starring the repository, reporting bugs and spreading the word help
just as much.

## Contributing

Contributions are welcome — bug reports, ideas and pull requests.

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Keep the security rules above intact (no network calls beyond the list above, no optimistic
   updates, review step before any signature).
3. Run the tests, the type-check and Prettier before opening a pull request, and add tests for
   any logic that touches amounts, fees, keys or transactions.

Because RustCore Wallet will also ship as a browser extension and in the mobile app stores,
contributors are asked to sign a **Contributor License Agreement (CLA)** before their first
pull request is merged. You keep the copyright on your contribution; the CLA lets the project
distribute it under this license and through those channels.

## Security

Please report vulnerabilities **privately** through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" on the repository's Security tab). Please include steps to reproduce
and give us a reasonable time to fix the issue before disclosing it publicly.

## License

RustCore Wallet is **source-available** under the
[Functional Source License, Version 1.1, ALv2 Future License](LICENSE.md) (FSL-1.1-ALv2).

In plain words (the [license text](LICENSE.md) is what legally applies):

- ✅ You **may** read, audit, run, modify and share the code — for yourself, for your company's
  internal use, for education and for research.
- ❌ You **may not** use it to offer a **competing product or service**: a wallet or service
  that substitutes for RustCore Wallet or offers substantially the same functionality.
- ⏳ **Each release becomes open source under Apache-2.0 two years after it is published.**

The names **"RustCore"** and **"RustCore Wallet"** and the RustCore logo are not licensed for
use in other products, including forks.

Copyright © 2026 Gicu Adasanu. All rights reserved except as granted by the license.

## Disclaimer

RustCore Wallet is provided "as is", without warranty of any kind. You are solely responsible for
your private keys and your funds: whoever holds a private key controls the funds, and lost keys
cannot be recovered by anyone. Blockchain transactions are irreversible. RustCore is not
affiliated with Massa Labs or Dusa.
