# Crawlmouse v1.0 — Plan 5: Launch Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Crawlmouse v1.0 from "hardened + billing-verified" to publicly launchable — close every launch-readiness gap that can be built and verified in the codebase, each brought to ≥9/10 on all four quality lenses, and produce an ordered deploy runbook for the manual production steps.

**Architecture:** Monorepo — `apps/web` (Next.js 15 App Router, React 19), `inngest/` (worker fns + own vitest), `packages/engine`, `packages/types`. Supabase (`ezspnfeyzwsisymytssm`) for DB/auth/RLS; Stripe billing; Inngest crons; Resend email; Cloudflare Turnstile/DNS; PostHog + Sentry observability; Vercel hosting. Work proceeds phase-by-phase; each phase passes the §4 per-phase gate before commit.

**Tech Stack:** TypeScript, Next.js ^15, React 19, `@supabase/ssr`, Stripe ^22, Inngest ^3.27, `posthog-js` ^1.376, `@sentry/nextjs` ^10.53, Zod ^4, Vitest ^2, Playwright ^1.60, k6 (load test), `@marsidev/react-turnstile` (added in Phase 1).

---

## Working agreements (read once, apply to every task)

- **Node:** run `nvm use` (Node 22) before any `pnpm` command.
- **Commands** (run from repo root unless noted):
  - apps/web typecheck: `pnpm --filter @crawlmouse/web exec tsc --noEmit`
  - apps/web lint: `pnpm --filter @crawlmouse/web exec next lint`
  - apps/web unit tests: `pnpm --filter @crawlmouse/web exec vitest run [path]`
  - inngest unit tests: `pnpm --filter @crawlmouse/inngest exec vitest run [path]` (the `inngest/` package has its **own** `vitest.config.ts`)
  - engine tests (when touched): `pnpm --filter @crawlmouse/engine exec vitest run`
  - e2e (Playwright): `pnpm --filter @crawlmouse/web exec playwright test`
- **Imports in unit-tested `apps/web/lib/*` files:** use **relative** imports (`./x`), not the `@/` alias — Vitest does not resolve `@/` in those files. Route/component files keep `@/`.
- **Migrations:** apply via the Supabase MCP `apply_migration` tool (project `ezspnfeyzwsisymytssm`), **not** `supabase db push`. Also commit the `.sql` file under `infra/supabase/migrations/`.
- **Commits:** Conventional-commit prefixes (`feat(web)`, `fix(web)`, `harden(db)`, `docs`, `test`, `chore`). **Never** mention AI/Claude/Cursor in messages, code comments, or any artifact. **Strip** the `Co-Authored-By` trailer. The controller commits per logical group and pushes (subagents cannot push `main`).
- **Per-phase quality gate (§4 of the design spec — non-negotiable):** before any phase is committed/pushed: (1) TDD — tests precede implementation; (2) green gates — tsc 0, `next lint` clean, all touched suites green; (3) three adversarial Opus-4.8 reviewers (read-only, parallel) score four lenses — **correctness+edge**, **security**, **performance+naming+maintainability**, **test-quality** — each returning numbered findings + a 0–10 sub-score; (4) controller verifies each finding against real code, fixes confirmed issues TDD-style; (5) re-review until **every lens ≥ 9/10**; (6) commit + push. Significant design choices are backed by fresh web research with cited sources. All subagents (implementers + reviewers) run on **Opus 4.8**. UI follows the distinctive/playful brand bar.
- **Brand tokens** (Tailwind, already configured): `cream` bg, `ink` text, `peach`/`sage`/`oat` accents, `font-display` (Fraunces), `font-mono`. Reuse `components/ui/*` (`Card`, `Button`, `Input`, `Badge`) and `components/layout/{Header,Footer}`.

---

## Phase P — Prerequisites — ✅ COMPLETE

- [x] **Vercel / PostHog / Sentry MCPs authenticated and verified** with one read call each:
  - Vercel — team `Nahl Technologies' projects` (`team_7JoIUGWqgJwobBinsyt2qRKH`), project **crawlmouse-001** (`prj_ZOVjZgG2kU6BzcXyAFutzNpQQXx5`).
  - Sentry — org `nahl-technologies-inc`, project **crawlmouse**.
  - PostHog — org `Nahl Technologies Inc`, project **Crawlmouse** (`448922`, US region).
  - Stripe MCP (test mode), Supabase (`ezspnfeyzwsisymytssm`), GitHub, Cloudflare, context7 — connected.

No further action; Phase 0 may begin.

---

## Phase 0 — Correctness & safety fixes [code] — ✅ COMPLETE

