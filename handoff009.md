# Handoff 009 — Plan 5 Phase 7 Task 7.2 (guided-live) — session 2026-06-05, RUN=202606051141

Resumed Task 7.2 from **TC-L4** (per handoff/memory). Made large progress; **paused cleanly mid-7.2**.
Verification plan: `docs/qa/2026-06-03-plan-5-launch-verification-plan.md`. All evidence under `evidence/plan-5/` (UNCOMMITTED).

## ✅ DONE this session (evidence on disk)
- **TC-P0** re-verified (TC-P0.txt): node v22.22.3; Stripe sk_test livemode:false (CLI ALSO has an rk_live_ key → always test-mode, never --live);
  MCP ref == dev write-target == `ezspnfeyzwsisymytssm`; Turnstile TEST keys + ADMIN_SECRET patched; STRIPE_WEBHOOK_SECRET set; RECONCILE_LIVEMODE unset; k6 absent; Playwright present.
- **TC-P1** re-run GREEN (TC-P1.txt + /tmp): tsc 0, web **32 files / 166 tests**, inngest **3/37**, k6 node --check 0.
- **TC-L1** (prior session; prod 0 Stripe customers → dry-run trivially write-free).
- **TC-L4** PASS (TC-L4.txt + TC-L4-frames.json + .png): live frame log on info.cern.ch — skeleton held the completed→done gap (domFirst skeleton 5093ms < done 5162ms < GradeCard 5170ms); NO GradeCard before done; numbers match payload.
- **TC-L5 PART 1** PASS (TC-L5.txt): admin takedown route auth — absent/wrong Bearer → 401; correct Bearer → 200 (0 rows). **PART 2 (visible OG-purge) DEFERRED → branch window.**
- **TC-L6** PASS (TC-L6.txt): anon cap=3 (IP 203.0.113.41): 3×200 no-token, 4th→429 captcha_required, dummy→200; **bad-token→429 'Captcha failed'** proven in the 2x window (IP 203.0.113.51).
- **TC-L7** PASS (TC-L7.txt): developers no-token→400 & dummy→200 (via L12); magic-link no-token→400; **bogus-token→400** for developers & magic-link in the 2x window.
- **TC-L7d** PASS-prod (TC-L7d.txt): no-report→404; per-domain 4th→429; per-IP 6th→429; bogus-token→400 (2x window). **(a) 200-existing-report DEFERRED → branch window.**
- **TC-L9** PASS full (TC-L9.txt): (a) valid-sig webhook + fake customer → 500 'handler error' + stripe_events row processed_at NULL (safe retry); (b·i) no-sig → 400 + **LIVE Sentry CRAWLMOUSE-2 tag signal=stripe-webhook-sig-fail level=warning** (confirmed via Sentry MCP) + zero DB writes. **L9b sampling = covered-by-A8.**
- **TC-L10** PASS (TC-L10.txt): per-domain 429 live (nodejs.org 2nd→429); global 503 mechanism = the count<=limit boundary proven live at limits 1/3/5 + source + TC-A10's 5000 lock; fail-open source-pinned.
- **TC-L11** PASS (TC-L11.txt + email PNGs): token_hash cross-device → **307 /dashboard** + authenticated; tampered→307 verify_failed+null; missing→307 missing_token; branded token_hash email templates render.
- **TC-L12** PASS (TC-L12.txt): waitlist idempotent (WL1 2 POSTs → 1 row), no-token→400, 6th IP→429; counts MCP-verified.
- **TC-L14** PASS (TC-L14.txt): anon audit user_id null→AU1' after standalone claim {claimed:1}→{claimed:0}; no-session→401.
- **TC-L8b** documented (TC-L8b.txt): gate order source-pinned; LIVE blocked by a dev-only vendor-chunk issue (see CORRECTIONS) → covered-by-source + A11/L13 pattern. MINOR.

## ⏳ REMAINING (next session) — every CRITICAL must pass for §R
- **TC-L13** (CRITICAL, leg 0D): findings-cap SSE. owner-free shown=5/hidden=N-5, cross-tenant & anon capped ≤5, owner-Pro uncapped, NO user_id on wire.
  - Needs (i) a **TGT** audit with a category N>5 findings (no committed fixture; categories: orphan/deep_page/unreachable_page/over_optimized_anchor/generic_anchor_overuse → a large real site yields >5; or DEVBRANCH-seed >5 findings) — record counts+URL in benchmarks.md as a PRE-RUN gate; (ii) **Pro via live Stripe-test checkout→webhook** (LOCKED decision: FULL live) OR DEVBRANCH id-scoped pro_until UPDATE. The free/cross-tenant/anon/no-PII legs need NO Pro and can run on any >5-findings audit.
- **TC-L8** (CRITICAL): 7 funnel events exactly-once via /ingest network sink (browser). Must-fire subset landing-view/audit-submitted/audit-completed/email-captured/public-share-clicked (share needs a minted report → verified domain, same blocker as L5 → DEVBRANCH or covered-by-A9); csv-download/pro-upgrade need Pro (else covered-by-A9). + replay-off corroboration (no session-recording /ingest for a healthy run) = live face of A8b.
- **TC-L8b 404/200** (MINOR): Pro cross-tenant→404, Pro owner→200 — needs Pro; ALSO the dev vendor-chunk blocker (try `next build`/prod server).
- **TC-L5 part 2** (CRITICAL): branch window — seed public_reports+open takedown_requests, processTakedown(branchSb,slug) → assert takedown_requested_at + queue 'removed' (+ OG render placeholder via TC-A6 OR a brief dev-server repoint to the branch).
- **TC-L7d (a)** (MINOR): 200 for an existing published domain — branch window (or covered-by-route-structure).
- **TC-L2/L3** (CRITICAL, isolated): **SURFACE BRANCH COST FIRST** (get_cost/confirm_cost on org). create_branch p5-cron-$RUN; L2 full reconcile repairs a seeded drift (repaired:1); L3 batched TTL deletes only past-dated; delete_branch. Mapping: if infeasible → covered-by-A2/A4.
- **TC-S1** (CRITICAL): seed 10 benchmark audits (the 10 fixed CMS domains in plan §S) via POST /api/audits/start — **inject explicit fresh x-forwarded-for IPs (or submit as AU1, cap 5) across ≥2 IPs since per-IP cap is 5/3 and 10 distinct big crawls are slow** → benchmarks.md (id/url/grade/score/cms). ⚠ some big crawls may be SLOW/hang (iana.org hung at 0 pages — substitute per plan).
- Then **§C cleanup** (below) → **§R scoring** (≥9 ea lens, every critical passes) → mark plan-doc Phase 7 complete → **controller push** → **R.1** deploy runbook.

