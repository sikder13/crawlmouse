# Crawlmouse — Project Handoff 008

**Date:** 2026-06-02
**Working dir:** `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0` · **Repo:** github.com/sikder13/crawlmouse (private), work on `main`.
**`origin/main` HEAD = `7a0f6cb`** (this session pushed 8 commits `eee8adb..7a0f6cb`).
**Supersedes:** handoff006. (handoff003 §4 methodology still applies.)

---

## 0. Headline — Plan 4 (Billing) is COMPLETE + guided-live VERIFIED

Part A (the only missing Plan-4 code — a dashboard plan-status card) shipped, and the **whole billing surface was verified guided-live** against a rigorous test plan that was itself reviewed→scored→fixed to **≥9 on all four lenses** (coverage / objectivity / negative-&-security / repeatability-&-safety) across **3 review rounds** before execution. The test plan lives at `docs/qa/2026-06-02-plan-4-billing-verification-plan.md`.

**The verification found and fixed FOUR launch-critical issues** (each: adversarial 3-lens review to ≥9/9/9, then live re-verify):

1. **Self-grant-Pro bypass (CRITICAL).** `users_self_update` RLS had `using(id=auth.uid())` but **no `WITH CHECK`**, and `anon`/`authenticated` held `UPDATE` on `public.users` with no protecting trigger → any logged-in user could `PATCH /rest/v1/users?id=eq.<own>` `{pro_until:'2099…'}` and self-grant Pro. **Fix:** migration `20260602000013_harden_users_entitlement_grants` (remote `20260602054456`) — `revoke update on users from anon, authenticated` + drop the dead policy. Verified: UPDATE on `users` is now `service_role`/`postgres` only.
2. **Reconcile cron chunk-poisoning.** One deleted Stripe customer threw the whole 200-row `step.run` chunk. **Fix:** extracted `inngest/billing-helpers.ts` (`deriveProUntil`, `reconcileCustomerChunk`) + per-customer try/catch — skip Stripe `resource_missing`, re-throw transient/systemic, surface Supabase read/write errors; also `billing.ts` now throws on the page-read error. Unit-tested (`inngest/billing.test.ts`).
3. **Magic-link sign-in fully broken (CRITICAL).** It was server-initiated (PKCE via `/api/auth/magic-link`) but verified **client-side** (`/login/verify/page.tsx`) — the browser can't complete the exchange (PKCE verifier cookie isn't readable by JS) → it hung on "Signing you in…". **Fix:** replaced with a server route `app/login/verify/route.ts` doing `verifyOtp({token_hash,type})` (robust, cross-device) or `exchangeCodeForSession(code)` (same-device fallback) + an OTP-`type` allow-list, then anon-audit claim + redirect.
4. **Paid-but-Free immediacy.** Entitlement was set only by `customer.subscription.*`; `checkout.session.completed` merely linked the customer. Stripe doesn't guarantee order → `subscription.created`-first 500'd and a just-paid user saw Free until a retry (`stripe listen` doesn't auto-retry locally). **Fix:** `checkout.session.completed` now links the customer FIRST then **grants `pro_until`** (retrieve sub; grant-only, never clears; retrieve blip defers to `subscription.*`) + new `components/billing/ActivatingPro.tsx` polls a lightweight `app/api/billing/status` and auto-swaps to the Pro card (strips `?upgraded=1`). Live-verified: pay → "Activating Pro…" → **auto-flips to Pro, no manual refresh.**

**Gates:** apps/web 83 tests + inngest 19 tests green; `tsc --noEmit` 0; `pnpm exec next lint` clean.

---

## 1. Live TC results (guided; test-mode Stripe `sk_test`, prod Supabase `ezspnfeyzwsisymytssm`, DB asserts read-only via MCP)

PASS: **P1** preflight · **X1** config (both crons registered, whsec match) · **X2** provisioning · **W1** entitlement==period-end · **W2** idempotency/crash-recovery · **W3a/b** sig-fail→400, 0 forged ledger rows · **W4** out-of-order→500+`processed_at null`→recovers · **W5** cancel→`pro_until` null · **W6a** bad price→400 · **W6b** unauth→401 · **W6c** malformed→400 (not 500) · **W6d** ref-id NOT spoofable · **W7** re-subscribe reuses customer (no dup) · **W8** origin allow-list (success_url≠evil) · **G2a** free export→402 / **G2b** Pro→200 zip · **G3a** 401→**G3b** 402 (gate before ownership)→**G3c** 404→**G3d** nonexistent==not-owned 404 (no oracle) · **G4** pageCap 2000(Pro)/500(free) · **G5a/b** portal redirects · **G6** portal POST 401/400/200 · **C1** reconcile logic(unit)+read-only truth(==Stripe)+blast-radius · **C2** TTL predicate+3 cascade FKs+blast-radius · **I1** full purchase→auto-Pro · **I2** free card · **S1** bypass closed.

**G1 (findings cap):** logic unit-tested (`lib/findings.test.ts`) + stream `viewerIsPro` gating code-verified (`stream/route.ts:66`); **live SSE-cap leg deferred** — needs a findings-rich completed crawl (example.com is 1 page/0 findings; can't seed findings — MCP classifier blocks unscoped DML). Do this in Plan 5 with a multi-page test site if a live confirmation is wanted.

**Crons NOT invoked live (safety):** both are full-table/unscoped (`stripe-reconcile` rewrites every `pro_until`; `audits-ttl-cleanup` is an unscoped DELETE) → verified by unit logic + read-only blast-radius, flagged as deploy-gates.

---

## 2. Deploy-gates before launch (in plan §8)

- **Magic-Link email template → token_hash.** Set Supabase Auth → Email Templates → Magic Link URL to `{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink` (and signup template with `&type=signup`). The DEFAULT template sends a PKCE `?code=` link, which the route can only complete **same-device** → prod email sign-in is same-device-only until this changes. (Local verify used admin-minted token_hash links, which exercise the robust path.)
- **Scope/guard the two crons** before any live full-table run (single-customer/dry-run mode + a livemode guard; bounded/batched TTL delete).
- **Resend webhook + `RESEND_WEBHOOK_SECRET`**, **LIVE Stripe keys + prod webhook registration**, Stripe statement-descriptor typo ("Nahl Techhnologies Inc"). All Plan-5/deploy.

---

## 3. Gotchas discovered this session

- `@supabase/ssr` **server-initiated PKCE** magic links MUST be verified server-side (verifier cookie not readable by browser JS). `token_hash`+`verifyOtp` is the cross-device-robust path.
- **`stripe listen` does NOT auto-retry 500s** like prod Stripe → out-of-order webhook events stay stuck locally; `stripe events resend <id>` to re-drive (it forwards through listen, with a delay).
- Magic-link **OTP expires fast** (`otp_expired` 403). For headless tests, mint **admin `generateLink`** token_hash links and use immediately.
- `stripe subscriptions cancel` / `stripe customers delete` are **interactive** ("Enter 'yes'") → `echo yes | …`.
- To curl **authed API routes** headlessly: run `verifyOtp` through `createServerClient` with an in-memory cookie jar (`getAll`/`setAll`) → the library writes the exact `sb-<ref>-auth-token` cookie; reuse it as a `Cookie:` header.
- **Supabase MCP `execute_sql` DOES run id-scoped DELETE** (the old "blocks all test DML" belief was wrong). But the Claude Code auto-classifier blocks **UNSCOPED destructive** deletes (e.g. `delete from stripe_events` with no WHERE) — scope by id.
- `/api/audits/start` response is `{auditId}` (no `pageCap` in the body) — verify the cap via `audits.settings` in the DB.
- Standing: vitest no `@/` alias in lib unit files (relative imports); `/inngest` has its own vitest; `pnpm exec next lint`; migrations via Supabase MCP `apply_migration`; `nvm use` Node 22; subagent push classifier blocks main pushes → controller pushes.

---

## 4. This session's commits (`eee8adb..7a0f6cb`)

`e479552` plan-status card · `b0ffdf6` unit coverage + `truncateDetail` · `acaf518` reconcile cron resilience · `a6521f7` verification test plan · `aeedbcd` entitlement-grants hardening (migration) · `f8a5b2e` server-route magic-link · `7b37f57` grant-Pro-on-checkout + activating poll · `7a0f6cb` docs.

## 5. Next
Plan 5 — launch readiness (Turnstile widget wiring, PostHog funnel + Sentry alerts, real legal copy, k6 load test, the deploy-gates above, pre-launch checklist) → deploy (Vercel Pro, prod env, DNS, LIVE Stripe webhook).

End of handoff 008.
