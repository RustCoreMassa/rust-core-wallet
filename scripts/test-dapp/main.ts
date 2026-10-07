// Test dApp for the dApp connection (docs/DAPP-CONNECTION.md, step 7): a local page that calls
// every window.rustcore method, so the bridge and the approval window can be tried in a real
// browser. Run with `npm run test-dapp` (scripts/test-dapp/serve.mjs).
//
// Real funds rule: transfers, rolls and contract calls are sent only while the wallet answers
// `network` with buildnet — checked again right before each one. Signing sends nothing.
import {
  Address,
  Args,
  JsonRpcPublicProvider,
  MRC20,
  Mas,
  OperationStatus,
  PublicKey,
  Signature,
} from '@massalabs/massa-web3';
import type { RustCoreInjected } from '../../src/extension/dapp/inpage';
import { DappErrorCode, NetworkInfo, toBase64 } from '../../src/extension/dapp/protocol';

declare global {
  interface Window {
    rustcore?: RustCoreInjected;
  }
}

/** Wrapped MAS on buildnet (massa-web3's WMAS.buildnet). */
const WMAS_BUILDNET = 'AS12FW5Rs5YN2zdpEnqwj4iHUUPt9R4Eqjq2qtpJFNKW3mn33RuLU';
const U256_MAX = (1n << 256n) - 1n;
/** How long a check may wait for its error before we assume it opened an approval instead. */
const CHECK_TIMEOUT_MS = 3000;

type Outcome = { ok: true; value: unknown } | { ok: false; code: number; message: string };

let wallet: RustCoreInjected | null = null;
let account: string | null = null;
let network: NetworkInfo | null = null;

// ------------------------------------------------------------------ page helpers

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el as T;
}

function value(id: string): string {
  return $<HTMLInputElement>(id).value.trim();
}

function log(kind: 'ok' | 'err' | 'info' | '', text: string, data?: unknown): void {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  const body = document.createElement('span');
  body.className = kind;
  body.textContent = data === undefined ? text : `${text} ${JSON.stringify(data, null, 2)}`;
  li.append(time, body);
  $('log').prepend(li);
}

function on(id: string, handler: () => unknown): void {
  $(id).addEventListener('click', () => {
    Promise.resolve(handler()).catch((err: unknown) => log('err', `Page error: ${String(err)}`));
  });
}

/** Enables each button by what it needs: the extension, a connection, or buildnet. */
function updateButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-needs]')) {
    const needs = button.dataset['needs'];
    button.disabled =
      !wallet ||
      (needs === 'connected' && !account) ||
      (needs === 'buildnet' && (!account || network?.name !== 'buildnet'));
  }
}

// ------------------------------------------------------------------ talking to the wallet

/** One request, logged with its answer. */
async function call(method: string, params?: unknown, quiet = false): Promise<Outcome> {
  if (!wallet) return { ok: false, code: 0, message: 'RustCore is not installed' };
  if (!quiet) log('', `→ ${method}`, params);
  try {
    const result = await wallet.request(method, params);
    if (!quiet) log('ok', `← ${method}`, result);
    return { ok: true, value: result };
  } catch (err) {
    const { code, message } = err as { code?: number; message?: string };
    if (!quiet) log('err', `← ${method} failed: [${code}] ${message}`);
    return { ok: false, code: code ?? 0, message: message ?? String(err) };
  }
}

async function refresh(): Promise<void> {
  const connected = await call('connected', undefined, true);
  account = null;
  network = null;
  if (connected.ok && connected.value === true) {
    const a = await call('account', undefined, true);
    const n = await call('network', undefined, true);
    if (a.ok) account = (a.value as { address: string }).address;
    if (n.ok) network = n.value as NetworkInfo;
  }
  $('s-ext').textContent = wallet ? `RustCore, protocol v${wallet.version}` : 'not found';
  $('s-connected').textContent = connected.ok
    ? String(connected.value)
    : `– (${connected.message})`;
  $('s-account').textContent = account ?? '–';
  $('s-network').textContent = network ? `${network.name} (chain ${network.chainId})` : '–';
  $('s-mas').textContent = '–';
  $('s-wmas').textContent = '–';
  if (!$<HTMLInputElement>('to').value && account) $<HTMLInputElement>('to').value = account;
  updateButtons();
  if (account && network) await showBalances(account, network);
}

