# Handoff 010 — Plan 5 Phase 7 Task 7.2 (guided-live) COMPLETE — session 2026-06-06, RUN=202606052356

Resumed from `handoff009.md` (13 legs done). This session closed the remaining legs and finished Task 7.2.
All evidence under `evidence/plan-5/` (NOW committed). Result: **guided-live verification COMPLETE, 9/9/9/9**,
with **2 launch deploy-gate findings** surfaced. PROD never destructively mutated; all test data §C-cleaned; `.env.local` restored.

## ✅ DONE this session
- **TC-L13** (CRITICAL) — SECURITY gate proven **LIVE** on prod: `viewerIsPro` TRUE only for the Pro OWNER (a); FALSE for
  anon (b), free owner (c), AND a **Pro user on another tenant's audit (d)** — Pro does not leak across tenancy. **No `user_id`
  on any SSE payload** (all `hasUserIdKey=false`). Pro seeded via the **LIVE Stripe-test checkout→webhook→applyStripeEvent**
  path (real customer `cus_UeUirlImaxTL5L` + real active sub → signed `checkout.session.completed` → webhook 200 → `pro_until`
  written; verified `{pro:true}`). The numeric **cap-bite (shown=5/hidden=N-5)** is **covered-by-A11** — see findings + deviations.
- **TC-L8b** (FULL LIVE pass) — export route 401/402/404/200; the prior dev vendor-chunk 500 did NOT reproduce.
- **TC-L8** — funnel DRIVEN live through every call site (landing→submit→complete→csv-link→login); exactly-once **covered-by-A9**
  (live PostHog ingestion does not flush under headless automation — verified 0 cloud events + 0 sendBeacon/fetch/XHR attempts;
  `x-forwarded-for` also CORS-blocks posthog ingestion). Env/tooling limitation, NOT a product defect.
- **TC-L1** (STRENGTHENED) — reconcile dry-run write-free with a REAL customer present (checked:1, repaired:0, before==after).
- **S1** — 10/10 seeded via the real app path; `drupal.org` completed (C) + several small completers; deep official CMS sites
  blocked by finding #1.
- **Branch window (L2/L3/L5pt2/L7d-a)** — **DEVBRANCH INFEASIBLE** (Supabase branching needs Pro plan ~$25/mo; user declined →
  chose deterministic coverage) → covered-by-A2/A4/A6/route-structure + live adjuncts (dry-run write-free; admin-auth gate;
  takedown rate-limit/404/400; 0-row prod TTL blast-radius).
- **§C cleanup** COMPLETE; **§R scoring** `RESULTS-scoring.txt`; plan-doc Phase 7 marked; TC-P1 gate GREEN.

