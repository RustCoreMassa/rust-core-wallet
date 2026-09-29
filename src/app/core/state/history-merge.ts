import { HistoryPaging, HistoryStream, TransactionRecord } from '../models/transaction.model';
import { HistoryPage } from '../services/explorer-api';

/**
 * Pure history bookkeeping for WalletStore: merging explorer pages with
 * what's already held, and the two-stream paging the explorer uses.
 */

/** A local pending record the explorer never confirms (e.g. expired op) is dropped after this. */
export const PENDING_TTL_MS = 10 * 60_000;

/**
 * Merges an explorer page into the history already held: records are
 * keyed by id, so re-reading the newest page (polling) or appending an
 * older one (load more) both just upsert.
 *
 * Local records (sent from this app) are dropped once the explorer
 * reports their operation, or after PENDING_TTL_MS if it never does.
 * MRC-20 transfers reach the explorer as a bare `CallSC` (no token, no
 * amount), so when a send we know about matches one by operation id, the
 * known token/amount is kept and only status/time/fee come from chain.
 */
export function mergeHistory(
  existing: readonly TransactionRecord[],
  incoming: readonly TransactionRecord[],
): TransactionRecord[] {
  // Token sends and swaps only (both reach the explorer as a bare CallSC);
  // a contract call's payouts share its operation id and would otherwise
  // shadow the record in this map.
  const knownCalls = new Map(
    existing.filter((r) => r.type === 'send' || r.type === 'swap').map((r) => [r.operationId, r]),
  );
  const incomingOps = new Set(incoming.map((r) => r.operationId));

  const byId = new Map<string, TransactionRecord>();
  for (const r of existing) {
    const settled = incomingOps.has(r.operationId) || Date.now() - r.timestamp > PENDING_TTL_MS;
    if (!(r.local && settled)) byId.set(r.id, r);
  }
  for (const r of incoming) {
    const mine = knownCalls.get(r.operationId);
    byId.set(
      r.id,
      mine && r.type === 'contract_call'
        ? { ...mine, id: r.id, local: false, status: r.status, timestamp: r.timestamp, fee: r.fee }
        : r,
    );
  }
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export const HISTORY_STREAMS: readonly HistoryStream[] = ['created', 'received'];

export const EMPTY_PAGING: HistoryPaging = {
  created: { cursor: null, oldest: Infinity },
  received: { cursor: null, oldest: Infinity },
};

/**
 * Oldest timestamp the loaded history is complete down to. A stream with
 * more pages only covers down to its oldest loaded record; anything older
 * from the other stream could have gaps before it, so it stays hidden
 * until that stream catches up. 0 = everything loaded, show it all.
 */
export function historyCutoff(paging: HistoryPaging | null): number {
  if (!paging) return 0;
  return HISTORY_STREAMS.reduce(
    (cutoff, s) => (paging[s].cursor ? Math.max(cutoff, paging[s].oldest) : cutoff),
    0,
  );
}

export function advancePaging(paging: HistoryPaging, page: HistoryPage): HistoryPaging {
  const next = { ...paging };
  for (const s of HISTORY_STREAMS) {
    const fetched = page.streams[s];
    if (fetched)
      next[s] = { cursor: fetched.cursor, oldest: Math.min(paging[s].oldest, fetched.oldest) };
  }
  return next;
}
