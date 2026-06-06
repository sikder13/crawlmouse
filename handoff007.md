# Crawlmouse — Handoff 007 (session bridge → Plan 4 execution)

**Date:** 2026-06-02
**origin/main HEAD:** `eee8adb` (Plans 1–3 hardened + pushed; nothing uncommitted of consequence except untracked handoff*.md + scripts/*).
**Purpose of this file:** bridge to a fresh session that will EXECUTE the approved Plan-4 completion plan. This session did the planning only — no Plan-4 code/verification was started.

## State in one paragraph
The codebase-hardening campaign is complete (Plans 1, 2, 3 at ≥9/9/9). Plan 4 (Billing) **code is complete + pushed** and its 3 migrations (`stripe_events`, `audits_ttl`, `email_events`) are **already applied to remote** (verified via `list_migrations`). The remaining Plan-4 work = (A) one small code task — a dashboard **plan-status card** linking to the existing `/billing` Stripe-Portal route (the only missing UI) — and (B) **verify the whole billing surface (code + configuration)** against a rigorous test plan. The full approved plan (Parts A–C, the layered test cases TC-U/W/G/C/I/X, the 4-lens rubric, the execution loop) is saved at **`/home/udsik/.claude/plans/abundant-spinning-pumpkin.md`** — read it. Env: all Stripe + Inngest + base URL set; only `RESEND_WEBHOOK_SECRET` empty (deferred to deploy). `public.users` provisioning is fixed live (Plan 2), so the purchase loop should actually grant Pro now — that's the key thing to re-prove.

## How to start the new session
1. In Claude Code, run `/clear` (this resets the conversation; your file-based memory under `…/memory/MEMORY.md`, the approved plan file, and these handoff docs all persist on disk and auto-load).
2. Paste the **resume prompt** below.

## RESUME PROMPT (paste into the new session)

> Read `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/handoff006.md` in full first (current build state — Plans 1–3 hardened + pushed, origin/main `eee8adb`), then the approved plan `/home/udsik/.claude/plans/abundant-spinning-pumpkin.md` (Plan-4 completion — already approved), then trust your auto-loaded `MEMORY.md` index (verify any file/flag it names still exists before acting).
>
> **Goal: EXECUTE the approved Plan-4 (Billing) completion plan.** Plan-4 code is complete + pushed and its 3 migrations are already live on remote; what remains is (A) one small code task — a dashboard "plan-status card" with a Manage-subscription link to the existing `/billing` route (per Part A: add a pure `lib/billing/plan-card.ts` + `components/billing/PlanStatusCard.tsx`, render it in `app/dashboard/page.tsx`, reuse `isProActive` from `lib/pro.ts`) — and (B) verify the whole billing surface (code + configuration) against the rigorous test plan in Part B.
>
> Apply the project methodology (handoff003 §4) — review → score → fix → re-review → ≥9/10 — and per my standing preference ([[feedback-rigorous-test-plan-code-and-config]]) apply it to BOTH code AND configuration/live behavior, and to the TEST PLAN itself before executing it. Concretely follow Part C: (1) score the test plan with 3 adversarial Opus reviewers against its 4-lens rubric (coverage / objectivity / negative-&-security / repeatability-&-safety) until ≥9; (2) implement Part A + the `plan-card.test.ts` unit tests, then a 3-lens code review to ≥9/9/9 (gate on `tsc` 0 + `pnpm exec next lint` clean + unit suite green); (3) execute the deterministic webhook tests via `stripe trigger` + the live purchase loop, GUIDED — you (the assistant) start `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, `npx inngest-cli@latest dev`, and `apps/web` `pnpm dev` as background processes (Node 22 — `nvm use` first), and assert DB state READ-ONLY via the Supabase MCP (project `ezspnfeyzwsisymytssm`); I (the user) do the browser logins/Checkout with test card `4242 4242 4242 4242`; (4) record a pass/fail+evidence table for every TC, score the results, fix, re-run until every critical TC (W1–W6, G1–G5, C1–C2, I1) passes at ≥9; (5) controller pushes (subagent push classifier blocks pushes to main).
>
> Honor standing prefs: subagents on Opus 4.8 (never downgrade); never mention AI/Claude/Cursor in commits/PRs/comments and strip the Co-Authored-By trailer; distinctive/playful UI; fresh web research with sources for significant decisions; SaaS signups use nahlai.tech@gmail.com; migrations via the Supabase MCP `apply_migration` (NOT `supabase db push`); source-lint with `pnpm exec next lint` (not `eslint .`). Deferred to deploy/Plan 5 (NOT now): Resend webhook + `RESEND_WEBHOOK_SECRET`, LIVE Stripe keys + prod webhook registration.
>
> Start by confirming you've read handoff006 + the plan + MEMORY, give a 3-line status, then begin Part C step 1 (score the test plan with the 3 reviewers).

## Pointers
- Approved plan (Plan-4 detail): `/home/udsik/.claude/plans/abundant-spinning-pumpkin.md`
- Overall build state: `handoff006.md`. Methodology + Plan-4 live-verification notes: `handoff003.md` §4 / §5.
- Memory index: `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/memory/MEMORY.md` (RESUME POINT bullet points here).
