# Changelog

All notable changes to RustCore Wallet are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **iOS and Android apps — in development, not yet in the App Store or Google Play.** The same
  wallet, with what a phone app adds: the encrypted vault in the phone's own secure storage
  (iOS Keychain, Android Keystore) instead of browser storage, unlocking with Face ID, Touch ID
  or a fingerprint (showing or copying a private key, removing a wallet and logging out still
  ask for your PIN), a lock when the app comes back after a minute in the background, balances
  hidden in the app switcher, a copied private key that stays on the phone and is removed after
  60 seconds, scanning a recipient's QR code, and sharing your address. Token swaps are not in
  the apps.

### Fixed

- Short notifications ("Address copied", …) appear below the status bar and the camera instead
  of behind them, on phones where the wallet fills the whole screen.

## [1.7.1] — 2026-11-04

### Security

- **Copying a private key from Settings → wallet now asks for your PIN or password**, like
  revealing it under *Backup private key* always did. Before, two taps on an unlocked phone (or
  at a computer while the extension was unlocked) were enough to take the key. Found in an
  internal audit.
- **The wallet locks itself after 15 minutes without use.** On the web it never locked by itself;
  in the browser extension a popup, side panel or tab left open kept it unlocked indefinitely.
  The extension also locks when the computer locks, and locking it anywhere — another tab, the
  popup, the side panel, the review window — now locks every open view, which kept their keys
  before.
- Browser extension: the review window's **Approve button works only once the window has been in
  front for a second without being clicked**, and a click that began before never approves — a
  site could pop the window up under a click the user was about to make.
- **The fee on the review screen is the fee the transaction pays.** Sends, rolls and swaps left
  the fee to the Massa node's own minimum, which only happened to equal the 0.01 MAS shown. A
  token transfer to someone who never held that token also pays a small storage deposit
  (≈ 0.01 MAS); it's now shown, checked against your MAS and sent exactly as shown.
- A transaction that fails on-chain no longer shows the network's error text (a contract writes
  it, and could make it say anything): a known cause in plain words, or a fixed sentence.
- Tokens you add by contract must have a symbol in Latin letters and digits, and can't take a
  listed token's symbol without its bridge suffix or with another one (USDC, USDC.b…): a
  Cyrillic "С" made "USDС" look exactly like USDC. Saved tokens that break these rules are
  dropped.
- Browser extension: unlimited token allowances are spelled out on any token, not only the ones
  RustCore lists; a site can have at most two requests waiting across its subdomains, and at
  most 16 in flight; only the extension's own pages may read its storage, where the browser
  supports it.
- Setting up a wallet in a second tab or extension view can no longer overwrite the one created
  in the first (and the private key it held); importing a key already in the wallet is refused.
- The extension's move from PIN to password can no longer be skipped by reopening the popup.
- A stricter Content Security Policy (nothing loads unless listed), no Referer sent to any
  server, the wallet refuses to run inside another site's frame, and IPFS media load only by
  content hash (never through a name another server resolves).
- The release workflow runs the dependencies' code (install, tests, build) only with a read-only
  token and no credentials in the checkout; publishing is a separate job. Updated Angular
  (22.2.4) and the build and test tools: `npm audit` reports no known vulnerabilities.

### Added

- `scripts/verify-deployment.mjs`: checks that the site served by a gateway is exactly a
  release (every file against its `SHA256SUMS`) — see docs/RELEASING.md.

### Fixed

- Saved addresses (*Save this address for future use*) are kept in the encrypted wallet and
  survive closing the app; they used to vanish with the session.

## [1.7.0] — 2026-11-04

### Security

- **Browser extension: a site could get a signature that moves your funds** through a "sign this
  message" request. A Massa transaction is signed over its own bytes with the same function as a
  message, so a site asking you to sign exactly those bytes would have received a valid
  signature for a transfer of its choosing. Such messages are now refused — by the extension's
  background and, finally, by the signing key itself. Found in an internal audit; no known abuse.
- After 5 wrong PINs or passwords in a row the wallet makes you wait (30 s, doubling with each
  new mistake, at most an hour), also for the PIN asked before revealing a key, removing a wallet
  or logging out. The count survives reloading the page.
