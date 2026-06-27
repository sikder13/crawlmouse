# Ticket — `persistAuditResults` bulk links insert overruns Postgres `statement_timeout` on dense large sites

**Status:** Open · **Priority:** Medium · **Scope:** POST-Phase-1 (do NOT fix during Phase 1 / SPEC 01)
**Filed:** 2026-06-17 (surfaced while seeding the Stage-7 backtest corpus, Gate 2)

## Symptom
Auditing `https://nextjs.org` at the free pageCap (500) fails during persistence with:

```
links insert failed: canceling statement due to statement timeout
```

The crawl + grade succeed; the failure is purely in the row-writer. `crawlAndPersist` then re-throws,
the audit is marked `failed`, and (because persistence is not transactional) the already-inserted
`pages` rows are left orphaned under the failed audit until cleaned up.

## Root cause
`inngest/persist-results.ts` inserts **all** link rows in a single `sb.from('links').insert(linkRows)`
call. A dense ~500-page site (docs sites like nextjs.org cross-link heavily) produces tens of
thousands of link rows, and that one statement exceeds Supabase's `statement_timeout`. The other
500-page Stage-7 sites (wordpress.org, webflow.com, squarespace.com, ghost.org, joomla.org) have
sparser graphs and stayed under the limit, so this only bites the densest sites.

This is independent of the engine version (v1 or v2) — it is a persistence-scaling limit, and a real
end user auditing any dense ~500-page site in **production** would hit it.

## Proposed fix (post-Phase-1)
Batch the `links` insert (and, defensively, `findings`) into chunks (e.g. 1–5k rows per insert) inside
`persistAuditResults`, instead of one statement. Keep it idempotent (the existing children-delete on
retry already supports this). Optionally cap link rows per page. Add a test with a synthetic dense
graph that would exceed a single-statement budget.

## Why not now
Out of scope for Phase 1 (SPEC 01 = engine reliability & reproducible grade). Tracked here so it is not
lost. **Workaround used for corpus seeding:** seed nextjs.org at a lower pageCap (~150) so the links
insert fits — see `scripts/seed-benchmarks.ts`.
