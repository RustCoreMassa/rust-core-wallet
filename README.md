<p align="center">
  <img src="src/assets/logo.png" alt="RustCore Wallet" width="120" />
</p>

<h1 align="center">RustCore Wallet</h1>

<p align="center">
  A self-custodial, transparent wallet for the <a href="https://massa.net">Massa</a> blockchain —
  the first product of the <b>RustCore</b> team.
</p>

<p align="center">
  <img alt="Version 1.2.0" src="https://img.shields.io/badge/version-1.2.0-brightgreen" />
  <img alt="Network: Massa" src="https://img.shields.io/badge/network-Massa-red" />
  <img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue" />
</p>

<p align="center">
  <b>Open it on your phone:</b>
  <a href="https://wrustcore.massa.net"><b>wrustcore.massa</b></a>
  — live on DeWeb
</p>

---

## Why RustCore Wallet

A wallet holds the keys to people's money, so "trust us" is not good enough. RustCore Wallet is
built on four principles:

- **Your keys never leave your phone.** Private keys are encrypted on your device with your PIN
  and are never sent anywhere — there is no RustCore server at all.
- **Everything is verifiable.** The full source code is public, so anyone can check exactly what
  the wallet does with your data — and confirm that it takes none.
- **What you see is what's on-chain.** Balances, rolls and history come straight from the
  blockchain. The wallet never shows a transaction as done before the network has executed it.
