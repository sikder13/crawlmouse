# Crawlmouse v1.0 — Plan 4: Billing + Pro Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe-powered Pro subscriptions ($19/mo, $190/yr) with hosted Checkout + Customer Portal, gate Pro features on `users.pro_until`, ship the CSV export and the inline-upgrade-card paywall, and land cost controls #3/#4/#5/#7.

**Architecture:** Hosted Stripe Checkout (redirect) → webhook sets `users.pro_until` (idempotent via `stripe_events`); a daily Inngest cron reconciles drift. A single pure predicate `isProActive(pro_until)` drives every gate (page cap, crawl concurrency, findings truncation, CSV access). Billing actions are plain API routes (matching the existing `audits/start` pattern). New tables: `stripe_events`, `email_events`, plus `audits.expires_at` for the 30-day free TTL.

**Tech Stack:** `stripe` (server SDK + webhook verification), `jszip` (CSV zip), `svix` (Resend webhook verification). Next 15 App Router, Supabase (service-role admin client for webhooks/crons), `@crawlmouse/inngest` workspace package for crons, Vitest for unit tests, Playwright for E2E.

**Design source:** `docs/superpowers/specs/2026-06-01-crawlmouse-v1.0-plan-4-billing-design.md`.

**Prereqs / env:** All `STRIPE_*` vars are set in `apps/web/.env.local`. New env var to add: `RESEND_WEBHOOK_SECRET` (from the Resend dashboard webhook you create in Task C4). Run `nvm use` (Node 22) in every terminal. Run web tests from `apps/web` (`pnpm test`); engine tests from `packages/engine`. Apply migrations from `infra/supabase/` (`supabase db push`) or via the Supabase MCP `apply_migration`.

---

## File Structure (created / modified)

```
apps/web/
├── lib/
│   ├── stripe.ts                                  # NEW: server Stripe client
│   ├── pro.ts                                     # NEW: isProActive() + userIsPro()
│   ├── tier.ts                                    # NEW: tierLimits(isPro) → {pageCap, perHostConcurrency}
│   └── billing/
│       ├── pro-until.ts                           # NEW: proUntilFrom(status, periodEnd) (pure)
│       ├── apply-stripe-event.ts                  # NEW: idempotent event → users update
│       ├── csv.ts                                  # NEW: buildFindingsCsv / buildPagesCsv / buildAuditZip (pure)
│       └── resend-event.ts                        # NEW: parseResendEvent(payload) (pure) + isEmailSuppressed()
├── app/
│   ├── api/
│   │   ├── billing/checkout/route.ts              # NEW: create Checkout session
│   │   ├── billing/portal/route.ts               # NEW: create Customer Portal session
│   │   ├── webhooks/stripe/route.ts              # NEW: verify sig + applyStripeEvent
│   │   ├── webhooks/resend/route.ts             # NEW: verify svix + record email_events
│   │   └── audits/[id]/export/route.ts          # NEW: Pro-gated CSV zip
│   ├── audit/[id]/AuditView.tsx                  # MODIFY: render FindingsPanel + CSV button
│   └── pricing/page.tsx                          # MODIFY: Monthly|Annual toggle + Checkout CTAs
├── components/
│   ├── billing/UpgradeCard.tsx                   # NEW: reusable inline upgrade card
│   ├── billing/PricingCards.tsx                  # NEW: client cards + toggle + checkout
│   └── audit/FindingsPanel.tsx                   # NEW: findings list w/ top-5 gate
├── app/api/audits/start/route.ts                 # MODIFY: gate cap+concurrency on isPro; set expires_at
infra/supabase/migrations/
├── 20260601000001_stripe_events.sql              # NEW
├── 20260601000002_audits_ttl.sql                 # NEW
└── 20260601000003_email_events.sql               # NEW
inngest/                                          # @crawlmouse/inngest package
├── client.ts                                     # MODIFY: add perHostConcurrency to event
├── audit.ts                                      # MODIFY: use event.perHostConcurrency
└── billing.ts                                    # NEW: reconcile + ttl-cleanup crons
apps/web/app/api/webhooks/inngest/route.ts        # MODIFY: register new crons
```

---

# Part A — Billing core (purchase → Pro entitlement)

### Task A1: Dependencies + Stripe client

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/stripe.ts`

- [ ] **Step 1: Add deps**

Run from `apps/web`:
```bash
nvm use && pnpm add stripe jszip svix
```
Expected: `stripe`, `jszip`, `svix` appear under `dependencies`.

- [ ] **Step 2: Create the Stripe client**

`apps/web/lib/stripe.ts`:
```ts
import 'server-only';
import Stripe from 'stripe';

// apiVersion omitted → uses the account default pinned by the SDK.
// If TS requires it, set it to the version in Stripe Dashboard → Developers → API version.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → Expected: PASS
```bash
git add apps/web/package.json apps/web/lib/stripe.ts ../../pnpm-lock.yaml
git commit -m "feat(billing): add stripe/jszip/svix deps and server stripe client"
```

---

### Task A2: `stripe_events` migration

**Files:**
- Create: `infra/supabase/migrations/20260601000001_stripe_events.sql`

- [ ] **Step 1: Write the migration**

`infra/supabase/migrations/20260601000001_stripe_events.sql`:
```sql
-- Idempotency ledger for Stripe webhooks. Primary key on the Stripe event id
-- means a replayed event collides and is skipped. Service-role writes only.
create table stripe_events (
  id text primary key,                 -- Stripe event.id
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table stripe_events enable row level security;
create policy stripe_events_deny_client on stripe_events for all using (false) with check (false);
```