## ⚠️ CORRECTIONS discovered this session (carry forward — some contradict the plan/memory)
1. **Cloudflare Turnstile test secrets** — the plan/memory claim "1x…AA accepts ONLY XXXX.DUMMY.TOKEN.XXXX" is **WRONG**. Direct siteverify probes:
   `1x0000…AA` (always-passes) → success=TRUE for ANY non-empty token; `2x0000…AA` (always-fails) → success=FALSE for any token. So verify-FAIL
   negatives REQUIRE the **2x secret** (used in a dedicated 2x window with a dev-server restart). Not a product bug (verifyTurnstileToken trusts data.success; real keys reject real bad tokens).
2. **localhost client IP** = `::ffff:127.0.0.1` (NOT 'unknown'). Next dev sets x-forwarded-for/x-real-ip to the IPv4-mapped loopback → no-header anon audit submits share the `ip:::ffff:127.0.0.1` bucket (anon cap 3). Inject explicit x-forwarded-for to control per-IP buckets (all rate-limit legs did).
3. **TC-L9(a) Sentry-via-onRequestError is WRONG**: the webhook route CATCHES the throw and RETURNS 500, so onRequestError (uncaught-only) never fires. The real live Sentry signal is the sig-fail captureMessage (b·i, confirmed). Not a product bug.
4. **/api/audits/[id]/export 500s in `next dev`**: `Cannot find module './vendor-chunks/@supabase+auth-js'` in Next's static-paths-worker (jszip+supabase chunk split, pnpm). Persists across `rm -rf .next`. Isolated to this route; all other routes fine. Dev tooling, NOT a product bug (Plan-4 verified export live). Re-attempt via `next build`/prod server.
5. **Mint requires a VERIFIED domain + a completed audit of that same domain** (reports/mint:58-73) — crawlmouse.com isn't crawlable, so no real-path public_report on prod → L5-part2/L7d-a/L8-share need the DEVBRANCH (or covered-by deterministic).
6. **Rapid dev-server restarts corrupt `.next`** (stale vendor chunks) → if a route 500s with a vendor-chunk MODULE_NOT_FOUND, `rm -rf apps/web/.next` + restart. Minimize restarts.

## 🧹 PENDING §C CLEANUP (prod test data left on `ezspnfeyzwsisymytssm` — clean at 7.2 completion)
- **audits** (id-scoped DELETE; also their pages/findings children): 147c47b0, b7fdb2c0, 247fb234(iana stuck), 403762f7, 6f5788fd, d87867fb, 8e2380e0, dfb3caf9, 4d249e1e, 211e25f7, a7ec70e7, 1d0ebe32, f5de4824(now owned by AU1').
- **waitlist** (equality-scoped lower(email)+source='developers'): the 6 WL_CLEANUP_EMAILS.
- **stripe_events** (id): evt_p5fake_202606051141.
- **rate_limits** (equality on bucket_key, NEVER global:audits:day): ip:203.0.113.41/.51/.61/.62, ip:::ffff:127.0.0.1, domain:gnu.org, domain:nodejs.org, takedown:* p5td-* keys, waitlist:ip:203.0.113.43/.44, magic:email:* p5 emails.
- **auth users** (auth.admin.deleteUser): AU1 67977a90-6a50-4828-bfbc-c947c871706b, AU1' 981ae3c4-540e-4c0c-969f-6d08b381194f. (Delete their audits FIRST if FK.)
- helper scripts (delete or keep): scripts/p5/{tc-l4-frames.mjs,admin.mjs,webhook.mjs,render-email.mjs}.

## PAUSE-STATE (clean)
- `.env.local` RESTORED byte-identical (sha **f2475ee6…**, 18 keys; Turnstile back to REAL 0x4AAAAAA…, ADMIN_SECRET removed). Backup kept at /home/udsik/.crawlmouse-p5/env.local.ORIGINAL.bak.
- dev (:3000) + inngest (:8288) STOPPED (ports free).
- Prod test data LEFT for §C (inventory above). No code committed; git unchanged from `bce761e`.

## RE-BRING-UP (next session)
`nvm use 22`; re-snapshot+patch `.env.local` (Turnstile 1x…AA site `1x00000000000000000000AA`/secret `1x0000000000000000000000000000000AA` + a throwaway ADMIN_SECRET; for verify-FAIL legs swap to 2x…AA with a restart);
`pnpm --filter @crawlmouse/web dev` (bg) + `npx inngest-cli@latest dev -u http://localhost:3000/api/webhooks/inngest --no-discovery` (bg). NEVER `pkill -f 'next dev'`/`'inngest-cli'` (self-match → exit 144); kill by `lsof -ti tcp:<port>`. Plan §B/§S/§C/§D in the plan doc. Standing gotchas in memory still apply.
