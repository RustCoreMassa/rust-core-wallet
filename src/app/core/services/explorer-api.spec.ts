import { ExplorerApi, INDEXER_TIMEOUT_MS } from './explorer-api';

const ME = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const OTHER = 'AU12NaQQfpKDLgFDaNvvi4GXxsTR6yutRvX66DQXRy9woSZQHNChx';
const USDC = 'AS1hCJXjndR4c9vekLWsXGnrdigp4AaZ7uYG3UKFzzKnWVsrNLPJ';

/** Slot 5553748/18 — the indexer's own block_timestamp_ms for it is 1794172777000. */
const SLOT = { period: 5553748, thread: 18 };
const SLOT_TIME = 1794172777000;

/** An operation as indexer-api.massa.net returns it (trimmed to what the wallet reads + a bit). */
function op(partial: Record<string, unknown>) {
  return {
    id: 'O1',
    creator: ME,
    target: OTHER,
    kind: 'transaction',
    expire_period: SLOT.period + 8,
    fee_nmas: 10000000,
    thread: SLOT.thread,
    inclusions: [{ slot: SLOT, block_id: 'B1x' }],
    candidate_exec_status: 'ok',
    final_exec_status: 'ok',
    details: { amount_nmas: 1000000000, recipient_address: OTHER },
    first_seen_ts_ms: SLOT_TIME + 400,
    ...partial,
  };
}

