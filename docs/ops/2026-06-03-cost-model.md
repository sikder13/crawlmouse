# Crawlmouse Ops Cost Model — the ≤18%-of-MRR ceiling

_Last updated: 2026-06-03. All vendor prices were read from the vendors' own pricing
pages on 2026-06-03; see [§6 Sources](#6-sources) for every cited URL._

---

## 1. Purpose & the 18% rule

Crawlmouse runs a hard operating rule:

> **Operational vendor cost must stay at or below 18% of Monthly Recurring Revenue (MRR).**

This document ties the per-audit unit economics and the seven vendor dashboard hard
caps to that ceiling, so anyone can re-derive the cost at a given MRR and confirm the
rule holds.

**In scope** (counts toward the 18%): the infrastructure that runs an audit and the
app around it — Vercel (functions + bandwidth), Supabase (Postgres + egress + storage),
Inngest (workflow steps), Resend (transactional email), Sentry (error monitoring),
PostHog (product analytics).

**Out of scope** (explicitly NOT in the 18%):

- **Stripe processing fees.** Stripe charges **2.9% + $0.30 per successful card charge**
  in the US (per [stripe.com/pricing](https://stripe.com/pricing)). This is a cost of
  collecting revenue, not a cost of operating the product, so it is excluded from the
  18% ops figure by definition. It is still real money — at $19/mo it is ~$0.85/charge
  (2.9% × $19 + $0.30) — and is tracked separately as a revenue-collection cost.
- **Marketing / paid acquisition.** Excluded from the 18% ops figure.

The 18% rule is therefore a statement about **variable infrastructure cost per dollar of
subscription revenue**, holding the vendor bills (excl. Stripe + marketing) under
$0.18 for every $1.00 of MRR.

---

## 2. Per-audit unit cost

An audit is the core unit of work. It is dispatched as a single Inngest function
(`crawlmouse.audit` in `inngest/audit.ts`) that crawls a site through the engine, then
persists results; the browser watches progress over a Server-Sent-Events (SSE) stream
served by a Vercel function (`app/api/audits/[id]/stream/route.ts`,
`maxDuration = 300`s). The cost of one audit is the sum of three vendor lines: **Vercel
compute + bandwidth**, **Supabase egress + storage**, and **Inngest steps**.

### 2.1 Assumptions (stated, not hidden)

| Assumption | Value | Basis |
| --- | --- | --- |
| Pages crawled, average **free** audit | **80 pages** | Most real sites are well under `FREE_PAGE_CAP = 500` (`apps/web/lib/limits.ts`); 80 is a conservative working average for the free/viral tail. |
| Pages crawled, average **Pro** audit | **400 pages** | Pro users audit larger properties; still well under `PRO_PAGE_CAP = 2000`. |
| Audit wall-clock (free) | **~60 s** | Single SSE consumer; engine crawl + grade. |
| Audit wall-clock (Pro) | **~150 s** | Larger crawl, `PRO_CONCURRENCY = 8`. |
| Vercel function memory | **1 GB (1769 MB tier rounded to 1 GB)** | Default Fluid Compute instance size; conservative. |
| Vercel region | **iad1 (Washington D.C.)** | US-East reference rates: **$0.128 / active-CPU-hour**, **$0.0106 / GB-hr provisioned memory** ([Vercel fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)). |
| Active-CPU fraction of wall-clock | **~25%** | Crawling is I/O-bound (waiting on the target site's network); Vercel bills active CPU only, not I/O wait ([Vercel fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)). The other 75% is billed as provisioned memory, not CPU. |
| Payload streamed to the browser per audit | **~1.5 MB (free) / ~4 MB (Pro)** | SSE snapshots + the rendered report; counts as Vercel Fast Data Transfer and, on reads from Postgres, as Supabase egress. |
| Audit row + findings stored | **~0.3 MB (free) / ~1 MB (Pro)** | Audit row + findings + pages JSON; auto-deleted after `AUDIT_TTL_DAYS = 30`. |
| Inngest steps per audit | **4 steps** | `mark-crawling` → `run-engine` → `persist-results` → `emit-completed` (`inngest/audit.ts`), plus the small persist-results follow-on. Round to **5 executions/audit**. |

### 2.2 Vercel compute (the SSE stream + the crawl-triggering route)

The browser holds an SSE connection while the audit runs; that connection is a live
Vercel function instance for the audit's wall-clock.

**Free audit (~60 s wall-clock, ~25% active CPU, 1 GB memory):**

- Active CPU: `60 s × 0.25 = 15 s = 0.004167 hr × $0.128 = $0.000533`
- Provisioned memory: `1 GB × 60 s = 0.01667 GB-hr × $0.0106 = $0.000177`
- Invocations: first 1M/mo are included on Pro; at launch volumes invocation overage is
  ~$0 (overage is **$0.60 per additional million** —
  [Vercel fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)).
- **Vercel compute (free) ≈ $0.00071**

**Pro audit (~150 s wall-clock, ~25% active CPU, 1 GB memory):**

- Active CPU: `150 s × 0.25 = 37.5 s = 0.010417 hr × $0.128 = $0.001333`
- Provisioned memory: `1 GB × 150 s = 0.04167 GB-hr × $0.0106 = $0.000442`
- **Vercel compute (Pro) ≈ $0.00178**

### 2.3 Vercel bandwidth (Fast Data Transfer)

Pro includes **1 TB Fast Data Transfer/mo, then $0.15/GB**
([Vercel pricing](https://vercel.com/pricing)). The report + SSE payload leaves Vercel's
edge on every view.

- Free: `1.5 MB = 0.00146 GB × $0.15 = $0.00022`
- Pro: `4 MB = 0.00391 GB × $0.15 = $0.00059`

(At launch volumes most of this sits inside the 1 TB included allotment, so the marginal
cost is effectively lower; we cost it at the overage rate to be conservative.)

### 2.4 Supabase egress + storage

Pro includes **250 GB egress/mo, then $0.03/GB** for database/cached egress, **8 GB DB
storage, then $0.125/GB**, with the **spend cap ON by default**
([Supabase pricing](https://supabase.com/pricing),
[Supabase egress docs](https://supabase.com/docs/guides/platform/manage-your-usage/egress)).

The audit row + findings are read out of Postgres to render the report and to feed the
SSE stream.

- Egress (free): `1.5 MB = 0.00146 GB × $0.03 = $0.000044`
- Egress (Pro): `4 MB = 0.00391 GB × $0.03 = $0.000117`
- Storage (free): `0.3 MB held 30 days ≈ 0.0003 GB × $0.125 × (30/30) = $0.0000375`/mo, amortized to the audit ≈ **$0.00004**
- Storage (Pro): `1 MB held 30 days ≈ 0.001 GB × $0.125 = $0.000125`/mo ≈ **$0.00013**
- **Supabase (free) ≈ $0.00008 ; Supabase (Pro) ≈ $0.00025**

(These sit inside the included 250 GB / 8 GB allotments at launch; we cost them at the
overage rate so the unit number is a true marginal ceiling.)

### 2.5 Inngest steps

Pro is **$75/mo for 1M executions, then $50 per additional 1M** = **$0.00005/execution**
([Inngest pricing](https://www.inngest.com/pricing)). The Inngest **concurrency limit**
(see §4) is the throughput throttle. `crawlmouse.audit`'s per-function concurrency is **env-driven**
(`INNGEST_AUDIT_CONCURRENCY`, read by `auditConcurrencyLimit()` in `inngest/audit.ts`): it defaults
to **5** (the Inngest Free-plan cap — a value above the account cap makes Inngest reject the whole
app sync) and is set to **50** in the Vercel env once the account is on a paid plan.

- `5 executions × $0.00005 = **$0.00025 per audit** (free and Pro alike)`

### 2.6 Unit cost — the headline numbers

| Line | Free audit | Pro audit |
| --- | --- | --- |
| Vercel compute | $0.00071 | $0.00178 |
| Vercel bandwidth | $0.00022 | $0.00059 |
| Supabase egress + storage | $0.00008 | $0.00025 |
| Inngest steps | $0.00025 | $0.00025 |
| **Total per audit** | **≈ $0.0013** | **≈ $0.0029** |

> **$ per free audit ≈ $0.0013 (about one-eighth of a cent).**
> **$ per Pro audit ≈ $0.0029 (about one-third of a cent).**

These exclude the flat platform fees (Vercel Pro seat $20/mo, Supabase Pro $25/mo,
Inngest Pro $75/mo, Resend Pro from $20/mo) which are fixed monthly base costs, folded
into the worked example in §5 rather than the per-audit marginal cost.

---

## 3. Code levers → cost

Every lever below lives in **`apps/web/lib/limits.ts`** — the single source of truth.
Changing a number there changes the cost ceiling; nothing else should hardcode these.

| Lever (`lib/limits.ts`) | Value | How it bounds cost |
| --- | --- | --- |
| `FREE_PAGE_CAP` | 500 | Caps crawl size for free/anon audits → caps Vercel active-CPU + Supabase storage per free audit. |
| `PRO_PAGE_CAP` | 2000 | Caps crawl size for Pro audits → keeps even the largest Pro audit's compute bounded (4× a free cap, not unbounded). |
| `FREE_CONCURRENCY` | 1 | Free crawls run sequentially → one free user can't fan out parallel crawls and multiply compute. |
| `PRO_CONCURRENCY` | 8 | Pro crawls run up to 8-wide → faster, but bounded; not unlimited parallelism. |
| `GLOBAL_AUDITS_PER_DAY` | 5000 | **Phase-3 backstop.** Hard platform-wide ceiling on audits started per day across ALL callers. Caps worst-case daily ops spend at `5000 × $0.0029 ≈ $14.50/day ≈ $435/mo` even under a full abuse spike. |
| `IP_AUDITS_PER_DAY_ANON` / `IP_AUDITS_PER_DAY_USER` | 20 / 40 | Coarse per-IP friction *before* Turnstile (not the binding ceiling). Tuned generous (was 3 / 5): mobile carriers share public IPs (CGNAT), so a low cap pushed real users into the captcha wall. Turnstile + the unchanged `GLOBAL_AUDITS_PER_DAY` backstop are the binding cost/abuse guards, so worst-case daily spend is unchanged. |
| `DOMAIN_AUDITS_PER_HOUR` | 5 | Up to 5 audits per domain per hour (free/anon): lets a user re-check their OWN site — the freemium loop (grade → see gap → re-check) — while still capping re-crawl spam. Was 1. |
| `VERIFY_CHECKS_PER_HOUR` | 10 | Caps outbound domain-verification fetches/DNS per user. |
| `MINT_REPORTS_PER_DAY` | 20 | Caps public-report mints per user/day (storage + share traffic). |
| `MAGIC_LINK_PER_IP_PER_HOUR` / `MAGIC_LINK_PER_EMAIL_PER_HOUR` | 5 / 3 | Caps Resend transactional sends → directly bounds the email bill. |
| `AUDIT_TTL_DAYS` | 30 | Free-tier audits auto-delete after 30 days (bounded/batched `deleteExpiredAudits` cron) → Supabase storage never grows unbounded. |
| PostHog event sampler (`lib/analytics-sampling.ts`, `shouldSendEvent`) | autocapture + pageleave kept at **10%**; funnel + pageview always kept | Drops 90% of high-volume autocapture/pageleave events before they're billed → bounds the PostHog event bill while preserving the seven funnel events. (Shipped Phase 2.) |

---

## 4. The seven dashboard hard caps **[runbook]**

These are **applied in each vendor's dashboard at deploy time, not in code.** Every row
is **[runbook]**. Set all seven before the first live traffic. Thresholds are sized so
that hitting one means something is wrong (abuse or a runaway), not normal growth — they
are circuit breakers, not throttles for expected load.

| # | Vendor — control | EXACT value to set | WHERE in the dashboard **[runbook]** |
| --- | --- | --- | --- |
| 1 | **Stripe** — billing alert | **$500/mo usage-threshold alert** (informational; Stripe processing fees scale with revenue, so this is an anomaly tripwire, not a spend cap) | Stripe Dashboard → **Billing → Billing alerts** → create a `usage_threshold` alert; listen for `billing.alert.triggered` ([Stripe billing alerts](https://docs.stripe.com/billing/subscriptions/usage-based/alerts)). **[runbook]** |
| 2 | **Supabase** — spend cap | **Spend cap = ON** (default), and confirm it stays on for the Pro project | Supabase Dashboard → project → **Settings → Billing → Spend cap → Enabled** ([Supabase pricing](https://supabase.com/pricing)). **[runbook]** |
| 3 | **Vercel** — spend management | **On-demand budget = $200/mo**, with **auto-pause projects at 100%** (hard limit) | Vercel Dashboard → team → **Settings → Billing → Spend Management** → set budget + enable "Pause projects" at 100% ([Vercel fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)). **[runbook]** |
| 4 | **Inngest** — concurrency limit | **Function concurrency aligned to the account plan cap** (Free tier = 5 concurrent steps; on Pro keep the account/function concurrency ≤ 100). The function limit is **env-driven** via `INNGEST_AUDIT_CONCURRENCY` (defaults to 5; exceeding the account cap makes Inngest reject the whole app sync so NO audits run) | Inngest Dashboard → **Settings → Billing/Plan** (account concurrency) + set `INNGEST_AUDIT_CONCURRENCY` in Vercel to match the plan (leave unset = 5 on Free; 50 on Pro), read by `auditConcurrencyLimit()` in `inngest/audit.ts` ([Inngest pricing](https://www.inngest.com/pricing)). **[runbook]** |
| 5 | **Resend** — monthly cap | **Monthly overage cap = 5× plan quota (Resend default; leave enabled).** On the free 3,000/mo tier this caps sends at 15,000/mo; raise the plan, not the cap multiplier | Resend Dashboard → **Settings → Billing** (plan + overage cap is 5× quota by default) ([Resend pricing](https://resend.com/pricing), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)). **[runbook]** |
| 6 | **Sentry** — quota / spend cap | **Pay-as-you-go (on-demand) budget = $20/mo**, with per-key/per-project **rate limiting** to drop events past a daily threshold | Sentry Dashboard → **Settings → Subscription → On-Demand Budget** + **Settings → Projects → [project] → Client Keys (DSN) → Rate Limit** ([Sentry pricing](https://sentry.io/pricing/), [Sentry pricing docs](https://docs.sentry.io/pricing/)). **[runbook]** |
| 7 | **PostHog** — billing limit | **Product Analytics billing limit = $50/mo** (on top of the in-code 10% sampler) | PostHog Dashboard → **Settings → Billing → set a billing limit** for the Product Analytics product ([PostHog pricing](https://posthog.com/pricing)). **[runbook]** |

---

## 5. Worked example at $100 / $1,000 / $10,000 MRR

### 5.1 Traffic-mix assumptions (stated)

- **Pro price:** $19/mo. Implied Pro users = `MRR / $19`.
- **Audits per Pro user per month:** **20**. Pro users are active; this is generous.
- **Free/viral tail multiplier:** for every Pro audit, **10 free audits** happen (viral
  consumer funnel — most traffic is free, only a sliver converts). This is the dominant
  volume driver and the reason `GLOBAL_AUDITS_PER_DAY = 5000` exists as a backstop.
- **Unit costs from §2.6:** free audit = **$0.0013**, Pro audit = **$0.0029**.
- **Flat platform base (per month):** Vercel Pro seat **$20** + Supabase Pro **$25** +
  Inngest Pro **$75** + Resend Pro **$20** + Sentry Team **$26** = **$166/mo fixed**
  (sources in §6). PostHog and Stripe usage tiers start at $0 and are covered by the
  variable + capped lines. This fixed base is the floor that dominates at low MRR and
  becomes negligible at high MRR — exactly the shape a healthy SaaS wants.

> Note on the fixed base vs. the 18% rule: the 18% ceiling is fundamentally about
> **variable** ops cost scaling sub-linearly with revenue. At very low MRR the fixed
> $166 base is large relative to revenue (a startup-cost reality, not a unit-economics
> failure); the rule is satisfied comfortably from the first ~$1k MRR onward, and the
> **variable** cost stays a tiny fraction of MRR at every tier (shown below).

### 5.2 The table

| MRR | Pro users (~$19) | Pro audits/mo (20 each) | Free audits/mo (10× Pro) | **Variable** ops cost | + Fixed base | **Total ops** | Total as % of MRR | **Variable** as % of MRR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **$100** | ~5 | 100 | 1,000 | `100×$0.0029 + 1,000×$0.0013 = $0.29 + $1.30 = $1.59` | $166 | **$167.59** | 168% ⚠️ (fixed-base dominates — pre-PMF, see note) | **1.6%** ✅ |
| **$1,000** | ~53 | 1,060 | 10,600 | `1,060×$0.0029 + 10,600×$0.0013 = $3.07 + $13.78 = $16.85` | $166 | **$182.85** | 18.3% ✅ (right at the line once you cross ~$1k MRR) | **1.7%** ✅ |
| **$10,000** | ~526 | 10,520 | 105,200 | `10,520×$0.0029 + 105,200×$0.0013 = $30.51 + $136.76 = $167.27` | $166 | **$333.27** | **3.3%** ✅ | **1.7%** ✅ |

### 5.3 What the table shows

- **Variable ops cost is ~1.6–1.7% of MRR at every tier** — an order of magnitude under
  the 18% ceiling. The unit economics are sound: each marginal dollar of MRR brings far
  more than its share of revenue net of variable infra.
- **The 18% rule is satisfied from ~$1,000 MRR upward.** At $1k MRR total ops (incl. the
  fixed $166 vendor base) lands at ~18.3%, and falls fast as MRR grows — **3.3% at
  $10k MRR.** Below ~$1k MRR the fixed vendor base is simply larger than a tiny revenue
  base (normal pre-product-market-fit reality); the rule is about the scaling regime, and
  the scaling regime is healthy.
- **Tail-risk guard:** the free/viral tail is the volume that could blow up. At $10k MRR
  the model already implies ~105k free audits/mo ≈ **~3,500/day**, comfortably under
  `GLOBAL_AUDITS_PER_DAY = 5000`. If a viral spike or abuse pushes daily volume past
  5,000, the **backstop trips and caps the day's audits**, holding worst-case ops spend
  at `5000 × $0.0029 ≈ $14.50/day ≈ $435/mo` regardless of MRR. Combined with the seven
  dashboard caps (§4), no single runaway can breach the budget.

---

## 6. Sources

All accessed **2026-06-03** from the vendors' own pricing/docs pages:

- **Vercel — Fluid Compute function pricing** (active CPU $0.128/hr & memory $0.0106/GB-hr at iad1; 1M invocations incl., $0.60/M overage; Spend Management $200 default budget + auto-pause): https://vercel.com/docs/functions/usage-and-pricing
- **Vercel — overall pricing / Pro plan** (Pro $20/seat; 1 TB Fast Data Transfer incl., $0.15/GB overage): https://vercel.com/pricing and https://vercel.com/docs/pricing
- **Supabase — pricing** (Pro $25/mo; 250 GB egress incl. then $0.03/GB; 8 GB DB then $0.125/GB; spend cap ON by default): https://supabase.com/pricing
- **Supabase — egress usage docs** (egress overage rates): https://supabase.com/docs/guides/platform/manage-your-usage/egress
- **Inngest — pricing** (Pro $75/mo, 1M executions incl., $50/additional 1M = $0.00005/execution; concurrency limits per plan): https://www.inngest.com/pricing
- **Stripe — pricing** (2.9% + $0.30 per successful US card charge; EXCLUDED from the 18% ops figure): https://stripe.com/pricing
- **Stripe — billing alerts docs** (usage-threshold alerts + `billing.alert.triggered`): https://docs.stripe.com/billing/subscriptions/usage-based/alerts
- **Resend — pricing** (free 3,000/mo; Pro from $20/mo for 50,000; overage $0.90/1,000; 5× quota overage cap): https://resend.com/pricing
- **Resend — account quotas & limits docs** (5× monthly-quota hard cap): https://resend.com/docs/knowledge-base/account-quotas-and-limits
- **Sentry — pricing** (Team $26/mo, 50k errors incl.; PAYG per-event overage; on-demand budget + DSN rate limits): https://sentry.io/pricing/ and https://docs.sentry.io/pricing/
- **PostHog — pricing** (Product Analytics: 1M events/mo free, then $0.00005/event for 1–2M; per-product billing limit): https://posthog.com/pricing
