# SPEC 04 — Execution progress log (branch `viral/spec-04-loop`)

Running log per the execution charter: stage, commits, test counts, adversarial-gate scores,
deployment state, BLOCKED-ON-RUNBOOK items, and spec/code mismatches discovered en route.

## Owner rulings in force (2026-07-07)

1. M1: `report_snapshot` jsonb at mint + FK `public_reports.audit_id` → ON DELETE SET NULL
   (nullable). Every `audit_id` consumer null-safe; legacy no-snapshot reports render a designed
   fallback; both pinned by tests.
2. M3: `/compare` stays noindex the entire phase; slug-based indexable compare deferred
   post-SPEC 04 (owner-ratified amendment to §8 — goes in the PR description). Capability URLs
   are never indexed.
3. Progress emission: batched nullable `audits` columns (`pages_crawled`, `crawl_estimated_total`,
   `crawl_phase`, `crawl_activity` ring ≤30 with `seq`), flush every 10 pages or ~5s, guarded
   `status='crawling'`, errors swallowed, final flush before persist, seq-delta SSE.
4. `MINT_REPORTS_PER_IP_PER_DAY_ANON = 10`; authed `MINT_REPORTS_PER_DAY = 20` unchanged.
5. Engine: optional additive `onProgress` on `AuditOptions` is the ONE sanctioned engine touch;
   the no-op path is mutation-pinned (absent callback = identical behavior).
6. M6 guard edit (`seo-robots-sitemap-guard`) ships as its own commit with rationale in the body.
7. Email valve: completion send piggybacks on `auditFn`'s existing flow (no new Inngest function,
   zero app-sync risk).

## Runbook status

| Runbook | Content | Migration file on branch | Owner-applied? |
|---|---|---|---|
| A | `audits` progress + notify columns | `20260707000001_audit_progress_notify.sql` | PENDING |
| B | `public_reports` visibility + snapshot + FK SET NULL + backfill | `20260707000002_public_reports_visibility.sql` | PENDING |
| C | `report-logos` storage bucket (SQL/dashboard, not a repo migration) | — (runbook only) | PENDING |

All three delivered 2026-07-07 (session log). Code fail-softs when A/B are unapplied: progress
writes are swallowed, the notify route degrades, legacy report rendering never depends on the new
columns. Live-data checks that need an applied runbook are marked BLOCKED-ON-RUNBOOK below.

## Stage log

(appended as stages complete)
