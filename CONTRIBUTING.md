# Contributing to RustCore Wallet

Thanks for helping! Bug reports, ideas and pull requests are all welcome. This guide covers
running the wallet locally, how the code is organized, and the rules that keep it safe.

For releases and deployment, see [docs/RELEASING.md](docs/RELEASING.md).

## Ground rules

1. **Open an issue first** for anything larger than a small fix, so we can agree on the approach.
2. **Keep the security model intact** (see the README):
   - no network calls beyond the documented list — a new one must be added to the README's
     "What goes over the network" table in the same pull request;
   - no optimistic updates: nothing is shown as done before the chain has executed it;
   - a review step before any signature;
   - private keys never leave the vault and never reach logs.
3. **Test what matters**: add or update tests for any logic that touches amounts, fees, keys or
   transactions. Run the tests, the type-check and Prettier before opening a pull request.
4. **Report vulnerabilities privately**, never in a public issue — see "Security" in the README.

### Contributor License Agreement

Because RustCore Wallet will also ship as a browser extension and in the mobile app stores,
contributors are asked to sign a **Contributor License Agreement (CLA)** before their first
pull request is merged. You keep the copyright on your contribution; the CLA lets the project
distribute it under its [license](LICENSE.md) and through those channels.

## Running it locally

**Requirements:** [Node.js](https://nodejs.org) — the version in [`.nvmrc`](.nvmrc) (24.15.0;
Angular also accepts `^22.22.3` and `>=26`) — and npm.

```bash
git clone https://github.com/RustCoreMassa/rust-core-wallet.git
cd rust-core-wallet
npm ci
npm start            # http://localhost:4200
```

| Command | What it does |
|---|---|
| `npm start` | Development server with live reload |
| `npm test` | Unit tests (Vitest) |
| `npx tsc -p tsconfig.app.json --noEmit` | Type-check |
| `npm run build` | Production build into `dist/` |
| `npx prettier --write .` | Format the code |

**Mobile only.** RustCore Wallet is a phone app: in a desktop browser it shows an "open on your
phone" screen instead of the wallet. To develop on desktop, open DevTools and turn on device
emulation (Chrome: *Toggle device toolbar*; Firefox: *Responsive Design Mode* with touch
simulation), then reload. The restriction is the `MOBILE_ONLY` flag in `src/app/app.config.ts`.

**Installable app.** The service worker runs in production builds only (`npm run build`), and
browsers offer installation only over HTTPS (or on `localhost`).

**Real funds.** The wallet talks to Massa mainnet. When developing features that write to the
chain, verify them with read-only calls or simulations first, and test with small amounts.

## How it's built

| Layer | Technology |
|---|---|
| UI | [Angular](https://angular.dev) — standalone components, signals, new control flow, zoneless |
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
│   ├── platform/    Device detection (mobile only), install-as-app prompt
│   ├── services/    Massa provider, Dusa prices & swap, explorer API,
│   │                encrypted vault & session cache, on-chain execution tracking
│   ├── state/       AuthStore (vault & session), WalletStore (balances, history,
│   │                staking, swaps), history merging, NetworkStore
│   └── utils/       Exact decimal ↔ on-chain amounts, staking rewards, user-facing errors
├── features/        Screens: PIN/unlock, Home, NFTs & domains, Staking, Settings, modals
├── layout/          App shell, navigation, auto-refresh
└── shared/          Reusable UI: dropdown, confirmation step, install banner, rows, PIN pad
```

### Design rules

- **Private keys stay in the vault** (AuthStore). Everything else looks them up only when
  signing and never stores them.
- **No optimistic updates.** Writes resolve only once the chain has executed the operation; then
  the history is updated and the chain is re-read. A failed operation changes nothing on screen.
- **Exact amounts.** Amounts are converted to on-chain units through decimal strings
  (`toUnits` / `fromUnits`), never floating-point multiplication; spends are clamped to the exact
  on-chain balance.
- **Plain errors.** Anything shown to users goes through `toUserMessage()` — raw node or network
  errors are never displayed.
- **UI**: no native `<select>` (use the shared dropdown); colors, radii and shadows come from the
  design tokens in `src/styles.scss`.

## Tests

`npm test` runs the unit tests (Vitest). They cover the logic where a mistake costs money or
data: amount conversions, the encrypted vault, validation and fees, "nothing changes on
failure", history merging, the explorer mapping, error messages, staking rewards, Dusa quote
encoding and platform detection. The blockchain and explorer are faked, so tests run offline.
