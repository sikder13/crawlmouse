# Audits with a NULL `expires_at` are never deleted, so their cascade never fires

**Filed:** 2026-08-06 · **Severity:** MEDIUM (storage + retention-promise correctness, not a leak)
**Status:** open · **Owner-ruled: do NOT fix in SPEC 5.1a.** Pre-existing, separate from the frontier.
**Found:** while writing the SPEC 5.1a Stage 5 retention story, which forced the question "what
actually deletes these rows when a crawl does *not* finish?"

---

## The defect

`deleteExpiredAudits` (`inngest/billing-helpers.ts`) — the daily TTL cleanup behind
`cleanupExpiredAuditsFn` — selects rows with a single predicate:

```ts
.from('audits').select('id').lte('expires_at', nowIso).order('expires_at').limit(batchSize)
```

**`expires_at <= now` and nothing else.** An audit whose `expires_at` is **NULL** therefore matches
nothing, is never selected, and is never deleted — so its `ON DELETE CASCADE` to `pages`, `links`,
`findings` and `fixes` **never fires either**. Those child rows are the bulk of the storage.

A second, independent shape: an audit stuck in `pending` (worker died before it ever ran) sits until
its own TTL comes due — up to 30 days — because nothing else reaps by status.

## Measured against live, 2026-08-06

Project `ezspnfeyzwsisymytssm`.

| status | rows | with `expires_at` NULL | oldest `started_at` | older than 2 days |
|---|---|---|---|---|
| completed | 214 | **20** | 2026-06-15 | 212 |
| failed | 7 | 0 | 2026-07-20 | 6 |
| pending | 7 | 0 | **2026-07-08** | 7 |
| canceled | 5 | **2** | 2026-06-15 | 5 |

**22 audits (20 completed + 2 cancelled) carry a NULL expiry and will never be deleted by the cron.**
One `pending` audit has been stuck since **2026-07-08** — roughly 29 days at time of filing.

Scale anchor, for sizing the eventual fix: `pages` is **41 228 rows in 24 428 544 B = 593 B/row**, and
the database is 226 MB.

## Why it is not urgent, stated honestly

This is **not** a data leak and **not** a privacy defect — RLS and the capability-URL paths are
unchanged, and nothing becomes readable that was not already. It is:

1. **A storage leak** — child rows for those audits accumulate forever.
2. **A correctness gap in the 30-day free-audit retention promise**, for whichever of the 22 are free
   audits. That distinction needs checking before the fix: a NULL expiry may be *deliberate* for Pro
   audits, in which case the defect is only that nothing distinguishes "deliberately permanent" from
   "accidentally permanent".

**That question — is a NULL expiry intentional for Pro, or a write-path bug? — must be answered before
choosing a fix.** Deleting rows that were meant to be kept would be far worse than the current state.

## What is NOT affected

SPEC 5.1a's `frontier` / `frontier_politeness` tables do **not** depend on this. Their retention is
covered by `deleteOrphanFrontierRows`, which sweeps on **staleness alone** (`updated_at` older than
`FRONTIER_ORPHAN_TTL_HOURS = 24`) and deliberately knows nothing about audit status or `expires_at`.
That was designed this way precisely because the cascade could not be relied upon — this ticket is the
reason.

## Suggested direction (not a decision)

1. First establish whether NULL `expires_at` is intentional (Pro / claimed audits) or a write-path bug.
2. If intentional: leave those rows, and add an explicit marker so "permanent" is a stated property
   rather than the absence of one.
3. If accidental: backfill `expires_at` for the affected rows, then fix the write path.
4. Separately, reap audits stuck in `pending`/`crawling` beyond any plausible crawl lifetime — the
   frontier sweep's age-only predicate is a working precedent.

Any change here is **owner-applied** if it touches schema, and any bulk delete needs the usual
rehearsal-first runbook.
