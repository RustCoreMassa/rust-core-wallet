// Protocol v1 between web pages (dApps) and the extension — see docs/DAPP-CONNECTION.md.
//
// Shared by inpage.js, content.js, the background worker and the approval view, so it imports
// nothing (no Angular, no massa-web3). Everything a page sends is untrusted: `parseRequest`
// turns it into a typed request or throws a DappError, before anything is shown to the user.

/** Marks our messages among everything else posted on a page's window. */
export const CHANNEL = 'rustcore:v1';

/** Largest message the content script relays (JSON text). */
export const MAX_MESSAGE_CHARS = 256 * 1024;
/** Largest `callSC` parameter, in bytes. */
export const MAX_PARAMETER_BYTES = 64 * 1024;
/** Largest message a dApp may ask to sign, in bytes. */
export const MAX_SIGN_BYTES = 16 * 1024;
/** Longest smart-contract function name. */
export const MAX_FUNCTION_CHARS = 256;

export const DappErrorCode = {
  UserRejected: 4001,
  Unauthorized: 4100,
  UnsupportedMethod: 4200,
  Busy: 4900,
  InvalidParams: -32602,
  Internal: -32603,
} as const;
export type DappErrorCode = (typeof DappErrorCode)[keyof typeof DappErrorCode];

export class DappError extends Error {
  constructor(
    readonly code: DappErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DappError';
  }

  toJSON(): DappErrorData {
    return { code: this.code, message: this.message };
  }
}

export interface DappErrorData {
  readonly code: number;
  readonly message: string;
}

/** What a page can ask for. Reads (balances, readSC, events…) never come here. */
export type DappRequest =
  | { readonly method: 'connect' }
  | { readonly method: 'disconnect' }
  | { readonly method: 'connected' }
  | { readonly method: 'account' }
  | { readonly method: 'network' }
  | { readonly method: 'sign'; readonly data: Uint8Array }
  | { readonly method: 'transfer'; readonly to: string; readonly amount: bigint }
  | { readonly method: 'buyRolls'; readonly rolls: bigint }
  | { readonly method: 'sellRolls'; readonly rolls: bigint }
  | {
      readonly method: 'callSC';
      readonly target: string;
      readonly func: string;
      readonly parameter: Uint8Array;
      readonly coins: bigint;
      readonly fee?: bigint;
      readonly maxGas?: bigint;
    };

export type DappMethod = DappRequest['method'];

const METHODS: readonly DappMethod[] = [
  'connect',
  'disconnect',
  'connected',
  'account',
  'network',
  'sign',
  'transfer',
  'buyRolls',
  'sellRolls',
  'callSC',
];

/**
 * Methods other Massa wallets expose that we refuse on purpose: raw bytecode can't be reviewed,
 * and a website must never hand the wallet a key, remove an account or change its node.
 */
const REFUSED: readonly string[] = [
  'executeSC',
  'deploySC',
  'importAccount',
  'deleteAccount',
  'generateNewAccount',
  'setRpcUrl',
];

/** Methods that need the user to approve them in the approval window. */
export function needsApproval(method: DappMethod): boolean {
  return method === 'connect' || needsSignature(method);
}

/** Methods that sign something with the connected account's key. */
export function needsSignature(method: DappMethod): boolean {
  return (
    method === 'sign' ||
    method === 'transfer' ||
    method === 'buyRolls' ||
    method === 'sellRolls' ||
    method === 'callSC'
  );
}

// ------------------------------------------------------------------ messages on the wire

