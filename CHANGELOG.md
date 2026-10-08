# Changelog

All notable changes to RustCore Wallet are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Custom tokens.** Add any MRC-20 token by its contract address, on Mainnet or Buildnet
  (Settings → Custom tokens). The wallet reads the token's name, symbol and decimals from its
  contract and shows them for review before adding it; its balance then appears with your tokens
  and you can send it. Added tokens are marked *Added by you*, the
  Send review shows their contract, and a token can't take the symbol of one RustCore already
  lists. Removing one only hides it — the tokens stay in your wallet on the blockchain. Custom
  tokens have no USD price and can't be swapped.
- **Icons for custom tokens**, from an `https://` or `ipfs://` link (loaded through ipfs.io),
  set when adding the token or later from Settings → Custom tokens. The icon is loaded from that
  server each time the token is shown, which the wallet says next to the field (and the README
  lists among the network destinations).

### Changed

- **The wallet's address is now Massa's official gateway, wrustcore.massa.network.** Opened from the
  old community gateway (wrustcore.deweb.half-red.net), the wallet shows how to move: back up
  each private key there, import it at the new address. A browser keeps a wallet only at the
  address where it was created, so it can't move by itself. The old address no longer offers to
  install the app, and its desktop QR code points to the new one.

## [1.2.0] — 2026-10-07

### Added

- **Browser extension: connect to Massa dApps.** A site asks once to connect and sees one
  wallet of your choice. Every transfer, roll purchase or sale, contract call and message
  signature it asks for opens a review window in the extension; nothing is signed without your
  approval. Contract calls are tried first without sending anything, and the wallet explains
  known token transfers, allowances (with a warning for unlimited ones) and Dusa swaps. Sites
  can't send raw bytecode or hand the wallet a private key. dApps will find RustCore once
  `@massalabs/wallet-provider` supports it (in progress).
- Settings → **Connected sites**: see which sites are connected, change a site's wallet or
  disconnect it. Removing a wallet or logging out disconnects its sites. If the browser has
  withdrawn the extension's access to websites, the wallet says so and lets you allow it again.
- The wallet's version is shown at the bottom of Settings.

### Changed

- **Browser extension: a password instead of the 6-digit PIN** (at least 8 characters, not only
  digits). If someone copied the browser's data, a PIN could be guessed offline in moments; a
  good password can't. A wallet created with a PIN in the extension asks for a new password at
  the next unlock — the wallets stay as they are. The mobile web wallet keeps its PIN.
- The wallet moved to **`wrustcore.massa`**, now its only official address; `rustcore.massa`
  is the RustCore website.

## [1.1.1] — 2026-10-02

### Added

- The browser extension links to its source code from the browser's extension page (homepage).

### Changed

- Smaller app: the unused gRPC client inside the Massa library (generated code plus two
  pre-minified libraries) is left out of the build. The app's code is less than half its
  former size (about 0.75 MB instead of 1.9 MB), and the extension now contains no minified
  third-party code that its source can't account for, as Firefox Add-ons requires.

## [1.1.0] — 2026-10-01

### Added

- **Browser extension** (Manifest V3), built from the same code as the web app, in two packages:
  one for Chrome, Edge, Brave, Opera, Vivaldi and Arc, one for Firefox (desktop and Android).
  It opens as the toolbar popup, in the browser's side panel (Firefox: sidebar) or full screen
  in its own tab. An unlocked wallet stays unlocked while you reopen the popup and locks itself
  15 minutes after it was last open. The extension may connect only to the Massa nodes and the
  explorer API. Store publishing comes next; connecting to dApps is the following step.
- Every GitHub Release now also carries the extension packages, each with its own checksums,
  built and boot-tested in public CI like the web app.

### Changed

- Amounts in balances, lists and history show exactly two decimals, cut rather than rounded up,
  so a balance never looks larger than it is. Review screens and transaction details still show
  exact amounts.

### Fixed

- After unlocking, every wallet's balance loads, not only the active one's. Wallets are now read
  one after another; reading them all at once tripped the public node's rate limit. The wallet
  list shows a placeholder instead of "0 MAS" until a balance is known.
- Swap quoted the whole balance when the amount typed was larger (1 000 and 10 000 MAS both
  showed the same result); it now says the balance isn't enough.
- The recipient address field in Send no longer shows a double focus ring.
- Text fields on their own (wallet name, private key, address label) span the full width.
- The bottom navigation labels are no longer underlined.

## [1.0.3] — 2026-09-30

### Changed

- RustCore Wallet is live on DeWeb at **`rustcore.massa`**; the README now shows the official
  address and warns against copies of the wallet on any other address.

### Fixed

- On the phone, dragging up or down no longer moves the whole app (it used to shift and spring
  back without scrolling anything).

## [1.0.2] — 2026-09-30

### Fixed

- Double-tapping no longer zooms the app in; pinch-to-zoom still works for accessibility.
- Tapping into a text field on iPhone no longer zooms the page (fields now use a 16 px font).

## [1.0.1] — 2026-09-30

### Fixed

- The production build no longer shows a blank page on load ("class heritage … is not an object
  or null"). An import cycle inside the massa-web3 library was ordered wrongly by the production
  bundler; the app now loads the library through its entry point first.

### Added

- Every release is now boot-tested before publishing: the built app is loaded in a simulated
  phone browser and must render its first screen.

## [1.0.0] — 2026-09-29

First production release of RustCore Wallet, a self-custodial mobile web wallet for the Massa
blockchain.

### Added

- **Encrypted vault**: 6-digit PIN → PBKDF2 (300 000 iterations) → AES-GCM with the browser's
  Web Crypto API. Private keys never leave the device; the PIN is never stored.
- **Wallets**: create or import private keys, multiple wallets, rename, switch, back up the
  private key (PIN-confirmed), remove a wallet (PIN-confirmed), full log out that wipes the
  device.
- **Send & receive**: MAS and MRC-20 tokens (MAS, PUR, DUSA, USDC.e, WETH.e, DAI.e, WBTC.e,
  WETH.b, USDT.b); a review step before every signature; a scannable QR code for receiving.
- **Swap** through the Dusa DEX: live quotes, price impact, route, 0.5 / 1 / 2 % slippage
  tolerance with an on-chain minimum output.
- **Staking**: buy and sell rolls, staking status (active, activating, missing slots,
  unstaking), produced/missed slots, APR, estimated daily reward, network roll count, and a
  guide for wallets that don't stake yet.
- **History** from the Massa explorer with cursor paging, transaction details and explorer links.
- **MNS domains** (`.massa`) owned by the wallet, with details.
- **USD prices** read directly from Dusa's on-chain quoters.
- **Networks**: Mainnet and Buildnet.
- **Installable app (PWA)** on Android and iOS, with install guidance for every browser.
- **Mobile only**: on desktop the wallet shows an "open on your phone" QR screen.

### Security

- Nothing is shown as done before the network has executed it: balances, rolls and history are
  re-read from the chain after each operation, and a failed operation changes nothing.
- No RustCore backend, analytics or tracking. The only network destinations are the Massa public
  RPC nodes and the Massa explorer API; fonts are bundled and the service worker caches only the
  app's own files.
- Raw node and network errors are never shown to users; they get a short, plain explanation.

[1.2.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.2.0
[1.1.1]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.1.1
[1.1.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.1.0
[1.0.3]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.3
[1.0.2]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.2
[1.0.1]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.1
[1.0.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.0