- The wallet's encryption key is now derived with 600 000 PBKDF2 iterations (was 300 000, below
  OWASP's recommendation); existing wallets move over at their next unlock, with the same PIN
  and the same private keys. A second window (another tab, the extension's side panel) can no
  longer save over a wallet another window re-encrypted — it asks to unlock again instead.
  Note: once moved, a wallet can't be opened by versions before 1.7.0.
- Private key fields are hidden and kept out of keyboard suggestions, spell check (which can send
  text to a server) and autofill; a copied private key is wiped from the clipboard after 60 s.
- Browser extension: a site can't set a network fee above 1 MAS, and a raised fee is spelled out
  on the review screen; `setApprovalForAll` on an NFT collection (how NFT drainers empty
  wallets) is decoded, with a warning unless it's for RustCore Launchpad; invisible and
  right-to-left characters in a message to sign are shown instead of disguising it, and a
  message that isn't readable text gets a warning.
- The release workflow pins its GitHub Actions to exact commits.

### Added

- **NFT gallery** on the NFTs page: the NFTs your wallet holds, with their picture, description
  and traits, and a details screen with the collection's contract. Only collections listed on
  RustCore Launchpad **and verified by its team** are shown (read from its registry on the
  blockchain), so spam, fake or "claim your reward" NFTs sent to your wallet never appear. At
  most 200 NFTs per collection and 500 in all are read. Works on Mainnet and Buildnet.
- NFT descriptions and pictures load only from `ipfs.io` (for `ipfs://` links) and
  `nft.rustcoremassa.com` (RustCore's Core Keepers NFTs); an NFT stored elsewhere shows only
  what's on the blockchain (collection name, symbol, number). Every request goes out without
  cookies or referrer, with a timeout and a size limit, over https only, and a redirect can't
  lead elsewhere.
- **Content Security Policy for the web app**, the same as the browser extension's: the browser
  runs only the wallet's own scripts and connects or loads images only from the servers in the
  README's list.

### Changed

- Custom token icons: only `ipfs://` links (or links on `nft.rustcoremassa.com`) are accepted,
  on the web and in the extension — the Content Security Policy blocks images from other
  servers. An icon saved before from another server shows the token's symbol instead.
- Pages scroll without showing a scrollbar (scrolling works as before).

## [1.6.0] — 2026-10-21

### Added

- **Connect several wallets to a site, as in MetaMask** (browser extension). When a site asks to
  connect, tick the wallets it may see — the one you're using comes ticked. The site uses the
  wallet you switch to whenever it may see it, and Home tells you when the site open in your
  browser is connected, but not to the wallet you're using, with a button to connect it.
  Settings → Connected sites lists the wallets each site sees, the one in use first, to add or
  take one away.
- **Older dApps stay on the wallet they show.** A site that doesn't handle several accounts yet
  (and every site connected before this version) doesn't follow your wallet switches, so it can
  never ask you to sign from another wallet than the one it displays. Home tells you when it
  uses another wallet than yours, and Settings → Connected sites lets you choose which one.
- **For dApp developers:** the `accounts` request, an optional `from` on signatures and
  operations to choose which of the site's accounts signs, and the `accountsChanged` event. A
  site follows wallet switches once it asks for `accounts` or sends `from`. Everything that
  worked before works the same.

## [1.5.2] — 2026-10-20

### Added

- **"Forgot your PIN / password?" on the lock screen.** The PIN or password can't be recovered
  (it encrypts your wallets), so until now a forgotten one left no way back in. The link erases
  this device's wallets, after a warning and a confirmation, and starts over: create a new PIN or
  password, then import your wallets again with their private keys. It clears the same data as
  Log out.

## [1.5.1] — 2026-10-19

### Added

- **dApps learn the network of every operation they send.** Transfers, rolls and contract calls
  now answer `{ operationId, network }`, with the network the wallet sent the operation on, so a
  site keeps following it on the right node even if you switch network meanwhile.

### Changed

- **Empty and low-balance tokens start hidden every time you open the wallet.** "Show all
  tokens" used to be remembered on the device, so one tap kept the zero balances on the Home
  list for good; now it lasts until the wallet is closed. Tokens you added yourself are hidden
  too while their balance is 0.

## [1.5.0] — 2026-10-17

### Added

- **dApps can set the fee of transfers and rolls** in the extension, as they already could for
  contract calls. The approval window shows the fee that will be paid — never less than the
  wallet's own 0.01 MAS — and the balance check keeps it.

### Changed

- **dApp requests with options the wallet doesn't support are refused** (error -32602) instead of
  having those options silently ignored, so a site never believes a setting was applied.
- **A site asking to connect twice gets one approval.** A second request to connect while the
  first is waiting — from the same page or another tab of the site — now waits for the same
  answer instead of failing with "busy".
- **Ready for Massa's MAIN.5.1 node release** (massa-web3 5.4.0). MAIN.5.1 nodes keep an
  executed operation in their pool until it is final; the wallet would have read that as still
  pending and reported a timeout for transactions that went through. Works with MAIN.5.0 and
  MAIN.5.1, before and after MIP-0002.
- **The first swap of a token pays the storage of its allowance** (0.015 MAS on Mainnet, shown
  as "up to 0.02 MAS" in Review), sent when the wallet approves the Dusa router for that token
  the first time. Tokens following MRC-20 0.1.0 — WMAS once MIP-0002 is active — refuse the
  approval without it and give back what isn't used. Swapping a token now needs 0.14 MAS
  (was 0.12).

### Fixed

- **Connected sites always hear about account and network changes.** The browser stops the
  extension's background worker when it's idle, which closed the line to the page; a change made
  after that (switching network a minute after connecting, for instance) never reached the site.
  Changes now go to every tab showing the site, whatever the worker did meanwhile.

## [1.4.0] — 2026-10-12

### Added

- **Register `.massa` names.** NFTs → Domains → *Register*: type a name, see its price (set by
  the Massa Name System: 2 characters 10,000 MAS, 3 → 1,000, 4 → 100, 5 → 10, 6 or more → 1 MAS,
  plus a 0.1 MAS storage deposit whose unused part comes back). Review checks on-chain that the
  name is free and runs the registration as a test first, so you only confirm one that would go
  through. The wallet becomes the owner and the name points to its address; it shows up in your
  domains and in History.

## [1.3.0] — 2026-10-08

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

[1.7.1]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.7.1
[1.7.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.7.0
[1.6.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.6.0
[1.5.2]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.5.2
[1.5.1]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.5.1
[1.5.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.5.0
[1.4.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.4.0
[1.3.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.3.0
[1.2.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.2.0
[1.1.1]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.1.1
[1.1.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.1.0
[1.0.3]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.3
[1.0.2]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.2
[1.0.1]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.1
[1.0.0]: https://github.com/RustCoreMassa/rust-core-wallet/releases/tag/v1.0.0