- **Served from the blockchain, too.** The wallet is hosted on
  [DeWeb](https://docs.massa.net/docs/deweb/home), Massa's decentralized web: its files are stored
  on-chain — there is no RustCore web server to take down or tamper with.

> **Version 1.2.0** — production release ([what's new](CHANGELOG.md)). RustCore Wallet
> works on Massa **mainnet with real funds**. It has not had an independent security audit yet:
> start with small amounts and always keep a backup of your private keys.

## What you can do

| | |
|---|---|
| 🔐 **Stay in control** | Your wallet is locked with a 6-digit PIN and encrypted on your phone. Create new wallets or import existing ones, and keep as many as you like. |
| 💸 **Send & receive** | MAS and Massa tokens. You always see a summary — amount, fee, recipient — before confirming. Receive with a QR code. |
| 🔄 **Swap** | Exchange tokens through the [Dusa](https://dusa.io) exchange, with a live quote and protection against price moves. |
| 🥩 **Stake** | Buy and sell rolls, see whether your wallet is staking, your produced and missed slots, the current APR and your estimated daily reward. |
| 🧾 **History** | Every transaction of your wallet, with full details and a link to the Massa explorer. |
| 🌐 **Domains** | See the `.massa` names your wallet owns. |
| 💲 **Prices** | Token values in USD, read directly from the Dusa exchange. |
| 📲 **Install it** | Add it to your home screen on Android or iPhone and it opens full screen, like a native app. |

Built-in tokens: MAS, PUR, DUSA, USDC.e, WETH.e, DAI.e, WBTC.e, WETH.b, USDT.b on Massa Mainnet;
MAS on Buildnet, the test network. **Any other MRC-20 token** can be added by its contract address
(*Settings → Custom tokens*): the wallet reads its name, symbol and decimals from the contract,
then shows its balance and lets you send it. You can give it an icon from an `https://` or
`ipfs://` link.

## Getting started

RustCore Wallet runs in your **phone's browser** — Android or iPhone, any browser. On a computer
it shows a QR code to open it on your phone instead.

1. **Open it** on your phone: **`wrustcore.massa`** — tap
   [wrustcore.massa.net](https://wrustcore.massa.net) (Massa's official gateway) or open
   `wrustcore.massa` through any DeWeb gateway or [Massa Station](https://station.massa.network).
2. **Install it** (recommended): the wallet offers it at the top of the screen.
   - *Android* — tap **Install app**.
   - *iPhone / iPad* — tap **Share**, then **Add to Home Screen**. Do this **before** creating
     your wallet: on iOS the installed app keeps its own storage, separate from the browser.
3. **Create your PIN**, then **create a new wallet** or **import** one with its private key.
4. **Back up your private key right away**: *Settings → Backup private key*. Write it down and
   keep it offline — it's the only way to recover your wallet.

## Your security & privacy

**What stays on your phone**

- Your wallet, encrypted with your PIN (PBKDF2 with 300 000 iterations, then AES-GCM, using the
  browser's built-in Web Crypto). Without your PIN it can't be read. The PIN itself is never
  stored.
- While the wallet is unlocked, your keys live in memory only; locking it or closing the tab
  drops them.
- A short-lived cache of balances and history, encrypted the same way and deleted when the tab
  closes.
- The tokens you added by contract address, and the icon links you set for them — kept
  unencrypted so the wallet knows what to show. Logging out deletes the list.

**What goes over the network — the complete list**

| Destination | Why |
|---|---|
| The DeWeb gateway you open the wallet from | Delivers the wallet itself, read from the Massa blockchain. |
| `mainnet.massa.net` / `buildnet.massa.net` | Massa's public nodes: balances, rolls, tokens, prices and swaps, and the transactions you confirm. |
| `explorer-api.massa.net` | Your transaction history. |
| Icon links you set for custom tokens (only if you set one) | Loads that icon whenever the token is shown — from the address you entered, or `ipfs.io` for an `ipfs://` link. That server can see your IP address. |

That's all: no RustCore servers, no analytics, no tracking. Links to `explorer.massa.net` and
`docs.massa.net` open only when you tap them.

**Built-in safeguards**

- Every transaction that spends funds shows a review screen and is checked first (balance, fee,
  address) — you confirm before anything is signed.
- Revealing a private key, removing a wallet or logging out asks for your PIN (or the
  extension's password) again.
- In the browser extension, a dApp you connect sees only the wallet you chose for it, and each
  of its requests opens a review window; you can disconnect sites in Settings → Connected sites.
- Swaps are sent with a minimum you'll accept, so the exchange cancels them instead of filling
  at a bad price.

**Good to know**

- **`wrustcore.massa` is the only official address of the wallet.** A copy of the wallet on any
  other address could steal your keys — never enter your PIN or private key anywhere else, and
  never on a site someone sent you in a message. (`rustcore.massa` is the RustCore website; it
  never asks for your key or PIN.)
- **Tokens you add yourself aren't checked by RustCore.** Anyone can create a token with any name
  and symbol, so they're marked *Added by you* and their contract is shown before every send. Add
  one only from a contract address you got from a source you trust. They have no USD price and
  can't be swapped in the wallet.
- A 6-digit PIN protects against casual access. If someone got hold of your phone's stored data,
  a determined attacker could try every PIN offline — keep your phone locked and secure.
- The browser extension (in progress) locks the wallet with a **password** instead: at least 8
  characters, not only digits. On a computer, stored browser data is a common target for
  malware, and a good password can't be guessed offline the way a PIN can.
- The wallet hasn't had an independent audit yet (it's on the [roadmap](#roadmap)).

### Verify it yourself

Every release is [published on GitHub](https://github.com/RustCoreMassa/rust-core-wallet/releases),
built in public from the source code, with checksums you can compare against a build of your own.
See [how to verify a build](docs/RELEASING.md#verifying-a-build).

## FAQ

**I forgot my PIN (or the extension's password).** There is no recovery — it's what encrypts
your wallet on the device, and nobody else has it. Clear this site's data in your browser
settings (on iPhone, remove the installed app from your home screen; for the extension, remove
and reinstall it), open the wallet again and import your private key from your backup.

**I lost my private key.** If you can still unlock the wallet, back the key up now under
*Settings → Backup private key*. Without the key and without access to the app, nobody —
including RustCore — can recover the funds.

**Is there a fee?** RustCore charges nothing. Each transaction pays the Massa network fee
(0.01 MAS), and swaps also send a small storage deposit required by the Dusa exchange
(0.1 MAS).

**I used the wallet at wrustcore.deweb.half-red.net — where is it now?** The wallet moved to
Massa's official gateway, [wrustcore.massa.net](https://wrustcore.massa.net). It's the same app,
but your browser keeps a wallet only at the address where it was created, so it doesn't follow by
itself. Open the old address — it shows the steps: back up the private key of every wallet
(*Settings → Backup private key*), open wrustcore.massa.net, create a PIN and import the keys. If
you installed the app, install it again from the new address. Your funds are on the blockchain,
not in the app: nothing is lost as long as you have your keys.

**Why doesn't it work on my computer?** It's built for phones. A browser extension for desktop is
built and in review at the browser stores; it will be listed here once it's published.

## Roadmap

**Phase 1 — Web wallet** *(live)*
- [x] Encrypted multi-wallet vault with PIN
- [x] Send / receive MAS and Massa tokens
- [x] Transaction history with details
- [x] Staking: rolls, status, APR and rewards
- [x] Swaps through Dusa
- [x] `.massa` domains
- [x] Installable app (Android & iOS)
- [x] Published on DeWeb (`wrustcore.massa`)
- [ ] Import custom tokens from Settings
- [ ] NFT gallery
- [ ] Independent security audit
- [ ] Translations

**Phase 2 — Browser extension** *(in progress)*
- [x] Chromium (Chrome, Edge, Brave) and Firefox builds
- [x] Popup, side panel and full screen
- [x] Connect to Massa dApps and sign their transactions, with a review screen
- [x] Per-site permissions
- [ ] Chrome Web Store, Edge Add-ons and Firefox Add-ons *(in review)*
- [ ] Listed in Massa's wallet library (`@massalabs/wallet-provider`), so dApps find RustCore
  *([proposed](https://github.com/massalabs/wallet-provider/pull/366))*

**Phase 3 — Mobile apps** *(planned)*
- [ ] iOS and Android apps
- [ ] Biometric unlock (Face ID / fingerprint)
- [ ] Notifications for incoming transfers

**Later**
- [ ] Hardware-wallet support

## Community

Questions, ideas, or want to follow what's next? Join the RustCore community on Telegram:
**[t.me/rustcore_massa](https://t.me/rustcore_massa)**. Admins never message you first and
never ask for your private key, PIN or password — anyone who does is a scammer.

## Support the project

RustCore Wallet is free and built in the open. If it's useful to you and you'd like to help fund
its development (the browser extension, mobile apps and a security audit), you can send a
voluntary donation in MAS or any Massa token to:

```
AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P
```

Donations are entirely optional and don't unlock any features — the wallet is the same for
everyone. Before sending, always check the address against this README in the official
repository — nobody from RustCore will ever DM you asking for funds or give you a different
address.

Not in a position to donate? Starring the repository, reporting bugs and spreading the word help
just as much.

## Contributing

Bug reports, ideas and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how
to run the wallet locally and the rules that keep it safe.

## Security

Found a vulnerability? Please **don't open a public issue** — report it privately through
GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" on the repository's Security tab), with steps to reproduce, and give
us reasonable time to fix it before disclosing it publicly.

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

Copyright © 2026 Whisky098. All rights reserved except as granted by the license.

## Disclaimer

RustCore Wallet is provided "as is", without warranty of any kind. You are solely responsible for
your private keys and your funds: whoever holds a private key controls the funds, and lost keys
cannot be recovered by anyone. Blockchain transactions are irreversible. RustCore is not
affiliated with Massa Labs or Dusa.
