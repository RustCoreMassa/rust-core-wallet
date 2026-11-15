import { Injectable } from '@angular/core';
import { TOKEN_LIST } from '../models/token.model';
import {
  HistoryStream,
  HistoryStreamState,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from '../models/transaction.model';
import { ROLL_PRICE_MAS } from './massa-provider';
import { fromUnits } from '../utils/token-amount';

/**
 * Massa's public indexer — the API behind explorer.massa.net (it replaced
 * explorer-api.massa.net in November 2026). Mainnet only: there is no
 * public indexer for buildnet.
 */
const INDEXER_API = 'https://indexer-api.massa.net';
/** Operations per stream and page. */
const PAGE_SIZE = 20;
/** A hung request must not keep a refresh waiting: give up after this. */
export const INDEXER_TIMEOUT_MS = 15_000;
const MAS_DECIMALS = 9;

/** Mainnet slot timing (the indexer's /v1/status reports the same values). */
const GENESIS_MS = 1_705_312_800_000;
const T0_MS = 16_000;
const THREAD_COUNT = 32;

/** Only the fields the wallet reads; amounts are nanoMAS JSON numbers. */
interface IndexerOperation {
  readonly id: string;
  readonly creator: string;
  /** Recipient of a transaction, contract of a call; null for roll operations. */
  readonly target?: string | null;
  /** `transaction` | `call_sc` | `execute_sc` | `roll_buy` | `roll_sell`. */
  readonly kind: string;
  readonly fee_nmas?: number | string;
  readonly inclusions?: readonly {
    readonly slot: { readonly period: number; readonly thread: number };
  }[];
  /** `ok` | `failed`; null until executed (the candidate one is also null on back-filled ops). */
  readonly candidate_exec_status?: string | null;
  readonly final_exec_status?: string | null;
  readonly details?: {
    readonly amount_nmas?: number | string;
    readonly coins_nmas?: number | string;
    readonly roll_count?: number;
  } | null;
  /** When the indexer first saw it — days late for back-filled ops, so only a fallback. */
  readonly first_seen_ts_ms?: number;
}

interface IndexerOperationList {
  readonly data: readonly IndexerOperation[];
  readonly has_more?: boolean;
  /** Present only while there are more pages. (The OpenAPI file calls it `next_cursor`.) */
  readonly cursor_next?: string | null;
  readonly next_cursor?: string | null;
}

export interface HistoryPage {
  /** Newest first. */
  readonly records: TransactionRecord[];
  /** New paging state, only for the stream(s) this request read. */
  readonly streams: Partial<Record<HistoryStream, HistoryStreamState>>;
}

const TOKEN_BY_CONTRACT = new Map(
  TOKEN_LIST.filter((t) => t.contract).map((t) => [t.contract, t.symbol]),
);

/** Indexer path of each stream. */
const STREAM_PATH: Record<HistoryStream, string> = {
  created: 'ops',
  received: 'received_ops',
};

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** nanoMAS (JSON number, or a digit string) → MAS; anything else → 0. */
function masFromNano(value: number | string | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0
      ? fromUnits(BigInt(Math.trunc(value)), MAS_DECIMALS)
      : 0;
  }
  const whole = (value ?? '').split('.')[0];
  return /^\d+$/.test(whole) ? fromUnits(BigInt(whole), MAS_DECIMALS) : 0;
}

/** Block time of the slot the operation was included in. */
function timestampOf(op: IndexerOperation): number {
  const slot = op.inclusions?.[0]?.slot;
  if (slot) return GENESIS_MS + slot.period * T0_MS + slot.thread * (T0_MS / THREAD_COUNT);
  return op.first_seen_ts_ms ?? Date.now();
}

function statusOf(op: IndexerOperation): TransactionStatus {
  const executed = op.final_exec_status ?? op.candidate_exec_status;
  if (executed == null) return 'pending';
  if (executed !== 'ok') return 'failed';
  return op.final_exec_status === 'ok' ? 'final' : 'pending';
}

function createdType(op: IndexerOperation): TransactionType {
  switch (op.kind) {
    case 'transaction':
      return 'send';
    case 'roll_buy':
      return 'buy_rolls';
    case 'roll_sell':
      return 'sell_rolls';
    default:
      return 'contract_call';
  }
}

