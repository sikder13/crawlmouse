# Crawlmouse — Project Overview

> **Read this first.** This is the single source of truth for *what Crawlmouse is, why it was built the way
> it was, how it works end to end, and where it stands.* It's written so a new contributor (or a fresh AI
> session) can get the full picture without spelunking through commits. Last updated **2026-06-12**.
>
> **Status:** Crawlmouse v1.0 is **live in production at [crawlmouse.com](https://crawlmouse.com)**, billing is
> live, it is legally compliant, and it is already serving real organic traffic.

---

## 1. What Crawlmouse is

**Crawlmouse is a free, no-install, instantly-shareable internal-linking grader for any website.** You paste a
URL, it crawls the live site, builds the internal-link graph, and returns a single **A–F letter grade + score**
for how well the site's internal linking is structured — plus the specific problems holding it back (orphan
pages, pages buried too deep, weak hubs, lazy anchor text).

It works on **any platform** (Shopify, WordPress, Webflow, Wix, Squarespace, Framer, Ghost, or fully custom)
because it reads rendered HTML rather than hooking into a CMS. The whole experience is built to be **shared**:
verified-domain owners can mint a public report page, embed a grade badge, and appear on per-platform
leaderboards.

**One-liner:** Screaming Frog / Sitebulb–class internal-link insight, but free, browser-based, instant, and
share-driven instead of a desktop crawler with a 300-setting UI.

---

## 2. Why it was built this way (strategy)

- **v1.0 is a viral consumer web app.** Growth is designed to come from *shared output*: public reports rank
  and get linked, embed badges create backlinks, and leaderboards turn the audit corpus into evergreen content.
  This is why public reports (`/r/<slug>`) are **indexable** and the `/top/<platform>` leaderboards exist.
- **v1.2 will add a developer surface** (CLI + GitHub Action + agentic webhooks) on the *same engine*. v1.0 is
  deliberately architected with a clean TypeScript engine boundary, a durable job model, and capability-URL
  reads so those surfaces can be built *on top*, not bolted in. (See `project_strategic_direction` memory.)
- **Pricing:** Free tier (audit any site, 500-page crawl cap, rate-limited) + **Pro at $19/mo or $190/yr**
  (CSV export, higher limits, no per-domain rate limit). Positioning: *"no credits, unlimited crawls."* $19
  undercuts every credible rival.
- **Cost discipline is a first-class constraint:** operating cost (excl. Stripe/marketing) must stay **≤ 18% of
  MRR**. This shaped the page caps, rate limits, TTL cleanup, concurrency gating, and analytics sampling.

---

## 3. How it works (the flow)

1. **Submit** a URL on the homepage (anti-abuse gated by Cloudflare Turnstile + per-IP / per-domain / global
   rate limits).
2. The request creates an `audits` row (`pending`) and fires an **Inngest** `audit.requested` event.
3. The **audit worker** crawls the site (`@crawlmouse/engine`), builds the link graph, computes the grade, and
   persists pages/links/findings — all in one durable step. Progress streams to the browser over **SSE**, so you
   watch the link graph build live.
4. You get the **grade + four component scores + findings**. Anonymous audits are readable via a capability URL
   (the audit UUID); signing up *claims* your anonymous audits.
5. If you **verify domain ownership**, you can **mint a public report** (`/r/<slug>`), grab an **embed badge**,
   and land on the **leaderboard**. Pro users can **export CSV**.

### The grade
The score is a weighted blend of four components computed from the internal-link graph:
- **Orphans** — pages with no inbound internal links.
- **Click depth** — how far pages sit from the homepage (reuses a BFS depth computation).
- **Anchor diversity** — descriptive vs. generic/duplicated anchor text.
- **Structure quality** — *concentration-rewarding*: `0.6·hubConcentration + 0.4·hubReachability` (top-5%
  PageRank share + how reachable the top hubs are within depth ≤ 3). A coverage floor caps the grade when a crawl
  is too thin (< ~5 pages) or errored, and a JS/SPA detector suppresses false orphans on client-rendered sites.

---

## 4. Architecture & repo layout

A **pnpm + Turborepo monorepo** (`pnpm@9.12.0`, Node 22). Push to `main` → Vercel auto-deploys.

