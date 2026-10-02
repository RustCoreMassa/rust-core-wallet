// The background worker's side of dApp connections — see docs/DAPP-CONNECTION.md.
//
// One port per page (opened by content.js). The router learns each page's origin from the port's
// sender, which the browser fills in, answers status requests itself, and queues everything the
// user must approve for the approval window. It never signs: the approval window (the wallet app)
// does, and reports back through `resolve`. No Angular and no chrome.* here — background.ts wires
// it to the browser, the specs to fakes.
import { ApprovalResult, ApprovalView } from './approval';
import { DappPermissions, PermissionMap, dappOrigin, toPermissionMap } from './permissions';
import {
  DappError,
  DappErrorCode,
  DappErrorData,
  DappEvent,
  DappRequest,
  PortMessage,
  WalletNetwork,
  networkInfo,
  newRequestId,
  parseRequest,
} from './protocol';

/** A request the user doesn't answer within this time is rejected. */
export const REQUEST_TTL_MS = 10 * 60_000;
/** Requests waiting for the user, across all sites. */
export const MAX_PENDING = 10;

/** The runtime port's parts the router uses. */
export interface RouterPort {
  readonly sender?: {
    readonly origin?: string;
    readonly url?: string;
    readonly frameId?: number;
  };
  postMessage(message: PortMessage): void;
  readonly onMessage: { addListener(callback: (message: unknown) => void): void };
  readonly onDisconnect: { addListener(callback: () => void): void };
  disconnect(): void;
}

export interface RouterDeps {
  readonly permissions: DappPermissions;
  /** The wallet's current network. */
  network(): Promise<WalletNetwork>;
  /** Opens the approval window, or brings it to the front. */
  showApproval(): void;
  readonly now?: () => number;
}

interface Pending {
  readonly approvalId: string;
  readonly origin: string;
  readonly port: RouterPort;
  readonly requestId: string;
  readonly request: DappRequest;
  readonly params: unknown;
  readonly address: string | null;
  readonly createdAt: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Returned by `dispatch` when the answer comes later, from the approval window. */
const QUEUED = Symbol('queued');

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const USER_ADDRESS = /^AU[1-9A-HJ-NP-Za-km-z]{40,60}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{20,200}$/;
const OPERATION_ID = /^O[1-9A-HJ-NP-Za-km-z]{20,100}$/;

export class DappRouter {
  /** Open ports per origin, for replies and events. */
  private readonly ports = new Map<string, Set<RouterPort>>();
  /** Requests waiting for the user, oldest first; the approval window shows the first. */
  private readonly queue: Pending[] = [];
  private readonly now: () => number;