- [ ] **Step 2: Apply**

Run from `infra/supabase`: `supabase db push` (or Supabase MCP `apply_migration`).
Expected: migration applies; `stripe_events` exists.

- [ ] **Step 3: Commit**
```bash
git add infra/supabase/migrations/20260601000001_stripe_events.sql
git commit -m "feat(db): stripe_events idempotency table with deny-all RLS"
```

---

### Task A3: Pro predicate (`isProActive`) — TDD

**Files:**
- Create: `apps/web/lib/pro.ts`
- Test: `apps/web/lib/pro.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/lib/pro.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isProActive } from './pro';

describe('isProActive', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('is true when pro_until is in the future', () => {
    expect(isProActive('2026-07-01T00:00:00Z', now)).toBe(true);
  });
  it('is false when pro_until is in the past', () => {
    expect(isProActive('2026-05-01T00:00:00Z', now)).toBe(false);
  });
  it('is false when pro_until is null/undefined', () => {
    expect(isProActive(null, now)).toBe(false);
    expect(isProActive(undefined, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run from `apps/web`: `pnpm test pro` → Expected: FAIL (`isProActive` not found).

- [ ] **Step 3: Implement**

`apps/web/lib/pro.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export function isProActive(proUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!proUntil) return false;
  return new Date(proUntil).getTime() > now.getTime();
}

