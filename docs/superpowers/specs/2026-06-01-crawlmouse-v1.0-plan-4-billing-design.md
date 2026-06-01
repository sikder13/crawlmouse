# Crawlmouse v1.0 — Plan 4: Billing + Pro Features — Design

**Status:** Approved design, 2026-06-01. Refines the billing decisions left open in the v1.0 design spec.
**Parent spec:** `2026-05-24-crawlmouse-v1.0-design.md` (§1.6 Pro tier, §2.10 payments, §4.1 stripe_events, §5.1 billing router, §14.6 webhook security, §18.3 E2E).
**Produced by:** brainstorming session (2026-06-01). The implementation plan derived from this lives at `docs/superpowers/plans/2026-06-01-crawlmouse-v1.0-plan-4-billing.md`.

---

## 1. Context

Plans 1–3 shipped the engine, web app + auth, and the viral sharing surface. Billing is entirely green-field: the `users` table already has `pro_until` + `stripe_customer_id`, the five Stripe env vars + test prices are set, and Inngest is fully wired (client, audit function, `/api/webhooks/inngest` serve handler) — but no Stripe code, webhook, Pro-gating, CSV export, or reconciliation exists. This plan adds the billing system, draws the Free/Pro line, and lands four cost controls required by the ≤18%-of-MRR ops ceiling.

## 2. Guiding principle — virality over conversion (for v1.0)

