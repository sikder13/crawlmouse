/**
 * The `audits` column list the SSE route selects, extracted so a TEST CAN READ THE REAL ONE.
 *
 * GATE 4 / W1 + W1b. Two mutations survived the whole suite: dropping `refusal, coverage` from this
 * list, and dropping `discovered_count, blocked_count`. Both are the DB→client leg of the refusal
 * fix — the write side is pinned in `persist-results`, the projection is pinned in
 * `audit-stream-projection`, and nothing pinned the SELECT that feeds them. A refused audit would
 * have reached the browser with no refusal payload at all, and `deriveAuditViewState` would have
 * routed it straight back to the failure card the whole stage exists to replace.
 *
 * It lives here rather than in the route module so a test can import the VALUE instead of regexing
 * the route's source. A guard that reads source text matches the spelling; this one matches the
 * thing the query actually sends.
 *
 * CAPABILITY-URL MODEL: the audit is read by its unguessable UUID via the service-role client (so an
 * anonymous owner — `user_id = null` — can see their own result), exactly like a public report slug.
 * `user_id` (the owner/Pro gate) and the raw `failure_reason` are selected server-side but NEVER sent
 * to the client — `projectAuditForClient` strips them and emits only a coarse, classified
 * `failureCategory`. `settings` carries only the page cap.
 */
export const AUDIT_COLS =
  'id, url, status, grade, score, page_count, link_count, cms_detected, user_id, settings, failure_reason, confidence, coverage_pct, block_rate, partial, refusal, coverage, discovered_count, blocked_count';

/**
 * SPEC 04 §2 — the progress/activity columns (Runbook A), selected via a RUNTIME fallback: the first
 * read tries this extended set and drops back to `AUDIT_COLS` if it errors, so the route tolerates
 * being deployed before the activity migration is applied (simply no activity events).
 *
 * ⚠ THE FALLBACK IS NARROWER THAN ITS COMMENT ONCE CLAIMED. It only covers the *activity* columns.
 * `AUDIT_COLS` itself names `refusal`, `coverage`, `discovered_count` and `blocked_count`, so on a
 * pre-Stage-4 database BOTH selects fail, `initial` is undefined and no `snapshot` event is sent at
 * all. Migration `20260804000001` is applied in production, so this bites only on a rollback or a
 * fresh environment — recorded rather than papered over (gate 4, R3-NB6).
 *
 * `crawl_activity` NEVER reaches a client payload; it is projected into separate seq-delta `activity`
 * SSE events (`projectAuditForClient` picks its fields explicitly).
 */
export const AUDIT_COLS_WITH_PROGRESS = `${AUDIT_COLS}, pages_crawled, crawl_estimated_total, crawl_phase, crawl_activity`;

/**
 * The columns the SPEC 5.1a refusal presentation cannot function without, named as a set so the
 * route-level tests can assert the select list still carries them. Each one is load-bearing:
 *
 *  - `refusal`  — the state itself. Absent → `deriveAuditViewState` sees no refusal and the audit
 *                 falls through to `gradeFailed`, i.e. gate 3's blocker, live again.
 *  - `coverage` — the §7 accounting every approved body quotes its numbers from.
 *  - `blocked_count` — "M refused" in copy (e). Absent → the sentence is omitted.
 *  - `grade` / `score` — nullable end to end; their absence is what the gate withholds.
 */
export const REFUSAL_REQUIRED_COLS = ['refusal', 'coverage', 'grade', 'score'] as const;

/**
 * The crawl-health counts carried for approved body (e) — "N requests, M refused".
 *
 * ⚠ THEY ARE INERT TODAY, AND THAT IS A FINDING, NOT A DESIGN. `blocked_count` fills "M refused";
 * "N requests" is `attempted`, which the engine computes (`crawl-health.ts`: same-host fetch
 * attempts) and **no column stores**. It is not recoverable from what is stored: `page_count` counts
 * every fetched page including off-host redirects, `fetched_ok + blocked` omits dead, and
 * `blocked / block_rate` would be deriving a number from numbers that are not that number — the rule
 * `refusal-copy.ts` exists to enforce. So the sentence is omitted on every production read.
 *
 * They stay SELECTED deliberately. Dropping them now would be invisible (nothing renders them today)
 * and would silently re-break the sentence on the day `attempted_count` lands — which is exactly the
 * shape of gate 4's W1, a mutation that survived the whole suite. See
 * `docs/tickets/2026-08-07-attempted-count-not-persisted.md`.
 */
export const REFUSAL_COUNT_COLS = ['blocked_count', 'discovered_count'] as const;

/** The select list as a set, for membership assertions. */
export function auditColumnSet(cols: string = AUDIT_COLS): Set<string> {
  return new Set(cols.split(',').map((c) => c.trim()).filter(Boolean));
}
