# SPEC 04 — Execution progress log & handoff (branch `viral/spec-04-loop`)

> **Self-sufficient handoff.** A fresh session can resume Phase 3 (SPEC 04) from this file + the repo
> alone. Read `docs/specs/04-viral-loop-and-client-reports-spec.md` (the controlling spec),
> `CLAUDE.md`, and `PROJECT_OVERVIEW.md` first, then this log. Work continues on **branch
> `viral/spec-04-loop`** (its own worktree off `origin/main`); `nvm use 22`. Commits are referenced by
> their conventional-commit **subject** (stable), not by hash (the branch history has been rewritten to
> scrub terminology, so hashes are not durable). This terminal holds **only SPEC 04**.

---

## 1. Current state (top-line)

- **Stage A — the honest wait (§2): COMPLETE.** Built, gated (3 independent review passes, all lenses
  ≥9, 0 blocking), pushed to the branch, and preview-verified on Vercel. Production live-smoke is a
  post-merge owner step (see §5). Details in §6.
- **Stage B — mint + client-ready report + snapshot (§3/§4/§10): COMPLETE.** Built, gated (clean 3×
  PASS after two fix-loops), **pushed to `origin/viral/spec-04-loop` @ `07986d7`**, and preview-verified
  on Vercel (incl. the deploy-order write fail-soft proven live — `hide` → 503 with the columns absent).
  Production V4/V5/V18-slice smoke is a post-merge owner step (§5). Details in §7.
- **Stage C — claim + indexing/sitemap + badge integrity (§7/§8/§9): COMPLETE.** Claim route (V14),
  owner visibility toggle (§8), claimed+indexable `/r/` sitemap section (V13) + the sitemap-guard update
  (own commit, M6), and the claimed-only badge/leaderboard carry-in all built + tested. Gated over **2
  independent-review rounds** — round 1 caught a real **BLOCKING** ownership-forgery security hole
  (client-forgeable `domain_verifications.verified_at`) + a test-quality gap; both fixed + re-gated
  clean (all lenses ≥9, 0 blocking). **Pushed to `origin/viral/spec-04-loop` @ `427bcf2`**, preview
  `dpl_AQ2cH2grp1arWSKVgKro4DiheSo4` **READY** + route-sanity clean. The fix adds **Runbook F** (a HARD
  security deploy-gate — see §3). Production V6/V13/V14 smoke is post-merge (needs Runbooks B+F applied).
  Details in §8.
- **Stages D, E: not started.** Scopes in the spec §17 (D = white-label on Pro; E = share/OG +
  observability + stress + PR).

## 2. Owner rulings in force (digest — these govern every stage)

1. **M1 (approved):** write a bounded `report_snapshot` jsonb at mint (exec-summary scalars, capped
   findings per category, the FREE diagnosis-only ledger, confidence — **NEVER**
   prescriptions/packets/monitoring), and change the `public_reports.audit_id` FK to
   **`ON DELETE SET NULL`** with `audit_id` nullable, so a minted report outlives its audit's 30-day
   TTL. Every `audit_id` consumer must be null-safe; a legacy row with no snapshot renders a designed
   fallback (grade/score/domain + "re-audit for the full report"); both pinned by tests.
2. **M3 (approved):** `/compare` stays **noindex** for this entire phase; a slug-based indexable
   compare is deferred post-SPEC 04. **Never index capability URLs.** (Owner-ratified amendment to
   spec §8 — put it in the PR description.)
3. **Anon mint cap:** `MINT_REPORTS_PER_IP_PER_DAY_ANON = 10`; authed `MINT_REPORTS_PER_DAY = 20`
   (unchanged).
4. **Engine:** the optional additive `onProgress` on `AuditOptions` is the **ONE** sanctioned engine
   touch for the whole phase; its no-op path is mutation-pinned (absent callback = byte-identical
   behavior). No other `packages/engine/src/**` change is authorized.