For a viral consumer product the priority stack is **reach → signups → convert a slice**. The free tier *is* the product for ~95% of users and is the entire distribution engine (grade-as-share-asset, the link graph, the "Powered by Crawlmouse" badge that spreads on users' own sites). Billing decisions are therefore optimized to protect virality first and monetize the *need-driven* slice (people who must export, crawl at scale, go white-label) second. This is why v1.0 ships **no free trial** (see §4.3).

## 3. The Free / Pro line

| Free — the viral engine | Pro ($19/mo · $190/yr) — scale & power |
|---|---|
| Full letter grade + score + peer percentile (screenshot-ready) | Full finding lists (free shows **top-5** of each) |
| Live Sigma.js link graph | **CSV export** (Findings + Pages, zip) |
| Top-5 examples of every finding | **2,000-page** crawls (free = 500) |
| Peer benchmarks | **Private** (non-indexed) reports |
| Public shareable report + social card | **Remove / customize** the embed badge |
| "Powered by Crawlmouse" badge (spreads the brand) | No domain rate limit |

The free tier is complete and delightful for the majority (most sites fit in 500 pages); its only "incompleteness" (top-5 vs full list) is the honest tease that drives the want.

## 4. Decisions

### 4.1 Hosted Checkout + Customer Portal
Stripe **hosted Checkout** for purchase; **Customer Portal** for cancel/update (`/billing` redirects to it). Minimal PCI scope, fastest to ship, auto-handles cards/SCA/tax/mobile, free subscription-management UI. tRPC `billing.createCheckoutSession({ priceId }) → { url }` and `createPortalSession() → { url }`.

### 4.2 Prices + pricing page
Pro **$19/mo** and **$190/yr** (2 months free). The pricing page gains a **Monthly | Annual toggle defaulting to Annual** (higher LTV + cash flow; monthly one tap away) and real Checkout CTAs. Logged-out users sign in (magic link) before Checkout so entitlement attaches to a known `users` row.

### 4.3 No free trial in v1.0
Pro is need-driven on top of a strong free tier, so a trial is a weak fit and its **downgrade moment** risks souring the viral share experience. "Free forever" is the more shareable, more trustworthy promise. A **reverse trial** (every new signup gets Pro for N days) is the architecturally-cheap future lever — it is literally `pro_until = signup + Nd`, since all gating already keys off `pro_until > now()` — but it ships as a **post-launch PostHog-flagged experiment**, not in v1.0. Decision is low-regret: easy to add later, impossible to un-sour a launch.

### 4.4 Contextual paywall = inline upgrade card
A single reusable `<UpgradeCard>` (honest cutoff after the top-5, cheeky mascot copy naming exactly what's hidden — e.g. "🐭 42 more orphans are hiding"). Reused at every Pro wall: findings lists, the Download-CSV action, the page-cap wall, badge removal. No blur/dark-pattern tease.

### 4.5 CSV export = Findings + Pages (zip)
- `findings.csv`: category, severity, affected page URL, detail/anchor text, recommended action.
- `pages.csv`: url, title, status_code, depth, in_degree, out_degree, is_orphan.

A meaty, sortable deliverable that *feels* like $19 of value without the overwhelming edge-list dump (that belongs to the v1.2 developer surface). CSV-only in v1.0; Excel deferred.

## 5. Data model changes (`infra/supabase/migrations/`)

- **`stripe_events`** — `id text primary key` (Stripe event id), `type text not null`, `processed_at timestamptz default now()`. Idempotency for the webhook. RLS deny-all to clients; service-role writes only.
- **`audits.expires_at timestamptz`** — TTL marker (cost control #3). `started_at + 30d` for free audits, `null` for Pro.
- **`email_events`** — id, user_id, email_address, event_type (sent/delivered/bounced/complained), resend ids, bounce_type, payload, created_at. RLS self-read; service-role writes. (Cost control #7.)

## 6. Flows

1. **Checkout → entitlement:** pricing CTA → `createCheckoutSession` → hosted Checkout → `checkout.session.completed` + `customer.subscription.created` webhook → set `users.stripe_customer_id` + `pro_until` (= current period end). Deduped via `stripe_events.id`.
2. **Lifecycle:** `customer.subscription.updated/deleted` → extend/clear `pro_until`. Portal cancel flows through `deleted`.
3. **Daily reconciliation** (`inngest/billing-reconciliation.ts`, cron `0 3 * * *`): compare local `pro_until` against Stripe's subscription list; repair any drift from missed webhooks. Idempotent.
4. **CSV export:** `GET /api/audits/[id]/export` → assert Pro (`isPro`) → stream zip; free users get the upgrade path.
5. **Paywall gating:** a single server helper `isPro(userId)` (reads `pro_until`) drives: page cap (500/2000), crawl concurrency, findings truncation (top-5), CSV access, badge removal, private reports, and domain rate-limit bypass (Pro skips the 1-audit-per-domain-per-hour limit).

## 7. Cost controls

- **#3 — 30-day TTL on free audits:** set `expires_at` at creation; daily Inngest cleanup deletes expired free audits (cascade); list queries filter expired.
- **#4 — Email digest (minimal in v1.0):** no per-audit emails to free users (audits are watched live); the bounce-aware send discipline is established now; full digest lands with v1.1 re-crawls.
- **#5 — Concurrency gating:** free `perHostConcurrency = 1` (sequential), Pro `= 8` (concurrent), set in `inngest/audit.ts` from the Pro flag threaded through the `audit.requested` event.
- **#7 — `email_events` + bounce handling:** Resend webhook (`/api/webhooks/resend`) records events; sends are suppressed to permanently-bounced addresses.

## 8. Behavior change to flag

The audit-start route currently grants 2,000 pages to *any logged-in user* (gates on auth presence). This plan re-gates the page cap **and** crawl concurrency on `pro_until > now()`, so logged-in **free** users correctly drop to 500 pages / sequential crawl — matching the pricing page.

## 9. Security

Stripe webhook verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET` (SDK one-liner) and dedupes on `stripe_events.id`. New tables are RLS-locked (service-role writes). Pro checks live in route handlers / tRPC (`proProcedure`), not global middleware; `middleware.ts` stays minimal. Stripe events retained indefinitely (idempotency).

## 10. Testing

- **Engine (Vitest):** free=sequential vs Pro=concurrent concurrency test.
- **API (Vitest):** webhook signature + idempotency (replayed id = no-op); export route gating (free blocked, Pro zip); resend webhook bounce flagging.
- **E2E (Playwright, spec §1058):** pricing toggle → test-mode Checkout → `stripe trigger`/`listen` webhook → `pro_until` set → report shows full lists + CSV download.
- **Manual:** Stripe CLI replay; Portal cancel → `pro_until` cleared; reconciliation cron via Inngest dev server.

## 11. Out of scope / deferred

Reverse trial (post-launch experiment), Excel export, AI link suggestions (v1.1), scheduled re-crawl + email diff (v1.1), Agency tier (v1.1).
