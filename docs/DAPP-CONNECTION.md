# Connecting dApps — architecture

Status: **design, not implemented yet** (branch `dapp-connect`). This document is for developers.
It describes how Massa dApps will connect to the RustCore Wallet browser extension and ask it to
sign.

## Goal

A Massa dApp should be able to:

1. find RustCore Wallet the same way it finds Bearby, Massa Station or MetaMask;
2. ask to connect, and get one address once the user approves;
3. ask for transfers, smart-contract calls, rolls and message signatures, each shown to the user
   on a review screen before anything is signed.

Private keys never leave the wallet. A dApp only ever receives addresses, signatures and
operation ids.

## How dApps find wallets today

dApps use [`@massalabs/wallet-provider`](https://github.com/massalabs/massa-wallet-provider)
(3.3.0 checked). Its wallet list is fixed: `supportedWallets = [BearbyWallet, MassaStationWallet,
MetamaskWallet]`, and `getWallets()` calls each class's static `createIfInstalled()`. Each class
implements the library's `Wallet` interface and returns accounts implementing massa-web3's
`Provider`. So:

- our extension exposes an API to web pages (this document);
- a `RustCoreWallet` / `RustCoreAccount` pair in wallet-provider talks to that API — a PR to
  massalabs, opened once our side works (issue drafted first);
- dApps see us after they update the library.

Bearby and MetaMask answer `importAccount`, `deleteAccount` and `generateNewAccount` with
`Method not implemented` — we do the same: a website must never hand a private key to the wallet.

## Overview

```
 web page (dApp)                         extension
┌──────────────────────────┐   ┌────────────────────────────────────────────────────────┐
│ dApp code                │   │                                                        │
│   └ wallet-provider      │   │  content.js (isolated world, every https page)         │
│       └ RustCoreAccount  │   │     │  adds the page's origin, never trusts the page   │
│            │             │   │     ▼                                                  │
│ inpage.js (main world)   │   │  background.js ── permissions (chrome.storage.local)   │
│   window.rustcore ◄──────┼───┼──►  request queue, routing, events                     │
│   (postMessage)          │   │     │  needs a signature?                              │
└──────────────────────────┘   │     ▼                                                  │
                               │  approval window: index.html?view=approve              │
                               │   the Angular app: unlock (PIN) → review → sign → send │
                               └────────────────────────────────────────────────────────┘
```

**Who signs:** only the approval window — the same Angular app as the popup, with the same
AuthStore, MassaProvider, validation and Review screen. The background worker never decrypts
the vault and never sees a private key; it only routes messages and keeps permissions.

**Reads don't go through the wallet.** `balanceOf`, `readSC`, `getEvents`, `getStorageKeys`,
`readStorage`, `getOperationStatus`, `getNodeStatus`, `executeSCReadOnly` need no key. The
`RustCoreAccount` class in wallet-provider runs them itself with a `JsonRpcPublicProvider` on the
wallet's current network. That keeps the bridge small, and the extension makes no network calls
on a dApp's behalf beyond the transactions the user approves.

## Components

### 1. `inpage.js` — main world, every https page

A content script registered with `"world": "MAIN"` and `"run_at": "document_start"` (Chrome 111+,
Firefox 128+; our minimums are 116 and 140), so it exists before the dApp's code runs. No
`web_accessible_resources` and no `<script>` tag injection needed.

Defines a frozen `window.rustcore`:

```ts
interface RustCoreInjected {
  readonly isRustCore: true;
  readonly version: string;                  // protocol version, "1"
  request(method: string, params?: unknown): Promise<unknown>;
  on(event: 'accountChanged' | 'networkChanged' | 'disconnect', cb: (data: unknown) => void): () => void;
}
```

`request` posts `{ channel: 'rustcore:v1', id, method, params }` to the window and resolves on the
matching reply. It holds no state and no secrets — the page could forge every message it sends
anyway, so nothing here is trusted.

### 2. `content.js` — isolated world, every https page

Relays between the page and the background through one long-lived `chrome.runtime.connect` port
per page:

- accepts only messages from `window` itself with the right `channel`, valid `id` and a known
  `method` string; drops anything else;
- size limit per message (e.g. 256 KB — enough for a `callSC` parameter);
- never adds the origin itself: the background takes it from `port.sender` (`origin` /
  `tab.url`), which the browser fills in and the page can't fake.

Runs only in top frames (`all_frames: false`): a dApp inside someone else's iframe can't ask.

### 3. Background worker — router, permissions, queue

The existing `background.ts` grows into the bridge's centre (still no Angular in it):

- **Permissions** in `chrome.storage.local` under `rustcore:dapp-permissions`:
  `{ [origin]: { address, grantedAt } }` — one connected account per site (the same address on
  every network; requests are signed on the wallet's current network). Addresses are
  stored in clear (they're public on-chain) so a connected site can be answered while the wallet
  is locked; the list is shown and revocable in Settings → Connected sites.
- **Requests needing the user** (`connect`, signatures) go into a queue, at most one pending per
  origin and a small global cap; extras are rejected with "busy". Each opens (or reuses) the
  approval window; closing it rejects the request (`windows.onRemoved`).
- **Events:** when a site's connected account or the wallet's network changes
  (`chrome.storage.onChanged`), the background notifies that site's ports. Revoking a site sends
  `disconnect`.
- Validates every request's params (types, ranges, string/byte limits) before showing anything.

### 4. Approval view — the Angular app

New extension view `approve` (`index.html?view=approve&request=<id>`, `EXTENSION_VIEWS`), opened
with `chrome.windows.create({ type: 'popup', width: 380, height: 600 })`; on Firefox for Android,
which has no `windows` API, as a tab.

1. Fetches the pending request from the background by id.
2. If locked, asks for the PIN (`AuthStore.resume()` / unlock — the normal lock screen).
3. Shows the request with `app-confirm-details`: the **origin** (large, as the browser reported
   it), account, network, and what will happen (below).
4. On approve: runs the same `validate*` rules as the wallet's own screens (fee reserved,
   balances, min amounts), signs and sends with the existing `MassaProvider` code, answers the dApp
   with the operation id as soon as the node accepted it, then waits for execution and records
   it in the wallet's history like any other operation (`afterWrite`).
5. On reject / close: answers `UserRejected`.

What the review shows per request:

| Request | Shown |
|---|---|
| `connect` | origin, which account to share (default: active), network |
| `transfer` | recipient, amount, fee |
| `buyRolls` / `sellRolls` | roll count, MAS cost/return, fee |
| `callSC` | contract, function, coins sent, fee, max gas, raw parameter size/hex; a **simulation** (`readSC` with the user as caller, same coins) — if it fails, the error is shown and Approve is disabled. Known calls are decoded: MRC-20 `transfer`, `increaseAllowance` / `approve` of tokens in `TOKEN_REGISTRY` (amount in the token's units, spender; a warning for huge allowances), Dusa router swaps |
| `sign` | the message as text if it's printable UTF-8, else hex; a warning that signing can authorize things |

## Protocol v1

Requests from the page: `request(method, params)`. Values cross the bridge as JSON: `bigint` as
decimal strings, bytes as base64 (as wallet-provider already does for Bearby).

| Method | Needs connection | User approval | v1 |
|---|---|---|---|
| `connect` | — | yes (once per site) | ✓ |
| `disconnect` | yes | no | ✓ |
| `connected`, `account`, `network` | — / yes / yes | no | ✓ |
| `sign` | yes | yes | ✓ |
| `transfer` | yes | yes | ✓ |
| `buyRolls`, `sellRolls` | yes | yes | ✓ |
| `callSC` | yes | yes | ✓ |
| `executeSC` (raw bytecode) | — | — | rejected: arbitrary bytecode can't be reviewed |
| `deploySC` | — | — | rejected in v1 |
| `importAccount`, `deleteAccount`, `generateNewAccount`, `setRpcUrl` | — | — | rejected, like Bearby/MetaMask |

Errors carry a `code`: `4001` user rejected, `4100` not connected / not allowed, `4200`
unsupported method, `4900` wallet busy, `-32602` invalid params, `-32603` internal (message from
`toUserMessage`, never a raw node error).

The dApp chooses `fee`/`maxGas` hints, but the wallet enforces its own minimum fee (0.01 MAS) and
caps; the review shows what will actually be sent.

## Manifest changes

```jsonc
"content_scripts": [
  { "matches": ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    "js": ["inpage.js"], "run_at": "document_start", "world": "MAIN" },
  { "matches": ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    "js": ["content.js"], "run_at": "document_start" }
]
```

- Chrome shows "Read and change your data on all websites" — the same as every injected wallet
  (MetaMask, Bearby). Store listings must explain it: the scripts only add `window.rustcore` and
  read nothing from the page.
- In Firefox, users can withdraw these site permissions at any time (and older Firefox versions
  didn't grant MV3 host permissions at install). Settings checks `permissions.contains` and shows
  "Allow RustCore on websites" with a `permissions.request` button when they're missing.
- `http://localhost` / `127.0.0.1` are for dApp developers.
- No new network destinations: approved transactions go to the same Massa nodes as today
  (README list unchanged). The read calls listed above are made by the dApp's own copy of
  wallet-provider, from the dApp's page.

## Security rules

- The origin always comes from the browser (`port.sender`), never from message content.
- No address is revealed before `connect` is approved; `connected` answers `false` for unknown
  sites (no probing which wallet a visitor has beyond "RustCore is installed").
- Every signature is approved individually. No "remember", no batch approval, no blind signing of
  bytecode in v1.
- The approval window is an extension page — dApps can't frame or script it.
- Requests expire (e.g. 10 minutes) and are rejected if the site disconnects or the tab closes.
- Network: requests are signed on the wallet's current network; if a dApp asks for a specific
  chain id and it differs, the request is rejected (no silent switch).
- The vault, the PIN and the session key stay where they are today; the background still only
  ends sessions (auto-lock) and never decrypts anything.

## Scope: the browser extension only

dApp connections are an extension feature. The mobile web wallet won't get them (decided
2026-10-02): a web page can't inject a provider into other sites, the main dApp (Dusa) refuses
to be framed, and redirects break on iPhone, where home-screen apps don't share storage with
Safari.

Firefox for Android runs the extension, so it gets the bridge as is (the approval opens as a tab,
as that browser has no `windows` API). The bridge is still kept independent of its transport,
so future native apps could reuse protocol v1 in their own dApp browser.

## Implementation plan

1. **Protocol module** (`src/extension/dapp/protocol.ts`): method list, param validation, error
   codes, JSON encoding of bigint/bytes — pure TS with unit tests.
2. **Permissions store** (`dapp/permissions.ts`) over `chrome.storage.local` — unit tests with the
   existing fake storage.
3. **inpage.js + content.js** bundled by `scripts/build-extension.mjs` (esbuild, IIFE, like the
   background); manifest `content_scripts`; smoke test that a page gets `window.rustcore`.
4. **Background router**: ports, queue, approval window lifecycle, events — unit tests with fake
   `chrome.runtime` / `chrome.windows`.
5. **Approval view** in the app: route + `approve` view, connect / transfer / rolls / sign first,
   then `callSC` with simulation and MRC-20/Dusa decoding. New `MassaProvider` methods
   (`callSC`, `signMessage`) with the same tests as the existing writes in `wallet-store.spec`.
6. **Settings → Connected sites** (list, change account, revoke) and Firefox's host-permission
   prompt.
7. **Test dApp page** (`scripts/test-dapp/`, local only) exercising every method against
   **buildnet**; mainnet only through `readSC` simulations, never real transactions.
8. **wallet-provider PR**: `RustCoreWallet` / `RustCoreAccount` over `window.rustcore`, tested
   against the test page, then against a real dApp with a locally linked build.
9. Docs: README (what connecting a site means, permissions), store listings, CHANGELOG.

## Decisions

- **One connected account per site** (2026-10-02). The site sees only that address, even when
  the user switches the active wallet; it changes only from Settings → Connected sites.
  wallet-provider's `accounts()` returns a list, so several accounts can come later without
  breaking dApps.
- **`sign` is in v1**, shown as text when printable, else hex, with a warning.
- **Approval window: 380 × 600**, the popup's size.

## Progress

- [x] Protocol module — `src/extension/dapp/protocol.ts` (+ spec)
- [x] Permissions store — `src/extension/dapp/permissions.ts` (+ spec)
- [ ] inpage.js + content.js, manifest, build
- [ ] Background router
- [ ] Approval view
- [ ] Settings → Connected sites
- [ ] Test dApp page (buildnet)
- [ ] wallet-provider PR
