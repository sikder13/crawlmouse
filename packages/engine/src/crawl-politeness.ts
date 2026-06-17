import { BACKOFF_BUDGET_SLACK_MS, MAX_BACKOFF_MS } from './constants.js';

/**
 * Polite-crawl primitives (SPEC 01 §5, ENGINE_V2). Pure + framework-free so they unit-test
 * without a live crawl; the crawler wires them into Crawlee's errorHandler / requestHandler.
 */

/**
 * Parse an HTTP `Retry-After` header into milliseconds (0 if absent/invalid/past). Honors both
 * forms the RFC allows: delta-seconds (`"120"`) and an HTTP-date. A non-positive or past value → 0
 * so it never *shortens* a backoff (it is only ever used as a `Math.max` minimum).
 */
export function parseRetryAfter(header: string | string[] | undefined, now: number = Date.now()): number {
  if (header == null) return 0;
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw == null) return 0;
  const value = String(raw).trim();
  if (!value) return 0;
  if (/^\d+$/.test(value)) {
    const secs = Number(value);
    return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
  }
  const when = Date.parse(value);
  if (Number.isNaN(when)) return 0;
  const delta = when - now;
  return delta > 0 ? delta : 0;
}

/**
 * Exponential full-jitter backoff (§5): `rand(0, base · 2^attempt)`. Full jitter (vs. equal jitter)
 * de-synchronizes retries from many concurrent slots so a throttled host isn't hammered in lockstep.
 * `rng` is injectable for deterministic tests; production uses `Math.random` (timing only — it never
 * affects which pages are graded, so R1 determinism on clean crawls is unaffected).
 */
export function fullJitterBackoffMs(attempt: number, baseMs: number, rng: () => number = Math.random): number {
  const ceiling = baseMs * 2 ** Math.max(0, attempt);
  return rng() * ceiling;
}

/**
 * Clamp a desired backoff so it never (a) exceeds MAX_BACKOFF_MS or (b) runs past the wall-clock
 * deadline (minus a slack margin). Guarantees a hostile `Retry-After: 3600` can't stall a slot and
 * that the crawl stops *gracefully* at its budget instead of hanging inside a retry delay.
 * `deadlineMs` may be `Infinity` (no budget).
 */
export function capDelayMs(wantMs: number, deadlineMs: number, nowMs: number): number {
  const budgetRemaining = deadlineMs === Infinity ? Infinity : deadlineMs - nowMs - BACKOFF_BUDGET_SLACK_MS;
  return Math.max(0, Math.min(wantMs, MAX_BACKOFF_MS, budgetRemaining));
}

/**
 * Whether a fetch outcome is a `blocked`/throttle signal (§5): 403/429, any 5xx, or status 0
 * (network error / timeout — no response). 404/410 and other non-200s are `dead`, not throttles,
 * so they trigger neither a backoff nor a concurrency halving.
 */
export function isThrottleStatus(status: number): boolean {
  if (status === 0) return true;
  if (status === 403 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/** Minimal view of Crawlee's AutoscaledPool — just the two knobs AIMD drives. */
export interface ConcurrencyPool {
  maxConcurrency: number;
  desiredConcurrency: number;
}

/** Per-crawl telemetry surfaced on the crawl output (and, later, to PostHog). */
export interface AimdTelemetry {
  /** Lowest cap reached (a halving leaves a fingerprint here). */
  minConcurrency: number;
  /** Highest cap reached (a healthy ramp reaches the ceiling). */
  maxConcurrency: number;
  halvings: number;
  increases: number;
}

export interface AimdOptions {
  /** Initial cap (effective concurrency to start at). */
  start: number;
  /** Hard upper bound the ramp may reach (already tier-clamped by the caller). */
  ceiling: number;
  /** Lower bound a halving may reach. */
  floor: number;
  /** Consecutive 200s required before a +1 step. */
  successStep: number;
}

/**
 * AIMD concurrency controller (§5, T7). Owns a single `cap` written to BOTH `maxConcurrency` and
 * `desiredConcurrency` so the effective parallelism is the cap (and Crawlee's resource autoscaler
 * can still throttle *below* it under genuine system load, but never re-ramp *above* it — which is
 * why a halving must lower `maxConcurrency`, not just `desiredConcurrency`). Additive-increase: +1
 * after `successStep` clean 200s. Multiplicative-decrease: halve on any throttle.
 */
export class AimdController {
  private cap: number;
  private streak = 0;
  private halvings = 0;
  private increases = 0;
  private telMin: number;
  private telMax: number;

  constructor(
    private readonly pool: ConcurrencyPool,
    private readonly opts: AimdOptions,
  ) {
    this.cap = opts.start;
    this.telMin = opts.start;
    this.telMax = opts.start;
    this.applyCap(opts.start, 'init');
  }

  private applyCap(n: number, dir: 'up' | 'down' | 'init'): void {
    // Defensive ordering: raise max before desired, lower desired before max, so the pool never sits
    // in a transient desired > max state. (Crawlee 3.16's setters only validate `integer >= 1`, not
    // the cross-field invariant, so this is belt-and-suspenders against a future tightening.)
    if (dir === 'up') {
      this.pool.maxConcurrency = n;
      this.pool.desiredConcurrency = n;
    } else {
      this.pool.desiredConcurrency = n;
      this.pool.maxConcurrency = n;
    }
    this.cap = n;
    if (n < this.telMin) this.telMin = n;
    if (n > this.telMax) this.telMax = n;
  }

  onSuccess(): void {
    this.streak += 1;
    if (this.streak < this.opts.successStep) return;
    this.streak = 0;
    if (this.cap >= this.opts.ceiling) return;
    this.applyCap(Math.min(this.opts.ceiling, this.cap + 1), 'up');
    this.increases += 1;
  }

  onThrottle(): void {
    this.streak = 0;
    const next = Math.max(this.opts.floor, Math.ceil(this.cap / 2));
    if (next < this.cap) {
      this.applyCap(next, 'down');
      this.halvings += 1;
    }
  }

  get telemetry(): AimdTelemetry {
    return {
      minConcurrency: this.telMin,
      maxConcurrency: this.telMax,
      halvings: this.halvings,
      increases: this.increases,
    };
  }
}

/**
 * Build the Crawlee `autoscaledPoolOptions` for the polite path. Replicates Crawlee's
 * HTTP-optimized snapshotter/system-status tuning (which we'd otherwise lose by passing our own
 * options object) and sets the initial concurrency to `start` (the AIMD controller raises the cap
 * toward its ceiling from there). Returns a fresh object (incl. fresh nested options) per call so
 * concurrent crawls never share mutable pool state.
 */
export function politeAutoscaledPoolOptions(bounds: { start: number; floor: number }): {
  minConcurrency: number;
  maxConcurrency: number;
  desiredConcurrency: number;
  snapshotterOptions: { eventLoopSnapshotIntervalSecs: number; maxBlockedMillis: number };
  systemStatusOptions: { maxEventLoopOverloadedRatio: number };
} {
  return {
    minConcurrency: bounds.floor,
    maxConcurrency: bounds.start,
    desiredConcurrency: bounds.start,
    snapshotterOptions: { eventLoopSnapshotIntervalSecs: 2, maxBlockedMillis: 100 },
    systemStatusOptions: { maxEventLoopOverloadedRatio: 0.7 },
  };
}