5. **Types:** all `packages/types` changes are **additive only**.
6. **Section-slot report is the frozen SPEC 05 seam.** The `/r/[slug]` report body is an ordered list
   of self-contained sections so SPEC 05 can add its section additively with zero edits to SPEC 04's
   components. **Build no AI-readiness content** (no score, no llms.txt / robots-AI checks) — that is
   SPEC 05, a separate terminal.
7. **Email valve (Stage A):** the completion send rides `auditFn`'s existing flow as a step — no new
   Inngest function (zero app-sync risk).
8. **Hide-fix vs claim-gating Stage B/C split (APPROVED):** honoring **hide** on every public surface
   (page + OG + badge + leaderboard) ships in **Stage B** (hide ships in B, so the guardrail must hold
   everywhere); the **claimed-only** gating of the badge + leaderboard (§7/§8) is **Stage C** (the
   carry-in, now done). There is no prod window between them — the whole spec merges once at Stage E.
9. **Runbook E (REVIEWED):** the client-INSERT-revoke migration (`…000004`) is reviewed and the owner
   is applying it now. It is order-independent (references no new column) and proven effective by a
   rolled-back live probe.

## 3. Runbook status (all owner-executed; code is deploy-order-safe without them)

| Runbook | Content | Migration file on branch | Status / when to apply |
|---|---|---|---|
| A | `audits` progress + notify columns | `20260707000001_audit_progress_notify.sql` | **APPLIED** (owner) |
| E | revoke client-role INSERT on `public_reports` (mint/claim is the only creator) | `20260707000004_public_reports_client_insert_revoke.sql` | **APPLYING NOW** (owner; reviewed; order-independent — no new column) |
| F | revoke client-role INSERT/UPDATE/DELETE on `domain_verifications` (close the claim/visibility ownership-forgery vector, §9/§11) | `20260707000005_domain_verifications_client_write_revoke.sql` | **apply BEFORE/WITH Runbook B** — HARD security deploy-gate; order-independent (can apply now, alongside E) |
| B | `public_reports` visibility + snapshot + FK SET NULL + backfill | `20260707000002_public_reports_visibility.sql` | strictly post-merge + deploy — **apply Runbook F first/with it** (F closes the forgery vector; without it, B makes claim/visibility go live while the vector is still open) |
| D | column-privilege hardening (revoke-table + grant-columns-excluding-sensitive) | `20260707000003_spec04_column_privilege_hardening.sql` | strictly post-merge + deploy, AFTER A+B |
| C | `report-logos` storage bucket (SQL/dashboard runbook, not a repo migration) | — | at Stage D |

- **Runbook E** (Stage B carry-in): closes the direct-PostgREST INSERT vector on `public_reports` (a
  verified-domain authed user could otherwise INSERT a report row directly, bypassing the mint route's
  snapshot/Turnstile/caps/noindex-guardrail). Table-level `revoke insert … from anon, authenticated`;
  all writes are service-role. **Proven effective** by a rolled-back live probe: anon/authenticated
  INSERT = false, service_role = true. **The mint route is deploy-order-safe**: pre-Runbook-B (snapshot
  columns absent) the whole mint returns 503, so open minting can NEVER ship without the guardrail.

