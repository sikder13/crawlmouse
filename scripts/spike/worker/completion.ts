import { verifyJwt } from './auth.js';

/**
 * Reference logic for `POST /api/internal/batch-done` (ARCH-2 4.4.1, 4.4.2). The spike runs it behind
 * a node:http fixture so the five cases of spike spec 2.7 can be exercised offline and then repeated
 * against the Vercel preview. The state change is one synchronous check-and-set, the in-memory form of
 * `update crawl_batches set state = 'done' ... where state <> 'done'`; the event is sent after it.
 */

export interface BatchCounters {
  fetched: number;
  newUrls: number;
  blocked: number;
  bytes: number;
  partial: boolean;
}

export interface DoneEvent {
  name: 'check.batch.done';
  id: string;
  data: { checkId: string; batch: number; batchId: string } & BatchCounters;
}

export const eventIdFor = (checkId: string, batch: number, nonce: string): string =>
  `batch:${checkId}:${batch}:${nonce}`;

export interface CompletionRequest {
  jwt: string;
  checkId: string;
  batch: number;
  nonce: string;
  counters: BatchCounters;
}

export interface CompletionResponse {
  status: 200 | 401 | 403 | 404 | 409;
  reason: string;
}

interface Row {
  nonce: string;
  state: 'open' | 'done';
  counters?: BatchCounters;
}

export class CompletionRoute {
  private readonly rows = new Map<string, Row>();

  constructor(
    private readonly deps: {
      jwtSecret: string;
      now: () => number;
      emit: (e: DoneEvent) => Promise<void>;
    },
  ) {}

  openBatch(i: { checkId: string; batch: number; nonce: string }): void {
    this.rows.set(`${i.checkId}:${i.batch}`, { nonce: i.nonce, state: 'open' });
  }

  stateOf(checkId: string, batch: number): 'open' | 'done' | undefined {
    return this.rows.get(`${checkId}:${batch}`)?.state;
  }

  async handle(req: CompletionRequest): Promise<CompletionResponse> {
    const v = verifyJwt(req.jwt, this.deps.jwtSecret, {
      now: this.deps.now(),
      expect: { check_id: req.checkId, batch: req.batch, nonce: req.nonce },
    });
    if (!v.ok) {
      return v.reason === 'claim_mismatch' || v.reason === 'wrong_role'
        ? { status: 403, reason: v.reason }
        : { status: 401, reason: v.reason };
    }
    const row = this.rows.get(`${req.checkId}:${req.batch}`);
    if (!row) return { status: 404, reason: 'no_such_batch' };
    if (row.nonce !== req.nonce) return { status: 403, reason: 'nonce_mismatch' };
    // Check and set with no await between them: a second caller cannot interleave.
    if (row.state === 'done') return { status: 409, reason: 'already_done' };
    row.state = 'done';
    row.counters = req.counters;
    await this.deps.emit({
      name: 'check.batch.done',
      id: eventIdFor(req.checkId, req.batch, req.nonce),
      data: { checkId: req.checkId, batch: req.batch, batchId: `${req.checkId}:${req.batch}`, ...req.counters },
    });
    return { status: 200, reason: 'applied' };
  }
}
