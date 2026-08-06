import { createHash } from 'node:crypto';
import { selectFrontier, sampleKey, type FrontierSelection } from './frontier.js';
import { templateKeyFor } from './template-key.js';

/**
 * SPEC 5.1a §8 (Stage 5) — the DURABLE FRONTIER CHECKPOINT, pure half.
 *
 * NOT resumability in the SPEC 06 sense. This is a durable home for frontier state so a timed-out
 * crawl resumes rather than restarts, and so the §6.7 fingerprint survives the interruption. Multi-step
 * Inngest continuation, scheduled re-crawls and incremental crawling are explicitly SPEC 06.
 *
 * THE ONE PROPERTY THAT MATTERS: a resumed crawl must select the SAME pages a straight-through crawl
 * would have. A checkpoint without that is worse than no checkpoint — it reintroduces composition
 * drift through the back door, and drift is the defect this whole spec exists to remove.
 *
 * The module is pure and DB-free: the engine never imports a database client. The SQL-backed store
 * satisfies `FrontierStore` in the worker; tests satisfy it in memory.
 */

export type FrontierState = 'discovered' | 'claimed' | 'fetched' | 'failed' | 'skipped';

/** How the URL entered the frontier. Recorded because it explains the row, and §7 counts by it. */
export type DiscoverySource = 'homepage' | 'sitemap' | 'link';

export interface FrontierRecord {
  /** sha256 of the canonical URL — the row key, paired with audit_id. */
  urlHash: string;
  url: string;
  /** §6 stratum key. Derived, but STORED, so a resume never has to recompute a rule that could change. */
  templateKey: string;
  /** §6.4 sample key. Stored for the same reason. */
  sampleKey: string;
  depth: number;
  state: FrontierState;
  source: DiscoverySource;
}

/** The terminal outcome of one fetched (or deliberately unread) URL. */
export interface FrontierOutcome {
  urlHash: string;
  state: Extract<FrontierState, 'fetched' | 'failed' | 'skipped'>;
}

/**
 * The persistence contract. Implemented over Postgres in the worker (`FOR UPDATE SKIP LOCKED` for
 * `claim`, so two parallel steps cannot take the same row) and in memory in tests.
 *
 * `allDiscovered` returns EVERY row for the audit regardless of state, and that is load-bearing rather
 * than convenient — see `resumeSelection`.
 */
export interface FrontierStore {
  upsertDiscovered(records: FrontierRecord[]): Promise<void>;
  /** Every row ever discovered for this audit, ANY state. The selection basis. */
  allDiscovered(): Promise<FrontierRecord[]>;
  /**
   * Atomically move up to `limit` of `urls` into `claimed`, returning what was taken.
   *
   * `FOR UPDATE SKIP LOCKED` over Postgres, which PostgREST cannot express — hence the SQL function
   * in 20260806000001. This decides WHO FETCHES, never WHAT IS SELECTED: selection has already
   * happened by the time this is called, and the caller re-orders the result back into selection
   * order so claim order can never leak into the crawl (§6.6).
   */
  claim(urls: string[], limit: number): Promise<FrontierRecord[]>;
  /**
   * Record the outcome of a WHOLE ROUND, atomically.
   *
   * BATCHED BECAUSE ATOMICITY IS LOAD-BEARING, not because it is faster. Settling row by row admits a
   * PARTIALLY-SETTLED round — some rows `fetched`, the rest still `claimed` — when the worker dies
   * partway through. Those still-claimed rows are released on resume (correctly), but they then
   * re-enter selection a round LATER, against a pool already grown by their siblings' children, so
   * the §6 quotas balance across a different set and the selected composition diverges once the page
   * cap binds. Measured on the 85-page fixture: 4-5 pages of 40 replaced, at a constant selected
   * count — the page count holding while the sample moves is exactly the E1 signature.
   *
   * One statement means a round is either fully settled or not settled at all, and BOTH of those
   * states resume identically. (It also removes ~25 round trips per round from the crawl budget,
   * which is a welcome side effect and not the reason.)
   */
  settleBatch(outcomes: FrontierOutcome[]): Promise<void>;
  /**
   * Drop every row for this audit. Called when the crawl COMPLETES — frontier rows are transient
   * working state and nothing downstream reads them; the artifact that outlives a crawl is
   * `audits.fingerprint`.
   *
   * That it runs only on success is the whole resume mechanism, not an oversight: when the worker
   * dies the delete never happens, so the rows survive for the retry to resume from. The orphan
   * sweep is what collects the rows of a crawl that never comes back.
   */
  deleteAll(): Promise<void>;
}