/** `ops` / `received_ops` bodies, picked by URL. */
function respondWith(
  bodies: { created?: unknown; received?: unknown },
  status = 200,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    const body = url.includes('/received_ops?')
      ? (bodies.received ?? { network: 'mainnet', data: [] })
      : (bodies.created ?? { network: 'mainnet', data: [] });
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const list = (data: unknown[], cursor?: string) => ({
  network: 'mainnet',
  ...(cursor ? { has_more: true, cursor_next: cursor } : {}),
  data,
});

describe('ExplorerApi', () => {
  const api = new ExplorerApi();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps created and received operations, newest first', async () => {
    const at = (period: number) => [{ slot: { period, thread: 0 }, block_id: 'B1x' }];
    respondWith({
      created: list([
        op({
          id: 'Ocall',
          kind: 'call_sc',
          target: USDC,
          details: { target_address: USDC, target_function: 'transfer', coins_nmas: 0 },
          inclusions: at(300),
        }),
        op({ id: 'Osend', inclusions: at(200) }),
        op({
          id: 'Oroll',
          kind: 'roll_buy',
          target: null,
          details: { roll_count: 15 },
          inclusions: at(100),
        }),
      ]),
      received: list([
        op({
          id: 'Oin',
          creator: OTHER,
          target: ME,
          details: { amount_nmas: 58300000, recipient_address: ME },
          inclusions: at(250),
        }),
      ]),
    });
    const { records } = await api.getHistory(ME);

    expect(records.map((r) => r.id)).toEqual(['Ocall', 'Oin', 'Osend', 'Oroll']);
    expect(records.find((r) => r.id === 'Osend')).toMatchObject({
      type: 'send',
      amount: 1,
      fee: 0.01,
      status: 'final',
      from: ME,
      to: OTHER,
      operationId: 'Osend',
      token: 'MAS',
    });
    expect(records.find((r) => r.id === 'Ocall')).toMatchObject({
      type: 'contract_call',
      amount: 0,
      counterparty: 'USDC.e contract',
    });
    expect(records.find((r) => r.id === 'Oin')).toMatchObject({
      type: 'receive',
      amount: 0.0583,
      from: OTHER,
      counterparty: 'AU12Na…NChx',
    });
    expect(records.find((r) => r.id === 'Oin')?.fee).toBeUndefined();
    expect(records.find((r) => r.id === 'Oroll')).toMatchObject({
      type: 'buy_rolls',
      rollCount: 15,
      amount: 1500,
      to: undefined,
      counterparty: undefined,
    });
  });

  it('maps a sell, a call with coins and a bytecode execution', async () => {
    respondWith({
      created: list([
        op({ id: 'Osell', kind: 'roll_sell', target: null, details: { roll_count: 2 } }),
        op({
          id: 'Oswap',
          kind: 'call_sc',
          target: 'AS1gUwVGA3A5Dnmev8c2BjBR2wC8y9hb7CFZXVzLb1iwASFHUZ1p',
          details: { target_function: 'swapExactMASForTokens', coins_nmas: 14500100000000 },
        }),
        op({ id: 'Oexec', kind: 'execute_sc', target: null, details: { bytecode_size: 900 } }),
      ]),
    });
    const { records } = await api.getHistory(ME);
    expect(records.find((r) => r.id === 'Osell')).toMatchObject({
      type: 'sell_rolls',
      rollCount: 2,
      amount: 200,
    });
    expect(records.find((r) => r.id === 'Oswap')).toMatchObject({
      type: 'contract_call',
      amount: 14500.1,
      counterparty: 'AS1gUw…UZ1p',
    });
    expect(records.find((r) => r.id === 'Oexec')).toMatchObject({
      type: 'contract_call',
      amount: 0,
      to: undefined,
    });
  });

  it('dates an operation by the slot it was included in, not by when the indexer saw it', async () => {
    respondWith({
      created: list([
        // Back-filled: seen by the indexer days after it happened.
        op({ id: 'Oold', first_seen_ts_ms: SLOT_TIME + 730_000_000 }),
        op({ id: 'Onew', inclusions: [], first_seen_ts_ms: 1_800_000_000_000 }),
      ]),
    });
    const { records } = await api.getHistory(ME);
    expect(records.find((r) => r.id === 'Oold')?.timestamp).toBe(SLOT_TIME);
    expect(records.find((r) => r.id === 'Onew')?.timestamp).toBe(1_800_000_000_000);
  });

  it('maps statuses: final, executed but not final, not executed, failed, back-filled', async () => {
    respondWith({
      created: list([
        op({ id: 'Ofinal' }),
        op({ id: 'Ocand', final_exec_status: null }),
        op({ id: 'Onone', candidate_exec_status: null, final_exec_status: null, inclusions: [] }),
        op({ id: 'Ofail', candidate_exec_status: 'failed', final_exec_status: 'failed' }),
        op({ id: 'Ofailing', candidate_exec_status: 'failed', final_exec_status: null }),
        op({ id: 'Obackfill', candidate_exec_status: null, final_exec_status: 'ok' }),
      ]),
    });
    const { records } = await api.getHistory(ME);
    const status = (id: string) => records.find((r) => r.id === id)?.status;
    expect(status('Ofinal')).toBe('final');
    expect(status('Ocand')).toBe('pending');
    expect(status('Onone')).toBe('pending');
    expect(status('Ofail')).toBe('failed');
    expect(status('Ofailing')).toBe('failed');
    expect(status('Obackfill')).toBe('final');
  });

  it('reads amounts given as digit strings too, and ignores garbage', async () => {
    respondWith({
      created: list([
        op({ id: 'Ostr', details: { amount_nmas: '2170460799999.9998' }, fee_nmas: '10000000' }),
        op({ id: 'Obad', details: { amount_nmas: -5 }, fee_nmas: 'x' }),
      ]),
    });
    const { records } = await api.getHistory(ME);
    expect(records.find((r) => r.id === 'Ostr')).toMatchObject({
      amount: 2170.460799999,
      fee: 0.01,
    });
    expect(records.find((r) => r.id === 'Obad')).toMatchObject({ amount: 0, fee: 0 });
  });

  it('reads both streams first, then only the requested ones with their cursors', async () => {
    const fetchMock = respondWith({ created: list([op({ id: 'Oa' })], 'next-c') });
    const first = await api.getHistory(ME);
    const urls = fetchMock.mock.calls.map(([u]) => new URL(u as string));
    expect(urls.map((u) => u.origin + u.pathname).sort()).toEqual([
      `https://indexer-api.massa.net/v1/addresses/${ME}/ops`,
      `https://indexer-api.massa.net/v1/addresses/${ME}/received_ops`,
    ]);
    expect(urls.every((u) => u.searchParams.get('limit') === '20')).toBe(true);
    expect(urls.every((u) => u.searchParams.get('cursor') === null)).toBe(true);
    expect(first.streams.created).toEqual({ cursor: 'next-c', oldest: SLOT_TIME });
    expect(first.streams.received).toEqual({ cursor: null, oldest: Infinity });

    fetchMock.mockClear();
    await api.getHistory(ME, { created: 'AABl_x-y' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe(`/v1/addresses/${ME}/ops`);
    expect(url.searchParams.get('cursor')).toBe('AABl_x-y');
  });

  it('stops paging when the indexer says there is no more', async () => {
    respondWith({
      created: { network: 'mainnet', has_more: false, cursor_next: 'stale', data: [] },
      received: { network: 'mainnet', data: [], next_cursor: 'spec-name' },
    });
    const { streams } = await api.getHistory(ME);
    expect(streams.created?.cursor).toBeNull();
    expect(streams.received?.cursor).toBe('spec-name');
  });

  it('throws on an HTTP error', async () => {
    respondWith({}, 503);
    await expect(api.getHistory(ME)).rejects.toThrow(/503/);
  });

  it('throws on a body without a data list', async () => {
    respondWith({ created: { type: '/errors/400', title: 'Bad Request' } });
    await expect(api.getHistory(ME)).rejects.toThrow(/unexpected response/);
  });

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      ),
    );
    const result = api.getHistory(ME);
    const settled = vi.fn();
    result.catch(settled);
    await vi.advanceTimersByTimeAsync(INDEXER_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).rejects.toThrow(/aborted/);
  });
});
