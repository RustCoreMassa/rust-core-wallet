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
| `npm run smoke` | Boots the production build in a simulated phone browser (run after `npm run build`) |
| `npm run build:extension` | Browser extension into `dist/extension/chromium` and `dist/extension/firefox` |
| `npm run smoke:extension` | Boots the extension's popup with a simulated `chrome.storage` (after `build:extension`) |
| `npm run build:native` | The iOS / Android apps' web bundle into `dist/native` |
| `npm run build:ios` | `build:native`, the app version from `package.json`, then copies the bundle into the Xcode project (`ios/`) |
| `npm run build:android` | `build:native`, the app version, then copies the bundle into the Android project (`android/`) |
| `npm run smoke:native` | Boots the apps' web bundle in a simulated phone (after `build:native`) |
| `npm run test-dapp` | Test page for dApp connections at http://127.0.0.1:4300 (see below) |
| `npx prettier --write .` | Format the code |

**Mobile only.** RustCore Wallet is a phone app: in a desktop browser the production build shows
an "open on your phone" screen instead of the wallet. Development builds (`npm start`) skip that
screen, so the wallet opens in any desktop browser; to see it as on a phone, turn on DevTools
device emulation (Chrome: *Toggle device toolbar*; Firefox: *Responsive Design Mode* with touch
simulation). The restriction is the `MOBILE_ONLY` flag in `src/app/platform-providers.ts`.

**Browser extension (in progress).** The same code also builds as a Manifest V3 browser
extension, one package per browser family: `npm run build:extension` writes
`dist/extension/chromium` (Chrome, Edge, Brave, Opera, Vivaldi, Arc) and
`dist/extension/firefox` (Firefox desktop and Android). They hold the same files; only
`manifest.json` differs — `src/extension/manifest.json` has every key and the build keeps each
browser's own (Chromium: `side_panel`, background `service_worker`; Firefox: `sidebar_action`,
background `scripts`, `browser_specific_settings`). To try it:

- Chrome / Edge / Brave: `chrome://extensions` (Edge: `edge://extensions`) → *Developer mode* →
  *Load unpacked* → pick `dist/extension/chromium`.
- Firefox: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick
  `dist/extension/firefox/manifest.json` (stays until Firefox restarts).