/** Build a record from a URL. `templateKey`/`sampleKey` are derived once, here, and then stored. */
export function frontierRecord(url: string, depth: number, source: DiscoverySource): FrontierRecord {
  return {
    urlHash: createHash('sha256').update(url).digest('hex'),
    url,
    templateKey: templateKeyFor(url),
    sampleKey: sampleKey(url),
    depth,
    state: 'discovered',
    source,
  };
}

/**
 * The selected set for an audit — THE resume-safe selection, and Stage 5's whole acceptance criterion.
 *
 * THE BASIS IS EVERY DISCOVERED ROW, WHATEVER ITS STATE. Not the outstanding ones, not the unfetched
 * ones, not the ones this worker has not claimed — all of them.
 *
 * WHY, because the obvious resume is the wrong one and it was measured that way rather than argued.
 * Selecting from what is LEFT feeds `selectFrontier` a different set, and `selectFrontier` is a pure
 * function of the set it is given: the stratified round-robin re-balances quotas across strata that
 * have already been partly consumed, and the selection diverges. On the B6 fixture the naive basis
 * produced digest `b6860ec…` against the straight-through `d64233f…` — a different sample of the same
 * site, which is precisely the composition drift SPEC 5.1 exists to eliminate.
 *
 * Already-fetched rows are subtracted from the WORK (`pendingAfterResume`, `claimOrder`) and never
 * from the basis. A `failed` row stays in the basis too: a dead URL was still discovered, and dropping
 * it would shrink the set and re-balance every quota around the gap — the same bug wearing a hat.
 *
 * `state` is therefore deliberately unread here. That is not an oversight, and a future edit that
 * "optimises" by filtering on it is the regression this comment exists to stop.
 */
export function resumeSelection(all: FrontierRecord[], budget: number): FrontierSelection {
  return selectFrontier(all.map((r) => ({ url: r.url, depth: r.depth })), budget);
}

/** The selected pages not yet fetched, in selection order. */
export function pendingAfterResume(all: FrontierRecord[], budget: number): string[] {
  const done = new Set(all.filter((r) => r.state === 'fetched').map((r) => r.url));
  return resumeSelection(all, budget).selected.filter((u) => !done.has(u));
}