export async function userIsPro(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await sb.from('users').select('pro_until').eq('id', userId).maybeSingle();
  return isProActive(data?.pro_until ?? null);
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm test pro` → Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/pro.ts apps/web/lib/pro.test.ts
git commit -m "feat(billing): isProActive predicate + userIsPro helper with tests"
```

---

### Task A4: `proUntilFrom` mapper — TDD

**Files:**
- Create: `apps/web/lib/billing/pro-until.ts`
- Test: `apps/web/lib/billing/pro-until.test.ts`

- [ ] **Step 1: Failing test**

`apps/web/lib/billing/pro-until.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { proUntilFrom } from './pro-until';

const periodEnd = 1782000000; // unix seconds

describe('proUntilFrom', () => {
  it('returns ISO period end for active/trialing/past_due', () => {
    expect(proUntilFrom('active', periodEnd)).toBe(new Date(periodEnd * 1000).toISOString());
    expect(proUntilFrom('trialing', periodEnd)).toBe(new Date(periodEnd * 1000).toISOString());
    expect(proUntilFrom('past_due', periodEnd)).toBe(new Date(periodEnd * 1000).toISOString());
  });
  it('returns null for canceled/unpaid/incomplete or missing period end', () => {
    expect(proUntilFrom('canceled', periodEnd)).toBeNull();
    expect(proUntilFrom('unpaid', periodEnd)).toBeNull();
    expect(proUntilFrom('active', null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm test pro-until`

- [ ] **Step 3: Implement**

`apps/web/lib/billing/pro-until.ts`:
```ts
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/** Map a Stripe subscription status + period-end (unix secs) to a pro_until ISO string (or null). */
export function proUntilFrom(status: string, currentPeriodEndUnix: number | null): string | null {
  if (!ACTIVE.has(status) || !currentPeriodEndUnix) return null;
  return new Date(currentPeriodEndUnix * 1000).toISOString();
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm test pro-until`

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/billing/pro-until.ts apps/web/lib/billing/pro-until.test.ts
git commit -m "feat(billing): subscription-status → pro_until mapper with tests"
```

---

### Task A5: Stripe event handler + webhook route

**Files:**
- Create: `apps/web/lib/billing/apply-stripe-event.ts`
- Create: `apps/web/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Implement the idempotent handler**

`apps/web/lib/billing/apply-stripe-event.ts`:
```ts
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { proUntilFrom } from './pro-until';

/** Idempotently apply a verified Stripe event to the users table. */
export async function applyStripeEvent(sb: SupabaseClient, event: Stripe.Event): Promise<{ handled: boolean }> {
  // Idempotency: inserting the event id fails on replay (PK conflict) → skip.
  const { error: dupe } = await sb.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dupe) return { handled: false };

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    const userId = s.client_reference_id;
    const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
    if (userId && customerId) {
      await sb.from('users').update({ stripe_customer_id: customerId }).eq('id', userId);
    }
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    // current_period_end is top-level on older API versions, on the item in newer ones.
    const periodEnd =
      (sub as unknown as { current_period_end?: number }).current_period_end ??
      sub.items?.data?.[0]?.current_period_end ??
      null;
    const proUntil = proUntilFrom(sub.status, periodEnd);
    await sb.from('users').update({ pro_until: proUntil }).eq('stripe_customer_id', customerId);
  }

  await sb.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
  return { handled: true };
}
```

- [ ] **Step 2: Implement the route (raw body + signature verify)**

`apps/web/app/api/webhooks/stripe/route.ts`:
```ts
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { applyStripeEvent } from '@/lib/billing/apply-stripe-event';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig ?? '', process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
  try {
    await applyStripeEvent(supabaseAdmin(), event);
  } catch (e) {
    // Return 500 so Stripe retries; the idempotency insert means retries are safe.
    return new Response('handler error', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
```

- [ ] **Step 3: Local verification with Stripe CLI**

In one terminal: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (prints `whsec_…` — confirm it matches `STRIPE_WEBHOOK_SECRET`).
In another: `stripe trigger checkout.session.completed`.
Expected: route logs 200; replaying the same event id is a no-op (`handled:false`).

- [ ] **Step 4: Commit**
```bash
git add apps/web/lib/billing/apply-stripe-event.ts apps/web/app/api/webhooks/stripe/route.ts
git commit -m "feat(billing): stripe webhook route + idempotent entitlement handler"
```

---

### Task A6: Checkout + Portal routes

**Files:**
- Create: `apps/web/app/api/billing/checkout/route.ts`
- Create: `apps/web/app/api/billing/portal/route.ts`

- [ ] **Step 1: Checkout route**

`apps/web/app/api/billing/checkout/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';

const schema = z.object({ priceId: z.string() });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const allowed = [process.env.STRIPE_PRICE_ID_PRO_MONTHLY, process.env.STRIPE_PRICE_ID_PRO_YEARLY];
  if (!allowed.includes(parsed.data.priceId)) return NextResponse.json({ error: 'bad_price' }, { status: 400 });

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_BASE_URL!;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: parsed.data.priceId, quantity: 1 }],
    client_reference_id: user.id,
    customer_email: user.email ?? undefined,
    allow_promotion_codes: true,
    success_url: `${origin}/dashboard?upgraded=1`,
    cancel_url: `${origin}/pricing`,
  });
  return NextResponse.json({ url: session.url });
}
```

- [ ] **Step 2: Portal route**

`apps/web/app/api/billing/portal/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data: row } = await sb.from('users').select('stripe_customer_id').eq('id', user.id).maybeSingle();
  if (!row?.stripe_customer_id) return NextResponse.json({ error: 'no_customer' }, { status: 400 });

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_BASE_URL!;
  const portal = await stripe.billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  });
  return NextResponse.json({ url: portal.url });
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → PASS.
```bash
git add apps/web/app/api/billing/checkout/route.ts apps/web/app/api/billing/portal/route.ts
git commit -m "feat(billing): checkout + customer-portal session routes"
```

---

### Task A7: Pricing page — Monthly|Annual toggle + Checkout CTAs

**Files:**
- Create: `apps/web/components/billing/PricingCards.tsx`
- Modify: `apps/web/app/pricing/page.tsx`

- [ ] **Step 1: Client pricing cards with toggle + checkout**

`apps/web/components/billing/PricingCards.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const FREE_FEATURES = [
  '1 audit per domain per 24h',
  'Crawl up to 500 pages',
  'Letter grade + live graph',
  'Counts + top-5 examples of each finding',
  'Peer benchmarks',
  '"Powered by Crawlmouse" embed badge',
];
const PRO_FEATURES = [
  'Everything in Free, plus:',
  'Crawl up to 2,000 pages',
  'Full finding lists + CSV export',
  'No domain rate limit',
  'Private (non-indexed) reports',
  'Remove or customize the embed badge',
];

export function PricingCards({ monthlyPriceId, yearlyPriceId }: { monthlyPriceId: string; yearlyPriceId: string }) {
  const [annual, setAnnual] = useState(true); // annual default
  const [loading, setLoading] = useState(false);

  async function upgrade() {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: annual ? yearlyPriceId : monthlyPriceId }),
      });
      if (res.status === 401) { window.location.href = '/login?next=/pricing'; return; }
      const { url } = await res.json();
      if (url) window.location.href = url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 rounded-full border border-oat p-1 bg-white">
          <button onClick={() => setAnnual(false)} className={`px-4 py-1.5 rounded-full text-sm font-medium ${!annual ? 'bg-ink text-cream' : 'text-ink/70'}`}>Monthly</button>
          <button onClick={() => setAnnual(true)} className={`px-4 py-1.5 rounded-full text-sm font-medium ${annual ? 'bg-ink text-cream' : 'text-ink/70'}`}>
            Annual <span className="text-sage font-semibold">· 2 months free</span>
          </button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <div className="mb-5">
            <div className="font-display font-bold text-2xl">Free</div>
            <div className="mt-1 flex items-baseline gap-2"><span className="font-display font-bold text-5xl">$0</span><span className="text-ink/60">forever</span></div>
          </div>
          <ul className="space-y-2 mb-6">{FREE_FEATURES.map((f) => <li key={f} className="flex gap-2 text-sm"><span className="text-sage font-bold">&#10003;</span><span>{f}</span></li>)}</ul>
          <a href="/"><Button variant="secondary" className="w-full">Start free</Button></a>
        </Card>
        <Card className="border-peach !border-2 relative">
          <div className="absolute -top-3 left-6"><Badge tone="peach">Most popular</Badge></div>
          <div className="mb-5">
            <div className="font-display font-bold text-2xl">Pro</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display font-bold text-5xl">{annual ? '$190' : '$19'}</span>
              <span className="text-ink/60">{annual ? 'per year' : 'per month'}</span>
            </div>
          </div>
          <ul className="space-y-2 mb-6">{PRO_FEATURES.map((f) => <li key={f} className="flex gap-2 text-sm"><span className="text-sage font-bold">&#10003;</span><span>{f}</span></li>)}</ul>
          <Button variant="primary" className="w-full" onClick={upgrade} disabled={loading}>
            {loading ? 'Starting checkout…' : annual ? 'Upgrade — Pro $190/yr' : 'Upgrade — Pro $19/mo'}
          </Button>
        </Card>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Wire price ids from server into the client component**

Replace `apps/web/app/pricing/page.tsx` body with:
```tsx
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PricingCards } from '@/components/billing/PricingCards';

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-20 pb-32">
        <section className="text-center mb-10 max-w-2xl mx-auto">
          <h1 className="font-display font-bold text-5xl tracking-tight">Pricing</h1>
          <p className="mt-4 text-lg text-ink/70">Free is genuinely free. Pay only when you need exports, more pages, or the badge gone.</p>
        </section>
        <PricingCards
          monthlyPriceId={process.env.STRIPE_PRICE_ID_PRO_MONTHLY!}
          yearlyPriceId={process.env.STRIPE_PRICE_ID_PRO_YEARLY!}
        />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Verify in browser**

Run `pnpm dev`, open `/pricing`. Toggle flips $19/mo ↔ $190/yr; logged-out "Upgrade" → `/login?next=/pricing`; logged-in → Stripe Checkout (test mode).

- [ ] **Step 4: Commit**
```bash
git add apps/web/components/billing/PricingCards.tsx apps/web/app/pricing/page.tsx
git commit -m "feat(billing): pricing page annual-default toggle + checkout CTAs"
```

---

# Part B — Pro gating + CSV + findings UI

### Task B1: Gate page cap + crawl concurrency on Pro — TDD

**Files:**
- Create: `apps/web/lib/tier.ts`
- Test: `apps/web/lib/tier.test.ts`
- Modify: `apps/web/app/api/audits/start/route.ts:58-77`
- Modify: `inngest/client.ts:3-19`, `inngest/audit.ts:18-44`

- [ ] **Step 1: Failing test for tier limits**

`apps/web/lib/tier.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { tierLimits } from './tier';

describe('tierLimits', () => {
  it('free = 500 pages, sequential', () => {
    expect(tierLimits(false)).toEqual({ pageCap: 500, perHostConcurrency: 1 });
  });
  it('pro = 2000 pages, concurrent', () => {
    expect(tierLimits(true)).toEqual({ pageCap: 2000, perHostConcurrency: 8 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm test tier`

- [ ] **Step 3: Implement**

`apps/web/lib/tier.ts`:
```ts
/** Cost control #5: free crawls are capped + sequential; Pro is bigger + concurrent. */
export function tierLimits(isPro: boolean): { pageCap: number; perHostConcurrency: number } {
  return isPro ? { pageCap: 2000, perHostConcurrency: 8 } : { pageCap: 500, perHostConcurrency: 1 };
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm test tier`

- [ ] **Step 5: Add `perHostConcurrency` to the event schema**

In `inngest/client.ts`, add to the `'audit.requested'` `data` type (after `pageCap?: number;`):
```ts
      perHostConcurrency?: number;
```

- [ ] **Step 6: Use it in the worker**

In `inngest/audit.ts`, change line 29 `perHostConcurrency: 8,` to:
```ts
          perHostConcurrency: event.data.perHostConcurrency ?? 8,
```

- [ ] **Step 7: Gate the start route on Pro**

In `apps/web/app/api/audits/start/route.ts`, add import near the top:
```ts
import { userIsPro } from '@/lib/pro';
import { tierLimits } from '@/lib/tier';
```
Replace the insert + send block (lines 58-77) with:
```ts
  const proUser = user ? await userIsPro(sbUser, user.id) : false;
  const { pageCap, perHostConcurrency } = tierLimits(proUser);
  const expiresAt = proUser ? null : new Date(Date.now() + 30 * TWENTY_FOUR_HOURS_MS).toISOString();

  const { data: audit, error: insertError } = await sb
    .from('audits')
    .insert({
      user_id: user?.id ?? null,
      anonymous_session_id: user ? null : `anon-${ip}-${Date.now()}`,
      url: parsed.data.url,
      status: 'pending',
      settings: { pageCap },
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertError || !audit) {
    return NextResponse.json({ error: 'Could not create audit' }, { status: 500 });
  }

  await inngest.send({
    name: 'audit.requested',
    data: { auditId: audit.id, url: parsed.data.url, pageCap, perHostConcurrency },
  });

  return NextResponse.json({ auditId: audit.id });
```
(Note: `expires_at` column is added in Task C1; this line is harmless until then because the insert object simply carries an extra key once the column exists. If executing B1 before C1, do Task C1 first — see ordering note at the end.)

- [ ] **Step 8: Run tests + typecheck + commit**

Run from `apps/web`: `pnpm test tier && pnpm typecheck` → PASS.
```bash
git add apps/web/lib/tier.ts apps/web/lib/tier.test.ts apps/web/app/api/audits/start/route.ts ../../inngest/client.ts ../../inngest/audit.ts
git commit -m "feat(billing): gate page cap + crawl concurrency on pro_until (cost control #5)"
```

---

### Task B2: `UpgradeCard` component

**Files:**
- Create: `apps/web/components/billing/UpgradeCard.tsx`

- [ ] **Step 1: Implement**

`apps/web/components/billing/UpgradeCard.tsx`:
```tsx
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

/** Reusable inline paywall card (honest cutoff). Used after top-5 findings, CSV, page-cap, badge. */
export function UpgradeCard({ headline, sub }: { headline: string; sub?: string }) {
  return (
    <div className="rounded-2xl border-[1.5px] border-dashed border-peach bg-peach/5 p-5 text-center">
      <p className="font-display font-semibold text-ink">🐭 {headline}</p>
      {sub && <p className="text-sm text-ink/70 mt-1">{sub}</p>}
      <Link href="/pricing" className="inline-block mt-3">
        <Button variant="primary" size="sm">Unlock Pro · $19 →</Button>
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add apps/web/components/billing/UpgradeCard.tsx
git commit -m "feat(billing): reusable inline UpgradeCard paywall component"
```

---

### Task B3: Findings panel with top-5 gate

**Files:**
- Modify: `apps/web/app/api/audits/[id]/stream/route.ts` (include findings summary + isPro in the `done` payload)
- Create: `apps/web/components/audit/FindingsPanel.tsx`
- Modify: `apps/web/app/audit/[id]/AuditView.tsx`

- [ ] **Step 1: Have the stream return findings + caller's Pro status on completion**

In `apps/web/app/api/audits/[id]/stream/route.ts`, replace the interval body's completed branch so that on completion it loads findings (joined to page url) and the viewer's Pro status. Replace lines 21-30 with:
```ts
      const interval = setInterval(async () => {
        const { data } = await sb.from('audits').select('id, status, grade, score, page_count, link_count, cms_detected, user_id').eq('id', id).maybeSingle();
        if (!data) return;
        send('progress', data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
          if (data.status === 'completed') {
            const { data: findings } = await sb
              .from('findings')
              .select('category, severity, pages(url)')
              .eq('audit_id', id);
            const { data: { user } } = await sb.auth.getUser();
            const viewerIsPro = user && user.id === data.user_id
              ? isProActive((await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle()).data?.pro_until ?? null)
              : false;
            send('done', { ...data, findings: findings ?? [], viewerIsPro });
          } else {
            send('done', data);
          }
          try { controller.close(); } catch {}
        }
      }, 1000);
```
And add the import at the top of the file:
```ts
import { isProActive } from '@/lib/pro';
```

- [ ] **Step 2: FindingsPanel component (top-5 free, full for Pro)**

`apps/web/components/audit/FindingsPanel.tsx`:
```tsx
import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Card } from '@/components/ui/Card';

export interface FindingRow { category: string; severity: string; pages?: { url: string } | null }

const LABELS: Record<string, string> = {
  orphan: 'Orphan pages', near_orphan: 'Near-orphan pages', deep_page: 'Pages too deep',
  unreachable_page: 'Unreachable pages', over_optimized_anchor: 'Over-optimized anchors',
  generic_anchor_overuse: 'Generic anchor overuse', under_linked_important: 'Under-linked key pages',
};
const FREE_LIMIT = 5;

export function FindingsPanel({ findings, isPro }: { findings: FindingRow[]; isPro: boolean }) {
  const byCat = new Map<string, FindingRow[]>();
  for (const f of findings) { const a = byCat.get(f.category) ?? []; a.push(f); byCat.set(f.category, a); }

  return (
    <div className="space-y-4">
      {[...byCat.entries()].map(([cat, rows]) => {
        const shown = isPro ? rows : rows.slice(0, FREE_LIMIT);
        const hidden = rows.length - shown.length;
        return (
          <Card key={cat}>
            <div className="font-display font-bold text-lg mb-3">
              {LABELS[cat] ?? cat} <span className="text-ink/50 font-normal text-sm">· {rows.length} found{!isPro && rows.length > FREE_LIMIT ? `, showing ${FREE_LIMIT}` : ''}</span>
            </div>
            <ul className="space-y-1 font-mono text-sm">
              {shown.map((r, i) => <li key={i} className="text-ink/80 truncate">{r.pages?.url ?? '—'}</li>)}
            </ul>
            {hidden > 0 && (
              <div className="mt-4">
                <UpgradeCard headline={`${hidden} more ${(LABELS[cat] ?? cat).toLowerCase()} are hiding.`} sub="See them all + export CSV" />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Render it in AuditView + add the CSV button**

In `apps/web/app/audit/[id]/AuditView.tsx`:
- Extend the `Snapshot` interface (after `cms_detected?`):
```ts
  user_id?: string | null;
  findings?: { category: string; severity: string; pages?: { url: string } | null }[];
  viewerIsPro?: boolean;
```
- Add imports:
```ts
import { FindingsPanel } from '@/components/audit/FindingsPanel';
import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Button } from '@/components/ui/Button';
```
- After the `{done && <SharePanel auditId={auditId} />}` line, add:
```tsx
      {done && snapshot.findings && (
        <FindingsPanel findings={snapshot.findings} isPro={!!snapshot.viewerIsPro} />
      )}
      {done && (snapshot.viewerIsPro
        ? <a href={`/api/audits/${auditId}/export`}><Button variant="secondary" className="w-full">Download CSV</Button></a>
        : <UpgradeCard headline="Export every finding + page as CSV." sub="Sortable spreadsheet of your whole site." />
      )}
```

- [ ] **Step 4: Verify in browser** (`pnpm dev`): run an audit; completed report shows findings grouped by category, top-5 + UpgradeCard for free, full list + Download CSV for Pro.

- [ ] **Step 5: Commit**
```bash
git add apps/web/app/api/audits/[id]/stream/route.ts apps/web/components/audit/FindingsPanel.tsx apps/web/app/audit/[id]/AuditView.tsx
git commit -m "feat(billing): findings panel with top-5 free gate + CSV button"
```

---

### Task B4: CSV export — pure builders (TDD) + route

**Files:**
- Create: `apps/web/lib/billing/csv.ts`
- Test: `apps/web/lib/billing/csv.test.ts`
- Create: `apps/web/app/api/audits/[id]/export/route.ts`

- [ ] **Step 1: Failing test for CSV builders**

`apps/web/lib/billing/csv.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildFindingsCsv, buildPagesCsv, csvCell } from './csv';

describe('csvCell', () => {
  it('quotes and escapes commas, quotes, newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });
});

describe('buildFindingsCsv', () => {
  it('has a header row and one row per finding', () => {
    const csv = buildFindingsCsv([
      { category: 'orphan', severity: 'critical', pageUrl: 'https://x.com/a', detail: 'no inbound links' },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('category,severity,page_url,detail');
    expect(lines[1]).toBe('orphan,critical,https://x.com/a,no inbound links');
  });
});

describe('buildPagesCsv', () => {
  it('emits page metrics', () => {
    const csv = buildPagesCsv([
      { url: 'https://x.com/a', title: 'A', status_code: 200, depth: 1, in_degree: 0, out_degree: 3, is_orphan: true },
    ]);
    expect(csv.split('\n')[0]).toBe('url,title,status_code,depth,in_degree,out_degree,is_orphan');
    expect(csv.split('\n')[1]).toBe('https://x.com/a,A,200,1,0,3,true');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm test csv`

- [ ] **Step 3: Implement the builders**

`apps/web/lib/billing/csv.ts`:
```ts
import JSZip from 'jszip';

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: unknown[]) => cells.map(csvCell).join(',');

export interface FindingExport { category: string; severity: string; pageUrl: string | null; detail: string }
export interface PageExport { url: string; title: string | null; status_code: number; depth: number | null; in_degree: number; out_degree: number; is_orphan: boolean }

export function buildFindingsCsv(findings: FindingExport[]): string {
  return [row(['category', 'severity', 'page_url', 'detail']), ...findings.map((f) => row([f.category, f.severity, f.pageUrl, f.detail]))].join('\n') + '\n';
}
export function buildPagesCsv(pages: PageExport[]): string {
  return [
    row(['url', 'title', 'status_code', 'depth', 'in_degree', 'out_degree', 'is_orphan']),
    ...pages.map((p) => row([p.url, p.title, p.status_code, p.depth, p.in_degree, p.out_degree, p.is_orphan])),
  ].join('\n') + '\n';
}
export async function buildAuditZip(findings: FindingExport[], pages: PageExport[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('findings.csv', buildFindingsCsv(findings));
  zip.file('pages.csv', buildPagesCsv(pages));
  return zip.generateAsync({ type: 'nodebuffer' });
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm test csv`

- [ ] **Step 5: Export route (owner + Pro gated)**

`apps/web/app/api/audits/[id]/export/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isProActive } from '@/lib/pro';
import { buildAuditZip, type FindingExport, type PageExport } from '@/lib/billing/csv';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle();
  if (!isProActive(me?.pro_until ?? null)) return NextResponse.json({ error: 'pro_required' }, { status: 402 });

  const admin = supabaseAdmin();
  const { data: audit } = await admin.from('audits').select('id, user_id').eq('id', id).maybeSingle();
  if (!audit) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (audit.user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data: pages } = await admin.from('pages').select('id, url, title, status_code, depth, in_degree, out_degree, is_orphan').eq('audit_id', id);
  const { data: findings } = await admin.from('findings').select('category, severity, page_id, payload').eq('audit_id', id);
  const pageUrlById = new Map((pages ?? []).map((p) => [p.id, p.url]));

  const findingExports: FindingExport[] = (findings ?? []).map((f) => ({
    category: f.category, severity: f.severity,
    pageUrl: f.page_id ? pageUrlById.get(f.page_id) ?? null : null,
    detail: typeof f.payload === 'object' && f.payload ? JSON.stringify(f.payload) : '',
  }));
  const pageExports: PageExport[] = (pages ?? []).map((p) => ({
    url: p.url, title: p.title, status_code: p.status_code, depth: p.depth, in_degree: p.in_degree, out_degree: p.out_degree, is_orphan: p.is_orphan,
  }));

  const zip = await buildAuditZip(findingExports, pageExports);
  return new Response(new Uint8Array(zip), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="crawlmouse-audit-${id}.zip"` },
  });
}
```

- [ ] **Step 6: Manual gating check** — as a free user, `GET /api/audits/<id>/export` → 402; as Pro owner → zip downloads with `findings.csv` + `pages.csv`.

- [ ] **Step 7: Commit**
```bash
git add apps/web/lib/billing/csv.ts apps/web/lib/billing/csv.test.ts apps/web/app/api/audits/[id]/export/route.ts
git commit -m "feat(billing): Pro-gated CSV (findings+pages) zip export with tests"
```

---

# Part C — Cost controls + reconciliation

### Task C1: `audits.expires_at` TTL column + list filter

**Files:**
- Create: `infra/supabase/migrations/20260601000002_audits_ttl.sql`
- Modify: `apps/web/lib/trpc/router.ts:13-21` (filter expired from `listMine`)

- [ ] **Step 1: Migration**

`infra/supabase/migrations/20260601000002_audits_ttl.sql`:
```sql
-- Cost control #3: free-tier audits expire after 30 days; Pro audits keep null (no expiry).
alter table audits add column expires_at timestamptz;
create index on audits (expires_at) where expires_at is not null;
```

- [ ] **Step 2: Apply** (from `infra/supabase`): `supabase db push`.

- [ ] **Step 3: Filter expired from the user's list**

In `apps/web/lib/trpc/router.ts`, in `listMine`, add `.or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())` before `.order(...)`:
```ts
      const { data, error } = await ctx.sb
        .from('audits')
        .select('id, url, grade, score, status, started_at, completed_at')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('started_at', { ascending: false })
        .limit(50);
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck` → PASS.
```bash
git add infra/supabase/migrations/20260601000002_audits_ttl.sql apps/web/lib/trpc/router.ts
git commit -m "feat(db): audits.expires_at TTL column + filter expired from listMine (cost control #3)"
```

---

### Task C2: Reconciliation + TTL-cleanup crons (Inngest)

**Files:**
- Create: `inngest/billing.ts`
- Modify: `apps/web/app/api/webhooks/inngest/route.ts`

- [ ] **Step 1: Cron functions**

`inngest/billing.ts`:
```ts
import { inngest } from './client';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
function stripeClient() { return new Stripe(process.env.STRIPE_SECRET_KEY!); }

// Daily Stripe reconciliation — repairs pro_until drift from any missed webhooks.
export const reconcileBillingFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile' },
  { cron: '0 3 * * *' },
  async ({ step }) => {
    const sb = admin();
    const stripe = stripeClient();
    const { data: customers } = await sb.from('users').select('id, stripe_customer_id').not('stripe_customer_id', 'is', null);
    let repaired = 0;
    for (const u of customers ?? []) {
      const subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id!, status: 'all', limit: 1 });
      const sub = subs.data[0];
      const active = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
      const periodEnd = active
        ? ((sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null)
        : null;
      const proUntil = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
      const { data: row } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
      if ((row?.pro_until ?? null) !== proUntil) {
        await sb.from('users').update({ pro_until: proUntil }).eq('id', u.id);
        repaired++;
      }
    }
    return { checked: customers?.length ?? 0, repaired };
  },
);

// Daily TTL cleanup — delete expired free audits (cascades to pages/links/findings).
export const cleanupExpiredAuditsFn = inngest.createFunction(
  { id: 'crawlmouse.audits-ttl-cleanup' },
  { cron: '0 4 * * *' },
  async () => {
    const sb = admin();
    const { data } = await sb.from('audits').delete().lt('expires_at', new Date().toISOString()).select('id');
    return { deleted: data?.length ?? 0 };
  },
);
```

- [ ] **Step 2: Register both crons in the serve handler**

`apps/web/app/api/webhooks/inngest/route.ts`:
```ts
import { serve } from 'inngest/next';
import { inngest as workerInngest } from '@crawlmouse/inngest';
import { auditFn } from '@crawlmouse/inngest/audit';
import { reconcileBillingFn, cleanupExpiredAuditsFn } from '@crawlmouse/inngest/billing';

export const { GET, POST, PUT } = serve({
  client: workerInngest,
  functions: [auditFn, reconcileBillingFn, cleanupExpiredAuditsFn],
});
```
(If `@crawlmouse/inngest/billing` does not resolve, add a `"./billing"` entry to the `exports` map in `inngest/package.json` mirroring the existing `"./audit"` entry.)

- [ ] **Step 3: Verify with the Inngest dev server**

Run `npx inngest-cli@latest dev` + `pnpm dev`; in the Inngest dev UI both `crawlmouse.stripe-reconcile` and `crawlmouse.audits-ttl-cleanup` appear and can be invoked manually (returns `{checked, repaired}` / `{deleted}`).

- [ ] **Step 4: Commit**
```bash
git add inngest/billing.ts apps/web/app/api/webhooks/inngest/route.ts inngest/package.json
git commit -m "feat(billing): daily Stripe reconciliation + free-audit TTL cleanup crons"
```

---

### Task C3: `email_events` + Resend webhook (cost control #7)

**Files:**
- Create: `infra/supabase/migrations/20260601000003_email_events.sql`
- Create: `apps/web/lib/billing/resend-event.ts`
- Test: `apps/web/lib/billing/resend-event.test.ts`
- Create: `apps/web/app/api/webhooks/resend/route.ts`
- Modify: `apps/web/.env.local.example` (document `RESEND_WEBHOOK_SECRET`)

- [ ] **Step 1: Migration**

`infra/supabase/migrations/20260601000003_email_events.sql`:
```sql
-- Cost control #7: track Resend deliveries/bounces/complaints; suppress sends to hard-bounced addresses.
create table email_events (
  id uuid primary key default gen_random_uuid(),
  resend_event_id text unique,
  email_address text not null,
  event_type text not null,            -- sent | delivered | bounced | complained | delivery_delayed
  bounce_type text,                    -- 'permanent' | 'transient' | null
  payload jsonb,
  created_at timestamptz not null default now()
);
create index on email_events (email_address, bounce_type) where bounce_type = 'permanent';

alter table email_events enable row level security;
create policy email_events_deny_client on email_events for all using (false) with check (false);
```
Apply from `infra/supabase`: `supabase db push`.

- [ ] **Step 2: Failing test for the pure parser**

`apps/web/lib/billing/resend-event.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseResendEvent } from './resend-event';

describe('parseResendEvent', () => {
  it('maps a hard bounce', () => {
    const e = parseResendEvent({ type: 'email.bounced', data: { email: 'x@y.com', bounce: { type: 'Permanent' } } });
    expect(e).toEqual({ eventType: 'bounced', email: 'x@y.com', bounceType: 'permanent' });
  });
  it('maps a delivery with no bounce', () => {
    const e = parseResendEvent({ type: 'email.delivered', data: { email: 'a@b.com' } });
    expect(e).toEqual({ eventType: 'delivered', email: 'a@b.com', bounceType: null });
  });
});
```
Run — expect FAIL: `pnpm test resend-event`.

- [ ] **Step 3: Implement parser + suppression helper**

`apps/web/lib/billing/resend-event.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ParsedResendEvent { eventType: string; email: string; bounceType: 'permanent' | 'transient' | null }

export function parseResendEvent(payload: any): ParsedResendEvent {
  const eventType = String(payload?.type ?? '').replace(/^email\./, '');
  const email = String(payload?.data?.email ?? payload?.data?.to ?? '');
  const rawBounce = payload?.data?.bounce?.type;
  const bounceType = rawBounce ? (String(rawBounce).toLowerCase() === 'permanent' ? 'permanent' : 'transient') : null;
  return { eventType, email, bounceType };
}

/** Future transactional sends (v1.1) call this before sending. */
export async function isEmailSuppressed(sb: SupabaseClient, email: string): Promise<boolean> {
  const { data } = await sb.from('email_events').select('id').eq('email_address', email).eq('bounce_type', 'permanent').limit(1);
  return (data?.length ?? 0) > 0;
}
```
Run — expect PASS: `pnpm test resend-event`.

- [ ] **Step 4: Resend webhook route (svix-verified)**

`apps/web/app/api/webhooks/resend/route.ts`:
```ts
import { Webhook } from 'svix';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseResendEvent } from '@/lib/billing/resend-event';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const raw = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };
  let payload: any;
  try {
    payload = new Webhook(process.env.RESEND_WEBHOOK_SECRET!).verify(raw, headers);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
  const e = parseResendEvent(payload);
  await supabaseAdmin().from('email_events').upsert(
    { resend_event_id: headers['svix-id'], email_address: e.email, event_type: e.eventType, bounce_type: e.bounceType, payload },
    { onConflict: 'resend_event_id', ignoreDuplicates: true },
  );
  return new Response('ok');
}
```

- [ ] **Step 5: Document the env var**

Add to `apps/web/.env.local.example`:
```
# Resend webhook signing secret (Resend dashboard → Webhooks → your endpoint)
RESEND_WEBHOOK_SECRET=
```
Then create the webhook in the Resend dashboard → `https://crawlmouse.com/api/webhooks/resend`, copy its secret into `apps/web/.env.local`.

- [ ] **Step 6: Commit**
```bash
git add infra/supabase/migrations/20260601000003_email_events.sql apps/web/lib/billing/resend-event.ts apps/web/lib/billing/resend-event.test.ts apps/web/app/api/webhooks/resend/route.ts apps/web/.env.local.example
git commit -m "feat(email): email_events table + Resend webhook + suppression helper (cost control #7)"
```

---

### Task D1: End-to-end purchase flow test (Playwright)

**Files:**
- Create: `apps/web/tests/e2e/billing.spec.ts`

- [ ] **Step 1: Write the E2E (per spec §1058)**

`apps/web/tests/e2e/billing.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

// Requires: dev server running, a logged-in test user, and `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
test('pricing toggle switches price and Pro CTA starts checkout', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText('$190')).toBeVisible();          // annual default
  await page.getByRole('button', { name: 'Monthly' }).click();
  await expect(page.getByText('$19')).toBeVisible();
  await expect(page.getByRole('button', { name: /Upgrade — Pro/ })).toBeVisible();
});
```

- [ ] **Step 2: Run** `pnpm test:e2e billing` → Expected: PASS.

- [ ] **Step 3: Manual full-loop verification (documented, not automated):**
  1. Logged-in user → `/pricing` → Upgrade → Stripe test Checkout → pay with `4242 4242 4242 4242`.
  2. `stripe listen` forwards `checkout.session.completed` + `customer.subscription.created` → `users.pro_until` set, `stripe_customer_id` populated.
  3. Re-open a completed audit → full finding lists + working "Download CSV" (zip with `findings.csv` + `pages.csv`).
  4. `/api/billing/portal` → Customer Portal → cancel → `customer.subscription.deleted` → `pro_until` cleared → report reverts to top-5 + UpgradeCard.

- [ ] **Step 4: Commit**
```bash
git add apps/web/tests/e2e/billing.spec.ts
git commit -m "test(billing): pricing/checkout E2E + documented full-loop verification"
```

---

## Execution ordering note

Because Task B1 Step 7 writes `expires_at` on insert, **run Task C1 (the migration) before B1 Step 7 reaches production**, or do Part C1 first. Suggested order: A1→A2→A3→A4→A5→A6→A7, then **C1**, then B1→B2→B3→B4, then C2→C3→D1.

## Self-review (against the design spec)

- **§4.1 Hosted Checkout + Portal** → A5/A6 ✔  · **§4.2 prices + annual toggle** → A7 ✔  · **§4.3 no trial** → nothing built (correct) ✔  · **§4.4 inline upgrade card** → B2, reused B3/B3 ✔  · **§4.5 CSV findings+pages zip** → B4 ✔
- **§5 data model:** stripe_events → A2 ✔; audits.expires_at → C1 ✔; email_events → C3 ✔
- **§6 flows:** checkout→entitlement A5/A6; lifecycle A5; reconciliation C2; CSV B4; gating via isProActive B1/B3/B4 ✔
- **§7 cost controls:** #3 C1+C2 ✔; #4 (no free per-audit email; suppression path) C3 ✔; #5 B1 ✔; #7 C3 ✔
- **§8 behavior change** (page cap gates on Pro) → B1 ✔
- **§9 security:** webhook signature A5, deny-all RLS A2/C3, 402 gate B4 ✔
- **§10 testing:** isProActive A3, proUntilFrom A4, tierLimits B1, csv B4, resend parser C3, E2E D1 ✔
- **Placeholder scan:** none. **Type consistency:** `isProActive`, `tierLimits`, `proUntilFrom`, `applyStripeEvent`, `buildAuditZip`, `parseResendEvent` names used consistently across tasks ✔.
```