```
apps/web/            Next.js 15 App Router app (the product + all routes + API)
packages/engine/     @crawlmouse/engine — the crawler + analysis (pure TypeScript, no Next)
packages/types/      @crawlmouse/types — shared types + billing helpers
inngest/             @crawlmouse/inngest — durable background functions (audit, billing crons)
infra/supabase/      migrations + auth email templates
docs/                spec, plans, deploy runbook, legal research, ops cost model, QA
scripts/             ops helpers (gitignored scripts/.env.local holds short-lived operator tokens)
tests/load/          k6 load scripts (staging-only; deferred)
evidence/            captured verification evidence from launch phases
```

**Stack:** Next.js 15 (App Router, typed routes) · Supabase (Postgres + Auth + RLS) · Stripe (billing) ·
Inngest (durable jobs/crons) · Crawlee/Cheerio (crawl engine) · Sentry + PostHog (observability) ·
Cloudflare (DNS, Turnstile, Email Routing) · Resend (transactional email) · Vercel (hosting, Pro plan).

---

## 5. The engine (`packages/engine/src`)

Pure TypeScript, framework-free, fully unit-tested — the reusable core that v1.2's CLI/Action will share.

- **`crawler.ts`** — Crawlee `CheerioCrawler` (HTTP, no JS). Same-hostname link strategy, scheme-normalized
  canonical URLs, per-host concurrency, page cap. Two prod-critical workarounds live here: it re-asserts
  `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` via `globalThis.process.env` (so Crawlee doesn't spawn `ps`, which is absent
  on Vercel), gated on Linux. **Do not remove `ensureCrawleeMemoryHint()`; keep `crawlee` a DIRECT `apps/web`
  dependency** (see §11).
- **`extract.ts` / `graph.ts`** — parse pages once, build the internal-link graph.
- **`analysis/`** — `pagerank`, `depth`, `orphans`, `anchor`, `structure`, `js-detect`.
- **`grade.ts`** — combines components into the letter grade + score, with the coverage floor.
- **`safe-fetch.ts` / `ssrf-guard.ts`** — SSRF protection (revalidates redirects, blocks private ranges) — the
  engine crawls arbitrary user-supplied URLs, so this is load-bearing security.
- **`cms-detection` / `cms-adjustments`** — platform detection (drives the leaderboards) + per-CMS tweaks.
- **`robots.ts` / `sitemap.ts`** — respect robots + seed from sitemaps.

---

## 6. The web app (`apps/web`)

**Pages:** `/` (homepage + live audit), `/audit/[id]` (results + SSE), `/r/[slug]` (public report, indexable),
`/compare/[a]/[b]` (head-to-head), `/top/[platform]` (leaderboards), `/embed/[domain]` (badge), `/pricing`,
`/dashboard`, `/login` + `/verify`, `/developers` (waitlist), `/bot`, `/status`, legal pages, `/blog` + posts.
Plus SEO files: `sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, `icon.tsx`, `apple-icon.tsx`, `global-error.tsx`.

**API (`app/api`):** `audits/start`, `audits/[id]/stream` (SSE), `audits/[id]/export` (Pro CSV, gated
401/402/404/200), `auth/magic-link` + `auth/claim`, `verify/start` + `verify/check`, `reports/mint`,
`billing/checkout` + `portal` + `status`, `takedown` + `admin/takedown/process`, `developers` (waitlist), and
webhooks for `stripe`, `inngest`, `resend`. tRPC at `trpc/[trpc]`.

**Auth:** Supabase magic-link via **`token_hash`** (cross-device-robust — the PKCE `?code=` default only works
same-device). Emails send from `magic@crawlmouse.com` (Resend SMTP). `site_url` = `https://crawlmouse.com`.

**Abuse + cost controls:** Cloudflare Turnstile (on-demand after a per-IP cap), per-IP/per-domain/global daily
rate limits (`global:audits:day` fails *closed*; per-IP/domain fail *open*), 30-day TTL cleanup of free audits,
PostHog sampling. All baked to hold the ≤18%-MRR ceiling.

---

## 7. Background jobs (`inngest/`)

Served through `apps/web/app/api/webhooks/inngest` (`maxDuration=300`, `runtime=nodejs`). Functions:
- **`auditFn`** (`audit.ts`) — crawl + persist in one durable step (so the multi-MB crawl result never crosses
  an Inngest step-output boundary). `onFailure` marks the audit `failed` *and* emits a `signal:audit-failed`
  Sentry event via an injected reporter (the worker stays Sentry-agnostic). Concurrency is env-driven
  (`INNGEST_AUDIT_CONCURRENCY`, default **5** — the Inngest Free cap; only raise to 50 on Inngest Pro).