/** Reads balances ourselves, like wallet-provider's RustCoreAccount will: reads need no wallet. */
async function showBalances(address: string, net: NetworkInfo): Promise<void> {
  try {
    const provider = JsonRpcPublicProvider.fromRPCUrl(net.url);
    const [mas] = await provider.balanceOf([address], false);
    $('s-mas').textContent = Mas.toString(mas.balance);
    if (net.name === 'buildnet') {
      const wmas = await new MRC20(provider, WMAS_BUILDNET).balanceOf(address);
      $('s-wmas').textContent = Mas.toString(wmas);
    }
  } catch (err) {
    log('err', `Balance read failed: ${String(err)}`);
  }
}

/**
 * Sends a write only if the wallet is on buildnet right now, then follows the operation until
 * it's final.
 */
async function write(method: string, params: Record<string, unknown>): Promise<void> {
  const n = await call('network', undefined, true);
  if (!n.ok || (n.value as NetworkInfo).name !== 'buildnet') {
    log('err', `${method} not sent: the wallet is not on buildnet`);
    await refresh();
    return;
  }
  const outcome = await call(method, params);
  if (outcome.ok) await follow((outcome.value as { operationId: string }).operationId);
}

async function follow(operationId: string): Promise<void> {
  if (!network) return;
  const provider = JsonRpcPublicProvider.fromRPCUrl(network.url);
  let last: OperationStatus | null = null;
  for (let i = 0; i < 90; i++) {
    const status = await provider.getOperationStatus(operationId).catch(() => null);
    if (status !== null && status !== last) {
      last = status;
      const failed =
        status === OperationStatus.Error || status === OperationStatus.SpeculativeError;
      log(failed ? 'err' : 'info', `${operationId.slice(0, 12)}… ${OperationStatus[status]}`);
      if (failed) {
        const events = await provider.getEvents({ operationId }).catch(() => []);
        for (const event of events) log('err', `event: ${event.data}`);
      }
      if (status === OperationStatus.Success || status === OperationStatus.Error) break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await refresh();
}

// ------------------------------------------------------------------ actions

async function sign(data: Uint8Array): Promise<void> {
  const outcome = await call('sign', { data: toBase64(data) });
  if (!outcome.ok) return;
  const { publicKey, signature } = outcome.value as { publicKey: string; signature: string };
  const key = PublicKey.fromString(publicKey);
  const valid = await key.verify(data, Signature.fromString(signature));
  const owner = Address.fromPublicKey(key).toString();
  log(valid ? 'ok' : 'err', `Signature ${valid ? 'is valid' : 'is NOT valid'}`);
  log(owner === account ? 'ok' : 'err', `Public key belongs to ${owner}`);
}

function wmasCall(func: string, args: Args, coins = 0n): Promise<void> {
  const parameter = args.serialize();
  return write('callSC', {
    target: WMAS_BUILDNET,
    func,
    ...(parameter.length > 0 && { parameter: toBase64(parameter) }),
    coins: coins.toString(),
  });
}

function customCall(): Promise<void> {
  const hex = value('c-param').replace(/^0x/, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) {
    log('err', 'Parameter must be hex bytes');
    return Promise.resolve();
  }
  const parameter = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  return write('callSC', {
    target: value('c-target'),
    func: value('c-func'),
    ...(parameter.length > 0 && { parameter: toBase64(parameter) }),
    coins: Mas.fromString(value('c-coins') || '0').toString(),
    ...(value('c-fee') && { fee: Mas.fromString(value('c-fee')).toString() }),
    ...(value('c-gas') && { maxGas: value('c-gas') }),
  });
}

interface Check {
  readonly label: string;
  readonly method: string;
  readonly params?: unknown;
  readonly expect: number;
}

/** Requests the wallet must refuse straight away, each with its protocol v1 error code. */
function checks(connected: boolean, self: string): Check[] {
  const { InvalidParams, UnsupportedMethod, Unauthorized } = DappErrorCode;
  const list: Check[] = [
    { label: 'unknown method', method: 'foo', expect: UnsupportedMethod },
    { label: 'executeSC is refused', method: 'executeSC', params: {}, expect: UnsupportedMethod },
    { label: 'deploySC is refused', method: 'deploySC', params: {}, expect: UnsupportedMethod },
    { label: 'importAccount is refused', method: 'importAccount', expect: UnsupportedMethod },
    { label: 'deleteAccount is refused', method: 'deleteAccount', expect: UnsupportedMethod },
    {
      label: 'generateNewAccount is refused',
      method: 'generateNewAccount',
      expect: UnsupportedMethod,
    },
    { label: 'setRpcUrl is refused', method: 'setRpcUrl', expect: UnsupportedMethod },
    { label: 'transfer: no params', method: 'transfer', expect: InvalidParams },
    {
      label: 'transfer: bad address',
      method: 'transfer',
      params: { to: 'AU1nope', amount: '1' },
      expect: InvalidParams,
    },
    {
      label: 'transfer: amount as a number',
      method: 'transfer',
      params: { to: self, amount: 1 },
      expect: InvalidParams,
    },
    {
      label: 'transfer: decimal amount',
      method: 'transfer',
      params: { to: self, amount: '0.5' },
      expect: InvalidParams,
    },
    {
      label: 'transfer: negative amount',
      method: 'transfer',
      params: { to: self, amount: '-1' },
      expect: InvalidParams,
    },
    {
      label: 'transfer: zero',
      method: 'transfer',
      params: { to: self, amount: '0' },
      expect: InvalidParams,
    },
    { label: 'buyRolls: zero', method: 'buyRolls', params: { rolls: '0' }, expect: InvalidParams },
    { label: 'sign: empty', method: 'sign', params: { data: '' }, expect: InvalidParams },
    {
      label: 'sign: not base64',
      method: 'sign',
      params: { data: 'hello!' },
      expect: InvalidParams,
    },
    {
      label: 'sign: over 16 KB',
      method: 'sign',
      params: { data: toBase64(new Uint8Array(16 * 1024 + 1)) },
      expect: InvalidParams,
    },
    {
      label: 'callSC: user address as target',
      method: 'callSC',
      params: { target: self, func: 'f' },
      expect: InvalidParams,
    },
    {
      label: 'callSC: bad function name',
      method: 'callSC',
      params: { target: WMAS_BUILDNET, func: '1 + 1' },
      expect: InvalidParams,
    },
    {
      label: 'callSC: zero max gas',
      method: 'callSC',
      params: { target: WMAS_BUILDNET, func: 'deposit', maxGas: '0' },
      expect: InvalidParams,
    },
  ];
  if (!connected) {
    list.push(
      { label: 'account before connect', method: 'account', expect: Unauthorized },
      { label: 'network before connect', method: 'network', expect: Unauthorized },
      {
        label: 'sign before connect',
        method: 'sign',
        params: { data: 'aGk=' },
        expect: Unauthorized,
      },
      {
        label: 'transfer before connect',
        method: 'transfer',
        params: { to: self, amount: '1' },
        expect: Unauthorized,
      },
    );
  }
  return list;
}

async function runChecks(): Promise<void> {
  await refresh();
  // Any valid user address works for the shape checks.
  const self = account ?? 'AU17Prntejq6G4Rwj5tpn6nnuniNAvV5atP1Um6Ujg3tGebsG1jR';
  const list = checks(account !== null, self);
  log(
    'info',
    `Running ${list.length} checks${account ? ' (connected: "before connect" checks skipped)' : ''}`,
  );
  let passed = 0;
  for (const check of list) {
    const timeout = new Promise<Outcome>((resolve) =>
      setTimeout(
        () =>
          resolve({ ok: false, code: 0, message: 'no answer — did an approval open? Reject it.' }),
        CHECK_TIMEOUT_MS,
      ),
    );
    const outcome = await Promise.race([call(check.method, check.params, true), timeout]);
    const pass = !outcome.ok && outcome.code === check.expect;
    if (pass) passed++;
    const got = outcome.ok
      ? `answered ${JSON.stringify(outcome.value)}`
      : `[${outcome.code}] ${outcome.message}`;
    log(
      pass ? 'ok' : 'err',
      `${pass ? 'PASS' : 'FAIL'} ${check.label}: expected ${check.expect}, got ${got}`,
    );
  }
  log(passed === list.length ? 'ok' : 'err', `${passed}/${list.length} checks passed`);
}

async function busyTest(): Promise<void> {
  const data = toBase64(new TextEncoder().encode('busy test'));
  const first = call('sign', { data });
  const second = await call('sign', { data });
  const busy = !second.ok && second.code === DappErrorCode.Busy;
  log(busy ? 'ok' : 'err', `${busy ? 'PASS' : 'FAIL'} second request while one waits → 4900`);
  log('info', 'Now reject the first request in the approval window');
  const outcome = await first;
  const rejected = !outcome.ok && outcome.code === DappErrorCode.UserRejected;
  log(rejected ? 'ok' : 'err', `${rejected ? 'PASS' : 'FAIL'} rejected request → 4001`);
}

// ------------------------------------------------------------------ start

function attach(api: RustCoreInjected): void {
  wallet = api;
  $('detect').textContent = 'RustCore Wallet found.';
  for (const event of ['accountChanged', 'networkChanged', 'disconnect'] as const) {
    api.on(event, (data) => {
      log('info', `event ${event}`, data);
      void refresh();
    });
  }
  void refresh();
}

on('refresh', refresh);
on('connect', async () => {
  await call('connect');
  await refresh();
});
on('connected', () => call('connected'));
on('account', () => call('account'));
on('network', () => call('network'));
on('disconnect', async () => {
  await call('disconnect');
  await refresh();
});
on('sign-text-btn', () =>
  sign(new TextEncoder().encode($<HTMLTextAreaElement>('sign-text').value)),
);
// Not valid UTF-8, so the approval window must show it as hex.
on('sign-bytes-btn', () => sign(Uint8Array.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x9f, 0xc0, 0xaf])));
on('transfer', () =>
  write('transfer', { to: value('to'), amount: Mas.fromString(value('amount')).toString() }),
);
on('buy-rolls', () => write('buyRolls', { rolls: value('rolls') }));
on('sell-rolls', () => write('sellRolls', { rolls: value('rolls') }));
on('wmas-deposit', () => wmasCall('deposit', new Args(), Mas.fromString('0.1')));
on('wmas-withdraw', () =>
  wmasCall('withdraw', new Args().addU64(Mas.fromString('0.05')).addString(account ?? '')),
);
on('wmas-transfer', () =>
  wmasCall('transfer', new Args().addString(value('to')).addU256(Mas.fromString('0.01'))),
);
on('wmas-allow', () =>
  wmasCall('increaseAllowance', new Args().addString(account ?? '').addU256(Mas.fromString('1'))),
);
on('wmas-allow-max', () =>
  wmasCall('increaseAllowance', new Args().addString(account ?? '').addU256(U256_MAX)),
);
// The contract needs coins for the new balance's storage: the simulation must fail.
on('wmas-fail', () => wmasCall('deposit', new Args()));
on('c-call', customCall);
on('checks', runChecks);
on('busy', busyTest);
on('clear', () => $('log').replaceChildren());

updateButtons();
if (window.rustcore) {
  attach(window.rustcore);
} else {
  window.addEventListener(
    'rustcore#initialized',
    () => window.rustcore && attach(window.rustcore),
    {
      once: true,
    },
  );
  setTimeout(() => {
    if (wallet) return;
    $('detect').textContent =
      'RustCore Wallet not found. Is the extension installed and enabled, and allowed on this ' +
      'site (Firefox: Permissions tab; Chromium: Site access)? The page must be served from ' +
      'http://localhost or http://127.0.0.1 (npm run test-dapp), not opened as a file.';
    $('s-ext').textContent = 'not found';
  }, 1500);
}
