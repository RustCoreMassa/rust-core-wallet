// Messages between the approval window (the wallet app, ?view=approve) and the background
// worker — see docs/DAPP-CONNECTION.md. No Angular here: the background bundles it too.
import { DappMethod } from './protocol';

/** Port the approval window keeps open while it's shown; its traffic keeps the worker alive. */
export const APPROVAL_PORT = 'rustcore:approval';

/** How often the approval window pings the worker, so the browser doesn't stop it meanwhile. */
export const APPROVAL_KEEPALIVE_MS = 20_000;

/** A request waiting for the user, as the approval window shows it. */
export interface ApprovalView {
  readonly approvalId: string;
  /** The requesting site, as the browser reported it. */
  readonly origin: string;
  readonly method: DappMethod;
  /** The page's params, exactly as received — the window re-checks them with parseRequest. */
  readonly params: unknown;
  /** The site's connected account, which must sign; null for `connect`. */
  readonly address: string | null;
  readonly createdAt: number;
  /** Requests waiting after this one. */
  readonly queued: number;
}

/** What the approval window sends back once the user approved and the wallet did the work. */
export type ApprovalResult =
  /** connect: the account the user chose to share. */
  | { readonly address: string }
  /** sign: massa-web3's SignedData. */
  | { readonly publicKey: string; readonly signature: string }
  /** transfer, rolls, callSC: the operation the wallet sent. */
  | { readonly operationId: string };

export type ApprovalMessage =
  | { readonly type: 'rustcore:approval:next' }
  | {
      readonly type: 'rustcore:approval:resolve';
      readonly approvalId: string;
      readonly result: ApprovalResult;
    }
  | { readonly type: 'rustcore:approval:reject'; readonly approvalId: string };

export function isApprovalMessage(data: unknown): data is ApprovalMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  switch (m['type']) {
    case 'rustcore:approval:next':
      return true;
    case 'rustcore:approval:reject':
      return typeof m['approvalId'] === 'string';
    case 'rustcore:approval:resolve':
      return (
        typeof m['approvalId'] === 'string' &&
        typeof m['result'] === 'object' &&
        m['result'] !== null
      );
    default:
      return false;
  }
}
