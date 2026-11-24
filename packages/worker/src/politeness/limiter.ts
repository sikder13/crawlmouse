import type { Clock } from '../clock.js';

/**
 * Request pacing for one site (one `Sites.keyOf` key: its registrable domain, or on a worker with
 * LAB_HOST_POLITENESS one lab host), shared by every batch in the process.
 *
 * - Request STARTS are at least `gapMs()` apart, measured start to start, never from a response.
 *   The floor is 500 ms, which is 2 requests per second.
 * - A Crawl-delay raises the gap. The gap is never lowered while the limiter lives, so two origins
 *   of one site that declare different delays get the larger one.
 * - One request in flight, except under the slow-host rule: when the median latency of the last 20
 *   responses exceeds 500 ms and the gap is at the floor, two may be in flight. Starts still obey the
 *   gap, so the rate stays at or below 2 per second.
 * - A queued task whose signal aborts before it starts is dropped without using a start.
 */

export const FLOOR_GAP_MS = 500;
export const SLOW_MEDIAN_MS = 500;
export const SLOW_WINDOW = 20;

export function medianOf(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export type Scheduled<T> = { ran: true; value: T } | { ran: false };

interface Waiting {
  start: () => void;
  /** The latest moment this task may start; past it, it is dropped rather than waited for. */
  latestAt?: number;
  drop: () => void;
}

export class SiteLimiter {
  private gap = FLOOR_GAP_MS;
  private nextStartAt = 0;
  private lastStartAt: number | null = null;
  private inFlight = 0;
  private startedCount = 0;
  private maxInFlightSeen = 0;
  private latencies: number[] = [];
  private slow = false;
  private pumping = false;
  private readonly queue: Waiting[] = [];
  private lastActivityAt: number;

  constructor(private readonly clock: Clock) {
    this.lastActivityAt = clock.now();
  }

  gapMs(): number {
    return this.gap;
  }

  /** Raises the gap to `ms` if larger. A start already scheduled is pushed out from the last start. */
  raiseGapMs(ms: number): void {
    if (!(Number.isFinite(ms) && ms > this.gap)) return;
    this.gap = ms;
    if (this.lastStartAt !== null) {
      this.nextStartAt = Math.max(this.nextStartAt, this.lastStartAt + this.gap);
    }
  }

  /** Holds the next start until `at`, a moment on this limiter's clock. Never brings it forward. */
  pauseUntil(at: number): void {
    if (Number.isFinite(at)) this.nextStartAt = Math.max(this.nextStartAt, at);
    // A task queued for another batch may now be unable to start before its deadline.
    this.dropLate();
  }

  /** The earliest a queued task could start now. */
  private startAt(): number {
    return Math.max(this.nextStartAt, this.clock.now());
  }

  /**
   * Drops every queued task that cannot start by its `latestAt`. Called where the start moves later
   * (a pause) or a task is queued, as well as in the pump: the pump may be asleep through a long
   * pause, and a task queued meanwhile must not wait for it to wake.
   */
  private dropLate(): void {
    const startAt = this.startAt();
    const late = this.queue.filter((w) => w.latestAt !== undefined && w.latestAt < startAt);
    for (const w of late) this.queue.splice(this.queue.indexOf(w), 1);
    for (const w of late) w.drop();
  }

  get started(): number {
    return this.startedCount;
  }

  get maxInFlight(): number {
    return this.maxInFlightSeen;
  }

  /** True when nothing is queued or running and the last activity is older than `ms`. */
  idleFor(ms: number): boolean {
    return (
      this.queue.length === 0 && this.inFlight === 0 && this.clock.now() - this.lastActivityAt >= ms
    );
  }

  /**
   * `latestAt`: a task that could not start by then (a pause or the gap holds the site past it) is
   * dropped, answering `{ ran: false }`, instead of being waited for: when it is queued, when a pause
   * makes it late, and when the pump reaches it. A batch passes its own deadline, so a long wait asked
   * by the site, for this batch or another one on the same site, does not run it past its time.
   */
  schedule<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
    latestAt?: number,
  ): Promise<Scheduled<T>> {
    if (signal?.aborted) return Promise.resolve({ ran: false });
    return new Promise<Scheduled<T>>((resolve, reject) => {
      const onAbort = () => {
        const i = this.queue.indexOf(waiting);
        if (i >= 0) {
          this.queue.splice(i, 1);
          resolve({ ran: false });
        }
      };
      const waiting: Waiting = {
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          this.run(task).then((value) => resolve({ ran: true, value }), reject);
        },
        ...(latestAt !== undefined && { latestAt }),
        drop: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve({ ran: false });
        },
      };
      if (latestAt !== undefined && latestAt < this.startAt()) return resolve({ ran: false });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiting);
      void this.pump();
    });
  }

  private maxConcurrent(): number {
    return this.slow && this.gap <= FLOOR_GAP_MS ? 2 : 1;
  }

  private async run<T>(task: () => Promise<T>): Promise<T> {
    const t0 = this.clock.now();
    try {
      return await task();
    } finally {
      this.inFlight--;
      this.recordLatency(this.clock.now() - t0);
      this.lastActivityAt = this.clock.now();
      void this.pump();
    }
  }

  private recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > SLOW_WINDOW) this.latencies.shift();
    this.slow = this.latencies.length >= SLOW_WINDOW && medianOf(this.latencies) > SLOW_MEDIAN_MS;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.inFlight < this.maxConcurrent()) {
        const before = this.queue.length;
        this.dropLate();
        if (this.queue.length !== before) continue;
        const wait = this.nextStartAt - this.clock.now();
        if (wait > 0) {
          await this.clock.sleep(wait);
          continue;
        }
        const next = this.queue.shift()!;
        const now = this.clock.now();
        this.lastStartAt = now;
        this.nextStartAt = now + this.gap;
        this.inFlight++;
        this.startedCount++;
        this.maxInFlightSeen = Math.max(this.maxInFlightSeen, this.inFlight);
        this.lastActivityAt = now;
        next.start();
      }
    } finally {
      this.pumping = false;
    }
  }
}
