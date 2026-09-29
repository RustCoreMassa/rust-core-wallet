import { HistoryPaging, TransactionRecord } from '../models/transaction.model';
import { HistoryPage } from '../services/explorer-api';
import {
  EMPTY_PAGING,
  PENDING_TTL_MS,
  advancePaging,
  historyCutoff,
  mergeHistory,
} from './history-merge';

const NOW = 1_800_000_000_000;

function record(
  partial: Partial<TransactionRecord> & Pick<TransactionRecord, 'id'>,
): TransactionRecord {
  return {
    type: 'send',
    token: 'MAS',
    amount: 1,
    timestamp: NOW,
    operationId: partial.id,
    ...partial,
  };
}

describe('mergeHistory', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW));

  it('upserts by id and sorts newest first', () => {
    const existing = [record({ id: 'O1', timestamp: NOW - 2000 })];
    const incoming = [
      record({ id: 'O2', timestamp: NOW - 1000 }),
      record({ id: 'O1', timestamp: NOW - 2000, amount: 5 }),
    ];
    const merged = mergeHistory(existing, incoming);
    expect(merged.map((r) => r.id)).toEqual(['O2', 'O1']);
    expect(merged[1].amount).toBe(5);
  });

  it('drops a local record once the explorer reports its operation', () => {
    const local = record({ id: 't1', operationId: 'O9', local: true, status: 'pending' });
    const chain = record({ id: 'O9', operationId: 'O9', type: 'send', status: 'final' });
    expect(mergeHistory([local], [chain]).map((r) => r.id)).toEqual(['O9']);
  });

  it('keeps a local record the explorer hasn’t seen yet, until its TTL', () => {
    const fresh = record({ id: 't1', operationId: 'O9', local: true, timestamp: NOW - 1000 });
    const stale = record({
      id: 't2',
      operationId: 'O8',
      local: true,
      timestamp: NOW - PENDING_TTL_MS - 1,
    });
    expect(mergeHistory([fresh, stale], []).map((r) => r.id)).toEqual(['t1']);
  });

  it('keeps token/amount of a known token send when the explorer shows a bare CallSC', () => {
    const local = record({
      id: 't1',
      operationId: 'O7',
      local: true,
      token: 'USDC.e',
      amount: 12,
      status: 'pending',
    });
    const callSc = record({
      id: 'O7',
      operationId: 'O7',
      type: 'contract_call',
      token: 'MAS',
      amount: 0,
      status: 'final',
      fee: 0.01,
    });
    const [merged] = mergeHistory([local], [callSc]);
    expect(merged).toMatchObject({
      id: 'O7',
      type: 'send',
      token: 'USDC.e',
      amount: 12,
      status: 'final',
      fee: 0.01,
      local: false,
    });
  });

  it('keeps swap details the same way', () => {
    const local = record({
      id: 't1',
      operationId: 'O6',
      local: true,
      type: 'swap',
      toToken: 'MAS',
      received: 314,
    });
    const callSc = record({ id: 'O6', operationId: 'O6', type: 'contract_call' });
    expect(mergeHistory([local], [callSc])[0]).toMatchObject({
      type: 'swap',
      toToken: 'MAS',
      received: 314,
    });
  });

  it('does not let a contract payout (same operation id, `_N` suffix) shadow the send', () => {
    const local = record({ id: 't1', operationId: 'O5', local: true, token: 'DUSA', amount: 3 });
    const payout = record({ id: 'O5_0', operationId: 'O5', type: 'receive', timestamp: NOW });
    const callSc = record({ id: 'O5', operationId: 'O5', type: 'contract_call', timestamp: NOW });
    const merged = mergeHistory([local], [payout, callSc]);
    expect(merged.find((r) => r.id === 'O5')).toMatchObject({ type: 'send', token: 'DUSA' });
    expect(merged.find((r) => r.id === 'O5_0')?.type).toBe('receive');
  });
});

describe('history paging', () => {
  const paging = (
    created: [string | null, number],
    received: [string | null, number],
  ): HistoryPaging => ({
    created: { cursor: created[0], oldest: created[1] },
    received: { cursor: received[0], oldest: received[1] },
  });

  it('shows everything when no stream has more pages', () => {
    expect(historyCutoff(null)).toBe(0);
    expect(historyCutoff(paging([null, 100], [null, 50]))).toBe(0);
  });

  it('cuts at the stream that still has pages, so no gap is shown', () => {
    // Created still has older pages below 900; received is complete back to 100.
    expect(historyCutoff(paging(['c1', 900], [null, 100]))).toBe(900);
  });

  it('cuts at the most recent of the incomplete streams', () => {
    expect(historyCutoff(paging(['c', 900], ['r', 500]))).toBe(900);
  });

  it('advances only the streams a page read, keeping the oldest timestamp', () => {
    const page: HistoryPage = { records: [], streams: { created: { cursor: 'c2', oldest: 700 } } };
    const next = advancePaging(paging(['c1', 900], ['r1', 500]), page);
    expect(next.created).toEqual({ cursor: 'c2', oldest: 700 });
    expect(next.received).toEqual({ cursor: 'r1', oldest: 500 });
  });

  it('marks a stream complete when the page has no next cursor', () => {
    const page: HistoryPage = { records: [], streams: { created: { cursor: null, oldest: 400 } } };
    expect(advancePaging(paging(['c1', 900], [null, 100]), page).created.cursor).toBeNull();
  });

  it('starts from an empty paging state', () => {
    const page: HistoryPage = {
      records: [],
      streams: { created: { cursor: 'c', oldest: 800 }, received: { cursor: null, oldest: 300 } },
    };
    expect(advancePaging(EMPTY_PAGING, page)).toEqual(paging(['c', 800], [null, 300]));
  });
});
