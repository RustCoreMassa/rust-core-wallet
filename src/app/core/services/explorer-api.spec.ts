import { ExplorerApi } from './explorer-api';

const ME = 'AU126s93ZxbT4QUJcZYqsAxyMc3wv8nkHJYKYCtgQyEnZ8VGRM99P';
const USDC = 'AS1hCJXjndR4c9vekLWsXGnrdigp4AaZ7uYG3UKFzzKnWVsrNLPJ';

function op(partial: Record<string, unknown>) {
  return {
    hash: 'O1',
    block_time: '1789551961000',
    status: 'Final',
    type: 'Transaction',
    from: ME,
    to: 'AU1other00000000000000000000000000000000000000000',
    value: '1000000000',
    transaction_fee: '10000000',
    op_exec_status: true,
    ...partial,
  };
}

function respondWith(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ExplorerApi', () => {
  const api = new ExplorerApi();
  afterEach(() => vi.unstubAllGlobals());

  it('maps created and received operations, newest first', async () => {
    respondWith({
      operationsCreated: [
        op({ hash: 'Osend', block_time: '2000' }),
        op({ hash: 'Ocall', type: 'CallSC', to: USDC, value: '0', block_time: '3000' }),
        op({ hash: 'Oroll', type: 'BuyRoll', to: '-', value: '1500000000000', block_time: '1000' }),
      ],
      operationsReceived: [
        op({
          hash: 'Ocall_0',
          from: 'AS1pool',
          to: ME,
          value: '58300000',
          block_time: '3000',
          transaction_fee: '0',
        }),
      ],
    });
    const { records } = await api.getHistory(ME);

    expect(records.map((r) => r.id)).toEqual(['Ocall', 'Ocall_0', 'Osend', 'Oroll']);
    expect(records.find((r) => r.id === 'Osend')).toMatchObject({
      type: 'send',
      amount: 1,
      fee: 0.01,
      status: 'final',
    });
    expect(records.find((r) => r.id === 'Ocall')).toMatchObject({
      type: 'contract_call',
      counterparty: 'USDC.e contract',
    });
    expect(records.find((r) => r.id === 'Ocall_0')).toMatchObject({
      type: 'receive',
      operationId: 'Ocall',
      amount: 0.0583,
    });
    expect(records.find((r) => r.id === 'Oroll')).toMatchObject({
      type: 'buy_rolls',
      rollCount: 15,
      amount: 1500,
      to: undefined,
    });
  });

  it('drops the sub-nanoMAS fraction the API sometimes returns', async () => {
    respondWith({ operationsReceived: [op({ hash: 'Obig', value: '2170460799999.9998' })] });
    const { records } = await api.getHistory(ME);
    expect(records[0].amount).toBe(2170.460799999);
  });

  it('maps statuses: failed execution, pending, final', async () => {
    respondWith({
      operationsCreated: [
        op({ hash: 'Ofail', op_exec_status: false }),
        op({ hash: 'Opend', status: 'Pending' }),
      ],
    });
    const { records } = await api.getHistory(ME);
    expect(records.find((r) => r.id === 'Ofail')?.status).toBe('failed');
    expect(records.find((r) => r.id === 'Opend')?.status).toBe('pending');
  });

  it('reads both streams first, then only the requested ones with their cursors', async () => {
    const fetchMock = respondWith({ operationsCreated: [], nextCursorCreated: 'next-c' });
    const first = await api.getHistory(ME);
    expect(fetchMock.mock.calls[0][0]).toContain('from=true&to=true');
    expect(first.streams.created?.cursor).toBe('next-c');
    expect(first.streams.received?.cursor).toBeNull();

    await api.getHistory(ME, { created: '{"cursor":1}' });
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.searchParams.get('from')).toBe('true');
    expect(url.searchParams.get('to')).toBeNull();
    expect(url.searchParams.get('cursorCreated')).toBe('{"cursor":1}');
  });

  it('throws on an HTTP error', async () => {
    respondWith({}, 503);
    await expect(api.getHistory(ME)).rejects.toThrow(/503/);
  });
});