/** Page → content script (window.postMessage). */
export interface PageRequestMessage {
  readonly channel: typeof CHANNEL;
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

/** Content script → page: the answer to one request. */
export type PageResponseMessage =
  | { readonly channel: typeof CHANNEL; readonly id: string; readonly result: unknown }
  | { readonly channel: typeof CHANNEL; readonly id: string; readonly error: DappErrorData };

export type DappEvent = 'accountChanged' | 'networkChanged' | 'disconnect';

/** Content script → page: something changed for this site. */
export interface PageEventMessage {
  readonly channel: typeof CHANNEL;
  readonly event: DappEvent;
  readonly data?: unknown;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Is this window message a well-formed request from a page? (Its params are checked later.) */
export function isPageRequest(data: unknown): data is PageRequestMessage {
  if (!isRecord(data) || data['channel'] !== CHANNEL) return false;
  const { id, method } = data;
  return typeof id === 'string' && ID.test(id) && typeof method === 'string' && method.length <= 64;
}

// ------------------------------------------------------------------ parsing params

/**
 * Checks a page's request and converts it to a typed DappRequest. Amounts arrive as decimal
 * strings of smallest units, bytes as base64. Only shape and limits are checked here; balances,
 * fees and the like are checked by the wallet's own rules in the approval view.
 */
export function parseRequest(method: string, params: unknown): DappRequest {
  if (REFUSED.includes(method)) {
    throw new DappError(DappErrorCode.UnsupportedMethod, `${method} is not supported`);
  }
  if (!(METHODS as readonly string[]).includes(method)) {
    throw new DappError(DappErrorCode.UnsupportedMethod, `Unknown method: ${method}`);
  }
  const m = method as DappMethod;
  switch (m) {
    case 'connect':
    case 'disconnect':
    case 'connected':
    case 'account':
    case 'network':
      return { method: m };
    case 'sign': {
      const p = record(params);
      const data = bytes(p['data'], 'data', MAX_SIGN_BYTES);
      if (data.length === 0) throw invalid('data must not be empty');
      return { method: m, data };
    }
    case 'transfer': {
      const p = record(params);
      return {
        method: m,
        to: address(p['to'], 'to', 'AU', 'AS'),
        amount: positive(units(p['amount'], 'amount'), 'amount'),
      };
    }
    case 'buyRolls':
    case 'sellRolls': {
      const p = record(params);
      return { method: m, rolls: positive(units(p['rolls'], 'rolls'), 'rolls') };
    }
    case 'callSC': {
      const p = record(params);
      const func = p['func'];
      if (typeof func !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(func)) {
        throw invalid('func must be a function name');
      }
      if (func.length > MAX_FUNCTION_CHARS) throw invalid('func is too long');
      return {
        method: m,
        target: address(p['target'], 'target', 'AS'),
        func,
        parameter:
          p['parameter'] === undefined
            ? new Uint8Array()
            : bytes(p['parameter'], 'parameter', MAX_PARAMETER_BYTES),
        coins: p['coins'] === undefined ? 0n : units(p['coins'], 'coins'),
        ...(p['fee'] !== undefined && { fee: units(p['fee'], 'fee') }),
        ...(p['maxGas'] !== undefined && {
          maxGas: positive(units(p['maxGas'], 'maxGas'), 'maxGas'),
        }),
      };
    }
  }
}

// ------------------------------------------------------------------ encoding helpers

/** Bytes → base64, for results crossing the bridge (signatures, public keys). */
export function toBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** base64 → bytes; null if it isn't valid base64. */
export function fromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ validators

const MASSA_ADDRESS = /^A[US][1-9A-HJ-NP-Za-km-z]{40,60}$/;
/** Up to 2^128: far above any real amount, short enough to never be a performance problem. */
const UNITS = /^(0|[1-9][0-9]{0,38})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) throw invalid('params must be an object');
  return params;
}

function invalid(message: string): DappError {
  return new DappError(DappErrorCode.InvalidParams, message);
}

function address(value: unknown, name: string, ...prefixes: ('AU' | 'AS')[]): string {
  if (typeof value !== 'string' || !MASSA_ADDRESS.test(value)) {
    throw invalid(`${name} must be a Massa address`);
  }
  if (!prefixes.some((p) => value.startsWith(p))) {
    throw invalid(`${name} must start with ${prefixes.join(' or ')}`);
  }
  return value;
}

/** A non-negative integer amount of smallest units, sent as a decimal string. */
function units(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !UNITS.test(value)) {
    throw invalid(`${name} must be a whole number of units, as a decimal string`);
  }
  return BigInt(value);
}

function positive(value: bigint, name: string): bigint {
  if (value <= 0n) throw invalid(`${name} must be greater than 0`);
  return value;
}

function bytes(value: unknown, name: string, max: number): Uint8Array {
  const data = typeof value === 'string' ? fromBase64(value) : null;
  if (!data) throw invalid(`${name} must be base64`);
  if (data.length > max) throw invalid(`${name} is larger than ${max} bytes`);
  return data;
}