> Done 2026-06-03 (origin/main `0d3a032`; 4 commits `ab0e8ae..0d3a032`). Workflow `plan5-phase0`: 3 implementers (TDD) → 3 adversarial Opus reviewers × 4 lenses, fix-loop converged R1 7/8/8/8 → **R3 9/9/9/9**. Gates (controller-verified): inngest 37/37, web 120/120, tsc 0, lint clean. Notable adds beyond the literal plan: (a) the stream emits a **named `error` event, not `done`** — added an error listener (a failed audit would otherwise hang on the skeleton) and extracted the wiring into a pure, tested `lib/audit-stream-wiring.ts` shared by `AuditView` + `useAuditStream`; (b) `deriveAuditViewState` gained a `hasResults` arg (prevents a *permanent* 0/0 card if `buildDone` throws server-side); (c) takedown writes `status:'removed'` (not the plan's invalid `'approved'`), no `processed_at`, scoped to undecided rows, purges the OG-image route segment too; (d) `inngest/client.ts` typed event `billing.reconcile.requested`; (e) admin route gained a per-IP throttle + tests.

Do first so later verification is clean. Touches: `inngest/billing.ts`, `inngest/billing-helpers.ts`, `apps/web/app/api/webhooks/inngest/route.ts`, `apps/web/app/audit/[id]/AuditView.tsx`, the public-report read path, takedown processing.

### Task 0A.1: Reconcile cron — `runReconcile` helper (mode + livemode guard + dry-run)

**Why:** The daily `crawlmouse.stripe-reconcile` cron rewrites `pro_until` for every customer. Under a wrong-mode Stripe key it must never null real subscribers. Make the default scheduled run a **dry-run** (logs intended writes, writes nothing), require explicit invocation for a `full` run, support `single-customer`, and **refuse** a livemode mismatch.

**Files:**
- Modify: `inngest/billing-helpers.ts` (add `runReconcile`, `keyLivemode`, `LivemodeMismatchError`)
- Test: `inngest/billing-helpers.test.ts` (rename target — currently the tests live in `inngest/billing.test.ts`; **add** the new cases there to keep one helper test file)

- [ ] **Step 1: Write the failing tests** — append to `inngest/billing.test.ts`:

```ts
import { runReconcile, LivemodeMismatchError } from './billing-helpers';

describe('runReconcile', () => {
  const customers = [cust('u1', 'cus_1')];

  it('dry-run computes intended repairs but writes NOTHING', async () => {
    const sb = makeSb({ u1: null }); // would be repaired to iso(5000)
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    const res = await runReconcile(sb, stripe, customers, { mode: 'dry-run', keyLivemode: false });
    expect(res).toMatchObject({ mode: 'dry-run', checked: 1, wouldRepair: 1, repaired: 0 });
    expect(sb.updates).toEqual([]); // <-- the safety guarantee
  });

  it('full mode writes the repairs', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    const res = await runReconcile(sb, stripe, customers, { mode: 'full', keyLivemode: false });
    expect(res).toMatchObject({ mode: 'full', checked: 1, repaired: 1 });
    expect(sb.updates).toEqual([{ id: 'u1', pro_until: iso(5_000) }]);
  });

  it('single-customer mode only touches the named customer', async () => {
    const sb = makeSb({ u1: null, u2: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)], cus_2: [sub('active', 6_000)] });
    const res = await runReconcile(
      sb, stripe, [cust('u1', 'cus_1'), cust('u2', 'cus_2')],
      { mode: 'single-customer', customerId: 'cus_1', keyLivemode: false },
    );
    expect(res.repaired).toBe(1);
    expect(sb.updates).toEqual([{ id: 'u1', pro_until: iso(5_000) }]); // u2 untouched
  });

  it('refuses to run when the expected livemode does not match the active key', async () => {
    const sb = makeSb({ u1: null });
    const stripe = makeStripe({ cus_1: [sub('active', 5_000)] });
    await expect(
      runReconcile(sb, stripe, customers, { mode: 'full', keyLivemode: false, expectLivemode: true }),
    ).rejects.toBeInstanceOf(LivemodeMismatchError);
    expect(sb.updates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/inngest exec vitest run billing.test.ts`
Expected: FAIL — `runReconcile`/`LivemodeMismatchError` not exported.

- [ ] **Step 3: Implement** — append to `inngest/billing-helpers.ts`:

```ts
export class LivemodeMismatchError extends Error {
  constructor(expect: boolean, actual: boolean) {
    super(`reconcile refused: expected Stripe livemode=${expect} but active key livemode=${actual}`);
    this.name = 'LivemodeMismatchError';
  }
}

/** Derive livemode from the active secret key prefix (`sk_live_` → true). */
export function keyLivemode(secretKey: string | undefined): boolean {
  return !!secretKey && secretKey.startsWith('sk_live_');
}

export type ReconcileMode = 'dry-run' | 'single-customer' | 'full';

export interface RunReconcileOpts {
  mode: ReconcileMode;
  keyLivemode: boolean;
  /** When set and != keyLivemode, the run is refused (deploy-time guard). */
  expectLivemode?: boolean;
  /** Required for single-customer mode: only this Stripe customer id is reconciled. */
  customerId?: string;
}

export interface ReconcileSummary {
  mode: ReconcileMode;
  checked: number;
  wouldRepair: number; // intended writes (all modes)
  repaired: number;    // actual writes (0 for dry-run)
}

/**
 * Reconcile customers against Stripe with an explicit, testable safety contract:
 *  - dry-run (DEFAULT for the scheduled cron): compute + log intended writes, write nothing.
 *  - single-customer: only the named customer id is processed.
 *  - full: write the repairs.
 * A livemode mismatch (expectLivemode != active key) is refused outright. Per-customer
 * resource_missing is already skipped by reconcileCustomerChunk, so a wrong-mode key can never
 * null a live customer.
 */
export async function runReconcile(
  sb: SupabaseClient,
  stripe: Stripe,
  customers: ReconcileCustomer[],
  opts: RunReconcileOpts,
): Promise<ReconcileSummary> {
  if (opts.expectLivemode != null && opts.expectLivemode !== opts.keyLivemode) {
    throw new LivemodeMismatchError(opts.expectLivemode, opts.keyLivemode);
  }
  const scoped =
    opts.mode === 'single-customer'
      ? customers.filter((c) => c.stripe_customer_id === opts.customerId)
      : customers;

  if (opts.mode === 'dry-run') {
    let wouldRepair = 0;
    for (const u of scoped) {
      if (!u.stripe_customer_id) continue;
      let subs: { data: Stripe.Subscription[] };
      try {
        subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id, status: 'all', limit: 100 });
      } catch (err) {
        if ((err as { code?: string })?.code === 'resource_missing') continue;
        throw err;
      }
      const derived = deriveProUntil(subs.data);
      if (derived.skip) continue;
      const { data: row } = await sb.from('users').select('pro_until').eq('id', u.id).maybeSingle();
      if ((row?.pro_until ?? null) !== derived.proUntil) {
        wouldRepair++;
        console.log(`[reconcile:dry-run] would set ${u.id} pro_until=${derived.proUntil ?? 'null'}`);
      }
    }
    return { mode: opts.mode, checked: scoped.length, wouldRepair, repaired: 0 };
  }

  const { chunkRepaired } = await reconcileCustomerChunk(sb, stripe, scoped);
  return { mode: opts.mode, checked: scoped.length, wouldRepair: chunkRepaired, repaired: chunkRepaired };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @crawlmouse/inngest exec vitest run billing.test.ts`
Expected: PASS (all prior + new cases).

- [ ] **Step 5: Commit**

```bash
git add inngest/billing-helpers.ts inngest/billing.test.ts
git commit -m "harden(inngest): reconcile dry-run default + livemode guard + single-customer mode"
```

### Task 0A.2: Wire the cron (dry-run) + manual full/single-customer function + register

**Files:**
- Modify: `inngest/billing.ts` (cron uses dry-run; add `reconcileBillingManualFn` on event `billing.reconcile.requested`)
- Modify: `apps/web/app/api/webhooks/inngest/route.ts` (register the new function)
- Modify: `apps/web/.env.local.example` (document `STRIPE_RECONCILE_LIVEMODE`)

- [ ] **Step 1: Replace `reconcileBillingFn` and add the manual fn** in `inngest/billing.ts`:

```ts
import { inngest } from './client';
import { supabaseAdmin } from './supabase';
import { reconcileCustomerChunk, runReconcile, keyLivemode, type ReconcileMode } from './billing-helpers';
import Stripe from 'stripe';

function stripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const PAGE = 200;

// `STRIPE_RECONCILE_LIVEMODE` ('true'|'false') asserts the mode the active key MUST be in.
// Unset = no assertion (local/dev). In prod set it to 'true' so a stale test key is refused.
function expectLivemode(): boolean | undefined {
  const v = process.env.STRIPE_RECONCILE_LIVEMODE;
  return v == null ? undefined : v === 'true';
}

async function loadAllCustomers(sb: ReturnType<typeof supabaseAdmin>) {
  const all: { id: string; stripe_customer_id: string | null }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('users')
      .select('id, stripe_customer_id')
      .not('stripe_customer_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
    from += PAGE;
  }
  return all;
}

// SCHEDULED daily run — DRY-RUN ONLY. Logs intended pro_until repairs; writes nothing.
// A real repair is triggered explicitly via the manual function below.
export const reconcileBillingFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile' },
  { cron: '0 3 * * *' },
  async ({ step }) =>
    step.run('reconcile-dry-run', async () => {
      const sb = supabaseAdmin();
      const stripe = stripeClient();
      const customers = await loadAllCustomers(sb);
      return runReconcile(sb, stripe, customers, {
        mode: 'dry-run',
        keyLivemode: keyLivemode(process.env.STRIPE_SECRET_KEY),
        expectLivemode: expectLivemode(),
      });
    }),
);

// MANUAL reconcile — explicit `inngest.send({ name: 'billing.reconcile.requested', data: { mode, customerId } })`.
// Defaults to a real 'full' run because it is only ever invoked deliberately (deploy runbook / ops).
export const reconcileBillingManualFn = inngest.createFunction(
  { id: 'crawlmouse.stripe-reconcile-manual' },
  { event: 'billing.reconcile.requested' },
  async ({ event, step }) =>
    step.run('reconcile', async () => {
      const sb = supabaseAdmin();
      const stripe = stripeClient();
      const mode = (event.data?.mode as ReconcileMode) ?? 'full';
      const customers = await loadAllCustomers(sb);
      return runReconcile(sb, stripe, customers, {
        mode,
        customerId: event.data?.customerId as string | undefined,
        keyLivemode: keyLivemode(process.env.STRIPE_SECRET_KEY),
        expectLivemode: expectLivemode(),
      });
    }),
);

// Daily TTL cleanup — bounded/batched delete of expired free audits (cascades to pages/links/findings).
export const cleanupExpiredAuditsFn = inngest.createFunction(
  { id: 'crawlmouse.audits-ttl-cleanup' },
  { cron: '0 4 * * *' },
  async ({ step }) =>
    step.run('delete-expired', async () => {
      const sb = supabaseAdmin();
      const { deleteExpiredAudits } = await import('./billing-helpers');
      return deleteExpiredAudits(sb, new Date().toISOString());
    }),
);
```

> Note: `event.data` typing — Inngest events are untyped here; `event.data?.mode` reads cleanly. If the project later adds an Inngest schema, type `billing.reconcile.requested` then.

- [ ] **Step 2: Register the manual fn** — `apps/web/app/api/webhooks/inngest/route.ts`:

```ts
import { serve } from 'inngest/next';
import { inngest as workerInngest } from '@crawlmouse/inngest';
import { auditFn } from '@crawlmouse/inngest/audit';
import { reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn } from '@crawlmouse/inngest/billing';

export const { GET, POST, PUT } = serve({
  client: workerInngest,
  functions: [auditFn, reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn],
});
```

- [ ] **Step 3: Document the env var** — add under `# Stripe` in `apps/web/.env.local.example`:

```
# Asserts the mode the active Stripe key must be in for the reconcile cron ('true' in prod).
# Unset = no assertion (dev). Mismatch → the reconcile run is refused, never nulls pro_until.
STRIPE_RECONCILE_LIVEMODE=
```

- [ ] **Step 4: Verify gates**

Run: `pnpm --filter @crawlmouse/inngest exec vitest run` then `pnpm --filter @crawlmouse/web exec tsc --noEmit`
Expected: inngest suite PASS; tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add inngest/billing.ts apps/web/app/api/webhooks/inngest/route.ts apps/web/.env.local.example
git commit -m "harden(inngest): scheduled reconcile is dry-run; explicit event triggers a real run"
```

### Task 0A.3: TTL cleanup — bounded/batched delete helper

**Why:** Replace the unscoped `delete().lte('expires_at', now)` (deletes the whole expired set in one statement — unbounded) with a select-ids→delete-by-id-chunk loop with an iteration cap.

**Files:**
- Modify: `inngest/billing-helpers.ts` (add `deleteExpiredAudits`)
- Test: `inngest/billing.test.ts` (add cases)

- [ ] **Step 1: Write failing tests** — append to `inngest/billing.test.ts`:

```ts
import { deleteExpiredAudits } from './billing-helpers';

// Fake Supabase for the batched delete: select(...).lte(...).limit(n) returns the next page of
// expired ids; delete().in('id', ids) removes them from the backing store.
function makeTtlSb(expiredIds: string[], opts: { batchSize?: number } = {}) {
  const store = new Set(expiredIds);
  const deleted: string[] = [];
  const sb = {
    deleted,
    from: () => ({
      select: () => ({
        lte: () => ({
          order: () => ({
            limit: (n: number) => Promise.resolve({ data: [...store].slice(0, n).map((id) => ({ id })), error: null }),
          }),
        }),
      }),
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          ids.forEach((id) => { store.delete(id); deleted.push(id); });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return sb as unknown as Parameters<typeof deleteExpiredAudits>[0] & { deleted: string[] };
}

describe('deleteExpiredAudits', () => {
  it('deletes the entire expired set in <= batchSize chunks and terminates', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `a${i}`);
    const sb = makeTtlSb(ids);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 100 });
    expect(res.deleted).toBe(23);
    expect(sb.deleted.sort()).toEqual(ids.sort());
  });

  it('stops at maxIterations even if rows remain (no infinite loop)', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const sb = makeTtlSb(ids);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 3 });
    expect(res.deleted).toBe(30); // 3 * 10
    expect(res.drained).toBe(false);
  });

  it('reports drained=true when the set empties before the cap', async () => {
    const sb = makeTtlSb(['a', 'b']);
    const res = await deleteExpiredAudits(sb, '2026-06-03T00:00:00Z', { batchSize: 10, maxIterations: 5 });
    expect(res).toMatchObject({ deleted: 2, drained: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/inngest exec vitest run billing.test.ts`
Expected: FAIL — `deleteExpiredAudits` not exported.

- [ ] **Step 3: Implement** — append to `inngest/billing-helpers.ts`:

```ts
export interface DeleteExpiredOpts { batchSize?: number; maxIterations?: number }
export interface DeleteExpiredResult { deleted: number; drained: boolean; iterations: number }

/**
 * Delete expired audits in bounded id-chunks instead of one unscoped statement. Selects up to
 * `batchSize` expired ids, deletes them by id, and loops until the set drains or `maxIterations`
 * is hit (a hard backstop so a clock/replication anomaly can't spin forever). `lte` matches a row
 * exactly at the expiry instant (complements listMine's `gt`).
 */
export async function deleteExpiredAudits(
  sb: SupabaseClient,
  nowIso: string,
  opts: DeleteExpiredOpts = {},
): Promise<DeleteExpiredResult> {
  const batchSize = opts.batchSize ?? 500;
  const maxIterations = opts.maxIterations ?? 50;
  let deleted = 0;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const { data, error } = await sb
      .from('audits')
      .select('id')
      .lte('expires_at', nowIso)
      .order('expires_at', { ascending: true })
      .limit(batchSize);
    if (error) throw error;
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) return { deleted, drained: true, iterations };
    const { error: delErr } = await sb.from('audits').delete().in('id', ids);
    if (delErr) throw delErr;
    deleted += ids.length;
    if (ids.length < batchSize) return { deleted, drained: true, iterations: iterations + 1 };
  }
  return { deleted, drained: false, iterations };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @crawlmouse/inngest exec vitest run billing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add inngest/billing-helpers.ts inngest/billing.ts inngest/billing.test.ts
git commit -m "harden(inngest): batched, bounded TTL cleanup for expired audits"
```

### Task 0B: AuditView 0/0 flash — pure state derivation + skeleton

**Why:** On the tick where status flips to `completed`, the stream emits a `progress` event (no `orphanCount`/`avgDepth`) immediately before the `done` event. `GradeCard` renders for that gap with `?? 0`, flashing `0` orphans / `0.0` depth. Gate the numeric stats behind the arrival of the `done` payload.

**Files:**
- Create: `apps/web/lib/audit-view-state.ts`
- Create: `apps/web/lib/audit-view-state.test.ts`
- Create: `apps/web/components/ui/GradeCardSkeleton.tsx`
- Modify: `apps/web/app/audit/[id]/AuditView.tsx`

- [ ] **Step 1: Write the failing test** — `apps/web/lib/audit-view-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveAuditViewState } from './audit-view-state';

const snap = (o: Partial<{ status: string; grade: string | null; score: number | null }>) =>
  ({ id: 'x', status: 'pending', grade: null, score: null, ...o });

describe('deriveAuditViewState', () => {
  it('running while not terminal and done not received', () => {
    expect(deriveAuditViewState(snap({ status: 'crawling' }), false))
      .toMatchObject({ running: true, awaitingResults: false, graded: false, failed: false });
  });

  it('awaitingResults when status=completed but the done payload has NOT arrived', () => {
    // This is the flash window: completed + grade present, but done=false.
    expect(deriveAuditViewState(snap({ status: 'completed', grade: 'A', score: 92 }), false))
      .toMatchObject({ running: false, awaitingResults: true, graded: false });
  });

  it('graded only once done=true AND grade+score present', () => {
    expect(deriveAuditViewState(snap({ status: 'completed', grade: 'A', score: 92 }), true))
      .toMatchObject({ graded: true, awaitingResults: false, running: false });
  });

  it('failed status is terminal and never awaitingResults', () => {
    expect(deriveAuditViewState(snap({ status: 'failed' }), false))
      .toMatchObject({ failed: true, running: false, awaitingResults: false, graded: false });
  });

  it('completed-but-ungradable (done, no grade) is neither graded nor awaiting', () => {
    expect(deriveAuditViewState(snap({ status: 'completed', grade: null, score: null }), true))
      .toMatchObject({ graded: false, gradeFailed: true, awaitingResults: false });
  });

  it('null snapshot is treated as running', () => {
    expect(deriveAuditViewState(null, false)).toMatchObject({ running: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/audit-view-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/web/lib/audit-view-state.ts`:

```ts
// Pure derivation of AuditView's render state from the latest snapshot + whether the `done`
// payload (which alone carries orphanCount/avgDepth/findingGroups) has arrived. Keeping this
// pure makes the "no 0/0 flash" guarantee unit-testable without a DOM/EventSource.
export interface AuditSnapshotLite {
  status: string;
  grade?: string | null;
  score?: number | null;
}

export interface AuditViewState {
  running: boolean;          // crawl in progress
  awaitingResults: boolean;  // terminal=completed but done payload not yet received → skeleton
  graded: boolean;           // safe to render GradeCard with real numbers
  failed: boolean;
  gradeFailed: boolean;      // completed + done but no grade (rare)
}

export function deriveAuditViewState(snapshot: AuditSnapshotLite | null, done: boolean): AuditViewState {
  const status = snapshot?.status ?? 'pending';
  const completed = status === 'completed';
  const failed = status === 'failed';
  const hasGrade = !!snapshot?.grade && snapshot?.score != null;
  const graded = done && completed && hasGrade;
  const gradeFailed = done && completed && !hasGrade;
  const awaitingResults = completed && !failed && !done;
  const running = !completed && !failed && !done;
  return { running, awaitingResults, graded, failed, gradeFailed };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/audit-view-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the skeleton** — `apps/web/components/ui/GradeCardSkeleton.tsx`:

```tsx
import { Card } from './Card';

// Animated placeholder shown in the gap between status=completed and the `done` payload
// (carrying orphan/depth). Prevents a 0-orphans / 0.0-depth flash. Playful pulse, on-brand.
export function GradeCardSkeleton() {
  return (
    <Card className="!p-7 !rounded-3xl" aria-busy="true" aria-label="Computing your grade">
      <div className="animate-pulse">
        <div className="flex items-start justify-between mb-4">
          <div className="space-y-2">
            <div className="h-3 w-16 rounded bg-oat" />
            <div className="h-14 w-20 rounded-xl bg-oat" />
            <div className="h-3 w-24 rounded bg-oat" />
          </div>
          <div className="h-6 w-24 rounded-full bg-oat" />
        </div>
        <div className="border-t border-dashed border-oat pt-3 grid grid-cols-2 gap-3">
          <div className="space-y-2"><div className="h-7 w-10 rounded bg-oat" /><div className="h-3 w-20 rounded bg-oat" /></div>
          <div className="space-y-2"><div className="h-7 w-10 rounded bg-oat" /><div className="h-3 w-24 rounded bg-oat" /></div>
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 6: Wire into AuditView** — `apps/web/app/audit/[id]/AuditView.tsx`. Add a `done` state set in the `done` listener, import the new helpers/skeleton, and replace the `completed/failed/graded/running` derivation + render:

Replace the imports block additions:
```tsx
import { GradeCardSkeleton } from '@/components/ui/GradeCardSkeleton';
import { deriveAuditViewState } from '@/lib/audit-view-state';
```

Add `done` state and set it in the listener:
```tsx
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [done, setDone] = useState(false);
  // ... pageCap unchanged ...
  useEffect(() => {
    const es = new EventSource(`/api/audits/${auditId}/stream`);
    es.addEventListener('snapshot', (e) => setSnapshot(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('progress', (e) => setSnapshot(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('done', (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
      setDone(true);
      es.close();
    });
    return () => es.close();
  }, [auditId]);
```

Replace the state booleans (`completed`/`failed`/`graded`/`running`) with:
```tsx
  const { running, awaitingResults, graded, failed, gradeFailed } = deriveAuditViewState(snapshot, done);
```

Render: keep `running` block as-is; insert the skeleton for the gap; gate the "couldn't grade" card on `gradeFailed`:
```tsx
      {running && <AuditProgress pageCount={snapshot?.page_count ?? 0} pageCap={pageCap} status={snapshot?.status ?? 'pending'} />}
      {running && <DripFeedFindings active={running} />}
      {awaitingResults && <GradeCardSkeleton />}
      {graded && (
        <GradeCard
          grade={snapshot!.grade!}
          score={snapshot!.score!}
          orphanCount={snapshot?.orphanCount ?? 0}
          avgDepth={snapshot?.avgDepth ?? 0}
          passing={(snapshot!.score ?? 0) >= 60}
        />
      )}
      {graded && <SharePanel auditId={auditId} />}
      {graded && snapshot?.findingGroups && <FindingsPanel groups={snapshot.findingGroups} />}
      {graded && (snapshot?.viewerIsPro
        ? <a href={`/api/audits/${auditId}/export`}><Button variant="secondary" className="w-full">Download CSV</Button></a>
        : <UpgradeCard headline="Export every finding + page as CSV." sub="Sortable spreadsheet of your whole site." />
      )}
      {(failed || gradeFailed) && (
        <Card>
          <h2 className="font-display font-bold text-2xl text-warning">
            {failed ? 'Audit failed' : 'Couldn’t grade this site'}
          </h2>
          <p className="mt-2 text-ink/70">
            {failed
              ? 'We hit an error crawling your site. Try again or contact support.'
              : 'The crawl finished but we couldn’t compute a grade — usually a site that blocks crawlers or has no crawlable pages. Try again or contact support.'}
          </p>
        </Card>
      )}
```

- [ ] **Step 7: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/audit-view-state.test.ts && pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: PASS, tsc 0, lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/audit-view-state.ts apps/web/lib/audit-view-state.test.ts apps/web/components/ui/GradeCardSkeleton.tsx apps/web/app/audit/[id]/AuditView.tsx
git commit -m "fix(web): gate grade stats behind completion payload to kill the 0/0 flash"
```

### Task 0C: OG-cache purge on takedown — tagged report read + processing path

**Why:** A processed takedown still serves the pre-takedown OG card (and possibly the cached report page) for up to an hour. Centralize the `public_reports`-by-slug read behind a tagged cache and purge that tag (plus the page path) when a takedown is actioned.

**Files:**
- Create: `apps/web/lib/reports.ts`
- Create: `apps/web/lib/takedown.ts`
- Create: `apps/web/lib/takedown.test.ts`
- Create: `apps/web/app/api/admin/takedown/process/route.ts`
- Modify: `apps/web/app/r/[slug]/opengraph-image.tsx`, `apps/web/app/r/[slug]/page.tsx`
- Modify: `apps/web/.env.local.example` (add `ADMIN_SECRET`)

- [ ] **Step 1: Cached, tagged report read** — `apps/web/lib/reports.ts`:

```ts
import { unstable_cache, revalidateTag } from 'next/cache';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface PublicReportRow {
  domain: string;
  grade: string | null;
  score: number | string | null;
  cms_detected: string | null;
  orphan_count: number | null;
  avg_depth: number | string | null;
  takedown_requested_at: string | null;
  created_at: string;
}

export const reportTag = (slug: string) => `public-report:${slug}`;

async function readReport(slug: string): Promise<PublicReportRow | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('public_reports')
    .select('domain, grade, score, cms_detected, orphan_count, avg_depth, takedown_requested_at, created_at')
    .eq('slug', slug)
    .maybeSingle();
  return (data as PublicReportRow) ?? null;
}

/**
 * Cache the by-slug read and tag it with `public-report:<slug>` so a takedown can purge exactly
 * this report's cached render (OG card + page) without waiting out the time-based revalidate.
 */
export function getPublicReport(slug: string): Promise<PublicReportRow | null> {
  return unstable_cache(() => readReport(slug), ['public-report', slug], {
    tags: [reportTag(slug)],
    revalidate: 3600,
  })();
}

/** Purge a single report's cached OG image + page so a takedown takes effect on the next request. */
export function purgePublicReport(slug: string): void {
  revalidateTag(reportTag(slug));
  revalidatePath(`/r/${slug}`);
}
```

- [ ] **Step 2: Takedown processing helper + failing test** — `apps/web/lib/takedown.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag, revalidatePath }));

import { processTakedown } from './takedown';

function makeSb() {
  const calls: { table: string; update?: Record<string, unknown>; eq?: [string, string] }[] = [];
  const sb = {
    calls,
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => { calls.push({ table, update: patch, eq: [col, val] }); return Promise.resolve({ error: null }); },
      }),
    }),
  };
  return sb as unknown as Parameters<typeof processTakedown>[0] & { calls: typeof calls };
}

describe('processTakedown', () => {
  beforeEach(() => { revalidateTag.mockClear(); revalidatePath.mockClear(); });

  it('sets takedown_requested_at on the report, marks the request approved, and purges caches', async () => {
    const sb = makeSb();
    await processTakedown(sb, 'abc123');
    const reportUpdate = sb.calls.find((c) => c.table === 'public_reports');
    expect(reportUpdate?.update).toHaveProperty('takedown_requested_at');
    expect(reportUpdate?.eq).toEqual(['slug', 'abc123']);
    const reqUpdate = sb.calls.find((c) => c.table === 'takedown_requests');
    expect(reqUpdate?.update).toMatchObject({ status: 'approved' });
    expect(revalidateTag).toHaveBeenCalledWith('public-report:abc123');
    expect(revalidatePath).toHaveBeenCalledWith('/r/abc123');
  });
});
```

> Note: `lib/takedown.ts` imports `reportTag`/`purgePublicReport` from `./reports`, which imports `@/lib/supabase/admin`. To keep this unit test free of the `@/` alias, have `takedown.ts` import the tag/purge **inline** as shown (relative `./reports`), and the test mocks `next/cache` so no Supabase admin is constructed.

- [ ] **Step 3: Implement** — `apps/web/lib/takedown.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportTag } from './reports';
import { revalidateTag, revalidatePath } from 'next/cache';

/**
 * Action a takedown for a public report: flip `takedown_requested_at` (the switch the OG image
 * and report page read), mark the queue row approved, and purge this report's cached render so
 * the taken-down placeholder is served immediately instead of up to an hour later.
 */
export async function processTakedown(sb: SupabaseClient, slug: string): Promise<void> {
  const now = new Date().toISOString();
  const { error: rErr } = await sb.from('public_reports').update({ takedown_requested_at: now }).eq('slug', slug);
  if (rErr) throw rErr;
  await sb.from('takedown_requests').update({ status: 'approved', processed_at: now }).eq('public_report_slug', slug);
  revalidateTag(reportTag(slug));
  revalidatePath(`/r/${slug}`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/takedown.test.ts`
Expected: PASS.

- [ ] **Step 5: Admin process route** — `apps/web/app/api/admin/takedown/process/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processTakedown } from '@/lib/takedown';

export const runtime = 'nodejs';

const schema = z.object({ slug: z.string().min(1).max(64) });

function authorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false; // closed by default — no secret set means no admin access
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  try {
    await processTakedown(supabaseAdmin(), parsed.data.slug);
  } catch {
    return NextResponse.json({ error: 'could not process' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Route the OG image + page through the cached read.**

`apps/web/app/r/[slug]/opengraph-image.tsx` — replace the direct `supabaseAdmin` read with:
```tsx
import { getPublicReport } from '@/lib/reports';
// ...
  const { slug } = await params;
  const report = await getPublicReport(slug);
  if (!report || report.takedown_requested_at) {
    return new ImageResponse(<div style={{ fontSize: 48 }}>Crawlmouse</div>, size);
  }
```
(Remove the now-unused `supabaseAdmin` import.)

`apps/web/app/r/[slug]/page.tsx` — replace the direct read with:
```tsx
import { getPublicReport } from '@/lib/reports';
// ...
  const { slug } = await params;
  const report = await getPublicReport(slug);
  if (!report || report.takedown_requested_at || !report.grade) notFound();
```
(Remove the now-unused `supabaseAdmin` import.)

- [ ] **Step 7: Document the env var** — add to `apps/web/.env.local.example` under a new `# Admin` section:

```
# Admin
# Bearer token for service ops routes (e.g. POST /api/admin/takedown/process). Long random string.
ADMIN_SECRET=
```

- [ ] **Step 8: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/takedown.test.ts && pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: PASS, tsc 0, lint clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/reports.ts apps/web/lib/takedown.ts apps/web/lib/takedown.test.ts apps/web/app/api/admin/takedown/process/route.ts apps/web/app/r/[slug]/opengraph-image.tsx apps/web/app/r/[slug]/page.tsx apps/web/.env.local.example
git commit -m "feat(web): action takedowns + purge cached report/OG card on processing"
```

### Phase 0 Gate

- [x] Run the §4 per-phase gate (3 adversarial Opus reviewers × 4 lenses → verify → TDD-fix → re-review until all ≥9/10). Confirm inngest + web suites green, tsc 0, lint clean. Controller pushes Phase 0 commits. — **DONE: R3 9/9/9/9; inngest 37/37, web 120/120, tsc 0, lint clean; pushed `0d3a032`.**

---

## Phase 1 — Anti-abuse: Turnstile widget [code] — ✅ COMPLETE

> Done 2026-06-03 (origin/main `74d33b7`; 4 commits `d2cc0e4..74d33b7`). Workflow `plan5-phase1`: 1 TDD implementer → 3 adversarial Opus reviewers × 4 lenses, **converged round 1 at 9/9/9/9** (per-reviewer 10/9/10/9 · 9/9/9/9 · 9/9/9/9; 0 blocking). Controller-verified gates: web vitest 24 files / **129 tests** (120 → +9 from the two new helper suites), tsc 0, lint clean. Plan-vs-reality adjustments confirmed in code: (a) `@marsidev/react-turnstile@1.5.2` types the component ref as `TurnstileInstance | **undefined**`, so the wrapper uses `forwardRef<TurnstileInstance | undefined, Props>` and all three consumers use `useRef<TurnstileInstance>(undefined)` — argless `useRef<T>()` does NOT compile under this tree's `@types/react@19.2.15` (TS2554 expected-1-arg); (b) the NEW magic-link server verify was extracted into a pure, injectable `lib/turnstile-gate.ts` (relative imports) so the allow/block logic is unit-tested without Vitest's missing `@/` alias — the route calls `turnstileGate(!!TURNSTILE_SECRET_KEY, token, (t) => verifyTurnstileToken(t, ip))` reusing its existing `ip`; (c) the funnel (`/api/audits/start`, `captcha_required` 429) and takedown ROUTES already verified — Phase 1 only added on-demand (funnel) / always-on (magic-link, takedown) widget rendering. New dep `@marsidev/react-turnstile`; env `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` were already documented — no new env. Live captcha behavior deferred to Phase 7.

Render a Cloudflare Turnstile (managed mode) widget on abuse-prone forms and pass `cf-turnstile-response` to the server, which verifies via the existing `lib/turnstile.ts`. **Policy:** always require a token on the low-volume forms (magic-link, takedown, /developers waitlist); on the audit funnel, only require it on `captcha_required` (429) so the viral path stays friction-free. Dev falls open when `TURNSTILE_SECRET_KEY` is unset (already true server-side).

**Research note (do at execution):** confirm current `@marsidev/react-turnstile` API (props `siteKey`, `onSuccess`, `onError`, `onExpire`, `options.theme`, the `ref.reset()` method) against its README; cite the version pinned.

### Task 1.1: Add the dependency + shared widget component

**Files:**
- Modify: `apps/web/package.json` (add `@marsidev/react-turnstile`)
- Create: `apps/web/components/ui/Turnstile.tsx`
- Create: `apps/web/lib/turnstile-client.ts` (+ test) — pure helper for "is a token required / present"

- [ ] **Step 1: Install**

Run: `nvm use && pnpm --filter @crawlmouse/web add @marsidev/react-turnstile`
Expected: dependency added; lockfile updated.

- [ ] **Step 2: Pure helper test** — `apps/web/lib/turnstile-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { turnstileEnabled } from './turnstile-client';

describe('turnstileEnabled', () => {
  it('is disabled when no site key is configured (dev falls open)', () => {
    expect(turnstileEnabled(undefined)).toBe(false);
    expect(turnstileEnabled('')).toBe(false);
  });
  it('is enabled when a site key is present', () => {
    expect(turnstileEnabled('0x4AAAAAADcDUWXN1hJ_2MRB')).toBe(true);
  });
});
```

- [ ] **Step 3: Implement helper** — `apps/web/lib/turnstile-client.ts`:

```ts
// A client form should only render/require the widget when a site key is configured. Centralized
// so every form gates identically and dev (no key) stays frictionless.
export function turnstileEnabled(siteKey: string | undefined): boolean {
  return !!siteKey && siteKey.length > 0;
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
```

- [ ] **Step 4: Run helper test**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/turnstile-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Widget component** — `apps/web/components/ui/Turnstile.tsx`:

```tsx
'use client';

import { Turnstile as MarsidevTurnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { forwardRef } from 'react';
import { TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';

interface Props {
  onToken: (token: string | null) => void; // null on expire/error → caller clears its token
}

/**
 * Managed-mode Turnstile. Renders nothing when no site key is set (dev), so forms stay usable
 * locally. Forwards the imperative instance so a parent can `.reset()` after a failed submit.
 */
export const Turnstile = forwardRef<TurnstileInstance, Props>(function Turnstile({ onToken }, ref) {
  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <MarsidevTurnstile
      ref={ref}
      siteKey={TURNSTILE_SITE_KEY}
      options={{ theme: 'light', size: 'flexible' }}
      onSuccess={(t) => onToken(t)}
      onError={() => onToken(null)}
      onExpire={() => onToken(null)}
      className="my-1"
    />
  );
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/ui/Turnstile.tsx apps/web/lib/turnstile-client.ts apps/web/lib/turnstile-client.test.ts
git commit -m "feat(web): add Turnstile widget component + client gating helper"
```

### Task 1.2: Wire Turnstile into the audit funnel (UrlForm, captcha-on-429)

**Why:** The funnel must stay friction-free until an IP trips the daily limit. `/api/audits/start` already returns `{ error: 'captcha_required' }` (429) and accepts `turnstileToken`. Render the widget only after the first `captcha_required`, then resubmit with the token.

**Files:** Modify `apps/web/components/audit/UrlForm.tsx`.

- [ ] **Step 1: Update UrlForm** — add captcha state, render the widget on demand, include the token:

```tsx
'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Turnstile } from '@/components/ui/Turnstile';

export function UrlForm() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captcha, setCaptcha] = useState(false);     // becomes true after a captcha_required 429
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance>(null);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let parsed: URL;
    try {
      parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      setError('Please enter a valid URL');
      return;
    }
    if (captcha && !token) { setError('Please complete the verification.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/audits/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: parsed.toString(), turnstileToken: token ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'captcha_required') {
          setCaptcha(true);
          setError('Quick check: confirm you’re human to continue.');
          return;
        }
        widgetRef.current?.reset();
        setToken(null);
        setError(data.error ?? 'Something went wrong');
        return;
      }
      router.push(`/audit/${data.auditId}` as never);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          type="text"
          placeholder="https://your-store.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          invalid={!!error}
          disabled={submitting}
          autoFocus
          autoComplete="url"
        />
        <Button type="submit" size="lg" disabled={submitting || !url || (captcha && !token)}>
          {submitting ? 'Starting...' : 'Grade it →'}
        </Button>
      </div>
      {captcha && <div className="mt-3"><Turnstile ref={widgetRef} onToken={setToken} /></div>}
      {error && <div className="mt-2 text-warning text-sm">{error}</div>}
      <div className="mt-3 text-xs text-ink/50">No signup needed. Free for the first audit per domain per 24h.</div>
    </form>
  );
}
```

- [ ] **Step 2: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: tsc 0, lint clean. (Live behavior verified in Phase 7 against the staging Turnstile key.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/audit/UrlForm.tsx
git commit -m "feat(web): show Turnstile on the audit funnel only after a captcha_required limit trip"
```

### Task 1.3: Always-on Turnstile for the magic-link form + server verify

**Why:** Sign-in email is abuse-prone and low-volume — require a token always. The server route must verify it (it currently does not).

**Files:** Modify `apps/web/app/login/page.tsx`, `apps/web/app/api/auth/magic-link/route.ts`.

- [ ] **Step 1: Server verify** — `apps/web/app/api/auth/magic-link/route.ts`: extend the schema + verify before sending:

```ts
import { verifyTurnstileToken } from '@/lib/turnstile';
// ...
const schema = z.object({ email: z.string().email(), turnstileToken: z.string().optional() });
// ... after the rate-limit checks, before signInWithOtp:
  const ip = getClientIp(req); // already computed above for rate-limit; reuse it
  if (process.env.TURNSTILE_SECRET_KEY) {
    const ok = parsed.data.turnstileToken
      ? await verifyTurnstileToken(parsed.data.turnstileToken, ip)
      : false;
    if (!ok) return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 400 });
  }
```
(`ip` is already derived for the rate-limit buckets; do not re-shadow it.)

- [ ] **Step 2: Render the widget** in `apps/web/app/login/page.tsx` — add token state, include in body, block submit until present when enabled:

```tsx
import { useRef, useState, type FormEvent } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { Turnstile } from '@/components/ui/Turnstile';
import { turnstileEnabled, TURNSTILE_SITE_KEY } from '@/lib/turnstile-client';
// inside the component:
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance>(null);
  const needToken = turnstileEnabled(TURNSTILE_SITE_KEY);
// in handleSubmit, before fetch:
    if (needToken && !token) { setError('Please complete the verification.'); return; }
// in the fetch body:
        body: JSON.stringify({ email, turnstileToken: token ?? undefined }),
// on !res.ok: widgetRef.current?.reset(); setToken(null);
// in the form JSX, above the submit button:
                <Turnstile ref={widgetRef} onToken={setToken} />
// disable submit:
                <Button type="submit" size="md" className="w-full" disabled={loading || !email || (needToken && !token)}>
```

- [ ] **Step 3: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: tsc 0, lint clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/login/page.tsx apps/web/app/api/auth/magic-link/route.ts
git commit -m "feat(web): require + server-verify Turnstile on magic-link sign-in"
```

### Task 1.4: Always-on Turnstile for the takedown form

**Why:** The takedown route already verifies a supplied token; wire the widget so a token is always sent.

**Files:** Modify `apps/web/app/takedown/page.tsx`.

- [ ] **Step 1:** Mirror Task 1.3's pattern in `takedown/page.tsx`: add `token`/`widgetRef`/`needToken`, render `<Turnstile ref={widgetRef} onToken={setToken} />` above the submit button, send `turnstileToken: token ?? undefined` in the POST body, block submit until present when enabled, and `widgetRef.current?.reset(); setToken(null);` on `!res.ok`.

- [ ] **Step 2: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: tsc 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/takedown/page.tsx
git commit -m "feat(web): wire Turnstile into the takedown form"
```

### Phase 1 Gate

- [x] Run the §4 per-phase gate (4 lenses → verify → fix → re-review ≥9/10). Security lens specifically checks: token never trusted client-side, server verify present on every gated path, no funnel friction below the limit, reset-on-error. Controller pushes. — **DONE: R1 9/9/9/9 (0 blocking); web 129/129, tsc 0, lint clean; pushed `74d33b7`.**

---

## Phase 2 — Observability: PostHog funnel + Sentry [code] + [runbook] — ✅ COMPLETE

> Done 2026-06-03 (origin/main; code commits `1c21e24..ece079e` + this plan-doc commit). Workflow `plan5-phase2`: 1 TDD implementer → 3 adversarial Opus reviewers × 4 lenses, **converged ROUND 1 at 9/9/9/9** (all three reviewers 9/9/9/9, 0 blocking; 1 outstanding *major* — an empty-string `NEXT_PUBLIC_POSTHOG_HOST=` in the example would defeat the `?? '/ingest'` fallback — fixed by the controller switching the guard to `|| '/ingest'`). Controller-verified gates: tsc 0, `next lint` clean, web vitest **137/137** (was 129; +3 sampling, +5 analytics-mock), and `next build` exit 0 (only the pre-existing @sentry/node + OpenTelemetry `require-in-the-middle` "Critical dependency" webpack notices remain). **Plan-vs-reality adjustments confirmed in code (carry forward):** (a) PostHog US-region rewrites must include the **`/ingest/array/:path*` → `us-assets…/array`** rule (the literal plan omitted it) and the plan's explicit `/ingest/flags` rule is redundant (the `/ingest/:path*` catch-all covers flags/decide) — dropped; (b) `next.config.mjs` `experimental.instrumentationHook` is **obsolete in Next 15** (instrumentation is stable) → removed, and `experimental.typedRoutes` had to **move to the top-level `typedRoutes: true`** key (Next 15.5 build warns otherwise); (c) `beforeSendSampler` must be typed to posthog-js's own **`CaptureResult | null`** (not the plan's `{ event: string }`) or `before_send: beforeSendSampler` fails tsc/build; (d) `AuditView` no longer has an inline `done` EventSource listener — it uses `wireAuditStream(...)` whose `onDone()` carries no payload, so **`audit-completed` fires via `useEffect([done])`** reading the latest snapshot (fire-once on the done edge), NOT the plan's stale `JSON.parse(e.data)` listener; (e) the project's flat ESLint config does NOT register `react-hooks`, so a `react-hooks/exhaustive-deps` disable comment itself *errors* — omit it (plain comment instead); (f) a focused `lib/analytics.test.ts` needs `vi.hoisted` for the posthog mock (vi.mock is hoisted above top-level consts). **Pre-existing build blocker fixed (separate commit `1c21e24`):** `app/api/audits/[id]/stream/route.ts` exported `maxDuration = SSE_MAX_DURATION_S` (an *imported* constant) — Next's route-segment validator requires a **static literal**, so `next build` failed; inlined `maxDuration = 300` (== `SSE_MAX_DURATION_S`, behavior-identical). This was latent because `next build` was not a gate before Phase 2 — i.e. production deploys would have failed at build without it. Confirmed: Next 15.5.18 (≥15.3 for `instrumentation-client.ts`, no experimental flag), `@sentry/nextjs` ^10.53.1 (`captureRouterTransitionStart`/`captureRequestError`), `posthog-js` ^1.376.0. Live captcha/DSN behavior, alert rules, sourcemaps, and the prod reverse-proxy host remain deferred to the deploy runbook / Phase 7 per the plan.

Instrument the seven funnel events with typed props, add a reverse-proxy + error-only session replay (privacy-masked), modernize client init to `instrumentation-client.ts`, add PostHog event sampling (cost-control #6), and wire Sentry `onRequestError` + the webhook-signature-failure signal. Alert rules + sourcemaps are runbook.

**Research note:** confirm the Next 15.3+ `instrumentation-client.ts` contract and `onRouterTransitionStart` (Sentry navigation), and PostHog's current Next.js reverse-proxy rewrite paths, against official docs at execution; cite versions.

### Task 2.1: Typed analytics events + sampling helper (pure, tested)

**Files:**
- Modify: `apps/web/lib/analytics.ts`
- Create: `apps/web/lib/analytics-events.ts`
- Create: `apps/web/lib/analytics-sampling.ts` (+ test)

- [ ] **Step 1: Sampling test** — `apps/web/lib/analytics-sampling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldSendEvent } from './analytics-sampling';

describe('shouldSendEvent', () => {
  it('always keeps named funnel events regardless of the sample roll', () => {
    expect(shouldSendEvent('audit-submitted', 0.999)).toBe(true);
    expect(shouldSendEvent('pro-upgrade', 0.999)).toBe(true);
    expect(shouldSendEvent('$pageview', 0.999)).toBe(true);
  });
  it('samples high-volume autocapture/pageleave at the configured rate', () => {
    expect(shouldSendEvent('$autocapture', 0.05)).toBe(true);  // under 0.10 → kept
    expect(shouldSendEvent('$autocapture', 0.50)).toBe(false); // over 0.10 → dropped
    expect(shouldSendEvent('$pageleave', 0.50)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement sampling** — `apps/web/lib/analytics-sampling.ts`:

```ts
import { FUNNEL_EVENTS } from './analytics-events';

// Cost control #6: keep every funnel event + pageview, sample noisy autocapture/pageleave to
// 10%. `rand` is injected (Math.random in prod) so the decision is deterministic under test.
const ALWAYS_KEEP = new Set<string>([...FUNNEL_EVENTS, '$pageview', '$identify', '$set']);
const SAMPLED = new Set<string>(['$autocapture', '$pageleave', '$rageclick', '$web_vitals']);
export const AUTOCAPTURE_SAMPLE_RATE = 0.1;

export function shouldSendEvent(eventName: string, rand: number): boolean {
  if (ALWAYS_KEEP.has(eventName)) return true;
  if (SAMPLED.has(eventName)) return rand < AUTOCAPTURE_SAMPLE_RATE;
  return true; // unknown custom events kept
}
```

- [ ] **Step 3: Typed event names** — `apps/web/lib/analytics-events.ts`:

```ts
// The seven launch funnel events. Keep this list and the call sites in sync; it also drives
// the sampling allow-list so a funnel event is never dropped.
export const FUNNEL_EVENTS = [
  'landing-view',
  'audit-submitted',
  'audit-completed',
  'email-captured',
  'public-share-clicked',
  'csv-download',
  'pro-upgrade',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/analytics-sampling.test.ts`
Expected: PASS.

- [ ] **Step 5: Typed `track` + `before_send` sampler** — update `apps/web/lib/analytics.ts`:

```ts
'use client';
import posthog from 'posthog-js';
import type { FunnelEvent } from './analytics-events';
import { shouldSendEvent } from './analytics-sampling';

export function beforeSendSampler(event: { event: string } | null) {
  if (!event) return event;
  return shouldSendEvent(event.event, Math.random()) ? event : null;
}

/** Typed funnel tracker — names constrained to the seven funnel events. */
export function track(event: FunnelEvent, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}

/** Escape hatch for non-funnel custom events (rare). */
export function trackRaw(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}
```

(Init moves to `instrumentation-client.ts` in Task 2.2; remove `initAnalytics` from here.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/analytics.ts apps/web/lib/analytics-events.ts apps/web/lib/analytics-sampling.ts apps/web/lib/analytics-sampling.test.ts
git commit -m "feat(web): typed funnel events + cost-control event sampling"
```

### Task 2.2: Modern client init (`instrumentation-client.ts`) + reverse proxy + error-only replay

**Files:**
- Create: `apps/web/instrumentation-client.ts`
- Delete: `apps/web/sentry.client.config.ts`
- Delete: `apps/web/components/AnalyticsBootstrap.tsx`
- Modify: `apps/web/app/layout.tsx` (drop `<AnalyticsBootstrap />`)
- Modify: `apps/web/next.config.mjs` (PostHog reverse-proxy rewrites + `skipTrailingSlashRedirect`)

- [ ] **Step 1: Confirm Next version** — `pnpm --filter @crawlmouse/web exec next --version`. Expected ≥ 15.3 (required for `instrumentation-client.ts`). If < 15.3, run `pnpm --filter @crawlmouse/web add next@^15.3` first.

- [ ] **Step 2: Client instrumentation** — `apps/web/instrumentation-client.ts`:

```ts
import posthog from 'posthog-js';
import * as Sentry from '@sentry/nextjs';
import { beforeSendSampler } from '@/lib/analytics';

// Sentry (client) — moved here from sentry.client.config.ts per @sentry/nextjs v8+ guidance.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// PostHog — reverse-proxied via /ingest (ad-blocker resilient); session replay OFF until an
// error occurs (privacy-masked). Sampling drops noisy autocapture (cost control #6).
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '/ingest',
    ui_host: 'https://us.posthog.com',
    person_profiles: 'always',
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true,        // do not record by default
    session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' },
    before_send: beforeSendSampler,
  });
  // Error-only replay: start recording the moment something throws, so we capture the lead-up
  // to a real bug without recording every healthy session.
  const startReplay = () => { try { posthog.startSessionRecording(); } catch { /* noop */ } };
  window.addEventListener('error', startReplay, { once: true });
  window.addEventListener('unhandledrejection', startReplay, { once: true });
}
```

- [ ] **Step 3: Reverse-proxy rewrites** — `apps/web/next.config.mjs`. Add `skipTrailingSlashRedirect: true` and an async `rewrites()` (US region hosts):

```js
export default {
  // ...existing experimental/transpile/serverExternalPackages...
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
      { source: '/ingest/flags', destination: 'https://us.i.posthog.com/flags' },
    ];
  },
  // ...existing webpack(config) {...}...
};
```

- [ ] **Step 4: Remove the old init path** — delete `apps/web/sentry.client.config.ts` and `apps/web/components/AnalyticsBootstrap.tsx`; in `apps/web/app/layout.tsx` remove the `AnalyticsBootstrap` import and its `<AnalyticsBootstrap />` usage.

- [ ] **Step 5: Point analytics env at the proxy** — in `apps/web/.env.local.example` change the PostHog host comment + default:

```
# PostHog is reverse-proxied through /ingest (see next.config rewrites). Leave host unset in prod
# to use the proxy; set an absolute host only for local debugging.
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
```

- [ ] **Step 6: Verify gates + build**

Run: `pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint && pnpm --filter @crawlmouse/web exec next build`
Expected: tsc 0, lint clean, build succeeds (confirms instrumentation-client + rewrites compile).

- [ ] **Step 7: Commit**

```bash
git add apps/web/instrumentation-client.ts apps/web/next.config.mjs apps/web/app/layout.tsx apps/web/.env.local.example
git rm apps/web/sentry.client.config.ts apps/web/components/AnalyticsBootstrap.tsx
git commit -m "feat(web): modern client instrumentation, PostHog reverse-proxy + error-only replay"
```

### Task 2.3: Fire the seven funnel events at their call sites

**Files (each a `track(...)` call):**
- `apps/web/app/page.tsx` → `landing-view` (needs a tiny client tracker)
- `apps/web/components/audit/UrlForm.tsx` → `audit-submitted`
- `apps/web/app/audit/[id]/AuditView.tsx` → `audit-completed`
- `apps/web/app/login/page.tsx` → `email-captured`
- `apps/web/components/share/SharePanel.tsx` → `public-share-clicked`
- `apps/web/app/audit/[id]/AuditView.tsx` (CSV link) → `csv-download`
- `apps/web/components/billing/ActivatingPro.tsx` → `pro-upgrade`

- [ ] **Step 1: Landing view** — create `apps/web/components/analytics/TrackView.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import { track } from '@/lib/analytics';
import type { FunnelEvent } from '@/lib/analytics-events';

/** Fire-once view tracker for server components. */
export function TrackView({ event, props }: { event: FunnelEvent; props?: Record<string, unknown> }) {
  useEffect(() => { track(event, props); }, [event, props]);
  return null;
}
```
Render `<TrackView event="landing-view" />` near the top of `app/page.tsx`'s `<main>`.

- [ ] **Step 2: audit-submitted** — in `UrlForm.handleSubmit`, immediately after a successful `res.ok` (before `router.push`):
```tsx
      track('audit-submitted', { domain: parsed.hostname });
```
(Import `track` from `@/lib/analytics`.)

- [ ] **Step 3: audit-completed** — in `AuditView`'s `done` listener, after `setDone(true)`:
```tsx
      const payload = JSON.parse((e as MessageEvent).data);
      track('audit-completed', { status: payload.status, grade: payload.grade ?? null, score: payload.score ?? null });
```
(Refactor the listener to parse once into `payload`, `setSnapshot(payload)`, then track.)

- [ ] **Step 4: csv-download** — wrap the CSV `<a>` with an `onClick`:
```tsx
        <a href={`/api/audits/${auditId}/export`} onClick={() => track('csv-download', { auditId })}>
```

- [ ] **Step 5: email-captured** — in `login/page.tsx` `handleSubmit`, after `setSent(true)`:
```tsx
      track('email-captured', {});
```

- [ ] **Step 6: public-share-clicked** — in `SharePanel.mint`, after `setSlug(data.slug)`:
```tsx
        track('public-share-clicked', { slug: data.slug });
```

- [ ] **Step 7: pro-upgrade** — in `ActivatingPro`, inside the poll where `pro` is detected (before `router.replace`):
```tsx
          track('pro-upgrade', {});
```

- [ ] **Step 8: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: tsc 0 (typed event names enforce correctness), lint clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/analytics/TrackView.tsx apps/web/app/page.tsx apps/web/components/audit/UrlForm.tsx apps/web/app/audit/[id]/AuditView.tsx apps/web/app/login/page.tsx apps/web/components/share/SharePanel.tsx apps/web/components/billing/ActivatingPro.tsx
git commit -m "feat(web): instrument the seven launch funnel events"
```

### Task 2.4: Sentry `onRequestError` + webhook-signature-failure signal

**Files:** Modify `apps/web/instrumentation.ts`, `apps/web/app/api/webhooks/stripe/route.ts`.

- [ ] **Step 1: Capture request errors** — `apps/web/instrumentation.ts`:

```ts
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.server.config');
  }
}

// Reports uncaught errors from nested React Server Components / route handlers (the 5xx signal).
export const onRequestError = Sentry.captureRequestError;
```

- [ ] **Step 2: Tag the webhook signature-failure signal** — in `app/api/webhooks/stripe/route.ts`, inside the `catch (err)` for `constructEvent` (before the 400 return):

```ts
    Sentry.captureMessage('stripe.webhook.signature_failed', {
      level: 'warning',
      tags: { signal: 'stripe-webhook-sig-fail' },
    });
```
Add `import * as Sentry from '@sentry/nextjs';` at the top.

- [ ] **Step 3: Verify gates + a forced-error smoke note**

Run: `pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: tsc 0, lint clean. (Live "forced error reaches Sentry with the right tag" is asserted in Phase 7 against the real DSN.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/instrumentation.ts apps/web/app/api/webhooks/stripe/route.ts
git commit -m "feat(web): Sentry onRequestError + webhook signature-failure signal"
```

### Phase 2 Gate

- [x] §4 gate. Test-quality lens checks: each funnel event fires exactly once with correct props (assert via the pure helpers + a captured-events mock in a focused test if added); sampling deterministic; no PII in replay (maskAllInputs). Runbook items (alert rules, sourcemaps, prod reverse-proxy host) recorded in the deploy runbook — NOT done here. Controller pushes. — **DONE: converged ROUND 1 9/9/9/9 (0 blocking); tsc 0, lint clean, web vitest 137/137, `next build` exit 0; committed `1c21e24..ece079e` + plan-doc, pushed origin/main.**

---

## Phase 3 — Cost controls #1/#2 + hard billing caps [code] + [runbook]

Page caps (#1) and IP/domain rate limits (#2) already exist — lock them with regression tests and add a **global daily audit ceiling** backstop. Dashboard spend caps + the ≤18%-MRR cost model are runbook + doc.

### Task 3.1: Global daily audit-concurrency ceiling

**Why:** A backstop so total audit volume across all users can't blow past the cost envelope even if per-IP/domain limits are individually evaded.

**Files:**
- Modify: `apps/web/lib/limits.ts` (add `GLOBAL_AUDITS_PER_DAY`)
- Modify: `apps/web/app/api/audits/start/route.ts` (enforce it)
- Create: `apps/web/lib/limits.test.ts` (assert the constants are present + sane — regression lock)

- [x] **Step 1: Add the constant** — in `apps/web/lib/limits.ts`, under the rate-limit levers:

```ts
// Global backstop: a hard ceiling on total audits started per day across ALL callers. Sized well
// above expected launch volume; trips only on a platform-wide abuse spike. (18%-MRR guard.)
export const GLOBAL_AUDITS_PER_DAY = 5000;
```

- [x] **Step 2: Regression-lock test** — `apps/web/lib/limits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  FREE_PAGE_CAP, PRO_PAGE_CAP, FREE_CONCURRENCY, PRO_CONCURRENCY,
  IP_AUDITS_PER_DAY_ANON, IP_AUDITS_PER_DAY_USER, DOMAIN_AUDITS_PER_HOUR,
  GLOBAL_AUDITS_PER_DAY, isPassingScore, PASSING_SCORE,
} from './limits';

describe('cost-control levers (regression lock)', () => {
  it('page caps and concurrency hold their tuned values', () => {
    expect(FREE_PAGE_CAP).toBe(500);
    expect(PRO_PAGE_CAP).toBe(2000);
    expect(FREE_CONCURRENCY).toBe(1);
    expect(PRO_CONCURRENCY).toBe(8);
  });
  it('rate limits are ordered free < user and a global ceiling exists', () => {
    expect(IP_AUDITS_PER_DAY_ANON).toBeLessThan(IP_AUDITS_PER_DAY_USER);
    expect(DOMAIN_AUDITS_PER_HOUR).toBe(1);
    expect(GLOBAL_AUDITS_PER_DAY).toBeGreaterThan(IP_AUDITS_PER_DAY_USER);
  });
  it('passing boundary matches the engine grade boundary (>=60)', () => {
    expect(PASSING_SCORE).toBe(60);
    expect(isPassingScore(60)).toBe(true);
    expect(isPassingScore(59)).toBe(false);
    expect(isPassingScore(null)).toBe(false);
  });
});
```

- [x] **Step 3: Run to verify it passes** (constant already added)

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/limits.test.ts`
Expected: PASS.

- [x] **Step 4: Enforce in the start route** — `apps/web/app/api/audits/start/route.ts`. Import `GLOBAL_AUDITS_PER_DAY`, and after URL validation but before the per-domain/per-IP checks add a global bucket (fails open like the others, by design):

```ts
import { GLOBAL_AUDITS_PER_DAY } from '@/lib/limits';
// ... after validateUrlOrThrow, before the domain check:
  const globalCheck = await checkRateLimit('global:audits:day', GLOBAL_AUDITS_PER_DAY, TWENTY_FOUR_HOURS_MS);
  if (!globalCheck.allowed) {
    return NextResponse.json({ error: 'We’re at capacity right now — please try again tomorrow.' }, { status: 503 });
  }
```

- [x] **Step 5: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec vitest run lib/limits.test.ts && pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: PASS, tsc 0, lint clean.

- [x] **Step 6: Commit**

```bash
git add apps/web/lib/limits.ts apps/web/lib/limits.test.ts apps/web/app/api/audits/start/route.ts
git commit -m "feat(web): global daily audit ceiling backstop + cost-lever regression lock"
```

### Task 3.2: Cost-model doc (≤18% MRR)

**Files:** Create `docs/ops/2026-06-03-cost-model.md`.

- [x] **Step 1:** Write `docs/ops/2026-06-03-cost-model.md` mapping each lever to the 18%-of-MRR ceiling. Required sections (real numbers, cite current vendor pricing pages at execution): per-audit unit cost (Vercel function-GBs + Supabase egress/storage + Inngest steps); the seven dashboard hard caps to set (**Stripe** billing alerts, **Supabase** spend cap, **Vercel** spend management, **Inngest** concurrency limit, **Resend** monthly cap, **Sentry** quota, **PostHog** billing limit) each with the exact value + where to set it; a worked example at 100 / 1,000 / 10,000 MRR showing ops cost stays ≤18%; and how the code levers (`FREE_PAGE_CAP`, `GLOBAL_AUDITS_PER_DAY`, concurrency, TTL, sampling) feed the model. Mark dashboard-setting rows **[runbook]**.

- [x] **Step 2: Commit**

```bash
git add docs/ops/2026-06-03-cost-model.md
git commit -m "docs(ops): ≤18%-MRR cost model + dashboard hard-cap targets"
```

### Phase 3 Gate

- [x] §4 gate (focus: the global ceiling can't lock out legitimate launch traffic; fails open on RPC error like the other buckets; doc numbers are sourced). Controller pushes. Dashboard caps themselves are applied in the deploy runbook. — **DONE: converged ROUND 2 9/9/9/9 (R1 9/9/9/8·8/9/9/8·9/9/9/8, 3 blocking on the test-quality lens → fixed; R2 all three reviewers 9/9/9/9, 0 blocking). Controller-verified gates: limits test 3/3, full web vitest 137→140, tsc 0, lint clean, `next build` exit 0. Reviewers independently re-derived the doc math (free ≈ $0.0013 / Pro ≈ $0.0029 per audit; ≤18% from ~$1k MRR; backstop worst-case ≈ $435/mo) and confirmed fail-open preserved + the regression test catches value drift (mutation-tested). Committed `a0863b0` (code+test) + `02d937e` (cost-model doc) + plan-doc, pushed origin/main.**

---

## Phase 4 — Auth email robustness [code-authored, runbook-applied]

Author branded, on-brand Supabase Auth email templates whose link uses `token_hash` (cross-device sign-in), committed to the repo and applied in the Supabase dashboard at deploy.

**Files:**
- Create: `infra/supabase/email-templates/magic-link.html`
- Create: `infra/supabase/email-templates/signup.html`
- Create: `infra/supabase/email-templates/README.md` (apply instructions → runbook)
- Create: `infra/supabase/email-templates/templates.test.ts` (+ wire into a vitest project, see step 4)

- [x] **Step 1: Magic-link template** — `infra/supabase/email-templates/magic-link.html`. Branded HTML (cream bg `#FBF7F0`, ink text, peach accent, Fraunces-ish system serif stack for the wordmark), inline CSS only (email clients strip `<style>`), with the critical link:

```html
<a href="{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink" ...>Sign in to Crawlmouse</a>
```
Include: preheader, the 🐭 wordmark, a one-line "you requested a sign-in link", the button, a plaintext fallback URL, "expires in 10 minutes / ignore if you didn't request this", and a footer with the support address. No tracking pixels.

- [x] **Step 2: Signup template** — `infra/supabase/email-templates/signup.html`. Same shell, link `...&type=signup`, copy "confirm your email to finish creating your Crawlmouse account."

- [x] **Step 3: Apply instructions** — `infra/supabase/email-templates/README.md`: exact Supabase dashboard path (Authentication → Email Templates → Magic Link / Confirm signup), paste-the-HTML steps, and the **deploy-gate warning** that the DEFAULT template emits a PKCE `?code=` link → cross-device sign-in is broken until replaced. Mark **[runbook]**.

- [x] **Step 4: Determinism test** — `infra/supabase/email-templates/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('Supabase auth email templates', () => {
  it('magic-link uses the token_hash verify URL with type=magiclink', () => {
    const html = read('magic-link.html');
    expect(html).toContain('{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink');
    expect(html).not.toContain('{{ .ConfirmationURL }}'); // the default PKCE link must NOT be used
  });
  it('signup uses type=signup', () => {
    expect(read('signup.html')).toContain('token_hash={{ .TokenHash }}&type=signup');
  });
  it('both are self-contained (no <style> blocks, which email clients strip)', () => {
    for (const f of ['magic-link.html', 'signup.html']) expect(read(f)).not.toMatch(/<style[\s>]/i);
  });
});
```

This test must be picked up by a Vitest run. Add a root-level test invocation: in the **root** `package.json` add a script `"test:templates": "vitest run infra/supabase/email-templates"` (root already has vitest available via the workspace; if not, run it under `apps/web`'s vitest by placing the test path explicitly). Verify the chosen runner resolves `node:fs`/`node:path` (Node env).

- [x] **Step 5: Run the test**

Run: `nvm use && pnpm exec vitest run infra/supabase/email-templates/templates.test.ts`
Expected: PASS. The `type=magiclink` allow-list already exists in `app/login/verify/route.ts` (verified), so these links complete sign-in cross-device.

- [x] **Step 6: Commit**

```bash
git add infra/supabase/email-templates/ package.json
git commit -m "feat(auth): branded token_hash magic-link + signup email templates"
```

### Phase 4 Gate

- [x] §4 gate (focus: link format exactly matches `app/login/verify/route.ts`'s `verifyOtp(token_hash,type)` allow-list; renders in an email-client preview — do a Litmus/inbox preview at execution and capture a screenshot to `evidence/`). Controller pushes. Dashboard application is a deploy-runbook step. — **DONE (code gate): converged ROUND 1 at 10/10/10/10 across all three Opus reviewers, 0 blocking; controller-verified gates `pnpm test:templates` 9/9, apps/web tsc 0, lint clean (no `apps/web` source changed → `next build` unaffected). Committed `ce3d221` (templates+test+runner wiring) + `6d91274` (README runbook). Allow-list re-confirmed: `ALLOWED_OTP_TYPES = {magiclink, signup, email}`. Runner note: `infra/` is not a workspace pkg, so `vitest.config.ts` exports a plain object (no `vitest/config` import — would `ERR_MODULE_NOT_FOUND` since vitest only lives under `apps/web`); root `test:templates` drives apps/web's vitest binary at the pinned config root. FINALIZED: email-client preview SCREENSHOTs captured to `evidence/email-preview-{magic-link,signup}.png` (headless-Chromium render — both on-brand, correct `token_hash`/`type` links; a true Gmail/Outlook send-test is optional polish). `support@crawlmouse.com` confirmed LIVE+verified via Cloudflare Email Routing (forwards → `nahlai.tech@gmail.com`).**

---

## Phase 5 — Legal + content pages [code] — ✅ COMPLETE

Real Privacy/Terms/AUP copy, new /subprocessors, /developers waitlist, /status. All on-brand, no placeholders.

> **Done 2026-06-03** — converged ROUND 2 at **9/9/9/9** (0 blocking). Code `f1acab1..a55697a`. Controller gates: tsc 0 · `next lint` clean · web vitest **151/151** (140→+11) · `next build` exit 0 (all of `/privacy /terms /aup /subprocessors /status /developers /api/developers` in the route table). Migration applied + registered via Supabase MCP `apply_migration` (`20260603184443/waitlist`); live schema matches the committed `.sql` (RLS deny-all, anon/authenticated grants revoked, functional unique index `(lower(email), source)`, 0 rows); security `get_advisors` → no new findings (only the pre-accepted passwordless WARN). Idempotency = plain `.insert()` + 23505-as-success (NOT `.upsert(onConflict)` — PostgREST can't target the functional index); waitlist Turnstile is **always-on** when configured; no email enumeration (dup and fresh both return `{ok:true}`). **Counsel follow-ups (behind the founder-draft banner):** confirm governing law (drafted Delaware, US) + legal entity name ("Nahl Technologies Inc, operator of Crawlmouse"); confirm each subprocessor's published region matches the prod-selected region (Resend/PostHog default EU unless configured); execute the 8 subprocessor DPAs; ensure `privacy@`/`abuse@`/`takedown@` forward before launch.

**Research note:** ground every legal claim in the actual stack/data-flows (Supabase, Stripe, Resend, Cloudflare, Vercel, PostHog, Sentry, Inngest) and current GDPR/CCPA norms for a seed-stage SaaS; cite sources. Add the visible "founder draft pending counsel review" banner.

### Task 5.1: Founder-draft banner + real Privacy / Terms / AUP

**Files:**
- Create: `apps/web/components/legal/DraftBanner.tsx`
- Modify: `apps/web/app/privacy/page.tsx`, `apps/web/app/terms/page.tsx`, `apps/web/app/aup/page.tsx`

- [ ] **Step 1: Banner** — `apps/web/components/legal/DraftBanner.tsx`:

```tsx
export function DraftBanner() {
  return (
    <div className="not-prose mb-8 rounded-xl border border-peach/40 bg-peach/10 px-4 py-3 text-sm text-ink/80">
      <strong className="font-semibold">Founder draft.</strong> This document is accurate to our
      current practices but is pending review by counsel. Questions? <a className="underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
    </div>
  );
}
```

- [ ] **Step 2: Privacy** — rewrite `apps/web/app/privacy/page.tsx` using `<LegalPage title="Privacy Policy">` with `<DraftBanner />` first, then real sections: **Last updated 2026-06-03**; Data we collect (email for magic-link auth; submitted URLs + resulting public structural audit data; Stripe-held billing data — we never see card numbers; product analytics via PostHog; error telemetry via Sentry); Legal bases (GDPR Art.6: contract, legitimate interest, consent for analytics); Sub-processors (link to `/subprocessors`); Cookies/*similar tech* (auth cookie + PostHog; error-only replay with masked inputs); Data retention (free audits auto-delete after 30 days; account data until deletion); International transfers (US-hosted; SCCs where applicable); Your rights (access/export/delete; GDPR + CCPA "do not sell — we don't sell"; 30-day SLA); How to exercise them (dashboard + privacy@); Children (not for under-16s); Changes; Contact. Plain language.

- [ ] **Step 3: Terms** — rewrite `apps/web/app/terms/page.tsx`: banner + Last updated; Acceptance; The service (free + Pro $19/mo·$190/yr); Accounts (magic-link, you're responsible for your inbox); Acceptable use (link `/aup`); **You may only publish public reports for domains you've verified you own**; Billing (Stripe, auto-renew, cancel anytime via portal, no refunds for partial periods except where required by law); Intellectual property (you keep your data; we own the product); Disclaimers (audit is informational, "as is", no SEO-ranking guarantee); Limitation of liability (cap at fees paid in prior 12 months); Indemnity; Termination; Governing law (Delaware / your incorporating jurisdiction — confirm at execution); Changes; Contact.

- [ ] **Step 4: AUP** — rewrite `apps/web/app/aup/page.tsx`: banner + Last updated; Prohibited (auditing sites you don't own to attack them; bypassing rate limits/Turnstile; submitting non-HTTP or internal/again-SSRF targets; reselling/scraping the service; publishing reports for domains you don't own; abuse/harassment via the takedown form); Crawler etiquette we follow (link `/bot`); Enforcement (throttle, suspend, remove reports); Reporting abuse (abuse@crawlmouse.com).

- [ ] **Step 5: Verify gates**

Run: `pnpm --filter @crawlmouse/web exec tsc --noEmit && pnpm --filter @crawlmouse/web exec next lint`
Expected: tsc 0, lint clean. Grep for "placeholder"/"lorem"/"Replace with" across the three files → zero hits.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/legal/DraftBanner.tsx apps/web/app/privacy/page.tsx apps/web/app/terms/page.tsx apps/web/app/aup/page.tsx
git commit -m "feat(web): real Privacy / Terms / AUP copy with founder-draft banner"
```

### Task 5.2: /subprocessors page

**Files:** Create `apps/web/app/subprocessors/page.tsx`.

- [ ] **Step 1:** Build `apps/web/app/subprocessors/page.tsx` using `<LegalPage title="Subprocessors">` + `<DraftBanner />` + a disclosure table (`Card`-wrapped, responsive). One row each — **Subprocessor · Purpose · Data · Region** — for: Supabase (DB/auth, account+audit data, US), Stripe (payments, billing identifiers, US/global), Resend (transactional email, email address, US), Cloudflare (Turnstile + DNS/CDN, IP + challenge token, global edge), Vercel (hosting, request metadata, US/global edge), PostHog (product analytics, usage events + masked replay, US), Sentry (error telemetry, error context, US), Inngest (background jobs, audit job metadata, US). Add "Last updated 2026-06-03" and a line: changes announced 30 days in advance via this page.

- [ ] **Step 2: Verify gates** — tsc 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/subprocessors/page.tsx
git commit -m "feat(web): /subprocessors disclosure page"
```

### Task 5.3: Waitlist table (migration)

**Files:** Create `infra/supabase/migrations/20260603000014_waitlist.sql`; apply via Supabase MCP `apply_migration`.

- [ ] **Step 1: Write the migration** — `infra/supabase/migrations/20260603000014_waitlist.sql`:

```sql
-- Developer-waitlist signups for the v1.2 CLI/GitHub Action pre-announce. Service-role writes
-- only (the /api/developers route, like takedown); no client RLS access.
create table waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'developers',
  created_at timestamptz not null default now()
);
-- One signup per email per source (idempotent re-submit).
create unique index waitlist_email_source_uniq on waitlist (lower(email), source);

alter table waitlist enable row level security;
create policy waitlist_deny_client on waitlist for all using (false) with check (false);
```

- [ ] **Step 2: Apply** — call Supabase MCP `apply_migration` (project `ezspnfeyzwsisymytssm`, name `waitlist`, the SQL above). Then `list_migrations` to confirm it's registered, and `get_advisors` (security) → no new findings.

- [ ] **Step 3: Commit**

```bash
git add infra/supabase/migrations/20260603000014_waitlist.sql
git commit -m "feat(db): waitlist table (service-role only) for the developer pre-announce"
```

### Task 5.4: /developers waitlist (route + page + form)

**Files:**
- Modify: `apps/web/lib/limits.ts` (add `WAITLIST_PER_IP_PER_DAY`)
- Create: `apps/web/app/api/developers/route.ts`
- Create: `apps/web/app/developers/page.tsx`
- Create: `apps/web/components/developers/WaitlistForm.tsx`

- [ ] **Step 1: Limit constant** — in `apps/web/lib/limits.ts`:

```ts
export const WAITLIST_PER_IP_PER_DAY = 5; // developer-waitlist signups per IP
```

- [ ] **Step 2: API route** — `apps/web/app/api/developers/route.ts` (mirrors the takedown route's Turnstile + rate-limit + service-role insert pattern):

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { WAITLIST_PER_IP_PER_DAY } from '@/lib/limits';

export const runtime = 'nodejs';
const schema = z.object({ email: z.string().email().max(320), turnstileToken: z.string().optional() });
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  const ip = getClientIp(req);
  if (ip !== 'unknown') {
    const rl = await checkRateLimit(`waitlist:ip:${ip}`, WAITLIST_PER_IP_PER_DAY, DAY_MS);
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (process.env.TURNSTILE_SECRET_KEY) {
    const ok = parsed.data.turnstileToken ? await verifyTurnstileToken(parsed.data.turnstileToken, ip) : false;
    if (!ok) return NextResponse.json({ error: 'captcha_failed' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  // Idempotent on (lower(email), source): a repeat signup is a success, not a 500.
  const { error } = await sb
    .from('waitlist')
    .upsert({ email: parsed.data.email.toLowerCase(), source: 'developers' }, { onConflict: 'email,source', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: 'could not submit' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

> Note: confirm the unique index expression `lower(email), source` matches the `onConflict` target; if PostgREST rejects the functional-index conflict target, switch the insert to a plain `.insert(...)` and treat error code `23505` as success (idempotent), as `reports/mint` does.

- [ ] **Step 3: Form** — `apps/web/components/developers/WaitlistForm.tsx`: client form (email `Input` + `Button` + `<Turnstile>` always-on like Task 1.3), POST `/api/developers`, success → "You're on the list 🐭", maps `rate_limited`/`captcha_failed`/`invalid input` to friendly copy, resets the widget on `!res.ok`.

- [ ] **Step 4: Page** — `apps/web/app/developers/page.tsx`: `Header` + on-brand hero — "Crawlmouse for developers", "CLI + GitHub Action + agentic webhooks on the same engine. **Coming Q3 2026.**", a few bullet teasers, `<WaitlistForm />` — + `Footer`. Distinctive, playful.

- [ ] **Step 5: Verify gates** — tsc 0, lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/limits.ts apps/web/app/api/developers/route.ts apps/web/app/developers/page.tsx apps/web/components/developers/WaitlistForm.tsx
git commit -m "feat(web): /developers waitlist (Turnstile-gated, rate-limited)"
```

### Task 5.5: /status page

**Files:** Create `apps/web/app/status/page.tsx`.

- [ ] **Step 1:** Build a distinctive static `apps/web/app/status/page.tsx` — `Header`/`Footer`, an "All systems nominal 🐭" hero, a static component list (Web app, Crawler, Billing, Email) each with a green pill, and a note that real-time status moves to `status.crawlmouse.com` at deploy. No external calls (static; safe to deploy immediately).

- [ ] **Step 2: Verify gates** — tsc 0, lint clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/status/page.tsx
git commit -m "feat(web): static /status page"
```

### Task 5.6: Footer links for the new pages

**Files:** Modify `apps/web/components/layout/Footer.tsx`.

- [ ] **Step 1:** In the "For developers" column, replace the inert `<span>CLI + GitHub Action</span>` with `<Link href={r('/developers')} ...>CLI + GitHub Action</Link>`. In the "Legal" column add `<Link href={r('/subprocessors')} ...>Subprocessors</Link>`. Add a "Company" or "Product" link to `/status`. Keep `r()` helper usage so typedRoutes is satisfied (the new routes exist after Tasks 5.2/5.4/5.5).

- [ ] **Step 2: Verify gates** — tsc 0 (typedRoutes now resolves the new paths), lint clean. Manually confirm every Footer link resolves to a real route.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/layout/Footer.tsx
git commit -m "feat(web): link new developers/subprocessors/status pages in the footer"
```

### Phase 5 Gate

- [x] §4 gate (focus: no placeholder/lorem anywhere; every internal link resolves; legal claims match the real stack; waitlist insert is idempotent, rate-limited, captcha-gated; security lens checks the waitlist route can't be used to enumerate or spam). **PASSED** — 9/9/9/9 round 2, 0 blocking; placeholder guard mutation-verified; every Footer + page link resolves to a real route; waitlist confirmed idempotent (23505→ok)/per-IP-rate-limited/always-on-Turnstile/non-enumerable on the live DB. Controller pushed.

---

## Phase 6 — Load test harness (k6) [code-authored, runbook-run] — ✅ COMPLETE

Author the k6 scripts now; the full ~1000-VU run executes against an isolated staging target at deploy (never prod).

**Files:**
- Create: `tests/load/audit-submit.js` (k6 script)
- Create: `tests/load/smoke.js` (low-VU sanity)
- Create: `tests/load/README.md` (staging-target setup + how to run)

- [x] **Step 1: Smoke script** — `tests/load/smoke.js`: 1–2 VUs, hits `GET ${BASE_URL}/` and `GET ${BASE_URL}/status`, asserts 200 + p95 < 800ms. Reads `BASE_URL` from `__ENV.BASE_URL`.

- [x] **Step 2: Ramp script** — `tests/load/audit-submit.js`:

```js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errors = new Rate('errors');
const BASE = __ENV.BASE_URL;          // staging Vercel preview URL — NEVER prod
const TURNSTILE = __ENV.TURNSTILE_TEST_TOKEN || ''; // Cloudflare test token for staging

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '3m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post(`${BASE}/api/audits/start`,
    JSON.stringify({ url: `https://example-${__VU}-${__ITER}.test`, turnstileToken: TURNSTILE }),
    { headers: { 'Content-Type': 'application/json' } });
  // Accept 200 (created) and 429 (rate-limited) as expected outcomes under load; 5xx = failure.
  check(res, { 'not a server error': (r) => r.status < 500 });
  errors.add(res.status >= 500);
  sleep(Math.random() * 3 + 1); // realistic think-time 1–4s
}
```

- [x] **Step 3: Setup doc** — `tests/load/README.md`: the **staging-only** rule (loud), how to create the target (Vercel preview deploy on a Supabase **branch** DB + Stripe **test** keys + a Cloudflare Turnstile **testing** site/secret key that always passes), the `k6 run -e BASE_URL=... -e TURNSTILE_TEST_TOKEN=... tests/load/audit-submit.js` command, what thresholds mean, and where to drop the run output in `evidence/`.

- [x] **Step 4: Local sanity**

Run: `k6 run -e BASE_URL=http://localhost:3000 tests/load/smoke.js` (against a local `pnpm dev`).
Expected: script executes, thresholds reported. (If k6 isn't installed locally, document `brew install k6` / the binary; the 1000-VU run is deferred to staging regardless.) — k6 NOT installed on this Linux box, so per the plan the run is documented (README §Installing k6 covers macOS/Linux/binary) and deferred to staging; `node --check` on both scripts (exit 0) is the deterministic local syntax substitute.

- [x] **Step 5: Commit**

```bash
git add tests/load/
git commit -m "test(load): k6 harness for the audit-submit path + staging setup doc"
```

### Phase 6 Gate

- [x] §4 gate (focus: script never targets prod; thresholds defined; think-times realistic; no silent cap — README states the 1000-VU run is staging-deferred). Controller pushes.

> Done 2026-06-03 (code commits `b1d733c`..`1ad57ff` + this plan-doc commit). Workflow `plan5-phase6`: 1 TDD implementer → 3 adversarial Opus reviewers × 4 lenses, **3 rounds**. By round 3 reviewers 1 & 3 were 10/9/10/9 and 10/10/10/9 (0 blocking); reviewer 2 was 9/10/9/**7** with **one** blocking finding the controller then closed (see below) → effective **9/9/9/9, 0 blocking**. Controller-verified gates: `node --check` both k6 scripts (exit 0), apps/web `pnpm typecheck` 0, `next lint` clean, web vitest **156/156** across 30 files (151 → +5 from the new guard suite). **Shipped:** `tests/load/smoke.js` (2-VU sanity hitting `GET /` and `GET /status`, `=== 200` on both, `http_req_duration: ['p(95)<800']` + `checks: ['rate>0.99']`, `sleep(1)` think-time, fail-fast throw if `__ENV.BASE_URL` is unset); `tests/load/audit-submit.js` (verified `ramping-vus` 0→200→1000→1000→0 against `POST /api/audits/start` with the exact `{url, turnstileToken}` body, `errors` Rate fed by `res.status >= 500`, `check` pass-condition `r.status < 500`, 1–4s think-time, same fail-fast BASE guard); `tests/load/README.md` (loud STAGING-ONLY/never-prod banner, the ~1000-VU run explicitly **deferred** to an isolated staging target at deploy and never CI/local, staging-target build steps + Cloudflare always-pass test keys, k6 install for macOS/Linux/binary, run commands, threshold meanings, the honest mostly-400/429 front-gate expectation, optional real-creation path, and an `evidence/` save convention); and a **mutation-resistant guard** `apps/web/__tests__/load-harness-guard.test.ts` that enforces every harness invariant (BASE strictly `__ENV`-driven with no prod default + fail-fast throw; no `crawlmouse.com`/hardcoded routable host; thresholds/`target: 1000`/`errors.add(>=500)`/`<500` check pinned; README staging-deferral) and fails LOUD (ENOENT) on a deleted file. **Controller fix of the lone blocking finding (reviewer 2, test-quality):** the latency pins used bare `.toContain('p(95)<2000')` / `'p(95)<800'`, so a 10× silent relaxation (`p(95)<20000` / `p(95)<8000`) CONTAINS the bare substring and slipped through; re-pinned to the **full array element** `"http_req_duration: ['p(95)<2000']"` / `"['p(95)<800']"` (consistent with the existing `errors`/`checks` pins), added a `target: 1000` no-silent-cap pin and a smoke `sleep()` assertion. **Mutation-verified by the controller:** the hardened guard now exits 1 on all three harmful mutations (`p(95)<20000`, `p(95)<8000`, `target: 100`) and passes 5/5 when restored byte-identical. **Key facts (carry forward):** `tests/load/` is at the REPO ROOT, outside every workspace package, so `turbo run lint/test/typecheck` + apps/web `next lint`/vitest never touch it — the apps/web guard test is what gives the §4 gate teeth (path `resolve(__dirname,'../../..','tests/load/…')`). k6 is **not installed** here (Linux); the ~1000-VU run is staging-deferred per plan; `node --check` is the deterministic local substitute. **Plan-vs-reality deltas confirmed:** (a) a Turnstile TEST secret (`1x000…AA`) only accepts the dummy token `XXXX.DUMMY.TOKEN.XXXX` at siteverify (NOT "any non-empty token" as the brief assumed), so the README pins `-e TURNSTILE_TEST_TOKEN=XXXX.DUMMY.TOKEN.XXXX`; (b) in `/api/audits/start`, `validateUrlOrThrow` (400) runs BEFORE the rate-limit buckets and Turnstile is only verified once the per-IP daily bucket is exhausted, so a synthetic `.test` ramp is mostly 400→429, not a captcha path — the README documents this honestly. **Non-blocking note (reviewer 3):** the guard can flash red under extreme concurrent-vitest OOM pressure (an artifact of reviewers running ~20 vitest instances at once); the real single-run CI path is deterministically green (30 files/156 tests) — no action.

---

## Phase 7 — Rigorous pre-launch verification [verification]

Author a Plan-5 verification test plan, score it ≥9 on all four lenses (coverage / objectivity / negative-&-security / repeatability-&-safety), then execute guided-live. Closes the deferred legs.

### Task 7.1: Author + score the verification test plan

**Files:** Create `docs/qa/2026-06-03-plan-5-launch-verification-plan.md`.

- [ ] **Step 1:** Write the test plan with deterministic, evidence-backed TCs covering, at minimum:
  - **Phase 0:** reconcile dry-run writes nothing (drive the cron + assert DB read-only via Supabase MCP); manual `billing.reconcile.requested` full-run repairs a seeded drift; livemode-mismatch refusal; batched TTL delete removes exactly the expired set (seed N+ expired rows, run, assert count + termination); **0B** AuditView no 0/0 flash (Playwright: throttle the stream, assert skeleton → real numbers, never `0 orphan pages` mid-flight); **0C** OG-purge (process a takedown via the admin route, assert the OG route + page return the placeholder on the next request).
  - **Phase 1:** funnel friction-free below the IP limit; widget appears on `captcha_required`; magic-link/takedown/waitlist reject absent/invalid token (negative); token never trusted without server verify.
  - **Phase 2:** each of the 7 funnel events fires exactly once with correct props (capture against a PostHog debug/local sink); forced 5xx reaches Sentry tagged; webhook sig-fail emits the tagged Sentry signal; sampling drops autocapture, keeps funnel events.
  - **Phase 3:** per-IP/domain/page-cap regressions; global ceiling trips at the limit (unit/integration), fails open on RPC error.
  - **Phase 4:** admin-minted `token_hash` link completes sign-in **cross-device**; email-client render screenshot.
  - **Phase 5:** every page renders with no placeholder; all links resolve; waitlist idempotent + rate-limited + captcha-gated; **G1** findings-cap live SSE (free viewer capped at 5, Pro full) against a **findings-rich multi-page** test site; **Plan-2 anon-funnel** browser smoke (anon audit → claim-on-signup).
  - **Phase 6:** smoke script passes at low VU.
  - **Seed** the 10 reference benchmark audits (record their ids in `evidence/`).
  - Each TC: id, preconditions, exact steps/commands, expected, evidence path. Safety: all DB asserts read-only via Supabase MCP; destructive ops scoped by id; crons exercised in dry-run/seeded scopes only.

- [ ] **Step 2: Score the plan** — run 3 adversarial Opus reviewers on the four plan lenses (coverage / objectivity / negative-&-security / repeatability-&-safety); fix; re-review until each ≥9/10. Record scores in the doc header.

- [ ] **Step 3: Commit**

```bash
git add docs/qa/2026-06-03-plan-5-launch-verification-plan.md
git commit -m "docs(qa): Plan-5 launch verification plan (scored >=9 on four lenses)"
```

### Task 7.2: Execute the verification guided-live — ✅ EXECUTED (2026-06-06, RUN=202606051141 + 202606052356)

> **Result: guided-live execution COMPLETE.** Evidence under `evidence/plan-5/` (TC-*.txt, frame logs, email PNGs, `RESULTS-scoring.txt`, `benchmarks.md`, `manifest.env`, `SAFETY-cron-autofire.txt`). Four-lens RESULT score **9/9/9/9**. Every critical security/billing/abuse/auth path confirmed **live** or by a **sanctioned deterministic backstop**; TC-P1 gate re-run GREEN (tsc 0, web 32 files/166, inngest 3/37, k6 node-check). PROD never destructively mutated; all test data id/key-scoped-cleaned (§C); `.env.local` restored byte-identical.
>
> **2 launch deploy-gate FINDINGS surfaced (the verification's value) — fix before launch:**
> - **#1 MAJOR (launch-relevant):** large-site audits exceed the **Inngest step-output limit** — the audit fn returns the whole crawl result from `step.run('run-engine')` and passes it to `step.run('persist-results')` (`inngest/audit.ts:35-52`); a deep crawl near the 500-page free cap exceeds the step-output cap → the audit ends `failed`. Free users can trigger 500-page crawls on real large sites, so the **core audit feature may fail for large sites in prod**. Fix: persist inside the run-engine step / batch-insert incrementally; re-run a deep crawl end-to-end. (Engine crawl/grade logic is correct + green — persistence plumbing only.)
> - **#2 MINOR:** reconcile spurious `wouldRepair` — `runReconcile` compares `pro_until` as **strings** (`billing-helpers.ts:170`); DB `…+00:00` vs computed `…000Z` (same instant) → every active subscriber looks "drifted". Fix: compare by instant (`getTime()`).
>
> **Deviations from the plan (all honest, no silent skips):** (a) the **findings-rich SSE cap-bite** (shown=5/hidden=N-5) is **covered-by-A11** — no >5-findings prod audit is obtainable (the crawler is conservative + the step-output limit (#1) blocks deep crawls) AND the DEVBRANCH fallback is **infeasible** (Supabase branching needs the Pro plan ~$25/mo; user declined → chose deterministic coverage). The L13 **security gate** (Pro-owner-only, cross-tenant denial, no `user_id` on the wire) IS live; Pro was seeded via the **live Stripe-test checkout→webhook** path. (b) **L8** exactly-once is **covered-by-A9** — the funnel was driven live through every call site, but PostHog ingestion does not flush under headless automation. (c) **L2/L3/L5pt2/L7d-a** (branch window) → **covered-by-A2/A4/A6/route-structure** (branch infeasible) + live adjuncts. (d) **S1**: seeded 10/10 via the real path; the literal deep-site benchmark is env-blocked by finding #1.

- [x] **Step 1:** Execute every critical TC guided-live. Capture evidence under `evidence/plan-5/` (command output, screenshots, MCP read results). For the findings-rich SSE leg, use a real multi-page site that produces findings (so the free-cap-at-5 vs Pro-full split is observable on a live stream). *(Done; the live cap-bite is covered-by-A11 — see deviations above.)*
- [ ] **Step 2:** For any failure, fix TDD-style under the §4 gate (3 reviewers → verify → fix → re-review ≥9), commit, re-run the TC.
- [ ] **Step 3:** Seed the 10 reference benchmark audits; record ids + grades in `evidence/plan-5/benchmarks.md`.
- [ ] **Step 4:** Update memory `project_build_state_v1.md` + write `handoff009.md` summarizing Plan-5 completion, the result scores, and the remaining deploy-runbook steps.
- [ ] **Step 5: Commit**

```bash
git add evidence/plan-5/ handoff009.md
git commit -m "docs(qa): Plan-5 verification evidence + launch-readiness handoff"
```

### Phase 7 Gate — ✅ MET (verification), with 2 deploy-gate findings

- [x] Every critical TC passes **live or by a sanctioned deterministic backstop**; result score **9/9/9/9**; evidence captured (`evidence/plan-5/`). TC-P1 gate GREEN. **Plan 5 guided-live verification is COMPLETE.** The actual launch is gated on the **2 findings above** (fix #1 MAJOR + #2 MINOR as fix-PRs) plus the §D deploy-gates, then the R.1 runbook. Handoff: `handoff010.md`.

---

## Deploy runbook authoring (bridges to step 4)

### Task R.1: Write the deploy runbook

**Files:** Create `docs/deploy/launch-runbook.md`.

- [x] **Step 1:** Author the ordered runbook (each step with a verify-before-next gate), per spec §6: *(Done — `docs/deploy/launch-runbook.md`, 9 gated stages incl. a Stage-0 PRE-LAUNCH FIX-GATES section folding in the 2 verification findings + the §D deploy-gates.)*
  Vercel Pro → set all prod env vars incl. **LIVE Stripe keys** (the full set in `.env.local.example` + `STRIPE_RECONCILE_LIVEMODE=true` + `ADMIN_SECRET`) → point `crawlmouse.com` DNS at Vercel via Cloudflare (A/AAAA/CNAME www) → register **LIVE Stripe webhook** + **Resend webhook** (set `RESEND_WEBHOOK_SECRET`) → apply Supabase prod email templates (Phase 4 HTML) → Sentry release + sourcemaps + the 3 alert rules (5xx rate, audit-failure rate via PostHog, webhook sig-fail) → PostHog prod project + reverse-proxy host + funnel/insight + the 7 dashboard hard caps (Phase 3 doc) → Inngest prod env connected → **scoped reconcile** (cron auto-runs dry-run; trigger `billing.reconcile.requested` once for a real reconcile, watch the summary) → **Stripe business activation** (fix the "Nahl Tech**hh**nologies Inc" statement-descriptor typo) → **co-founder Stripe access** → seed/verify 10 benchmark audits → **k6 vs staging** (capture evidence) → `/status` domain → final **spec §19.2 checklist** → prod smoke (purchase loop, magic-link cross-device, public share, CSV export). Declare launch-ready only after prod smoke passes.
- [ ] **Step 2: Commit**

```bash
git add docs/deploy/launch-runbook.md
git commit -m "docs(deploy): ordered launch runbook for production cutover"
```

---

## Self-Review (controller runs before execution)

- **Spec coverage:** Phase 0 (0A cron guards / 0B flash / 0C OG-purge / 0D deferred→Phase 7) ✓; Phase 1 Turnstile on all four forms (funnel/magic-link/takedown/waitlist) ✓; Phase 2 PostHog 7 events + reverse-proxy + error-replay + sampling#6 + Sentry onRequestError/signals (alerts→runbook) ✓; Phase 3 #1/#2 regression + global ceiling + cost-model doc + dashboard caps→runbook ✓; Phase 4 token_hash branded templates ✓; Phase 5 privacy/terms/aup + subprocessors + developers-waitlist + status + footer ✓; Phase 6 k6 harness + staging doc ✓; Phase 7 scored verification closing 0D/anon-funnel/OG/flash + 10 benchmarks ✓; deploy runbook authored ✓. The §19.2 four extras (subprocessors, 10 benchmarks, status, error-only replay) are all present.
- **Type consistency:** `track()` is typed to `FunnelEvent`; `FUNNEL_EVENTS` feeds both the tracker and the sampler allow-list; `reportTag(slug)` is the single tag string used by `getPublicReport` + `purgePublicReport` + `processTakedown`; `runReconcile` opts/`ReconcileMode` shared between helper and both inngest fns; `deriveAuditViewState(snapshot, done)` returns the exact booleans AuditView consumes.
- **Placeholder scan:** none — legal/doc tasks explicitly forbid placeholders and add a grep gate.
- **Dependency order:** Footer links (5.6) come after the routes they link exist (5.2/5.4/5.5); typedRoutes will fail tsc otherwise (intentional gate).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-crawlmouse-v1.0-plan-5-launch-readiness.md`.

Execute via **superpowers:subagent-driven-development** (recommended): a fresh Opus-4.8 subagent per task, the §4 per-phase gate (3 adversarial reviewers → controller-verify → TDD fix → re-review ≥9/9/9/9) between logical groups, controller commits + pushes. Phase order is 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → R.1, then the collaborative deploy (step 4).
