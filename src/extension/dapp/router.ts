// The background worker's side of dApp connections — see docs/DAPP-CONNECTION.md.
//
// One port per page (opened by content.js). The router learns each page's origin from the port's
// sender, which the browser fills in, answers status requests itself, and queues everything the
// user must approve for the approval window. Events go to the site's tabs (SiteTabs), not over
// the ports: those close whenever the browser stops the idle worker. It never signs: the approval window (the wallet app)
// does, and reports back through `resolve`. No Angular and no chrome.* here — background.ts wires
// it to the browser, the specs to fakes.
import { ApprovalResult, ApprovalView } from './approval';
import { DappPermissions, PermissionMap, dappOrigin, toPermissionMap } from './permissions';
import {
  CHANNEL,
  DappError,
  DappErrorCode,
  DappErrorData,
  DappEvent,
  DappRequest,
  PortMessage,
  TabEventMessage,
  WalletNetwork,
  networkInfo,
  newRequestId,
  parseRequest,
} from './protocol';
import { SiteTabs } from './site-tabs';

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
    readonly tab?: { readonly id?: number };
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
  /** Tabs showing each site, for events. */
  readonly tabs: SiteTabs;
  /** Delivers an event to a tab's content script; rejects if nothing there listens. */
  sendToTab(tabId: number, message: TabEventMessage): Promise<void>;
  readonly now?: () => number;
}

/** A page waiting for the answer to its request. */
interface Waiter {
  readonly port: RouterPort;
  readonly requestId: string;
}

interface Pending {
  readonly approvalId: string;
  readonly origin: string;
  /** Who gets the answer: the page that asked — and, for `connect`, any page of the site that
   * asked again while the first was waiting. */
  readonly waiters: Waiter[];
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
    const tabId = port.sender?.tab?.id;
    if (tabId !== undefined) {
      this.deps.tabs
        .remember(tabId, origin)
        .catch((err) => console.error('Remembering a dApp tab failed', err));
    }
    port.onMessage.addListener((message) => void this.handle(origin, port, message));
    port.onDisconnect.addListener(() => this.detach(port));
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
    if ('operationId' in result) {
      // the site follows the operation on that network's node: give it the network's details
      const { operationId, network } = result;
      this.answer(pending, { result: { operationId, network: networkInfo(network) } });
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
      await this.permissionsChanged(before, after);
    }
    const networkChange = changes[items.network];
    if (networkChange && networkChange.oldValue !== networkChange.newValue) {
      const info = networkInfo(await this.deps.network());
      const origins = Object.keys(await this.deps.permissions.all());
      await Promise.all(origins.map((origin) => this.emit(origin, 'networkChanged', info)));
    }
  }

  private async permissionsChanged(before: PermissionMap, after: PermissionMap): Promise<void> {
    const events: Promise<void>[] = [];
    for (const [origin, old] of Object.entries(before)) {
      const now = after[origin];
      if (!now) {
        this.dropOrigin(origin, unauthorized('The site was disconnected'));
        events.push(this.emit(origin, 'disconnect'));
      } else if (now.address !== old.address) {
        this.dropOrigin(origin, unauthorized("The site's account changed"));
        events.push(this.emit(origin, 'accountChanged', { address: now.address }));
      }
    }
    await Promise.all(events);
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
    const waiting = this.queue.find((p) => p.origin === origin);
    if (waiting?.request.method === 'connect' && request.method === 'connect') {
      // Same question, same answer: the page asked twice, or two pages of the site asked.
      waiting.waiters.push({ port, requestId });
      this.deps.showApproval();
      return QUEUED;
    }
    if (waiting) {
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
      waiters: [{ port, requestId }],
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
    for (const { port, requestId } of pending.waiters) post(port, { id: requestId, ...outcome });
  }

  /** Rejects whatever a site still has waiting (its connection was revoked or changed). */
  private dropOrigin(origin: string, error: DappError): void {
    for (const pending of this.queue.filter((p) => p.origin === origin)) {
      this.take(pending.approvalId);
      this.answer(pending, { error: error.toJSON() });
    }
  }

  /** A page went away: it can't get answers anymore; a request nobody waits for is dropped. */
  private detach(port: RouterPort): void {
    for (const pending of [...this.queue]) {
      const left = pending.waiters.filter((w) => w.port !== port);
      if (left.length === pending.waiters.length) continue;
      pending.waiters.splice(0, pending.waiters.length, ...left);
      if (left.length === 0) this.take(pending.approvalId);
    }
  }

  /** Tells every tab showing `origin`; tabs that no longer listen are forgotten. */
  private async emit(origin: string, event: DappEvent, data?: unknown): Promise<void> {
    const message: TabEventMessage = {
      channel: CHANNEL,
      origin,
      event,
      ...(data !== undefined && { data }),
    };
    const tabs = await this.deps.tabs.of(origin);
    await Promise.all(
      tabs.map((tabId) =>
        this.deps.sendToTab(tabId, message).catch(() => this.deps.tabs.forget(tabId)),
      ),
    );
  }
}

/** Does the approval window's result match what the request asked for? */
function fitsRequest(request: DappRequest, result: ApprovalResult): boolean {
  const r = result as Partial<
    Record<'address' | 'publicKey' | 'signature' | 'operationId' | 'network', unknown>
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
      return (
        typeof r.operationId === 'string' &&
        OPERATION_ID.test(r.operationId) &&
        (r.network === 'mainnet' || r.network === 'buildnet')
      );
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
