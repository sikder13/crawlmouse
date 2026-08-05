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
  /** Atomically move up to `limit` of `urls` into `claimed`, returning what was taken. */
  claim(urls: string[], limit: number): Promise<FrontierRecord[]>;
  settle(urlHash: string, state: Extract<FrontierState, 'fetched' | 'failed' | 'skipped'>): Promise<void>;
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
