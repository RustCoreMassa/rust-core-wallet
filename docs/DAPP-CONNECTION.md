# Connecting dApps — architecture

Status: **implemented** (released in 1.2.0; several accounts per site in 1.6.0 — see Progress at
the end). wallet-provider's `RustCoreWallet` is merged
([#366](https://github.com/massalabs/wallet-provider/pull/366)); its update for several accounts
is the next PR. This document is for developers. It describes how Massa dApps connect to the RustCore
Wallet browser extension and ask it to sign.

## Goal

A Massa dApp should be able to:

1. find RustCore Wallet the same way it finds Bearby, Massa Station or MetaMask;
2. ask to connect, and get the addresses the user chooses to share once they approve;
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
- a `RustCoreWallet` / `RustCoreAccount` pair in wallet-provider talks to that API — merged in
  [#366](https://github.com/massalabs/wallet-provider/pull/366) (one account per site); a
  follow-up adds several accounts (`accounts()`, `from` on each signature);
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
                               │   the Angular app: unlock → review → sign → send       │
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
  on(event: 'accountChanged' | 'accountsChanged' | 'networkChanged' | 'disconnect', cb: (data: unknown) => void): () => void;
}
```

`request` posts `{ channel: 'rustcore:v1', to: 'wallet', id, method, params }` to the window and
resolves on the matching `to: 'page'` reply (both scripts share the window, so every message
says which way it goes). Once defined, `window.rustcore` is read-only and the page gets a
`rustcore#initialized` event, for scripts that ran first. It holds no state and no secrets — the page could forge every message it sends
anyway, so nothing here is trusted.

### 2. `content.js` — isolated world, every https page

Relays between the page and the background through one long-lived `chrome.runtime.connect` port
per page:

- accepts only messages from `window` itself with the right `channel`, valid `id` and a known
  `method` string; drops anything else;
- size limit per message (e.g. 256 KB — enough for a `callSC` parameter);
- never adds the origin itself: the background takes it from `port.sender` (`origin` /
  `tab.url`), which the browser fills in and the page can't fake;
- opens the port only on the page's first request. The port carries requests and their replies
  only: it closes whenever the browser stops the idle background worker (~30 s in Chromium), and
  the page opens a new one only with its next request — so **events come as tab messages**
  (`chrome.runtime.onMessage`, sent with `chrome.tabs.sendMessage`), and are relayed to the page
  only if their `origin` is the page's own (the tab may have moved to another site since).

Runs only in top frames (`all_frames: false`): a dApp inside someone else's iframe can't ask.

### 3. Background worker — router, permissions, queue

The existing `background.ts` grows into the bridge's centre (still no Angular in it):

- **Permissions** in `chrome.storage.local` under `rustcore:dapp-permissions`:
  `{ [origin]: { addresses, followsWallet, grantedAt } }` — the accounts the site may see, never
  empty, the one it uses now first (the same addresses on every network; requests are signed on
  the wallet's current network). `followsWallet` turns true the first time the site asks for
  `accounts` or names a signer with `from` (see Decisions). Sites saved before several accounts
  per site (`{ address, grantedAt }`) are read as that one account, not following the wallet,
  and rewritten at the next change. Changes run one at a time, so two sites asking at once
  can't overwrite each other's. Addresses are
  stored in clear (they're public on-chain) so a connected site can be answered while the wallet
  is locked; the list is shown and revocable in Settings → Connected sites.
- **Requests needing the user** (`connect`, signatures) go into a queue, at most one pending per
  origin and a small global cap; extras are rejected with "busy". The exception is a second
  `connect` from a site whose `connect` is already waiting (the same page again, or another tab of
  the site): it joins the waiting one and gets the same answer. Each opens (or reuses) the
  approval window; closing it rejects the request (`windows.onRemoved`).
- **Events:** when a site's accounts or the wallet's network change
  (`chrome.storage.onChanged`, which also wakes a stopped worker), the background sends the event
  to every tab showing that site with `chrome.tabs.sendMessage` (top frame; no extra permission).
  It learns a tab when the tab's page opens a port (`port.sender.tab.id`) and keeps
  `{ [tabId]: origin }` in `chrome.storage.session` under `rustcore:dapp-tabs`, so the list
  outlives the worker; a closed tab (`tabs.onRemoved`) or one where nothing answers is
  forgotten. A new account in use sends `accountChanged`, any change to the list
  `accountsChanged`; revoking a site sends `disconnect`. A waiting request is dropped (`4100`)
  only when the account that signs it is taken away from the site.
- Validates every request's params (types, ranges, string/byte limits) before showing anything.

### 4. Approval view — the Angular app

New extension view `approve` (`index.html?view=approve&request=<id>`, `EXTENSION_VIEWS`), opened
with `chrome.windows.create({ type: 'popup', width: 380, height: 600 })`; on Firefox for Android,
which has no `windows` API, as a tab.

1. Fetches the pending request from the background by id.
2. If locked, asks for the password (`AuthStore.resume()` / unlock — the normal lock screen).
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
| `connect` | origin, which accounts to share (ticked; the active wallet comes ticked), network |
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
| `connected`, `account`, `accounts`, `network` | — / yes / yes / yes | no | ✓ |
| `sign` | yes | yes | ✓ |
| `transfer` | yes | yes | ✓ |
| `buyRolls`, `sellRolls` | yes | yes | ✓ |
| `callSC` | yes | yes | ✓ |
| `executeSC` (raw bytecode) | — | — | rejected: arbitrary bytecode can't be reviewed |
| `deploySC` | — | — | rejected in v1 |
| `importAccount`, `deleteAccount`, `generateNewAccount`, `setRpcUrl` | — | — | rejected, like Bearby/MetaMask |

Params (amounts in smallest units, as decimal strings; `?` = optional):

| Method | Params |
|---|---|
| `connect`, `disconnect`, `connected`, `account`, `accounts`, `network` | none (`undefined`, `null` or `{}`) |
| `sign` | `data` (base64, ≤ 16 KB), `from?` |
| `transfer` | `to`, `amount`, `fee?`, `from?` |
| `buyRolls`, `sellRolls` | `rolls`, `fee?`, `from?` |
| `callSC` | `target`, `func`, `parameter?` (base64), `coins?`, `fee?`, `maxGas?`, `from?` |

`from` names which of the site's accounts signs (an `AU…` address it was given); without it, the
account it uses now signs. An account the site may not use is refused with `4100` before anything
is shown to the user. Asking for `accounts`, or sending `from`, tells the wallet the site handles
several accounts: from then on it follows the wallet the user switches to.

Answers: `connect` → `{ address, addresses }` (the account in use, and every account the site may
see, that one first); `account` → `{ address }`; `accounts` → `{ addresses }`; `connected` →
boolean; `network` →
`{ name, chainId, url, minimalFee }`; `sign` → massa-web3's `SignedData`; `transfer`, `buyRolls`,
`sellRolls`, `callSC` → `{ operationId, network }`, where `network` (same shape as `network`'s
answer) is the one the operation was sent on — follow its status on that node: the user may
switch network before the answer arrives, and events travel apart from answers, so a
`networkChanged` can come after it.

A key the method doesn't take is refused with `-32602` (`Unsupported params: …`) instead of being
ignored — the site would otherwise believe it was applied (e.g. `periodToLive`, which the wallet
sets itself).

Errors carry a `code`: `4001` user rejected, `4100` not connected / not allowed, `4200`
unsupported method, `4900` wallet busy, `-32602` invalid params, `-32603` internal (message from
`toUserMessage`, never a raw node error).

The dApp chooses `fee`/`maxGas` hints, but the wallet enforces its own minimum fee (0.01 MAS) and
caps: a lower `fee` is raised to 0.01 MAS, a higher one is paid as asked and reserved from the
balance like the wallet's own. The review shows what will actually be sent.

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
- The vault, the password and the session key stay where they are today; the background still only
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

- ~~One connected account per site~~ (2026-10-02) → **several accounts per site, as MetaMask**
  (2026-10-20). At `connect` the user ticks the accounts to share (the active wallet comes
  ticked). A site that follows the wallet (below) uses the wallet's most recently active account
  among them: switching wallets moves every such site that may see the new one
  (`accountChanged`); the wallet the app opens with moves nothing (after a lock it is just the
  first wallet). When the site in the active tab is connected, but not to the active wallet,
  Home says so and offers to connect it (the popup asks the tab's content script for its origin
  — no `tabs` permission). Settings → Connected sites lists each site's accounts, the one in use
  first, to add or take away.
- **Only sites that handle several accounts follow wallet switches** (2026-10-21). Rolled back
  once before release (2026-10-20) because wallet-provider's first `RustCoreWallet` (#366)
  shares one account and signs without `from`: if a switch moved its site, a signature could
  come from another account than the one the dApp shows. Fix: a site follows the wallet only
  once it asked for `accounts` or named a signer with `from` — which only the updated
  wallet-provider does (it asks `accounts` right after connecting). Other sites (older
  wallet-provider, sites connected before 1.6.0) keep the account they use, exactly as in 1.5;
  it changes only by hand: Home says "<site> uses another account" with a button to use the
  active wallet there, and Connected sites has a Use button and a note. Their signatures without
  `from` therefore always come from the account the dApp was given.
- **`sign` is in v1**, shown as text when printable, else hex, with a warning.
- **Approval window: 380 × 600**, the popup's size.

## Progress

- [x] Protocol module — `src/extension/dapp/protocol.ts` (+ spec)
- [x] Permissions store — `src/extension/dapp/permissions.ts` (+ spec)
- [x] inpage.js + content.js, manifest, build — `dapp/inpage.ts`, `dapp/content.ts` (+ `bridge.spec`),
  `npm run smoke:extension` checks a page gets `window.rustcore`.
- [x] Background router — `dapp/router.ts` (+ spec), `dapp/approval-window.ts`, wired in
  `background.ts`; smoke checks the worker starts and listens. The approval window talks to it
  with `runtime.sendMessage` (`rustcore:approval:next` / `:resolve` / `:reject`, `dapp/approval.ts`,
  accepted only from extension pages) and keeps a `rustcore:approval` port open, pinging every
  20 s so the browser doesn't stop the worker (and lose the queue) while the user decides.
- [x] Approval view — connect, sign, transfer, rolls: `features/approve/approve-page` (+ spec),
  route `/approve` (extension only; the lock screen returns to it), `DAPP_APPROVALS`
  (`extension/dapp/approval-channel.ts`). WalletStore `dapp*` methods take the connected wallet's
  id and never switch the active wallet (it's saved in the session cache the popup restores);
  amounts are exact units. An operation that failed on-chain still goes back to the site with its
  id; anything that failed before sending keeps the request open.
- [x] Approval view — `callSC`: run read-only first as the connected account (`readSC`,
  `simulateCall`), Approve off while checking and when the test run fails (plain message via
  `rejectedCallMessage`, raw VM error to the console only); `core/utils/describe-call.ts` decodes
  MRC-20 `transfer` / `increaseAllowance` / `decreaseAllowance` / `transferFrom` on the supported
  tokens and Dusa V2 router swaps (mainnet), only when the parameters decode completely; warns
  about unlimited allowances, unknown spenders, swaps paying another address and unreadable calls.
  Fee = the site's, never below 0.01 MAS; gas limit within the network's bounds. Verified with
  read-only calls on mainnet only.
- [x] Settings → Connected sites — `features/modals/connected-sites-modal` (+ spec), `CONNECTED_SITES`
  (`extension/dapp/connected-sites.ts`, + spec): list, change a site's account, disconnect. Removing
  a wallet disconnects its sites; log out disconnects all. The router tells the sites through
  the storage events.
- [x] Site access — `SITE_ACCESS` (`extension/dapp/site-access.ts`, + spec): checks
  `permissions.contains` (follows `onAdded` / `onRemoved`); when the browser has withdrawn it
  (Firefox's Permissions tab, Chromium's Site access), Connected sites explains it and asks with
  `permissions.request` straight from the click, and the Settings row says so. Not yet tried in a
  real browser.
- [x] Test dApp page — `scripts/test-dapp/` (`npm run test-dapp`, http://127.0.0.1:4300): every
  method, signature verified on the page, writes only while the wallet answers `network` with
  buildnet (checked again before each), WMAS presets on buildnet (wrap, unwrap, transfer,
  allowance, unlimited allowance, a wrap with 0 coins whose simulation fails — presets checked
  with buildnet `readSC`), operations followed to finality, 24 protocol checks (expected error
  codes, run against `parseRequest` in jsdom) and a busy test (4900, then 4001). Not yet tried
  with the real extension in a browser.
- [x] Follow-ups from the wallet-provider review (massalabs/wallet-provider#366): optional `fee`
  on `transfer` / `buyRolls` / `sellRolls` (shown in the review, never below 0.01 MAS); unknown
  params refused with `-32602`; a repeated `connect` joins the waiting one; events sent to the
  site's tabs (`dapp/site-tabs.ts`) instead of over ports that close with the idle worker. The
  test page has a fee field for transfer and rolls and 27 protocol checks.
- [x] Operation answers carry the network they were sent on (`{ operationId, network }`): the
  approval window reports the network it sent on, the background answers that network's details
  (#366 review: a network switch during the prompt sent status polling to the wrong node).
- [x] wallet-provider PR — [massalabs/wallet-provider#366](https://github.com/massalabs/wallet-provider/pull/366),
  merged 2026-10-19 (first in the `3.3.2-dev` build on npm).
- [x] Several accounts per site, as MetaMask (see Decisions): permissions hold `addresses`,
  `accounts` method, `from` on everything signed, `accountsChanged` event, ticks at `connect`,
  `SiteConnection` (follows the active wallet, Home notice), Connected sites lists accounts. The
  test page has an `accounts` button, a `from` field and the new protocol checks.
- [x] Older dApps don't follow wallet switches (`followsWallet`, see Decisions): Home notice
  "uses another account", Use button in Connected sites; permission changes serialized.
- [ ] wallet-provider update for several accounts (`accounts()`, `from`, `accountsChanged`).
