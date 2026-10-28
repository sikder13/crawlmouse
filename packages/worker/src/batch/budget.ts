import type { Clock } from '../clock.js';
import { MAX_BODY_BYTES, MAX_REQUEST_MS, type FetchLimits } from '../fetch/fetcher.js';

/**
 * A batch's request, byte and time budgets, all three required in the request body. A request is
 * taken from the budget before it is sent; once any budget is spent no further request starts, and
 * the batch says which one ran out. A request is never sent with more bytes or time than remain, so
 * no budget is overrun by a response already in flight.
 */

export interface BudgetLimits {
  max_requests: number;
  max_bytes: number;
  max_seconds: number;
}

export type BudgetKind = 'requests' | 'bytes' | 'seconds';

export class Budget {
  private requests = 0;
  private bytes = 0;
  private spent: BudgetKind | null = null;
  private readonly startedAt: number;

  constructor(
    private readonly limits: BudgetLimits,
    private readonly clock: Clock,
  ) {
    this.startedAt = clock.now();
  }

  /** Takes one request from the budget. Null on success; otherwise the budget that is spent. */
  take(): BudgetKind | null {
    if (this.spent) return this.spent;
    if (this.clock.now() - this.startedAt >= this.limits.max_seconds * 1000) this.spent = 'seconds';
    else if (this.requests >= this.limits.max_requests) this.spent = 'requests';
    else if (this.bytes >= this.limits.max_bytes) this.spent = 'bytes';
    if (this.spent) return this.spent;
    this.requests++;
    return null;
  }

  addBytes(n: number): void {
    this.bytes += n;
  }

  /** What one request may use: the per-request ceilings, or what is left, whichever is smaller. */
  requestLimits(): FetchLimits {
    const msLeft = this.limits.max_seconds * 1000 - (this.clock.now() - this.startedAt);
    return {
      maxBytes: Math.max(1, Math.min(MAX_BODY_BYTES, this.limits.max_bytes - this.bytes)),
      deadlineMs: Math.max(1, Math.min(MAX_REQUEST_MS, msLeft)),
    };
  }

  get exhausted(): BudgetKind | null {
    return this.spent;
  }

  get used(): { requests: number; bytes: number } {
    return { requests: this.requests, bytes: this.bytes };
  }
}