What differs from the web app is swapped in at build time: `src/app/platform-providers.ts` (web)
is replaced by `src/extension/platform-providers.ts` — `chrome.storage` instead of the page's
storage, a password instead of the 6-digit PIN (`UNLOCK_SECRET`; a vault made with a PIN moves
to a password at the next unlock), hash routing, no mobile gate, service worker or install
banner, and an unlocked session that survives closing the popup (the vault key is kept in
memory-only `chrome.storage.session` and wiped 15 minutes after the user last did something in
any view, or when the computer locks — every open view then locks: `ChromeSessionKeyStore`,
`core/state/auto-lock.ts`). The same page runs in three views
(Settings → *Open in full screen* / *Open in side panel*; `html[data-view]`, styled in
`src/extension/views.scss`): the toolbar popup, fixed at 380×600 (the browsers' height limit);
the side panel (`?view=side-panel` — Chrome's side panel or Firefox's sidebar), full window
height; and a full-screen browser tab (`?view=tab`): a centered 720 px column, with dialogs in
place of bottom sheets. What a browser offers is detected, not assumed
(`src/extension/browser-views.ts`): no side panel where neither API exists, and on a phone
(Firefox for Android) the popup is already full screen, so it offers no other view. The
extension's pages may connect only to the Massa nodes, the explorer API and the two media
servers of `MEDIA_HOSTS` (`src/app/core/utils/media-hosts.ts`), and load images only from those
two (CSP in `src/extension/manifest.json`; `src/csp.spec.ts` checks it against `MEDIA_HOSTS`).

**iOS app (in progress).** The same code runs inside a native shell made with
[Capacitor](https://capacitorjs.com): the Xcode project lives in `ios/`, the settings in
`capacitor.config.json`. The app holds its own copy of the web bundle — it never loads the wallet
from DeWeb or any server. `npm run build:ios` builds that bundle (Angular configuration
`native`: `src/native/platform-providers.ts` replaces the web one, `src/native/native.scss` keeps
the screen below the status bar) and copies it into the project; then open
`ios/App/App.xcodeproj` in Xcode and run it on a simulator or a phone. Capacitor's own native
code comes through Swift Package Manager as Ionic's prebuilt framework, pinned by checksum
(`ios/App/CapApp-SPM/Package.swift`, `Package.resolved`); its source is in
`node_modules/@capacitor/ios`. Needs macOS and the full
Xcode (the command line tools alone can't build iOS apps). To run it on your own iPhone, add
your Apple ID in Xcode → Settings → Accounts (a free account works; the app then expires after
7 days) and put `DEVELOPMENT_TEAM = <your team ID>` in `ios/local.xcconfig` — git-ignored, so
your team ID stays out of the repository. Don't pick the team in Xcode's *Signing &
Capabilities* tab: Xcode would write it into the committed `project.pbxproj`. The phone needs
Developer Mode (Settings → Privacy & Security; the switch appears once Xcode has the phone as a
run destination), and on first launch you trust your developer profile in Settings → General →
VPN & Device Management. Swaps aren't offered in the store apps (`SWAP_AVAILABLE`: app stores
treat in-app crypto exchange as a licensed service). The app's lasting storage (`LOCAL_STORE`:
the encrypted vault, preferences) is the iOS Keychain, not the web view's localStorage, which
iOS may clear when space runs low: `ios/App/App/NativeStorePlugin.swift` (our own plugin,
registered in `MainViewController.swift`; readable only while the phone is unlocked, never
synced or restored onto another phone, cleared on a fresh install because Keychain items
outlive the app) behind `src/native/native-storage-area.ts` (loaded before Angular starts,
writes in order in the background; items an earlier build left in localStorage move over once).
Locking adds one rule to the web's: back after a minute or more in the background, the app
asks for the PIN again (`BACKGROUND_LOCK_MS`, checked on Capacitor's `resume`, before the app is
on screen); while it isn't active, `SceneDelegate.swift` covers it with the launch screen, so
the app switcher's snapshot shows no balances. Face ID / Touch ID can stand in for typing the
PIN to unlock (Settings → Unlock with Face ID; `BIOMETRIC_UNLOCK`,
`ios/App/App/BiometricUnlockPlugin.swift`): the PIN is kept in the Keychain behind the
biometrics (`biometryCurrentSet` — adding a face turns it off), and showing or copying a private
key, removing a wallet and logging out still ask for the PIN typed. A copied private key goes to
the clipboard through `SECRET_CLIPBOARD` (`SecretClipboardPlugin.swift`): this device only (no
Universal Clipboard) and removed by the system after 60 s, even with the app in the background.
Send → Scan reads a recipient from a QR code (`QR_SCANNER`, `QrScannerPlugin.swift`, camera
full screen); only a plain address or a `massa:` link is taken (`addressFromQr`). Receive →
Share opens the iOS share menu (`SHARE_SHEET`, `ShareSheetPlugin.swift`). The apps' version
follows `package.json`: `npm run build:ios` / `build:android` set it
(`scripts/sync-app-version.mjs`; Android's `versionCode` = major·10000 + minor·100 + patch).

**Android app (in progress).** The same web bundle and Capacitor project, in `android/`: needs
Android Studio (its SDK) and JDK 21; `npm run build:android`, then open `android/` in Android
Studio and run it on an emulator or a phone with USB debugging. Each iOS plugin has a Java
counterpart in `android/app/src/main/java/com/rustcoremassa/wallet/` (registered in
`MainActivity.java`), same names and answers: `NativeStorePlugin` (values AES-GCM-encrypted with
an Android Keystore key, usable only while the phone is unlocked, in private SharedPreferences;
backups and device transfers exclude the app's data — `res/xml/data_extraction_rules.xml`,
`allowBackup="false"`), `BiometricUnlockPlugin` (the PIN encrypted to an RSA Keystore key whose
private half needs a strong biometric check every time and dies when a fingerprint or face is
added), `SecretClipboardPlugin` (marked sensitive, emptied after 60 s while the app's process
lives), `QrScannerPlugin` (ZXing via zxing-android-embedded — open source, no Google Play
services) and `ShareSheetPlugin`. The recent-apps screen shows no balances
(`setRecentsScreenshotEnabled(false)`; before Android 13, `FLAG_SECURE` while in the
background). The Gradle download is pinned by checksum (`gradle-wrapper.properties`).
Capacitor's own logging is off in both apps (`loggingBehavior: "none"` in `capacitor.config.json`):
in debug builds it would write every plugin call's data — a PIN being kept for biometric unlock,
a private key being copied — to the system log. Debug the web side with Chrome's
`chrome://inspect` (Android) or Safari's Web Inspector (iOS) instead.

**Content Security Policy.** The web app has the same policy as a `<meta>` in `src/index.html`
(minus `frame-ancestors`, which a `<meta>` can't set — `src/main.ts` refuses to start inside a
frame instead): `npm run build:extension` fails if the two differ, and `npm run smoke` fails if
the built `index.html` lacks it or has inline code (`script-src 'self'` would block it — hence
`inlineCritical: false` in angular.json). It starts from `default-src 'none'`: anything not
listed (frames, media, fonts or styles from elsewhere) is refused, so a new kind of resource needs
its own directive. Styles allow `'unsafe-inline'` because Angular adds component styles as
`<style>` elements. A new server means changing both policies, `MEDIA_HOSTS` if it serves media,
and the README's list. Remote media links always go through `mediaUrl()` (IPFS: content-hash
paths only).

**dApp connections** (extension only; design in `docs/DAPP-CONNECTION.md`). To try them, load the
extension, run `npm run test-dapp` and open http://127.0.0.1:4300 (the extension's scripts run
on `localhost` / `127.0.0.1` pages, so the page gets `window.rustcore`). It calls every method —
connect, sign (the signature is verified on the page), transfers, rolls, contract calls on
buildnet's Wrapped MAS (including one whose simulation must fail) — and runs protocol checks:
bad requests the wallet must refuse with the right error code. Transfers, rolls and contract
calls are sent only while the wallet is on **buildnet** (Settings → network); fund the test
account from the buildnet faucet.

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
| Native apps | [Capacitor](https://capacitorjs.com) — the same web bundle inside the iOS and Android apps |

```
src/app/
├── core/
│   ├── models/      Tokens, wallets, transactions, vault, MNS
│   ├── platform/    Device detection (mobile only), install-as-app prompt, storage tokens
│   ├── services/    Massa provider, Dusa prices & swap, explorer API,
│   │                encrypted vault & session cache, on-chain execution tracking
│   ├── state/       AuthStore (vault, saved addresses & session), WalletStore (balances,
│   │                history, staking, swaps), AutoLock, history merging, NetworkStore
│   └── utils/       Exact decimal ↔ on-chain amounts, staking rewards, user-facing errors
├── features/        Screens: lock screen, Home, NFTs & domains, Staking, Settings, modals
├── layout/          App shell, navigation, auto-refresh
├── shared/          Reusable UI: dropdown, confirmation step, install banner, rows, unlock entry
└── platform-providers.ts   Web-app specifics (replaced in the extension and native builds)
src/extension/       Browser extension: manifest, background worker, chrome.storage adapters
src/native/          iOS / Android apps: platform providers, status-bar spacing
ios/                 Xcode project (Capacitor)
android/             Android Studio project (Capacitor)
```

### Design rules

- **Private keys stay in the vault** (AuthStore). Everything else looks them up only when
  signing and never stores them. Revealing or copying a key, removing a wallet and logging out
  ask for the PIN/password again; the wallet locks itself after 15 minutes without use
  (`AutoLock`), and a lock anywhere locks every tab or extension view.
- **What you review is what you sign.** Every write passes its fee explicitly
  (`NETWORK_FEE_UNITS`, or the dApp's) — never massa-web3's default, which is whatever the node
  reports — and any coins it sends (a token's storage deposit included) are shown first.
- **No optimistic updates.** Writes resolve only once the chain has executed the operation; then
  the history is updated and the chain is re-read. A failed operation changes nothing on screen.
- **Exact amounts.** Amounts are converted to on-chain units through decimal strings
  (`toUnits` / `fromUnits`), never floating-point multiplication; spends are clamped to the exact
  on-chain balance.
- **Plain errors.** Anything shown to users goes through `toUserMessage()` — raw node or network
  errors are never displayed, nor the reason of an operation that failed on-chain (a contract
  writes it).
- **UI**: no native `<select>` (use the shared dropdown); colors, radii and shadows come from the
  design tokens in `src/styles.scss`.

## Tests

`npm test` runs the unit tests (Vitest). They cover the logic where a mistake costs money or
data: amount conversions, the encrypted vault, validation and fees, "nothing changes on
failure", history merging, the explorer mapping, error messages, staking rewards, Dusa quote
encoding, platform detection, auto-lock and the kept session, and the extension's dApp bridge
(protocol parsing, per-site permissions, the request router and its events, the approval
window — including when its Approve button may answer). The blockchain and explorer are faked, so tests
run offline.

Unit tests can't see problems that only exist in the bundled output, so after
`npm run build` run `npm run smoke`: it loads the production build in a simulated phone browser
and checks the app renders. The release workflow runs it too, before publishing anything.
For the extension, `npm run build:extension` also fails if the popup's `index.html` contains
inline code (the extension's CSP would block it), and `npm run smoke:extension` boots the popup.