/** MAS moved by the operation itself (a call's coins, a transfer's amount). */
function masAmountOf(op: IndexerOperation): number {
  return masFromNano(op.details?.amount_nmas ?? op.details?.coins_nmas);
}

function streamState(
  records: readonly TransactionRecord[],
  cursor: string | null | undefined,
): HistoryStreamState {
  return {
    cursor: cursor || null,
    oldest: records.reduce((min, r) => Math.min(min, r.timestamp), Infinity),
  };
}

/**
 * Reads an address's on-chain history from Massa's indexer API and maps
 * it to TransactionRecord.
 *
 * Two streams, each newest first and paged by its own opaque cursor:
 * operations the address created (`/ops`) and operations whose target is
 * the address (`/received_ops` — incoming transfers). Without cursors a
 * call reads the newest page of both; with cursors, only the streams given.
 *
 * MAS that a smart contract sends to the address (e.g. a swap's output)
 * is not an operation targeting it, so it doesn't show up as a receive:
 * the indexer's `/transfers` list would have it, but it only covers
 * activity since the indexer started (May 2026) and its pages aren't in
 * time order, so it can't be paged alongside the two streams.
 */
@Injectable({ providedIn: 'root' })
export class ExplorerApi {
  async getHistory(
    address: string,
    cursors?: Partial<Record<HistoryStream, string>>,
  ): Promise<HistoryPage> {
    const readCreated = !cursors || !!cursors.created;
    const readReceived = !cursors || !!cursors.received;

    const [created, received] = await Promise.all([
      readCreated ? this.readStream(address, 'created', cursors?.created) : null,
      readReceived ? this.readStream(address, 'received', cursors?.received) : null,
    ]);

    const createdRecords = (created?.data ?? []).map((op) => this.fromCreated(op));
    const receivedRecords = (received?.data ?? []).map((op) => this.fromReceived(op));
    const streams: HistoryPage['streams'] = {};
    if (created) streams.created = streamState(createdRecords, nextCursor(created));
    if (received) streams.received = streamState(receivedRecords, nextCursor(received));

    return {
      records: [...createdRecords, ...receivedRecords].sort((a, b) => b.timestamp - a.timestamp),
      streams,
    };
  }

  private async readStream(
    address: string,
    stream: HistoryStream,
    cursor: string | undefined,
  ): Promise<IndexerOperationList> {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const url = `${INDEXER_API}/v1/addresses/${encodeURIComponent(address)}/${STREAM_PATH[stream]}?${params}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Indexer API responded ${response.status}`);
      const body = (await response.json()) as IndexerOperationList | null;
      if (!body || !Array.isArray(body.data)) throw new Error('Indexer API: unexpected response');
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  private fromCreated(op: IndexerOperation): TransactionRecord {
    const type = createdType(op);
    const rolls = type === 'buy_rolls' || type === 'sell_rolls';
    const rollCount = rolls ? (op.details?.roll_count ?? 0) : undefined;
    const target = op.target || undefined;
    const token = target && TOKEN_BY_CONTRACT.get(target);
    return {
      ...this.base(op),
      type,
      // Roll operations: their MAS value (100 MAS a roll), as before.
      amount: rolls ? (rollCount ?? 0) * ROLL_PRICE_MAS : masAmountOf(op),
      fee: masFromNano(op.fee_nmas),
      counterparty: token ? `${token} contract` : target && shortAddress(target),
      rollCount,
    };
  }

  private fromReceived(op: IndexerOperation): TransactionRecord {
    return {
      ...this.base(op),
      type: 'receive',
      amount: masAmountOf(op),
      counterparty: shortAddress(op.creator),
    };
  }

  private base(op: IndexerOperation) {
    return {
      id: op.id,
      from: op.creator,
      // Roll operations have no recipient.
      to: op.target || undefined,
      operationId: op.id,
      token: 'MAS' as const,
      timestamp: timestampOf(op),
      status: statusOf(op),
    };
  }
}

function nextCursor(list: IndexerOperationList): string | null {
  if (list.has_more === false) return null;
  return list.cursor_next ?? list.next_cursor ?? null;
}
