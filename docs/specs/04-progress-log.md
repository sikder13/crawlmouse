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
| D | column-privilege hardening (revoke-table + grant-columns-excluding-sensitive) | `20260707000003_spec04_column_privilege_hardening.sql` | PENDING |

**Runbook D** (apply AFTER A+B): closes the round-2 security finding — `minted_by` (a user_id) and
`notify_email` (third-party PII) would otherwise be anon/authenticated-selectable via direct
PostgREST, because Supabase's default table-level grants make a bare column-`REVOKE` a no-op. The
migration revokes table-level SELECT/UPDATE and re-grants SELECT on a generated column list excluding
the sensitive columns. **Proven effective** against the live DB (`ezspnfeyzwsisymytssm`) with a
rolled-back `has_column_privilege` probe: anon can't read `minted_by` but can read `domain`;
authenticated can't read `audits.notify_email` or UPDATE audits/public_reports, but can still read
`audits.url`. Post-apply verification query is embedded in the migration.

All three delivered 2026-07-07 (session log). Code fail-softs when A/B are unapplied: progress
writes are swallowed, the notify route degrades, legacy report rendering never depends on the new
columns. Live-data checks that need an applied runbook are marked BLOCKED-ON-RUNBOOK below.

## Stage log

### Stage A — the honest wait (§2) — IN PROGRESS

Commits: `980acc8` (migrations A/B) · `4c58e6c` (types) · `9e28d7e` (engine seam) · `2a3dfa7`
(worker batcher/notify) · `613a12d` (web wait UI) · then fix-loop round 1: `11ad1b9` (db
hardening) · `83dce89` (worker fixes) · `e63a822` (web fixes) · `70b8814` (engine-test strengthen).

Tests V1–V3 mapped: V1 honest progress (`inngest/progress.test.ts`, `apps/web/lib/audit-activity.test.ts`,
`AuditProgress.test.tsx`, engine `crawler-activity.test.ts`), V2 activity XSS (`ActivityFeed.test.tsx`,
projection chokepoint in `audit-stream-projection.test.ts`), V3 email valve (`notify/route.test.ts`,
`inngest/notify.test.ts`). Suite: engine 394 · inngest 113 · web 720 · scripts 5 = **1232 green**;
typecheck 0, lint 0, `next build` OK.

**3× adversarial gate — round 1 (parallel independent reviewers):** all three FAIL, **0 BLOCKING**. Scores:
R1 correctness 8.5 / security 9.5 / deploy 9 / test 8.5; R2 9 / 8.5 / 9 / 9; R3 9 / 8.5 / 9 / 9.
Consensus gate-failing items, all fixed in round-1 fix-loop:
- **Security 8.5 (×3):** `public_reports`/`audits` column-grant gap → hardening migration
  `20260707000003` + guard test (`11ad1b9`).
- **Correctness MAJOR (R1):** persist-phase false stall copy → `shouldShowStall` phase-gate (`e63a822`).
- **Test-quality MAJOR (R1):** SSE fallback/seq-delta untested → extracted `isUndefinedColumnError`
  (42703-scoped) + tests; fake-timers no-timer pin; stronger `comparable()` (`e63a822`/`83dce89`/`70b8814`).
- **Deploy MINOR (×3):** `notified_at` claimed before the RESEND key check → config-guard + non-2xx
  log (`83dce89`).
- **Correctness MINOR (×2):** failed audit never emailed despite the "we'll email you" promise →
  send on terminal failure too, honest failure copy (`83dce89`).
- Swept: 42703-scoped fallback, `pagesCrawled>estimate` display, activity reset on auditId, honesty-
  guard surfaces, DO-block `limit 1`, softened valve error copy, seq-restart doc.

**BLOCKED-ON-RUNBOOK:** the live-smoke on the deployed function (V18 slice for the wait path) — needs
Runbooks A/B applied on prod; runs post-merge on production per the charter (preview lacks the Inngest
pipeline). Runbook C (report-logos bucket) is a Stage D dependency, not Stage A.

**Runbook delta:** added Runbook D = apply `20260707000003` (column-privilege hardening) AFTER A+B.
All four are additive and safe pre-code.

**3× adversarial gate — round 2 (verify fixes + fresh sweep):** all three FAIL, **1 BLOCKING** — a
single shared, empirically-proven finding: the round-1 hardening migration's *column-scoped* revokes
were Postgres no-ops (effective access = table-level OR column-level grant; Supabase grants table-
level by default). Each reviewer proved it against the live DB (rolled-back `has_column_privilege`
probes). Correctness 9 · deploy-safety 9 · test-quality 8; the code fixes from round 1 (stall, notify,
42703 fallback, tests) all verified CLOSED. Round-2 fix-loop:
- **Rewrote `20260707000003`** to revoke table-level SELECT/UPDATE + re-grant SELECT on a generated
  column list excluding the sensitive columns (proven effective via the live rolled-back probe).
- **Rewrote the guard test** to pin the *effective* mechanism (table-level revoke + sensitive-column
  exclusion), so it can never again green-light the inert form (the round-1 test-quality MAJOR).
- **Engine NIT (R-C):** guarded the per-page emit block on `input.onActivity` so the no-listener path
  does zero extra work (URL parse + alloc) — the no-op path is now truly free.

**3× adversarial gate — round 3 (verify the round-2 fix + regression sweep):** **PASS**. Two thorough
independent reviewers returned PASS with all lenses ≥ 9.5, 0 blocking; both independently confirmed the
hardening migration effective via rolled-back live-DB probes, and one via an actual `SET ROLE anon`
simulation (anon reads `grade`/`domain`; hard-denied `42501` on `minted_by` SELECT and `listed`
UPDATE). Combined with my own rolled-back `has_column_privilege` proof = **three independent live
confirmations** the round-2 blocker is CLOSED. (A third reviewer slot crashed twice on a transient
harness fault — spurious context injection at spawn, 0 tool uses — producing no review; re-attempted.)
Non-blocking items carried forward:
- **Stage B awareness (pre-existing, not a SPEC-04 regression):** `public_reports_owner_insert` RLS +
  the retained table-level INSERT grant let a verified-domain authenticated user INSERT a
  `public_reports` row directly via PostgREST (new rows default `listed=false`/`indexable=false`,
  `minted_by`/`report_snapshot` null; low impact). Out of scope for this SELECT/UPDATE-hardening
  migration — **Stage B must ensure the mint/claim path is the only way to create/populate reports**
  (consider revoking client INSERT then, or rely on the audit-ownership + unique-constraint guards).
- **Deploy NIT:** apply each migration `.sql` as one transaction (the standard Supabase migration path
  already does) so there is no window between `revoke select` and the re-`grant`. Added to Runbook D.