## ⚠️ 2 LAUNCH DEPLOY-GATE FINDINGS (the verification's value — FIX before launch)
1. **MAJOR — large-site audits exceed the Inngest step-output limit.** `inngest/audit.ts:35-52` returns the whole crawl result
   from `step.run('run-engine')` and passes it to `step.run('persist-results')`; a deep crawl near the 500-page free cap exceeds
   the step-output size cap → `"step output size is greater than the limit"` → audit ends `failed`. Free users CAN trigger
   500-page crawls on real large sites → **the core audit feature may fail for large sites in prod** (confirmed on gnu.org +
   8 deep CMS sites in the dev Inngest server; Inngest Cloud's cap is ~4MB — verify the prod threshold). **FIX:** persist INSIDE
   the run-engine step / batch-insert pages+findings incrementally so the result never crosses a step boundary; re-run a deep
   crawl end-to-end. Engine crawl/grade logic is correct + green (packages/engine) — this is persistence plumbing.
2. **MINOR — reconcile spurious `wouldRepair`.** `runReconcile` compares `pro_until` as STRINGS (`billing-helpers.ts:170`); DB
   `…+00:00` vs computed `…000Z` (same instant) → every active subscriber looks "drifted" (inflated dry-run metric + harmless
   no-op writes in a full run). **FIX:** compare by instant (`new Date(a).getTime() === new Date(b).getTime()`). Unit tests miss
   it because they compare ISO-to-ISO. See `evidence/plan-5/TC-L1.txt`.

## ENV / CARRY-FORWARD CORRECTIONS (this session)
- **Crawler is conservative:** `canonicalizeUrl` strips trailing slashes → trailing-slash sites barely crawl (most sites → 1-2
  pages); clean-`.html` sites crawl deep → hit finding #1. So a real prod audit with >5 findings in a category is **not obtainable**
  via blind site selection (hence L13 cap-bite → A11).
- **Supabase project is on the FREE plan** → `create_branch` fails ("Branching is supported only on the Pro plan or above").
  The $0.01344/hr branch cost I quoted was runtime-only; enabling branching needs the ~$25/mo Pro plan. User declined.
- **The dev Inngest server AUTO-FIRES the scheduled crons** (03:00 reconcile dry-run = safe; 04:00 TTL cleanup = 0-row no-op
  pre-launch). See `SAFETY-cron-autofire.txt`. No prod mutation. In a real staging harness, point the dev server at a branch.
- **Injecting `x-forwarded-for` in a browser CORS-blocks PostHog ingestion** (preflight on the cross-origin endpoint) — keep it
  off the funnel browser.
- The **IDE terminal crashed** mid-session and killed dev/Inngest + in-flight crawls; recovered cleanly (restart, re-verify).

## §C CLEANUP — DONE (prod is launch-clean except the 2 residuals below)
audits/pages/findings/waitlist/public_reports/takedown_requests = **0**; rate_limits = only `global:audits:day`; the 2 test users
(`p5user`/`p5claim`, auth+public) deleted; Stripe `sub_1TfBjYJp0NUyqKK7njcBD9wM` canceled + `cus_UeUirlImaxTL5L` deleted;
`.env.local` restored byte-identical (sha **f2475ee6…**). Helper scripts kept in `scripts/p5/`.
**RESIDUALS LEFT INTACT (not mine to delete — surfaced for you):** `users` = `nahlai.tech@gmail.com` + `ud.ideal@gmail.com`
(founder real accounts, 2026-06-01, free/no-Stripe); **42 prior-session test-mode `stripe_events`** (Plan-4 era idempotency
ledger; harmless; bulk-clear before launch if desired — the MCP classifier blocks a wildcard delete, use an explicit id list).

## REMAINING (next)
- **R.1 deploy runbook** — `docs/deploy/launch-runbook.md` (collaborative; per plan §R.1 + spec §6/§19.2). ADD the 2 findings as
  pre-launch fix-PRs.
- **Fix-PRs:** finding #1 (MAJOR, audit persistence) + #2 (MINOR, reconcile comparison), then re-run TC-S1 (deep crawl) + TC-L1.
- The §D deploy-gates (token_hash templates, LIVE Stripe keys/webhook, subprocessor DPAs, governing-law/entity, k6 staging ramp).

## RE-BRING-UP (if needed) — same as handoff009
`nvm use 22`; re-snapshot+patch `.env.local` (Turnstile 1x site `1x00000000000000000000AA`/secret `1x0…AA`; 2x for verify-FAIL;
throwaway `ADMIN_SECRET`); `pnpm --filter @crawlmouse/web dev` (bg) + `npx inngest-cli@latest dev -u http://localhost:3000/api/webhooks/inngest --no-discovery` (bg).
NEVER `pkill`; kill by `lsof -ti tcp:<port>`. Helper scripts in `scripts/p5/` (driver.mjs, stripe-pro.mjs, l8-funnel*.mjs,
reconcile-dryrun.ts, branch-seed-l13.mjs, auditstatus.mjs, admin.mjs, webhook.mjs, s1-seed.mjs). Backup at
`/home/udsik/.crawlmouse-p5/env.local.ORIGINAL.bak`.