- **`reconcileBillingFn`** — daily Stripe↔DB entitlement reconcile (dry-run by construction; livemode-guarded).
- **`cleanupExpiredAuditsFn`** — bounded daily TTL delete of expired free audits.

---

## 8. Data model (`infra/supabase/migrations`)

Postgres on Supabase (`ezspnfeyzwsisymytssm`). Core tables: **users** (entitlement via `pro_until`,
`stripe_customer_id`), **audits**, **pages**, **links**, **findings**, **public_reports** (denormalized at mint
for one-query viral reads), **embed_badges**, **stripe_events** (idempotency ledger), **email_events**,
**rate_limits**, **waitlist**, **benchmark_cohorts**. A `handle_new_user` trigger provisions `public.users` on
signup. **RLS is deny-by-default**; anonymous audit reads go through capability-URL admin reads (no `user_id`
ever on the wire), not open RLS. Migrations are applied via the Supabase MCP / Management API.

---

## 9. Infrastructure, services & key IDs

| Service | Detail |
|---|---|
| **Repo** | `github.com/sikder13/crawlmouse` (private) · work on `main` |
| **Hosting** | Vercel project `crawlmouse-001` (`prj_ZOVjZgG2kU6BzcXyAFutzNpQQXx5`), team `team_7JoIUGWqgJwobBinsyt2qRKH` (`nahl-technologies-projects`), **Pro plan**, git-linked → auto-deploy |
| **Domain** | `crawlmouse.com` (live, TLS via Vercel, DNS-only) |
| **Database/Auth** | Supabase `ezspnfeyzwsisymytssm` (us-east-1) |
| **Billing** | Stripe LIVE `acct_1TGtSdJp0NUyqKK7` · product `prod_UfF3mDgWtNhWAQ` · $19/mo `price_1Tfua6Jp0NUyqKK7JdkdHweF` · $190/yr `price_1TfuaNJp0NUyqKK7FvumlEsm` · webhook `we_1ThBIfJp0NUyqKK7HieIGRUw` → `/api/webhooks/stripe` |
| **DNS/Edge** | Cloudflare account `23bc67f7c3a229d9b7d58407ab9de8b8` · zone `76e83abf448d438608e27eebdd3ddb9a` · Turnstile sitekey `0x4AAAAAADcDUWXN1hJ_2MRB` · Email Routing (`magic@`/`support@`/`privacy@`/`abuse@`/`takedown@`) |
| **Email** | Resend, domain `crawlmouse.com`, sender `magic@crawlmouse.com` |
| **Errors** | Sentry org `nahl-technologies-inc`, project `crawlmouse` (source-maps + 3 alert rules) |
| **Analytics** | PostHog project `448922` (US Cloud), `/ingest` reverse-proxy, geo-gated consent |
| **Jobs** | Inngest (Free/Hobby — concurrency cap 5) |
| **Entity** | **Nahl Technologies Inc** (Delaware C-Corp, office in Indiana; governing law Delaware). DMCA agent registered (reg# `DMCA-1074108`); 4 subprocessor DPAs executed. |
| **Accounts** | SaaS signups use `nahlai.tech@gmail.com` |

---

## 10. What's been built (the journey)

- **Plan 1 — Engine:** the crawler + graph + grading + SSRF guard. Hardened ≥9/9/9.
- **Plan 2 — Web app + auth:** Next.js app, magic-link auth, anon audits + claim-on-signup, RLS hardening, SSE.
- **Plan 3 — Sharing:** public reports, OG cards, head-to-head compare, embed badge, leaderboards, takedown flow.
- **Plan 4 — Billing:** Stripe Checkout + Portal, webhook→Pro entitlement, idempotency ledger, reconcile cron,
  Pro-gated CSV export.
- **Plan 5 — Launch readiness:** Turnstile, PostHog funnel + Sentry, the ≤18%-MRR cost controls, legal pages,
  `/developers` waitlist. Verified live (handoff010, 9/9/9/9).
- **Launch blockers (Sessions A/B):** all 7 algorithm/correctness blockers fixed + proven on large sites
  (`books.toscrape` 496pg → A/90.61 — the case that never used to finish).
- **Deploy (Session C, June 2026):** legal → industry-standard, Vercel prod, Stripe LIVE, Supabase auth emails,
  **found + fixed 3 stacked prod-only pipeline bugs** (see §11), Stripe LIVE webhook (purchase→Pro proven),
  Sentry source-maps + alert rules, Vercel Pro + `maxDuration`, **DNS cutover to crawlmouse.com**, **legal
  compliance closed** (DMCA agent + 4 DPAs), the `audit-failed` signal, and a full **SEO foundation + blog**.

Every code change went through the project's **TDD + 3×Opus adversarial review gate**.

---

## 11. Hard-won lessons (don't relearn these)

- **The core pipeline was once 100% broken in prod** while every "proven live" test passed — because those ran
  on the *local* `inngest-cli` dev server, not the deployed Vercel function. Three stacked prod-only bugs:
  (1) `crawlee` wasn't nft-traced into the lambdas (transitive-only dep → `Cannot find module 'crawlee'`) → it
  must be a **DIRECT `apps/web` dependency**; (2) Inngest concurrency `50` > the Free cap `5` rejected the whole
  app sync → concurrency is env-driven, default 5; (3) Crawlee spawned `ps` (absent on Vercel) → fixed via
  `globalThis.process.env` (a bundle-local `process.env` write doesn't reach the externalized crawlee).
  **After ANY deploy touching the engine/crawl path, run a live audit smoke** — unit tests can't catch these.
- **Carry-forward gotchas:** `nvm use 22` (system default is 20); never reference AI tools in commits/PRs (strip
  `Co-Authored-By`); route-segment exports must be static literals; `turbo.json build.env` must list every
  build-time env var (Turborepo strict mode); Vercel "Sensitive" env vars can't be read back (edit, don't dup);
  Supabase MCP has **no auth-config tool** (use the Management API for `site_url`/templates); `@/` alias works in
  vitest but unit-tested `lib` should prefer relative imports.

---

## 12. Current live state & what remains

**Live & verified:** crawlmouse.com (TLS, email routing), Stripe LIVE billing (purchase→Pro proven), magic-link
auth (cross-device), Sentry + PostHog + Inngest observability, the core audit pipeline (real organic audits
completing on real sites), legal compliance (DMCA + DPAs in force), SEO + blog + sitemap submitted to Google.
**There are zero remaining launch blockers.**

**Remaining (optional / operator / future):**
- **Stage 7 (paused):** seed 10 reference benchmark audits; k6 load ramp on an isolated staging target.
- **Indexing:** finish Bing Webmaster; monitor Google Search Console (sitemap submitted; indexing is Google's
  call, days–weeks).
- **Go-to-market:** the actual announcement (Shopify community → HN / Product Hunt / X) and the mascot brief.
- **v1.1 roadmap:** monitoring/delta alerts (the churn fix), the AI-Agent-Readiness score (cheap differentiator),
  data-driven caps/pricing tuning, benchmark percentiles.
- **v1.2:** the developer surface (CLI / GitHub Action / agentic webhooks) on the same engine.
- **Ops watch-items:** `crawlee` is caret-pinned (a minor bump could re-break the `ps` fix — consider exact-pin);
  Inngest still Free (bump concurrency only on Inngest Pro); a dynamic `/r/` report sitemap for better discovery.

---

## 13. Working in this repo

```bash
nvm use 22            # system default is Node 20
pnpm install
pnpm test             # turbo: engine + web + inngest + types
pnpm typecheck && pnpm lint
pnpm smoke -- --url=https://example.com   # engine smoke (direct crawl)
```

- **Every code change → TDD + the 3×Opus adversarial review gate** (a Workflow of independent reviewers across
  correctness / security / deploy-safety / test-quality lenses, fix-loop to ≥9, 0 blocking; mutation-verify
  guards). The controller commits + pushes to `main`.
- **Never** mention AI tools in commits/PRs/code; strip `Co-Authored-By`.
- Ops are done autonomously via MCP / provider Management/REST APIs where possible; only identity-bound steps
  (a real card, legal e-sign, DNS/registrar) go to the operator.

---

## 14. Where to look next

- **Design spec (locked decisions):** `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md`
- **SEO + blog spec:** `docs/superpowers/specs/2026-06-12-seo-and-blog-design.md`
- **Deploy runbook (staged, gated cutover + full progress log):** `docs/deploy/launch-runbook.md`
- **Cost model (≤18% MRR):** `docs/ops/2026-06-03-cost-model.md`
- **Legal research synthesis:** `docs/legal/2026-06-07-legal-research-synthesis.md`
- **Plans 1–3:** `docs/superpowers/plans/`
- **Live ops memory** (Claude auto-memory, persists across sessions): the `project_*` notes — especially
  `project_build_state_v1`, `project_launch_blockers`, and `project_seo_and_blog`.
