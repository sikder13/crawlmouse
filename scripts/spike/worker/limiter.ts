/**
 * Per-host politeness limiter (ENGINE-GAP 8.6, 8.7; ARCH-2 4.2 step 2..n).
 *
 *  - Request starts are at least `gapMs()` apart: max(500 ms, declared Crawl-delay). 500 ms is the 2 req/s cap.
 *  - One request in flight, except under the slow-host rule: when the median latency of the last 20
 *    responses exceeds 500 ms, two may be in flight while starts stay at most 2 per second.
 *  - The slow-host rule never applies while the gap is above 500 ms (a declared Crawl-delay).
 *
 * Timing uses Date.now and setTimeout so fake timers drive it in tests.
 */

export const SLOW_MEDIAN_MS = 500;
export const SLOW_WINDOW = 20;
export const FLOOR_GAP_MS = 500;

export function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface LimiterStats {
  started: number;
  maxInFlight: number;
  /** Milliseconds from the first start to the moment the slow-host rule first applied; null if it never did. */
  slowRuleFiredAtMs: number | null;
  /** Number of responses completed when the rule first applied. */
  slowRuleFiredAtCount: number | null;
}

export class HostLimiter {
  private readonly rps: number;
  private readonly slowRule: boolean;
  private crawlDelayMs = 0;
  private nextStartAt = 0;
  private lastStartAt: number | null = null;
  private inFlight = 0;
  private maxInFlight = 0;
  private started = 0;
  private firstStartAt: number | null = null;
  private latencies: number[] = [];
  private slowFiredAt: number | null = null;
  private slowFiredCount: number | null = null;
  private slowActive = false;
  private readonly waiting: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  /** TEST ONLY: replaces the gap floor so integration tests do not wait in real time. Never set outside tests. */
  private readonly unsafeGapOverrideMs: number | undefined;

  constructor(opts: { rps: number; slowRule?: boolean; unsafeGapOverrideMs?: number }) {
    this.unsafeGapOverrideMs = opts.unsafeGapOverrideMs;
    if (!(opts.rps > 0 && opts.rps <= 2)) throw new Error('rps must be in (0, 2]: the polite cap is 2 req/s');
    this.rps = opts.rps;
    this.slowRule = opts.slowRule ?? true;
  }

  /** A delay learned after requests have started also pushes out the next start, measured from the last one. */
  setCrawlDelayMs(ms: number): void {
    this.crawlDelayMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (this.lastStartAt !== null) this.nextStartAt = Math.max(this.nextStartAt, this.lastStartAt + this.gapMs());
  }

  gapMs(): number {
    if (this.unsafeGapOverrideMs !== undefined) return this.unsafeGapOverrideMs;
    return Math.max(FLOOR_GAP_MS, 1000 / this.rps, this.crawlDelayMs);
  }

  private maxConcurrent(): number {
    return this.slowActive && this.gapMs() <= FLOOR_GAP_MS ? 2 : 1;
  }

  stats(): LimiterStats {
    return {
      started: this.started,
      maxInFlight: this.maxInFlight,
      slowRuleFiredAtMs: this.slowFiredAt,
      slowRuleFiredAtCount: this.slowFiredCount,
    };
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push(() => {
        const t0 = Date.now();
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        this.started++;
        if (this.firstStartAt === null) this.firstStartAt = t0;
        fn().then(resolve, reject).finally(() => {
          this.inFlight--;
          this.recordLatency(Date.now() - t0);
          this.pump();
        });
      });
      this.pump();
    });
  }

  private recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > SLOW_WINDOW) this.latencies.shift();
    if (!this.slowRule || this.latencies.length < SLOW_WINDOW) return;
    const slow = medianOf(this.latencies) > SLOW_MEDIAN_MS;
    if (slow && this.gapMs() <= FLOOR_GAP_MS && this.slowFiredAt === null) {
      this.slowFiredAt = Date.now() - (this.firstStartAt ?? Date.now());
      this.slowFiredCount = this.started;
    }
    this.slowActive = slow;
  }

  private pump(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.waiting.length === 0 || this.inFlight >= this.maxConcurrent()) return;
    const now = Date.now();
    if (now < this.nextStartAt) {
      this.timer = setTimeout(() => this.pump(), this.nextStartAt - now);
      return;
    }
    this.nextStartAt = now + this.gapMs();
    this.lastStartAt = now;
    const start = this.waiting.shift()!;
    start();
    this.pump();
  }
}