- **Runbook F** (Stage C security deploy-gate — the round-1 security-review blocking finding): the claim
  + visibility routes authorize every privileged `public_reports` write on a VERIFIED
  `domain_verifications` row, but that table's client-role write was never revoked and its RLS policy
  constrains only `user_id`, **not `verified_at`** — so any authenticated user could POST a forged
  `{user_id: self, domain: victim, verified_at: backdated}` row straight to PostgREST (bypassing the
  DNS/meta challenge) and then claim / de-index / (Stage D) white-label ANY victim's report. The
  migration `revoke insert, update, delete … from anon, authenticated`; both legit writers
  (`verify/start`, `verify/check/[id]`) already use the service-role client, so it breaks nothing.
  **Proven effective** by a rolled-back live probe (BEFORE: anon/authenticated INSERT/UPDATE/DELETE =
  true; AFTER: false; `service_role` = true; nothing persisted). Order-independent, so it can be applied
  now (alongside E) and also retroactively hardens the current mint verification gate. **Ordering
  caveat:** its filename sorts `000005` (after B's `000002`); the owner applies via the Supabase
  MCP/Management API **per this ledger**, so apply F **before/with B**. If a blind `supabase db push`
  is ever used instead, note that it would apply `000002` before `000005` — so either apply F manually
  first, or accept the (single-push, seconds-long) window. Guard:
  `apps/web/__tests__/spec04-domain-verification-write-revoke-guard.test.ts`.

- **Deploy-order safety (must hold every stage):** all code fail-softs when the migrations are
  unapplied — progress writes are swallowed, the notify route returns 503, the SSE route falls back to
  legacy columns only on Postgres `42703`, and legacy report rendering never depends on the new
  columns. Verified live on the preview function (§6). **Never apply a migration yourself** — deliver
  runbooks; the owner applies them.
- **Runbook D — why it is the shape it is:** a bare column-level `REVOKE SELECT (col)` is a **Postgres
  no-op** when the role holds a table-level grant (effective access is the union of table- and
  column-level grants, and Supabase grants anon/authenticated table-level SELECT/UPDATE by default).
  The migration therefore **revokes the table-level SELECT/UPDATE and re-grants SELECT on a column
  list (generated from `information_schema` at apply time) that EXCLUDES the sensitive columns**
  (`public_reports.minted_by`; `audits.notify_email`/`notify_requested_at`/`notified_at`). This was
  proven effective against the live DB with a rolled-back `has_column_privilege` / `SET ROLE anon`
  probe (anon denied `42501` on `minted_by`; legitimate reads preserved). Apply each `.sql` as one
  transaction. The verification query is embedded in the migration; a guard test
  (`apps/web/__tests__/spec04-column-privilege-guard.test.ts`) pins the effective pattern.
- **Migrations already applied on prod are NONE** (confirmed via live schema — `audits`/`public_reports`
  lack the new columns). The DB project is `ezspnfeyzwsisymytssm`.

## 4. Standing per-stage loop (follow for B → E)

1. **Restate scope + plan** against the real repo (verify every file/function/table name).
2. **TDD** — write the stage's failing tests first, mapped to the spec's V-numbers.
3. **Implement to green.** Full suite + `typecheck` + `lint` + the four repo guards (blog-guard,
   seo-jsonld-guard, positioning-and-honesty-guard, seo-robots-sitemap-guard) all pass.
4. **3× independent review passes** (correctness / security / deploy-safety / test-quality — separate
   independent passes, not self-review). Fix-loop to **≥9 all lenses, 0 blocking**. Log the outcome
   here. Security-migration claims must be proven with a rolled-back live-DB probe, not asserted.
5. **Pre-push trace audit:** the repo is **PUBLIC** — no AI-tool or model names anywhere (commits,
   code, comments, this log). Describe the gate as "independent review passes." No `Co-Authored-By`.
   Author is the owner's normal git identity. Fix (and scrub history if needed) before pushing.
6. **Push the branch only** (`git push -u origin viral/spec-04-loop`). **Never push/merge to `main`;
   never self-merge.** Show the full diff before pushing.
7. **Verify the Vercel preview** for the push reaches **READY**; run route sanity on changed surfaces.
   Preview lacks production env (`ENGINE_V2`) and the Inngest pipeline, so preview = build + route
   sanity only. **"Proven live" is claimed ONLY from production**, never preview/local.
8. **Update this log.** At Stage E: open the PR (summary + the §12 non-regression checklist + the M6
   guard-change callout + the M3 spec amendment + runbook status + the production V18 smoke plan) and
   **STOP — no merge without owner approval.**

---

## 5. Post-merge production checklist (owner)

After the owner merges the PR and prod redeploys: apply Runbooks A → B → D (D after A+B), then run the
production **V18** live-smoke for the shipped stages on a **static + a throttling-WordPress + a JS/SPA**
site. For Stage A that is: submit → activity appears < 10s → determinate progress advances on real
events → grade reveals. Runbook C + the white-label upload smoke land at Stage D. This is the only
place "proven live" may be claimed.

## 6. Stage A — the honest wait (§2) — COMPLETE

**What shipped (by commit subject):** `feat(types): add CrawlActivity contract + optional onProgress
on AuditOptions` · `feat(engine): emit real crawl activity through the optional onProgress seam` ·
`feat(worker): batched honest progress writes + finding previews + completion email` · `feat(web): the
honest wait — activity SSE, determinate progress, feed, email valve` · plus the migration commit and
the round-1/2 fix-loop commits (`fix(db|worker|web|engine)…`). Migrations `20260707000001/2/3` are on
the branch.

- **Engine seam:** optional `onProgress` emits `fetch_ok/blocked/dead`, `sitemap_seeded` (honest
  sitemap total), `cms_detected`, and real `phase` transitions. No-op + mutation-pinned when absent;
  the per-page emit is guarded on the listener so the no-listener path does zero extra work.
- **Worker:** `inngest/progress.ts` batched writer — writes only on real events (no timer),
  every 10 pages / ~5s, `status='crawling'`-guarded, error-swallowed, bounded activity ring (≤30) with
  a monotonic `seq` (the SSE dedup watermark). `emitFindingPreviews` previews REAL findings (counts
  only, never the grade). `inngest/notify.ts` completion email rides `auditFn` as a step + fires from
  `handleAuditFailure` (completed **and** failed; never canceled; `notified_at`-claim = no double-send;
  skips + logs when RESEND is unconfigured; never throws).
- **SSE + UI:** `app/api/audits/[id]/stream/route.ts` emits seq-delta `activity` events with a
  `42703`-scoped pre-migration column fallback; `lib/audit-activity.ts` is the pure reducer
  (determinate progress + honest stall via `shouldShowStall` — suppressed outside the crawling phase so
  the persist tail never shows a false "site rate-limits crawlers"). Components: `AuditProgress`
  (determinate "N of ~M" / "N so far · cap C"), `ActivityFeed` (labels rendered as inert text — XSS),
  `EmailWhenDone` (posts to the capped notify route), `EducationalCards` (the one honestly-labeled
  timer element). The timer-faked `DripFeedFindings` was deleted.
- **Notify route:** `app/api/audits/[id]/notify/route.ts` — capability-authorized, per-IP + per-email
  daily caps, running-audits-only (409), fail-soft 503.

**Verification:** suite **1232 green** (engine 394 · inngest 113 · web 720 · scripts 5) + typecheck 0 +
lint 0 + `next build` OK. Tests map V1 (honest progress — `progress.test.ts`, `audit-activity.test.ts`,
`AuditProgress.test.tsx`, engine `crawler-activity.test.ts`), V2 (activity XSS — `ActivityFeed.test.tsx`
+ the projection chokepoint in `audit-stream-projection.test.ts`), V3 (email valve — `notify/route.test.ts`,
`inngest/notify.test.ts`).

**Gate — 3 independent review passes over three rounds:**
- Round 1: 0 blocking; fixed a real correctness bug (the stall line falsely blamed the site during the
  event-quiet persist tail → `shouldShowStall` phase-gate), a test-quality gap (SSE fallback/seq-delta
  untested → `isUndefinedColumnError` extracted + tested; fake-timers no-timer pin; stronger engine
  no-op pin), a deploy item (`notified_at` claimed before the RESEND-key check → config-guard), and a
  correctness miss (failed audits never emailed → send on failure too).
- Round 2: **1 blocking** — the first hardening migration's column-scoped revokes were Postgres no-ops
  (proven against the live DB by every reviewer). Rewrote it to the effective revoke-table + grant-
  columns pattern (§3) and rewrote the guard test to pin the effective mechanism.
- Round 3: **PASS** — all lenses ≥9.5, 0 blocking; the migration fix confirmed effective by multiple
  independent rolled-back live-DB probes (incl. a `SET ROLE anon` `42501`-denial check).

**Branch pushed + preview verified.** Preview reached **READY** (clean build, no alias error). Live
route sanity on the branch preview: homepage/`/status` 200; `POST /api/audits/[id]/notify` → 400 on
invalid email / non-UUID id / empty body, and **503 fail-soft** on a valid request while the Runbook-A
columns are absent (deploy-order-independence proven live, not a 500). Wait-UI + SSE need the pipeline
→ their full smoke is the post-merge V18 (§5).

## 7. Stage B — mint + client-ready report + snapshot (§3/§4/§10) — COMPLETE (gate-passed, pushed, preview-verified)

**Gate: clean 3× PASS** (round 3, all lenses ≥9, 0 blocking) after two fix-loops (round 1: OG/badge hide
leak + PGRST204 write-body detection; round 2: leaderboard hide leak). **Pushed** (`viral/spec-04-loop`
@ `ae7adc9`, AI-trace clean, author `git_lab_007`). **Preview `dpl_3kGRqhd2…` READY**; live route sanity
on the branch alias (pre-Runbook-B, columns absent): `/` 200 · `/top/shopify` 200 · `/embed/example.com`
200 (leaderboard + badge READ fallbacks work live) · `/r/<none>` 404 · mint invalid→400 / missing→404 ·
hide invalid→400 · **hide valid-uuid → 503** (the deploy-order WRITE fail-soft — PGRST204/42703 detection
proven against REAL Supabase PostgREST, not just the mock). Full V4/V5/V18-slice smoke is post-merge on
production (needs Runbooks A/B applied + the Inngest pipeline).


**Implemented + tested (committed by subject):** `feat(report): report-snapshot contract + deterministic
builder` (foundation) · `feat(report): deterministic report content + deploy-order-safe read +
visibility gating` · `feat(report): section-slot client-ready report page + print stylesheet` ·
`feat(mint): auth-optional minting + Turnstile on-demand + snapshot write (V4)` · `feat(mint):
capability-scoped hide route + client-INSERT revoke (guardrail trio, V5/V15)`.

- **Mint (`app/api/reports/mint/route.ts`)** → V4: auth-optional (capability = a completed audit UUID;
  no 401/403); Turnstile on-demand + per-user (20) / per-IP anon (10) caps; writes `report_snapshot`
  (built by `lib/mint-snapshot.ts`, which fetches ONLY diagnosis columns — the gated cure columns are
  never read) + `minted_by`; `insertReportWithRetry` idempotency preserved; 503 fail-soft pre-Runbook-B.
- **Report (`/r/[slug]` + `components/report/*` + `lib/report-content.ts`)** → V7/V8/V5/V13p:
  deterministic exec summary + plain-language findings + prioritised ledger (never summed) + methodology
  in a section-slot layout (frozen SPEC 05 seam); claim-gated robots (unclaimed → noindex), `hidden_at`
  → 404, legacy null-snapshot fallback, `@media print` + Download-PDF, guardrail footer. Structural
  no-cure-leak (snapshot has no prescription field). `lib/reports.ts` read is deploy-order-safe (42703
  → legacy fallback); `minted_by` never selected.
- **Hide (`app/api/reports/hide/route.ts`)** → V5: capability-scoped (audit UUID), sets `hidden_at` +
  purges cache; per-IP capped; 503 fail-soft.
- **Carry-in / V15:** Runbook E revokes client INSERT on `public_reports` (proven effective, §3 above).

**Verification:** web suite **802 green** (+82 for Stage B incl. the gate fix-loops); typecheck 0, lint 0;
four guards green; `next build` OK. New guards: `report-print-guard`, `spec04-report-insert-revoke-guard`,
`spec04-hide-honored-guard`.

**3× adversarial gate — round 1 (Stage B):** all three FAIL, 0 blocking. Two MAJORs (fixed): (a) hide was
honored on the page only — the OG card + embed badge kept unfurling a hidden report's grade+domain →
gate OG on `isReportGone`, resolve the badge via `readLatestVisibleReport` (hidden-excluded, deploy-
order-safe); (b) `isUndefinedColumnError` matched only Postgres `42703`, but a WRITE BODY with a missing
column returns PostgREST `PGRST204` → mint/hide would 500 not 503 pre-Runbook-B → match both codes +
a message backstop. **Round 2:** two PASS (9.5); one FAIL on a THIRD hide surface — the **leaderboard**
(`top/[platform]`) filtered neither `hidden_at` nor claim → a hidden report stayed ranked. **Fixed in B**
via `lib/leaderboard.ts` (hidden-excluded page + indexability count, deploy-order-safe fallback) + guard.
Also tightened the message backstop so a transient `PGRST002` schema-cache error is NOT treated as an
undefined column; mint now rejects an ungradeable audit up front; re-hide re-purges.

**CARRY-FORWARD to Stage C (must verify before the single Stage-E merge):** the **CLAIMED-only** gating of
the badge + leaderboard (unclaimed → unlisted, §3 guardrail #1 / §7 / §8) is Stage C. Stage B added the
**hide** exclusion to both (required now that hide ships); Stage C must add the `claimed_at`/`listed`
gating to `lib/badge-report.ts` + `lib/leaderboard.ts` (reusing their deploy-order fallback) AND the
claimed `/r/` sitemap section, then verify no unclaimed/hidden report is listable. No prod window exists
(whole spec merges once at Stage E). **Remaining for B: round-3 verify → pre-push audit → push → preview.**

### Stage B foundation (superseded detail — kept for provenance)

**Done (committed):** `feat(report): report-snapshot contract + deterministic builder`.
- `PublicReportSnapshot` + `ReportSnapshotFinding` + `ReportSnapshotLedgerItem` — additive types in
  `packages/types/src/audit.ts`. The FROZEN, FREE artifact the public report renders forever. Gating is
  **STRUCTURAL**: there is no field for prescriptions/packets/monitoring.
- `apps/web/lib/report-snapshot.ts` `buildReportSnapshot(SnapshotInput)` — pure + deterministic
  (`mintedAt` injected; no clock/random). Ledger is diagnosis-only (drops the `fixes` rows'
  `suggested_links`/`action_packet_body`), sorted `marginalDelta` desc, never summed, with a
  disclaimer; findings capped per category (`MAX_FINDINGS_PER_CATEGORY = 10`) + payload-stripped.
- Test `apps/web/lib/report-snapshot.test.ts` **7/7**: determinism, no-cure-leak (grep asserts no
  `suggested`/`actionPacket`/packet body in the serialized snapshot), per-category cap, payload-strip,
  v1-null-projection fallback.

**Remaining (TDD each, then the §4 standing loop + 3× gate):**
1. **Mint route** — `apps/web/app/api/reports/mint/route.ts`. Make **auth OPTIONAL** (drop the 401 and
   the 403 `verification_required`; capability = possession of a **completed** audit UUID). Add
   **Turnstile on-demand** (mirror `audits/start`) + the **anon per-IP cap
   `MINT_REPORTS_PER_IP_PER_DAY_ANON = 10`** (authed keeps `MINT_REPORTS_PER_DAY = 20`, per-user). At
   mint, read the audit's `findings` + `fixes` + `confidence_band`/`projected_*` and **write
   `report_snapshot`** (via `buildReportSnapshot`) + `minted_by` (the user id when authed; null for
   anon). **Preserve `insertReportWithRetry`** (one report per audit; idempotent on the `audit_id`
   unique constraint). The `embed_badges` upsert moves to claim (anon mints have no user). → **V4**.
2. **`/r/[slug]` section-slot report** — `apps/web/app/r/[slug]/page.tsx` + new
   `apps/web/components/report/*`. Claim-gated `generateMetadata` robots (**unclaimed → noindex**);
   `hidden_at` → 404. Body = an ordered array of self-contained sections: **ExecutiveSummary /
   PlainFindings / ActionList / Methodology / ReportFooter** (this is the frozen SPEC 05 seam — ruling
   6). ExecutiveSummary is a **pure template** (deterministic, byte-identical per audit). ActionList
   renders the snapshot ledger sorted by `marginalDelta`, **never summed**, with the disclaimer. Footer
   = automated-analysis disclaimer + `mintedAt` "as of" + a fresh-run link + a **dispute/hide** link +
   the existing takedown link. **Legacy null-snapshot fallback** (grade/score/domain + "re-audit for
   the full report" — must never crash on null snapshot or null `audit_id`; ruling 1). `@media print`
   stylesheet + a "Download PDF" affordance (browser print path — **no server-side PDF**). **XSS-escape
   every crawled string** (titles/URLs); no `dangerouslySetInnerHTML` with crawled content. →
   **V5, V7, V8, V13-partial**.
3. **`getPublicReport` / `apps/web/lib/reports.ts`** — extend the read to the new columns
   (`report_snapshot`, `claimed_at`, `listed`, `indexable`, `hidden_at`); the render reads the snapshot,
   falling back to the denormalized columns (`grade`/`score`/`orphan_count`/`avg_depth`) for legacy
   rows. Keep the `public-report:<slug>` cache tag + `purgePublicReport`.
4. **The guardrail trio (never ship mint without it):** unclaimed = noindex + unlisted + the
   "unverified — automated report" label + the disclaimer/timestamp/dispute footer; self-service
   **hide** for the minter (capability/session-scoped) → hidden reports 404; the existing takedown flow
   preserved + linked. → **V5**.
5. **V15** — snapshot columns immutable (write-once at mint); new-surface RLS deny-by-default (covered
   by Runbook D + the guard test); visibility writes only via claim-verified server routes (Stage C).

**Stage-B carry-in (from the Stage A round-3 gate — a pre-existing, non-regression finding):** the
`public_reports_owner_insert` RLS policy + the retained table-level INSERT grant let a verified-domain
authenticated user INSERT a `public_reports` row directly via PostgREST (new rows default
`listed=false`/`indexable=false`, `minted_by`/`report_snapshot` null — low impact). **Stage B must make
the mint/claim path the only creator:** either revoke client INSERT in a Stage-B migration (runbook), or
rely on the audit-ownership + unique-`audit_id` guards. Decide + note it here.

**Migrations B + D are already committed on the branch and proven** — Stage B does **not** re-author
them; it writes the code that populates/reads the columns. Any further schema need (e.g. the INSERT
revoke above) is a new additive Stage-B migration delivered as an owner runbook.

## 8. Stage C — claim + indexing/sitemap + badge integrity (§7/§8/§9) — COMPLETE (gate-passed 2 rounds, pushed, preview-verified)

**Done (committed + pushed as part of the checkpoint; the full Stage C 3× gate — covering the whole
stage — runs before Stage C is declared complete):**
`feat(report): badge + leaderboard resolve CLAIMED reports only (Stage C §7/§8, V6)`.
- The Stage B carry-in is closed: `lib/badge-report.ts` (`readLatestVisibleReport`) and
  `lib/leaderboard.ts` (`fetch`/`countLeaderboardReports`) now resolve **claimed, non-hidden** reports
  only — `not('claimed_at', 'is', null)` added alongside the existing `is('hidden_at', null)`, with the
  same deploy-order-safe fallback (pre-Runbook-B the columns are absent → today's query, behavior-
  preserving since every existing report was minted under mandatory verification = claimed).
- §7 badge integrity (a third-party unclaimed mint can't change a domain's badge) and §8 unclaimed →
  unlisted are both now enforced. `spec04-hide-honored-guard` pins the claim filter on both surfaces.

**Shipped (Stage C COMPLETE — commit subjects):** `feat(report): domain-verified report claim route
(V14)` · `feat(report): owner visibility toggle for claimed reports (§8)` · `feat(seo): list
claimed+indexable reports in the /r/ sitemap section (V13)` · `test(seo): claim-gate the sitemap guard
for /r/` (own commit, M6) · `fix(security): revoke client write on domain_verifications (V14/V15
ownership boundary)` · `fix(deploy-safety): operationalize the domain_verifications revoke runbook`.
Pushed `origin/viral/spec-04-loop` @ `427bcf2` (AI-trace clean; author `git_lab_007`).

1. **C-claim-route (V14)** — `POST /api/reports/[slug]/claim`: authed; REUSES the existing
   domain-verification (new `lib/report-ownership.ts::isDomainVerifiedForUser` reads
   `domain_verifications`, `verified_at IS NOT NULL`), sets `claimed_at`+`listed`+`indexable`, links the
   owner (`embed_badges` upsert — the FIRST writer; nothing inserted it before), composes with anon-claim
   (never writes `audits`), service-role write, deploy-order 503. There is **no `claimed_by` column** —
   ownership is re-derived from verification on every write (§11).
2. **C-sitemap (V13)** — async `app/sitemap.ts` + `lib/sitemap-reports.ts`: claimed+indexable+non-hidden+
   non-takedown `/r/<slug>` section, deploy-order-safe fail-soft (any error → `[]`, sitemap never breaks),
   bounded by `SITEMAP_REPORTS_MAX` (logged, no silent truncation), ISR `revalidate=3600`. Guard updated
   as its own commit (M6). `/compare` stays noindex (M3).
3. **C-visibility (§8)** — `POST /api/reports/[slug]/visibility`: claimed-only owner opt-out of
   `listed`/`indexable` (409 if unclaimed), same ownership gate, only listed/indexable writable
   (snapshot/white_label untouched).
4. **SECURITY (round-1 gate finding, FIXED)** — the ownership gate trusted a client-forgeable
   `domain_verifications.verified_at` (RLS constrains only `user_id`) → any authed user could forge a row
   and take over any report. **Runbook F** revokes client write on `domain_verifications` (proven
   effective by a rolled-back live probe); guard `spec04-domain-verification-write-revoke-guard`. See §3.

**Gate (2 rounds, independent reviewers, all four lenses):** R1 — correctness/deploy-safety PASS 9/9/9/9;
SECURITY **FAIL** (1 blocking = the forgery above); TEST-QUALITY **FAIL** (8/10, canned route mocks let a
same-arity `claimed_at`→`indexable` column swap slip). Both fixed → **R2 PASS** (security closure
re-verified live; recording mocks now catch every gate-predicate mutation; the runbook operationalized;
one minor slug-pin + a non-reproducible test-isolation flake also closed). **Verification:** web suite
**840 green** · full turbo 5/5 · typecheck 0 · lint 0 · `next build` OK (both routes registered,
`sitemap.xml` ISR) · four named guards green. **Preview** `dpl_AQ2cH2grp1arWSKVgKro4DiheSo4` READY; route
sanity: `/` 200 · `/sitemap.xml` 200 (static set, **no `/r/`** — pre-Runbook-B fail-soft) ·
claim/visibility POST no-auth → **401** · `/r/<none>` 404. Production V6/V13/V14 smoke is post-merge
(needs Runbooks **B+F** applied — apply F before/with B, §3).

**Stage-C deploy-order note:** the claim/visibility writes touch the Runbook-B columns, so pre-Runbook-B
they 503 (fail-closed, like mint/hide — no unguarded state). The sitemap/badge/leaderboard reads fall
back. The claim/visibility COLUMNS need no new migration (they live in Runbook B), **but Stage C DOES add
a required security migration — Runbook F** (`…000005`, the `domain_verifications` client-write revoke):
without it the ownership gate is forgeable (round-1 review finding). **Apply Runbook F BEFORE/WITH
Runbook B** (see §3) so claim/visibility never go live while the forgery vector is open.