  constructor(private readonly deps: RouterDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Takes a new port from a page's content script. */
  attach(port: RouterPort): void {
    // Top frames only (content.js isn't injected elsewhere), and only https/localhost pages.
    const topFrame = port.sender?.frameId === undefined || port.sender.frameId === 0;
    const origin = topFrame ? dappOrigin(port.sender?.origin ?? port.sender?.url) : null;
    if (!origin) {
      port.disconnect();
      return;
    }
    const set = this.ports.get(origin) ?? new Set();
    set.add(port);
    this.ports.set(origin, set);
    port.onMessage.addListener((message) => void this.handle(origin, port, message));
    port.onDisconnect.addListener(() => this.detach(origin, port));
  }

  // ---------------------------------------------------------------- the approval window's side

  /** The request the approval window should show now, or null when nothing waits. */
  next(): ApprovalView | null {
    const head = this.queue[0];
    if (!head) return null;
    return {
      approvalId: head.approvalId,
      origin: head.origin,
      method: head.request.method,
      params: head.params,
      address: head.address,
      createdAt: head.createdAt,
      queued: this.queue.length - 1,
    };
  }

  /**
   * The user approved and the wallet did the work: answers the page. False if the request is
   * gone (page closed, expired, connection revoked) or the result doesn't fit the request — for
   * `connect`, the site is then not connected.
   */
  async resolve(approvalId: string, result: ApprovalResult): Promise<boolean> {
    const pending = this.take(approvalId);
    if (!pending) return false;
    const { request, origin } = pending;
    if (!fitsRequest(request, result)) {
      this.answer(pending, { error: internal('The wallet returned an invalid result') });
      return false;
    }
    if (request.method === 'connect') {
      const { address } = result as { address: string };
      await this.deps.permissions.grant(origin, address);
      this.answer(pending, { result: { address } });
      return true;
    }
    this.answer(pending, { result });
    return true;
  }

  /** The user said no. */
  reject(approvalId: string): boolean {
    const pending = this.take(approvalId);
    if (!pending) return false;
    this.answer(pending, { error: rejected('Rejected by the user') });
    return true;
  }

  /** The approval window was closed: everything still waiting is rejected. */
  rejectAll(): void {
    for (const pending of [...this.queue]) {
      this.take(pending.approvalId);
      this.answer(pending, { error: rejected('Rejected by the user') });
    }
  }

  // ---------------------------------------------------------------- storage changes

  /**
   * Reacts to chrome.storage.local changes made anywhere (Settings, other views, this router):
   * a site whose account changed gets `accountChanged`, a disconnected one `disconnect`, and
   * every connected site `networkChanged` when the wallet switches network.
   */
  async onStorageChanged(
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    items: { permissions: string; network: string },
  ): Promise<void> {
    const permissionChange = changes[items.permissions];
    if (permissionChange) {
      const before = toPermissionMap(permissionChange.oldValue);
      const after = toPermissionMap(permissionChange.newValue);
      this.permissionsChanged(before, after);
    }
    const networkChange = changes[items.network];
    if (networkChange && networkChange.oldValue !== networkChange.newValue) {
      const info = networkInfo(await this.deps.network());
      for (const origin of Object.keys(await this.deps.permissions.all())) {
        this.emit(origin, 'networkChanged', info);
      }
    }
  }

  private permissionsChanged(before: PermissionMap, after: PermissionMap): void {
    for (const [origin, old] of Object.entries(before)) {
      const now = after[origin];
      if (!now) {
        this.dropOrigin(origin, unauthorized('The site was disconnected'));
        this.emit(origin, 'disconnect');
      } else if (now.address !== old.address) {
        this.dropOrigin(origin, unauthorized("The site's account changed"));
        this.emit(origin, 'accountChanged', { address: now.address });
      }
    }
  }

  // ---------------------------------------------------------------- requests from pages

  private async handle(origin: string, port: RouterPort, message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
    if (typeof id !== 'string' || !REQUEST_ID.test(id) || typeof method !== 'string') return;
    try {
      const request = parseRequest(method, params);
      const result = await this.dispatch(origin, port, id, request, params);
      if (result !== QUEUED) post(port, { id, result });
    } catch (err) {
      post(port, { id, error: toErrorData(err) });
    }
  }

  private async dispatch(
    origin: string,
    port: RouterPort,
    id: string,
    request: DappRequest,
    params: unknown,
  ): Promise<unknown> {
    const permission = await this.deps.permissions.get(origin);
    switch (request.method) {
      case 'connected':
        return permission !== null;
      case 'account':
        if (!permission) throw unauthorized('Connect to the wallet first');
        return { address: permission.address };
      case 'network':
        if (!permission) throw unauthorized('Connect to the wallet first');
        return networkInfo(await this.deps.network());
      case 'disconnect':
        // Other pages of the site hear about it through onStorageChanged.
        await this.deps.permissions.revoke(origin);
        return true;
      case 'connect':
        if (permission) return { address: permission.address };
        return this.enqueue(origin, port, id, request, params, null);
      default:
        if (!permission) throw unauthorized('Connect to the wallet first');
        return this.enqueue(origin, port, id, request, params, permission.address);
    }
  }

  private enqueue(
    origin: string,
    port: RouterPort,
    requestId: string,
    request: DappRequest,
    params: unknown,
    address: string | null,
  ): typeof QUEUED {
    if (this.queue.some((p) => p.origin === origin)) {
      throw new DappError(DappErrorCode.Busy, 'Another request from this site is waiting');
    }
    if (this.queue.length >= MAX_PENDING) {
      throw new DappError(DappErrorCode.Busy, 'The wallet is busy. Try again in a moment.');
    }
    const approvalId = newRequestId();
    const timer = setTimeout(() => {
      const expired = this.take(approvalId);
      if (expired) this.answer(expired, { error: rejected('The request expired') });
    }, REQUEST_TTL_MS);
    this.queue.push({
      approvalId,
      origin,
      port,
      requestId,
      request,
      params,
      address,
      createdAt: this.now(),
      timer,
    });
    this.deps.showApproval();
    return QUEUED;
  }

  // ---------------------------------------------------------------- bookkeeping

  /** Removes a pending request from the queue and returns it. */
  private take(approvalId: string): Pending | null {
    const index = this.queue.findIndex((p) => p.approvalId === approvalId);
    if (index < 0) return null;
    const [pending] = this.queue.splice(index, 1);
    clearTimeout(pending.timer);
    return pending;
  }

  private answer(pending: Pending, outcome: { result: unknown } | { error: DappErrorData }): void {
    post(pending.port, { id: pending.requestId, ...outcome });
  }

  /** Rejects whatever a site still has waiting (its connection was revoked or changed). */
  private dropOrigin(origin: string, error: DappError): void {
    for (const pending of this.queue.filter((p) => p.origin === origin)) {
      this.take(pending.approvalId);
      this.answer(pending, { error: error.toJSON() });
    }
  }

  /** A page went away: its waiting requests can't be answered anymore. */
  private detach(origin: string, port: RouterPort): void {
    for (const pending of this.queue.filter((p) => p.port === port)) {
      this.take(pending.approvalId);
    }
    const set = this.ports.get(origin);
    set?.delete(port);
    if (set?.size === 0) this.ports.delete(origin);
  }

  private emit(origin: string, event: DappEvent, data?: unknown): void {
    for (const port of this.ports.get(origin) ?? []) {
      post(port, data === undefined ? { event } : { event, data });
    }
  }
}

/** Does the approval window's result match what the request asked for? */
function fitsRequest(request: DappRequest, result: ApprovalResult): boolean {
  const r = result as Partial<
    Record<'address' | 'publicKey' | 'signature' | 'operationId', unknown>
  >;
  switch (request.method) {
    case 'connect':
      return typeof r.address === 'string' && USER_ADDRESS.test(r.address);
    case 'sign':
      return (
        typeof r.publicKey === 'string' &&
        r.publicKey.startsWith('P') &&
        BASE58.test(r.publicKey.slice(1)) &&
        typeof r.signature === 'string' &&
        BASE58.test(r.signature)
      );
    case 'transfer':
    case 'buyRolls':
    case 'sellRolls':
    case 'callSC':
      return typeof r.operationId === 'string' && OPERATION_ID.test(r.operationId);
    default:
      return false;
  }
}

function post(port: RouterPort, message: PortMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // The page went away between the request and the answer.
  }
}

function toErrorData(err: unknown): DappErrorData {
  if (err instanceof DappError) return err.toJSON();
  console.error('dApp request failed', err);
  return internal('Something went wrong in the wallet');
}

function internal(message: string): DappErrorData {
  return { code: DappErrorCode.Internal, message };
}

function rejected(message: string): DappErrorData {
  return { code: DappErrorCode.UserRejected, message };
}

function unauthorized(message: string): DappError {
  return new DappError(DappErrorCode.Unauthorized, message);
}