/** Claim order = selection order, minus anything already fetched or in flight. */
export function claimOrder(all: FrontierRecord[], budget: number): string[] {
  const unavailable = new Set(
    all.filter((r) => r.state === 'fetched' || r.state === 'claimed').map((r) => r.url),
  );
  return resumeSelection(all, budget).selected.filter((u) => !unavailable.has(u));
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — per-host politeness, persisted so BACKOFF SURVIVES A RESUME.
//
// Without this a resumed crawl forgets it was being throttled and reopens at full concurrency against
// a host that just asked it to slow down. That is worse than restarting: it is restarting while
// looking like a bad actor, and it risks converting a temporary 429 into a durable block — which
// would then show up as a REFUSAL on the next audit and be indistinguishable from the site's own
// configuration.
//
// Timing only. §6.6 forbids politeness from touching WHICH URLs are selected; it may only change when
// they are fetched. `resumeSelection` never reads this, and that separation is the contract.
// ─────────────────────────────────────────────────────────────────────────────

export interface HostPoliteness {
  host: string;
  /** Floor between requests, from robots.txt `Crawl-delay` or escalated by 429s. */
  crawlDelayMs: number;
  /** Epoch ms before which this host must not be requested. Null when not backing off. */
  backoffUntil: number | null;
  /** Consecutive 429/503 responses. Persisted so escalation does not reset to zero on a resume. */
  consecutive429s: number;
}

/**
 * Restore politeness after an interruption.
 *
 * An EXPIRED backoff is cleared rather than carried, because a deadline that has already passed is not
 * a restriction — keeping it would make the crawl wait on a timestamp from the previous run. The
 * crawl-delay and the 429 count are kept exactly: those describe the HOST, not the run, and resetting
 * them is how a resume would walk straight back into the throttle it just earned.
 */
export function restorePoliteness(saved: HostPoliteness, now: number): HostPoliteness {
  return {
    ...saved,
    backoffUntil: saved.backoffUntil !== null && saved.backoffUntil > now ? saved.backoffUntil : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the DISCOVERY cap, and why it is applied HERE rather than at the crawler's discovery loop.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reduce a discovered set to at most `max` records, DETERMINISTICALLY.
 *
 * THE NAIVE CAP IS FORBIDDEN. "Stop discovering once we hit N" keeps whichever URLs happened to arrive
 * first, and arrival order is an explicitly forbidden input (§6.6) — it is concurrency and host latency
 * wearing a hat. Two runs of the same site would keep different prefixes and grade different samples,
 * which is the very failure a cap is supposed to help with.
 *
 * So the cap keeps the `max` records with the SMALLEST SAMPLE KEY — the same Efraimidis–Spirakis
 * min-k mechanism §6.4 already uses for over-quota strata. The sample key is a hash of the URL, so the
 * retained subset is a property of the SITE, not of the run: identical across runs, independent of
 * arrival order, and stable under a resume.
 *
 * ⛔ OWNER-RULED 2026-08-06: **DROPPED. This is UNWIRED and nothing calls it.**
 *
 * It was built, measured, and dropped on its own measurement: capping replaces ~78 % of the selected
 * sample on the one-stratum-per-URL shape — which is the ONLY shape that reaches the cap (all five
 * live audits above the band are Wikipedia, whose `/wiki/{article}` yields one stratum per article).
 * Meanwhile the storage problem it was meant to solve is already solved by the frontier's orphan
 * sweep, at a transient ceiling rather than a permanent cost. **A guard that moves grades to solve a
 * problem already solved is pure cost.**
 *
 * It is KEPT rather than deleted because its tests ARE the measurement apparatus for the 5.1b
 * watch-item (see docs/handoff/2026-08-03-spec51a-handoff.md §5.1): if a NON-Wikipedia site ever
 * reaches the 12 000–88 000 band, this is what re-measures the impact cheaply. **Do not wire it
 * without re-reading that ruling — it is a GRADE-MOVING change, therefore 5.1b work.**
 *
 * THIS IS NOT THE B6 BASIS TRUNCATION. B6 forbids shrinking the basis *relative to what was
 * discovered*; this bounds what is discovered AT ALL, and then selection runs over that whole
 * (smaller) set on both a fresh run and a resume. The distinction is the difference between a
 * disclosed limit and a silent lie about the sample — which is why `discoveryCapped` exists.
 */
export function capDiscovered(all: FrontierRecord[], max: number): FrontierRecord[] {
  if (all.length <= max) return all;
  return [...all]
    .sort((a, b) =>
      a.sampleKey < b.sampleKey ? -1 : a.sampleKey > b.sampleKey ? 1
      : a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
    )
    .slice(0, max);
}

/** Did the cap bite? Returned separately so the caller stamps the fingerprint rather than guessing. */
export function discoveryCapInfo(
  discoveredCount: number,
  max: number,
): { discoveryCapped: true; discoveredAtCap: number } | Record<string, never> {
  return discoveredCount > max ? { discoveryCapped: true, discoveredAtCap: discoveredCount } : {};
}
