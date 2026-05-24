# Crawlmouse v1.0 — Technical Design Specification

**Status:** Locked design for build. Approved 2026-05-24.
**Audience:** The 2-person Nahl Technologies engineering team + Claude Code (executing build).
**Supersedes:** `/home/udsik/Downloads/LinkSitemap_Technical_Discussion.md` (v1) and `/home/udsik/Downloads/Crawlmouse_Technical_Discussion_v2.md` (v2 discussion doc). Those were exploratory; this is the locked spec.
**Companion artifacts:** Visual brainstorm artifacts at `.superpowers/brainstorm/213533-1779589586/`. Memory at `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/memory/`.

---

## 1. Context

Crawlmouse is a free, no-install, share-driven internal-linking grader for any website, with a paid tier ($19/mo) that unlocks CSV export, AI-generated link suggestions (v1.1), scheduled re-crawls (v1.1), and an embed-badge that removes "Powered by Crawlmouse" branding (v1.0). v1.2 adds a developer/agency surface (CLI, GitHub Action, agentic webhook notifications) on the same underlying engine.

**The problem it solves:** Most site owners have measurable internal-linking issues (orphan pages, excessive click-depth, anchor-text over-optimization) and cannot see them in their CMS dashboards. The dominant existing tool, Link Whisper, is WordPress-only and serves Shopify badly (3.7★, 42% one-star Shopify App Store reviews). A free, no-install, instantly-shareable grader for any platform is the unfilled opportunity.

**The strategic bet:** Crawlmouse wins not by being another AI wrapper, but by combining (a) HubSpot Website Grader's score-driven viral mechanism, (b) Calendly's "Powered by" embed-badge multiplier, (c) BuiltWith/AnswerThePublic's give-to-get data network effect via peer benchmarking, and (d) CMS-aware analysis that goes deeper than any generalist competitor. The data moat compounds: every free crawl makes the benchmarks more accurate, which makes the product more useful, which drives more crawls. Competitors entering year 2 face a data gap they cannot close.

**v1.0 success criteria:** ship a launchable web app that produces a letter-grade audit for any site in <5 minutes, shareable as a public URL with social card, with a CSV-export paywall, in 6–8 weeks of build for 2 engineers + Claude Code. Run on free-tier infra except Vercel Pro ($20/mo). Validate v1.2 dev-tool demand via landing-page email capture during v1.0 launch.

---

## 2. System Architecture

### 2.1 Topology

**Single Next.js 15 app (App Router) on Vercel Pro**, with all server-side logic in API routes and Server Actions. Background work (crawling, scoring, embedding generation) runs on **Inngest** as durable step-functions. Database, auth, storage, and pgvector live in **Supabase**. The engine itself is a **pure TypeScript library** at `packages/engine`, imported by API routes in v1.0 and by the v1.2 CLI later.

The dual-track architecture means: the v1.0 web app and the v1.2 CLI both consume the same engine + Audit API. Nothing in v1.0 special-cases the web surface in ways that v1.2 would need to undo.

### 2.2 High-level diagram

```
                                  ┌────────────────────┐
                                  │  Browser (user)    │
                                  └─────────┬──────────┘
                                            │ HTTPS
                              ┌─────────────┴─────────────┐
                              │   Vercel Pro (Next.js 15) │
                              │  ┌─────────────────────┐  │
                              │  │  React UI + Sigma.js │  │
                              │  └─────────┬───────────┘  │
                              │  ┌─────────┴──────────┐   │
                              │  │  tRPC + REST API   │   │
                              │  │  (Audit API)       │   │
                              │  └─────────┬──────────┘   │
                              └────────────┼──────────────┘
                                           │
                       ┌───────────────────┼──────────────────┐
                       │                   │                  │
                  ┌────┴────┐         ┌────┴─────┐       ┌────┴────┐
                  │ Inngest │         │ Supabase │       │ Stripe  │
                  │  Jobs   │         │ Postgres │       │ Checkout│
                  │ + Events│         │  + Auth  │       │ + Portal│
                  └────┬────┘         │  + RLS   │       └─────────┘
                       │              │+pgvector │
                       │              │ +Storage │
                       │              └──────────┘
                       │
                  ┌────┴───────────────┐
                  │ @crawlmouse/engine │
                  │   (pure TS lib)    │
                  │  - Crawler         │
                  │  - Sitemap parser  │
                  │  - Analyzer        │
                  │  - Grader          │
                  │  - CMS detector    │
                  │  - Benchmarker     │
                  └────┬───────────────┘
                       │ HTTP
                       ▼
                  ┌─────────┐
                  │ Target  │
                  │ websites│
                  └─────────┘
```

### 2.3 Monorepo layout

```
crawlmouse/
├── apps/
│   ├── web/                  # Next.js 15 (App Router) — the v1.0 web app
│   └── cli/                  # v1.2 — defer; placeholder package.json only in v1.0
├── packages/
│   ├── engine/               # Pure TS library: crawler, analyzer, grader, CMS detection, benchmarker
│   ├── types/                # Shared TS types (audit options, results, events)
│   └── ui/                   # Shared React components used in apps/web (and potentially apps/cli outputs)
├── inngest/                  # Inngest functions (audit pipeline)
├── infra/
│   ├── supabase/             # SQL migrations
│   └── vercel.json
├── docs/
│   └── superpowers/specs/    # This spec + future specs
├── pnpm-workspace.yaml
└── turbo.json
```

`pnpm` for package management; `Turborepo` for build orchestration. `packages/engine` is the load-bearing piece — it MUST NOT import React, Next.js, or any browser API. It accepts URL + options and returns plain JSON.

---

## 3. Technology Stack & Rationale

| Concern | Choice | Why (in one line) |
|---|---|---|
| Frontend framework | Next.js 15 (App Router) | RSC + server actions + best DX on Vercel |
| Language (everywhere) | TypeScript 5.5+ | Type-check catches bugs Claude Code generates; one stack |
| Hosting (web) | Vercel Pro ($20/mo) | Fluid Compute = 800s timeouts; spike resilience |
| Database + Auth + Storage + Vectors | Supabase (free → Pro $25/mo at ~10k MAU) | All-in-one; RLS for the public/private report rule; pgvector beats Pinecone 28x at 25% cost |
| Background jobs | Inngest (free up to 50k runs/mo) | Step-based durable execution; tolerates Vercel function timeouts; best free tier for viral free tools |
| Crawler orchestration | Crawlee 3.x (Apache 2.0) | Battle-tested concurrency, retries, sessions; CheerioCrawler variant for HTTP-only |
| HTML parsing | Cheerio | jQuery-like; fast; ships with CheerioCrawler |
| Sitemap parsing | `sitemapper` + `node-sitemap-stream-parser` fallback | Handles sitemap-index, gzip, malformed XML, huge sitemaps |
| Graph data structure | Graphology | Used both server-side (analyzer) and client-side (Sigma.js viewer) |
| Live graph viz | Sigma.js + `@react-sigma/core` | WebGL; smooth at 2k+ nodes; full brand customization |
| Internal API | tRPC | End-to-end type safety; zero glue between Next.js client and server |
| External API (v1.2 CLI, future integrations) | REST + OpenAPI (auto-gen via `trpc-openapi`) | One source of truth (tRPC), two consumption surfaces |
| LLM (v1.1 only) | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | $1/$5 per M tokens; sufficient for ranking + short anchor-text writing |
| Embeddings (v1.1 only) | OpenAI `text-embedding-3-small` ($0.02/M) | Cheapest viable; 1536 dims = pgvector-native |
| Payments | Stripe Checkout + Customer Portal | Hosted = minimal PCI; webhook-driven entitlement + daily reconciliation |
| Email | Resend (free 3k/mo) | Best Next.js DX; React-based templates |
| CAPTCHA | Cloudflare Turnstile (free) | Less friction than reCAPTCHA; privacy-friendly |
| Funnel analytics | PostHog (free 1M events/mo) | Funnel + session replay; cookieless mode |
| Error tracking | Sentry (free 5k errors/mo) | Industry standard; great Next.js SDK |
| CDN / DNS | Vercel + Cloudflare (DNS only, via Namecheap forward) | Already own crawlmouse.com |
| CI / git | GitHub + Vercel auto-deploy | Standard, free for the team |

**Considered and rejected:**
- **Python engine** (B2 in v2): TypeScript-only stack wins on operational simplicity; Python's ecosystem advantage is narrow once Crawlee + Sitemapper handle the hard parts. Re-evaluate if a specific algorithm becomes a bottleneck.
- **Cloudflare Workers** (alternate frontend host): cheaper at extreme scale but immature Next.js story and complicates Inngest/Supabase. Re-evaluate at 1M+ MAU.
- **Trigger.dev** (alternate jobs): better DX, OSS self-hostable, but free tier is 50 runs/*day* vs Inngest's 50k/*month*. Mismatch for viral-free-tool launch.
- **Pinecone / Qdrant** (alternate vectors): pgvector matches them at this scale; no second data store, no second auth surface.
- **GraphQL** (alternate API): too much ceremony for a 2-person team building one client (web) + one CLI (later).
- **Loops / Postmark** (alternate email): Resend's free tier and DX edge out.

---

## 4. Data Model

All tables live in Postgres (Supabase) with Row-Level Security (RLS) enabled. Embeddings use `pgvector`. Schema migrations live at `infra/supabase/migrations/*.sql`.

### 4.1 Core tables (v1.0)

```sql
-- users
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  pro_until timestamptz,                       -- null = free; set by Stripe webhook
  stripe_customer_id text unique,
  created_at timestamptz default now()
);

-- sessions (magic-link sessions; supabase auth manages tokens but we mirror here for FK)
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- audits (one per crawl, anonymous or authenticated)
create table audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,            -- null for anonymous audits
  anonymous_session_id text,                                       -- cookie-bound for anonymous flows
  url text not null,                                               -- canonicalized
  status text not null default 'pending',                          -- pending|crawling|analyzing|completed|failed
  cms_detected text,                                               -- 'shopify' | 'wordpress' | 'webflow' | 'wix' | 'squarespace' | 'framer' | 'ghost' | 'custom'
  cms_metadata jsonb,                                              -- theme name, app fingerprints, etc.
  page_count int,
  link_count int,
  score numeric(5,2),                                              -- 0.00–100.00
  grade text,                                                       -- 'A' | 'A-' | … | 'F'
  -- v1.2-ready context fields (null in v1.0; populated by CLI later)
  commit_sha text,
  environment text,
  branch text,
  deployment_id text,
  -- audit options used (echoed back for reproducibility)
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz default now(),
  completed_at timestamptz,
  failure_reason text
);
create index on audits (user_id, started_at desc);
create index on audits (url, completed_at desc);                   -- per-domain rate-limit lookups

-- pages (one row per page in an audit's link graph)
create table pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid references audits(id) on delete cascade,
  url text not null,
  url_hash text not null,                                          -- sha256 of canonicalized URL (for aggregate use)
  title text,
  status_code int,
  depth int,                                                        -- shortest BFS distance from homepage; null = unreachable
  in_degree int default 0,
  out_degree int default 0,
  is_orphan boolean default false,
  unique(audit_id, url)
);
create index on pages (audit_id, is_orphan);

-- links (one row per discovered internal link)
create table links (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid references audits(id) on delete cascade,
  from_page_id uuid references pages(id) on delete cascade,
  to_page_id uuid references pages(id) on delete cascade,
  anchor_text text,
  is_generic_anchor boolean default false                          -- "click here", "read more", etc.
);
create index on links (audit_id, to_page_id);                      -- in-degree calculations

-- findings (categorized issues surfaced in the report)
create table findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid references audits(id) on delete cascade,
  category text not null,                                          -- 'orphan' | 'deep_page' | 'over_anchor' | 'generic_anchor' | 'under_linked_important'
  severity text not null,                                          -- 'critical' | 'medium' | 'minor'
  page_id uuid references pages(id) on delete cascade,
  payload jsonb                                                    -- category-specific data
);
create index on findings (audit_id, category);

-- domain_verifications
create table domain_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  domain text not null,                                            -- canonical eTLD+1
  method text not null,                                            -- 'dns_txt' | 'meta_tag'
  verification_token text not null,
  verified_at timestamptz,
  created_at timestamptz default now(),
  unique(user_id, domain)
);

-- public_reports (mintable only by verified domain owners)
create table public_reports (
  slug text primary key,                                           -- 22-char nanoid; unguessable
  audit_id uuid references audits(id) on delete cascade unique,
  domain text not null,
  og_image_url text,                                               -- pre-rendered social card
  created_at timestamptz default now(),
  takedown_requested_at timestamptz,
  takedown_reason text
);

-- embed_badges
create table embed_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  domain text not null,                                            -- which site embeds it
  style jsonb default '{}'::jsonb,                                 -- color overrides (Pro), branded vs custom
  view_count bigint default 0,
  created_at timestamptz default now(),
  unique(user_id, domain)
);

-- benchmark_cohorts (anonymized aggregate; k-anonymity enforced at write time)
create table benchmark_cohorts (
  id uuid primary key default gen_random_uuid(),
  cms text not null,
  size_bucket text not null,                                       -- 'tiny' (<50p) | 'small' (50-200) | 'medium' (200-1000) | 'large' (1000+)
  category text,                                                   -- nullable; populated when detectable from CMS metadata
  metric text not null,                                            -- 'orphan_ratio' | 'avg_depth' | 'grade_score' | 'anchor_hhi'
  percentiles jsonb not null,                                      -- {"p10":0.05,"p25":0.10,"p50":0.18,"p75":0.27,"p90":0.40}
  n_sites int not null,                                            -- always ≥ 25 (k-anonymity threshold)
  updated_at timestamptz default now(),
  unique(cms, size_bucket, category, metric)
);

-- stripe_events (idempotency)
create table stripe_events (
  id text primary key,                                             -- Stripe event ID
  type text not null,
  processed_at timestamptz default now()
);

-- rate_limits (anonymous IP and user buckets)
create table rate_limits (
  bucket_key text not null,                                        -- e.g. "ip:1.2.3.4" or "user:uuid" or "domain:example.com"
  window_start timestamptz not null,
  request_count int default 1,
  primary key (bucket_key, window_start)
);
```

### 4.2 v1.2-ready tables (created in v1.0, UI hidden)

```sql
-- api_keys (hashed at rest; UI exposed in v1.2)
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  hash text not null,                                              -- bcrypt or argon2id
  prefix text not null,                                            -- last 4 chars shown in UI ("cm_..._xxxx")
  scopes jsonb default '["audits:run","audits:read"]'::jsonb,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- webhook_subscriptions (UI exposed in v1.2)
create table webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  url text not null,
  secret text not null,                                            -- for HMAC signing
  event_filter jsonb default '["audit.completed","grade.changed"]'::jsonb,
  active boolean default true,
  created_at timestamptz default now()
);
```

### 4.3 v1.1 tables (added later)

```sql
-- page_embeddings (vector dim 1536 for OpenAI text-embedding-3-small)
create table page_embeddings (
  page_id uuid primary key references pages(id) on delete cascade,
  embedding vector(1536) not null,
  computed_at timestamptz default now()
);
create index on page_embeddings using hnsw (embedding vector_cosine_ops);

-- scheduled_audits (Pro weekly re-crawl)
create table scheduled_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  url text not null,
  cron text not null default '0 9 * * 1',                          -- Monday 9am UTC
  last_run_at timestamptz,
  next_run_at timestamptz not null,
  active boolean default true
);
```

### 4.4 Row-Level Security policies

All tables enable RLS. Selected policies:

- `audits`: users can read their own audits (where `user_id = auth.uid()`); anonymous audits readable only via `anonymous_session_id` matching a cookie value passed in JWT; public reports readable by anyone via the `public_reports.slug` join (no direct `audits` access for public reports).
- `pages`, `links`, `findings`: readable only by users who can read the parent audit.
- `public_reports`: anyone can read by slug; only verified domain owners can insert.
- `domain_verifications`: users can manage their own.
- `benchmark_cohorts`: readable by all authenticated and anonymous users (aggregate data, no PII).
- `api_keys`, `webhook_subscriptions`: users manage their own; hashes never returned in SELECT.

### 4.5 Aggregation policy (legal/ethical)

`benchmark_cohorts` is populated by a periodic job that aggregates from completed `audits`. **k-anonymity threshold: n_sites ≥ 25.** No cohort row is written or returned where n_sites < 25. URLs are never exposed in aggregate. Cohort dimensions: CMS × size_bucket × (optional) category × metric.

Users can request data deletion via `/api/account/delete`, which removes their `users` row (cascading to all owned data). Aggregate data does not retroactively un-include them — by design, aggregated metrics are derived statistics that don't constitute personal data once anonymized.

---

## 5. API Contracts

### 5.1 Internal: tRPC procedures

The web app's frontend talks to the backend via tRPC for type safety. Procedures live in `apps/web/src/server/router/`. Selected procedures:

```ts
// audits router
audits.create({ url: string, options?: AuditOptions }) → { auditId: string }
audits.get({ auditId: string }) → AuditResult
audits.listMine({ limit?: number, cursor?: string }) → PaginatedAudits
audits.stream({ auditId: string }) → AsyncIterable<AuditEvent>   // SSE under the hood

// reports router
reports.mintPublic({ auditId: string }) → { slug: string } | { error: 'verification_required' }
reports.getPublic({ slug: string }) → PublicReportPayload
reports.requestTakedown({ slug: string, reason: string }) → { ok: true }

// verifications router
verifications.start({ domain: string, method: 'dns_txt' | 'meta_tag' }) → { token: string, instructions: string }
verifications.check({ verificationId: string }) → { verified: boolean }

// embeds router
embeds.create({ domain: string }) → { embedScript: string }
embeds.update({ id: string, style: BadgeStyle }) → { ok: true }                  // Pro only

// auth router
auth.requestMagicLink({ email: string }) → { ok: true }
auth.verifyMagicLink({ token: string }) → { sessionToken: string }

// billing router
billing.createCheckoutSession({ priceId: string }) → { url: string }
billing.createPortalSession() → { url: string }
```

### 5.2 External: REST endpoints (auto-generated via `trpc-openapi`)

The same tRPC procedures are exposed as REST endpoints at `/api/v1/*`. `trpc-openapi` decorates procedures with `.meta({ openapi: { method, path } })` to register them. v1.0 exposes the schema at `/api/v1/openapi.json` but does not advertise REST publicly (CLI/external usage comes in v1.2). Examples:

```
POST   /api/v1/audits                       # body: { url, options? }
GET    /api/v1/audits/{id}
GET    /api/v1/audits/{id}/stream           # SSE
GET    /api/v1/reports/{slug}
POST   /api/v1/embeds                       # body: { domain }
```

### 5.3 Authentication

All API routes (tRPC + REST) accept TWO auth modes via middleware:
- **Session cookie** (default for web app): `Authorization` not present, cookie validated against Supabase Auth.
- **API key** (Bearer): `Authorization: Bearer cm_live_xxx`. Key validated against `api_keys.hash`. UI for managing keys is hidden in v1.0 but middleware and table exist.

Anonymous endpoints (those allowing `user_id = null`): `POST /api/v1/audits` (anonymous first audit), `GET /api/v1/reports/{slug}` (public reports).

### 5.4 Webhook endpoints

Inbound webhooks accepted:

```
POST /api/webhooks/stripe                   # signature verified via STRIPE_WEBHOOK_SECRET
POST /api/webhooks/inngest                  # signature verified via Inngest signing key
```

Outbound webhooks (v1.2 dispatched by Inngest):

```
POST <subscriber_url>                       # body: { event, data, timestamp }
                                            # headers: X-Crawlmouse-Signature (HMAC-SHA256), X-Crawlmouse-Event
```

### 5.5 Rate limits

Enforced in middleware via `rate_limits` table (atomic upsert with window):

- Anonymous: 3 audits per IP per 24h (Cloudflare Turnstile gate on the 4th+ in the same window)
- Authenticated free: 5 audits per user per 24h
- Authenticated Pro: 50 audits per user per 24h (soft; abuse-detection alerts at higher)
- Per-domain: 1 audit per domain per 60 minutes regardless of user (prevents reverse-DDoS via Crawlmouse)
- API key: 100 audits per key per 24h (v1.2; per-key configurable later)

---

## 6. Crawler Implementation

### 6.1 Library stack

```ts
import { CheerioCrawler, RequestQueue } from 'crawlee';
import Sitemapper from 'sitemapper';
import { validateUrl, isPrivateIp, resolveDnsSafe } from './ssrf-guard';
```

### 6.2 Crawl flow (per audit)

1. **URL validation**: `validateUrl(targetUrl)` — must be `http://` or `https://`; DNS resolve target; reject if resolved IP is in private/cloud-metadata ranges.
2. **Sitemap discovery**:
   - Try `<root>/sitemap.xml`
   - Try `<root>/robots.txt` and parse `Sitemap:` directive
   - Try common paths (`sitemap_index.xml`, `sitemap1.xml`, etc.)
   - If none found, fall back to HTML-link breadth-first crawl from homepage
3. **Sitemap parsing**: `Sitemapper` handles index files, gzip, malformed XML. Returns list of URLs.
4. **Page cap enforcement**: cap at 500 (free) or 2000 (Pro). If sitemap returns more, sample (deterministic by URL hash) for the audit.
5. **Crawl execution** (Crawlee `CheerioCrawler`):
   - 8 concurrent requests per host
   - 250ms inter-request stagger per connection (≈30 req/s aggregate ceiling)
   - 10s per-request timeout
   - 10MB response size cap
   - Respect `robots.txt`
   - Abort + exponential backoff on 429 / 503
   - User-Agent: `CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)`
   - Custom `requestHandler`: extract title, status, internal links with anchor text; SSRF-validate every URL before adding to queue
6. **CMS detection** (runs once on homepage HTML): see §9.
7. **Link graph construction**: build a `Graphology` `DirectedGraph` from pages + links.
8. **Analysis**: see §7.
9. **Score + grade**: see §8.
10. **Benchmark lookup**: see §10.
11. **Persist**: write `audits` (status=completed), `pages`, `links`, `findings`. Update `benchmark_cohorts` if this audit completes a cohort sample.

### 6.3 Inngest function structure

```ts
inngest.createFunction({ id: 'crawlmouse.audit', concurrency: { limit: 50 } },
  { event: 'audit.requested' },
  async ({ event, step }) => {
    const audit = await step.run('init-audit', () => initAudit(event.data));
    const sitemap = await step.run('fetch-sitemap', () => discoverSitemap(audit.url));
    const urls = await step.run('parse-sitemap', () => parseSitemap(sitemap));
    const pages = await step.run('crawl-pages', () => crawlPages(audit.id, urls, audit.settings));
    const graph = await step.run('build-graph', () => buildGraph(pages));
    const analysis = await step.run('analyze', () => analyze(graph));
    const benchmark = await step.run('benchmark', () => lookupBenchmark(audit.cms_detected, pages.length));
    await step.run('persist', () => persistResults(audit.id, graph, analysis, benchmark));
    await step.sendEvent('audit.completed', { name: 'audit.completed', data: { auditId: audit.id } });
  }
);
```

Each `step.run` is durably retried by Inngest on failure. Progress events are emitted between steps so the SSE stream reflects real progress to the browser.

### 6.4 Crawl politeness (non-negotiable)

- Identifiable User-Agent linking to `/bot` info page
- `robots.txt` respected (Crawlee handles this when configured)
- Per-host concurrency cap = 8
- Per-host request stagger = 250ms
- Backoff: 1s → 2s → 4s → 8s → abort after 4 attempts on 5xx; immediate abort on 429 + email cooldown for that host
- No cookie persistence; no auth bypass attempts
- Standard headers only; no fingerprint evasion

---

## 7. Analysis Algorithms

All algorithms operate on a `Graphology.DirectedGraph` where nodes = pages and edges = internal links (with anchor text as edge attribute).

### 7.1 Orphan detection

```ts
function detectOrphans(graph: DirectedGraph, homepageNode: string): OrphanResult {
  const orphans: string[] = [];
  const nearOrphans: string[] = [];
  graph.forEachNode((node) => {
    if (node === homepageNode) return;
    const inDegree = graph.inDegree(node);
    if (inDegree === 0) orphans.push(node);
    else if (inDegree <= 2) nearOrphans.push(node);
  });
  return { orphans, nearOrphans, totalPages: graph.order, orphanRatio: orphans.length / graph.order };
}
```

**Excluded from orphan check:** homepage, `/login`, `/cart`, `/checkout`, `/account/*`, `/wp-admin/*`, common utility pages (heuristic list, CMS-aware).

### 7.2 Click depth (BFS)

```ts
function computeClickDepth(graph: DirectedGraph, homepageNode: string): Map<string, number> {
  const depths = new Map<string, number>();
  depths.set(homepageNode, 0);
  const queue: string[] = [homepageNode];
  while (queue.length) {
    const node = queue.shift()!;
    const d = depths.get(node)!;
    graph.forEachOutNeighbor(node, (neighbor) => {
      if (!depths.has(neighbor)) {
        depths.set(neighbor, d + 1);
        queue.push(neighbor);
      }
    });
  }
  return depths;
}
```

Pages not in `depths` after BFS are unreachable. Depth distribution histogram fed into the grade.

### 7.3 Anchor-text concentration (Herfindahl-Hirschman Index)

For each destination page, compute HHI over the distribution of anchor texts pointing to it:

```ts
function anchorConcentration(graph: DirectedGraph, target: string): number {
  const counts = new Map<string, number>();
  graph.forEachInEdge(target, (_, attrs) => {
    const anchor = normalizeAnchor(attrs.anchorText);
    counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
  });
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return Array.from(counts.values()).reduce((sum, c) => sum + Math.pow(c / total, 2), 0);
}
```

HHI > 0.5 = over-optimized (one phrase dominates). Flag the destination page in findings.

### 7.4 Generic anchor detection

Regex-based, per-locale (start with English):

```ts
const GENERIC_ANCHOR_PATTERNS = [
  /^(click here|read more|learn more|more info|here|this|link)\.?$/i,
  /^(see more|find out more|get started)$/i,
];
```

Per audit: count generic anchors; if > 20% of all internal links are generic, flag as finding.

### 7.5 PageRank-lite (hub authority approximation)

Iterative degree-weighted authority score, 20 iterations. Used to identify "important pages that are under-linked" — pages with high in-degree relative to their PageRank score (suggesting they're popular but starved of authority flow). Implementation via `Graphology`'s built-in `pageRank` extension.

### 7.6 CMS-aware adjustments

Once the CMS is detected (§9), the analyzer applies platform-specific adjustments:

- **Shopify**: collection pages downweighted in PageRank (they're navigational hubs that inflate scores); product pages whose only inbound link is from a single collection page flagged as "collection-only" (semi-orphan).
- **WordPress**: tag and category archive pages excluded from orphan detection (auto-generated).
- **Webflow**: CMS Collection items checked against their template references.

The adjustments live in `packages/engine/src/cms-adjustments/{shopify,wordpress,webflow,...}.ts`. Each exports a `transform(graph): graph` function. Easy to extend per CMS.

---

## 8. Grade Formula

### 8.1 Composite score (0–100)

```ts
const score =
  40 * (1 - orphanRatio) +                    // orphan ratio component
  20 * depthScore(depthDistribution) +        // click-depth component
  20 * anchorDiversityScore(audit) +          // anchor diversity component
  20 * structureScore(pageRankDist);          // link-structure quality
```

Each component returns 0–1. Components defined:

- **`depthScore`**: `1 - clamp(fractionOfPagesBeyondDepth3 + 0.5 * fractionUnreachable, 0, 1)`
- **`anchorDiversityScore`**: `1 - mean(HHI over all targets with > 2 in-links)`, plus penalty if > 20% of links are generic anchors (subtract 0.2, floor at 0)
- **`structureScore`**: `1 - giniCoefficient(pageRankValues)` (low Gini = even distribution = healthy)

### 8.2 Letter mapping

```
A:   ≥ 90
A-:  85-89.99
B+:  80-84.99
B:   75-79.99
B-:  70-74.99
C+:  65-69.99
C:   60-64.99
C-:  55-59.99
D+:  50-54.99
D:   45-49.99
D-:  40-44.99
F:   < 40
```

### 8.3 Tuning policy

Thresholds and weights are versioned. v1.0 ships with the above as `grade-formula-v1.json`. Adjustments require version bump. A `audits.grade_formula_version` column will be added when the first re-tune happens, so old audits can be re-graded under new rules retroactively or not.

### 8.4 Display

The grade is shown big and central. The score (0–100) is shown smaller. Each component contributes a sub-score visible on hover/expand. Benchmark comparison ("you're in the bottom 15% for orphan ratio vs other Shopify food-and-bev stores at your size") appears beside each component.

---

## 9. CMS Detection

### 9.1 Detection signatures

The detector inspects the homepage HTML, response headers, and a small number of well-known paths. Signatures live in `packages/engine/src/cms-detection/signatures.ts`. Each signature returns a confidence score 0–1. The highest wins. Example signatures:

```ts
{
  shopify: {
    headers: { 'x-shopid': 'present', 'x-shopify-stage': 'present' },
    html: [/cdn\.shopify\.com/, /Shopify\.theme/, /shopify-section/],
    paths: ['/cart.js', '/products.json']
  },
  wordpress: {
    html: [/wp-content/, /<meta name="generator" content="WordPress/, /wp-json/],
    paths: ['/wp-login.php', '/wp-json/']
  },
  webflow: {
    html: [/webflow\.com/, /data-wf-page/, /wf-form/],
    headers: { 'x-powered-by': /Webflow/ }
  },
  wix: {
    html: [/static\.wixstatic\.com/, /window\.wixBiSession/],
    headers: { 'x-wix-published-version': 'present' }
  },
  squarespace: {
    html: [/static1\.squarespace\.com/, /Static\.SQUARESPACE_CONTEXT/]
  },
  framer: {
    html: [/framer\.com/, /__framer__/],
    headers: { 'x-framer-site-id': 'present' }
  },
  ghost: {
    html: [/<meta name="generator" content="Ghost/, /content\/images\//],
    paths: ['/ghost/api/']
  }
}
```

Detection runs in parallel with the first homepage fetch — no extra round-trips. Result stored in `audits.cms_detected`. If no signature exceeds 0.6 confidence, store as `'custom'`.

### 9.2 Fingerprint metadata

In addition to the platform name, the detector populates `audits.cms_metadata`:

- **Shopify**: theme name (from `Shopify.theme.name`), Plus indicator, list of detected apps (from script-tag fingerprints), store currency, locale
- **WordPress**: WP version, active theme (from `style.css` URL pattern), top plugins (heuristic from script names)
- **Webflow**: published-version timestamp, site-ID
- **Others**: similar shallow fingerprints where available

This metadata feeds CMS-aware analysis (§7.6) and benchmark cohort assignment (§10).

---

## 10. Benchmarking Aggregation

### 10.1 Cohort definition

A cohort = (cms, size_bucket, category, metric). Size buckets: tiny (<50p), small (50-200), medium (200-1000), large (1000+). Category is optional (e.g., "food-and-beverage" detected from Shopify shop category, or null for unknown).

### 10.2 Aggregation job

A nightly Inngest cron (`02:00 UTC`) re-computes `benchmark_cohorts`:

```ts
for each (cms, size_bucket, category):
  for each metric in ['orphan_ratio', 'avg_depth', 'grade_score', 'anchor_hhi']:
    sites = audits where cms=cms and matches(size_bucket, page_count)
                       and (category=category or category is null match)
                       and status='completed'
                       and completed_at within last 90 days
    if count(sites) >= 25:
      percentiles = compute_percentiles(sites[metric], [10, 25, 50, 75, 90])
      upsert benchmark_cohorts(cms, size_bucket, category, metric, percentiles, n_sites=count)
    else:
      delete benchmark_cohorts where (cms, size_bucket, category, metric)   // hide if cohort shrinks
```

### 10.3 Report-time lookup

On report render, the API picks the most specific cohort available (category-specific if exists; falls back to category-null). Result: a small inline JSON `{ percentile: 27, cohort_n: 124, cohort_label: "Shopify food-and-bev stores 200-1000 pages" }` attached to each grade component.

### 10.4 Cold-start handling

Until cohorts reach n_sites ≥ 25, the report shows "Benchmark unavailable for stores like yours yet — your audit helps build it." This is honest and frames the data moat as a feature (you're contributing).

### 10.5 Anonymization

The aggregation job only reads `audits.cms_detected`, `audits.page_count`, derived metrics, and (optionally) `audits.cms_metadata.category` — never URLs. Aggregated percentiles cannot be reversed to individual audits. URL hashes are stored for join purposes only (e.g., "this audit already counted") and never exposed.

---

## 11. UI / UX

### 11.1 Design system (locked from brainstorming)

**Palette:**
- Cream (surface): `#fdfaf5`
- Ink (text): `#1a1a18`
- Peach (brand / CTA): `#ff7849`
- Sage (semantic pass / healthy): `#7a9b7e`
- Oat (borders / subtle surfaces): `#e8e2d4`

**Typography:**
- Display / headlines: **Fraunces** (Google Fonts, free, variable)
- Body / UI: **Geist** (Vercel, free)
- Accents / data / mono: **Geist Mono**

**Mascot:** the graph-mouse mark (peach circles + ink lines, two ear nodes + body node + tail). v1.0 ships hand-coded SVG. v1.1+ ships commissioned illustration (see Open Questions).

**Voice:** distinctive, slightly cheeky, never corporate. Reference: Stripe Press × Notion × Linear. No generic SaaS-speak.

### 11.2 Sitemap (v1.0 pages)

```
/                       landing — URL form is the hero
/pricing                full pricing (Free + Pro $19)
/bot                    CrawlmouseBot info page (linked from bot UA)
/login                  magic-link entry
/dashboard              user's audit history + "Run new audit"
/billing                redirect to Stripe Customer Portal
/audit/[id]             live progress + private report view
/r/[slug]               public shareable report (verified domain owners only)
/verify/[id]            domain verification flow (DNS TXT or meta tag)
/embed/[domain]         iframe-served embed badge
/top/[platform]         public leaderboard per CMS (/top/shopify, /top/wordpress, ...)
/compare                competitor compare tool (enter 2 URLs)
/developers             v1.2 pre-announce + early access email capture
/privacy                privacy policy
/terms                  terms of service
/aup                    acceptable use policy
/takedown               takedown request form (verified ownership required)
/404                    custom 404 with mascot
```

### 11.3 Hero (landing `/`)

URL form is the hero. Headline: *"Grade your store's internal linking in under 2 minutes."* Subhead: *"Free. No install. Works on any site."* Single large URL input + "Grade it" button below. Below the fold: 3-up "How it works" cards, sample grade graphic, pricing summary, social proof counter ("X stores graded this week"), FAQ. Footer: standard links + "For developers — Coming Q3 2026" CTA.

### 11.4 Crawl wait UX

Three-layer screen (per locked brainstorming):

1. **Top hero zone:** live force-directed link graph forms in real time as the crawler discovers pages. Sigma.js + Graphology, Force-Atlas-2 layout. Brand-coded nodes (peach ears + body, sage variant for "healthy" pages, ink edges).
2. **Side panel:** drip-fed findings with personality. Text-only in v1.0, mascot illustration in v1.1. Examples:
   - *"Sniffing around your sitemap... found 487 pages."*
   - *"Spotted 4 potential orphan pages already — investigating."*
   - *"Your deepest page is 6 clicks from the homepage. That's gonna cost you."*
3. **Bottom strip:** progress bar, page counter, ETA, "you can close this — email's coming" reassurance. At 60s, email-entry slot slides in: *"Heading out? Drop your email — we'll send the report when it's ready."*

### 11.5 Report page (`/audit/[id]` private, `/r/[slug]` public)

Top: grade card (huge letter, score, peer percentile, finding counts). Right of grade: shareable actions (copy link, tweet, embed code, download CSV [Pro]). Below: the link graph (interactive Sigma.js view, filterable by category). Below: findings tabs (orphans, depth, anchor, structure). Each finding shows: count, top-5 examples free, full list paywalled with CTA. Bottom: "Compared to other [cohort label] sites" benchmark visualization.

### 11.6 Embed badge (`<iframe>`)

Iframe served from `/embed/[domain]` with `Content-Security-Policy` headers + `sandbox="allow-scripts allow-same-origin"`. Renders the grade badge with brand colors. Free tier includes "Powered by Crawlmouse" footer; Pro tier configurable. View count tracked via the iframe request (impressions == requests, not perfect but adequate).

### 11.7 Leaderboard (`/top/[platform]`)

Per-platform leaderboard of top-graded verified sites. Sortable by grade, score, recency. Only shows public reports for sites where the owner verified and explicitly opted in to leaderboard inclusion (opt-in default: yes for verified public reports, with an off toggle in /dashboard). Drives SEO + discovery + vanity sign-ups.

### 11.8 Competitor compare (`/compare`)

Two URL inputs, "Compare" button. Runs two audits in parallel (subject to rate limits), shows grades side-by-side, key metrics deltas. No signup required for the first compare. Highly shareable.

---

## 12. Background Jobs & Events

### 12.1 Inngest functions

| Function ID | Trigger | Purpose |
|---|---|---|
| `crawlmouse.audit` | event `audit.requested` | Run a single audit end-to-end (§6.3) |
| `crawlmouse.aggregate-benchmarks` | cron `0 2 * * *` | Nightly benchmark cohort recompute |
| `crawlmouse.stripe-reconcile` | cron `0 3 * * *` | Daily Stripe customer reconciliation (catch missed webhooks) |
| `crawlmouse.cleanup-stale-audits` | cron `0 4 * * *` | Mark audits stuck in `crawling` >2h as failed |
| `crawlmouse.dispatch-webhook` | event `event.emit` (v1.2) | Deliver webhook to subscribers; retry with backoff |

### 12.2 Event taxonomy

Events emitted by the engine, consumed by SSE (web) and webhooks (v1.2):

```ts
type AuditEvent =
  | { type: 'audit.started'; auditId: string; url: string }
  | { type: 'audit.progress'; auditId: string; phase: 'sitemap' | 'crawl' | 'analyze' | 'score'; pct: number }
  | { type: 'page.discovered'; auditId: string; url: string; title?: string; depth?: number }
  | { type: 'link.found'; auditId: string; from: string; to: string; anchor: string }
  | { type: 'audit.completed'; auditId: string; grade: string; score: number }
  | { type: 'audit.failed'; auditId: string; reason: string }
  | { type: 'grade.changed'; auditId: string; previousGrade: string; newGrade: string }   // for v1.1 re-crawls
  | { type: 'suggestions.ready'; auditId: string; count: number };                         // v1.1
```

### 12.3 SSE delivery (v1.0 browser)

`GET /api/v1/audits/{id}/stream` opens an EventSource. Inngest forwards events via Supabase realtime channel (per-audit channel name). The Next.js route subscribes to the channel and pipes to SSE.

### 12.4 Webhook delivery (v1.2)

`crawlmouse.dispatch-webhook` function reads `webhook_subscriptions` matching the event type, POSTs JSON body with `X-Crawlmouse-Signature: <hmac>` header. Retries 5x with exponential backoff. After final failure, mark subscription as `unhealthy` (UI notice in v1.2 dashboard).

---

## 13. Authentication & Identity

### 13.1 Two-step free flow

**Step 1 — Anonymous audit (no signup).** First-time visitor pastes URL, hits "Grade it." Server creates `audits` row with `anonymous_session_id` (UUID) stored in a `crawlmouse_anon` HTTP-only cookie (180-day TTL). The audit runs. Result viewable via session cookie OR via a one-time magic link emailed if the user provided email.

**Step 2 — Email-magic-link identity (required for: save, re-run, share-public, upgrade).** When the user clicks "Save this report" or "Get the public URL," they enter email; `/api/v1/auth/request-magic-link` sends a Resend email with a 10-minute-TTL single-use token. Clicking the link calls `/api/v1/auth/verify-magic-link`, which mints a Supabase Auth session and links any anonymous audits matching the session cookie to the new user.

### 13.2 Sessions

Supabase Auth manages session JWTs in `httpOnly`, `Secure`, `SameSite=Lax` cookies. Session lifetime: 30 days, sliding. Refresh handled by Supabase Auth client.

### 13.3 Rate limits (per §5.5)

Enforced in middleware. Limits scale with identity tier (anon → email → Pro).

### 13.4 Account deletion

`/api/account/delete` removes the `users` row; CASCADE removes audits, pages, links, findings, public_reports, embed_badges, domain_verifications. Aggregate data is statistical and not retroactively recomputed.

---

## 14. Security

(Detailed eight-surface threat model in brainstorm artifact `security-model.html`; summary below.)

### 14.1 SSRF prevention (highest risk)

`packages/engine/src/ssrf-guard.ts` exports `validateUrl(input: string): Promise<URL>` which:

1. Parses URL. Rejects if scheme ≠ `http://` or `https://`.
2. Resolves DNS (with timeout).
3. Rejects if resolved IP matches:
   - RFC 1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
   - Loopback (127.0.0.0/8)
   - Link-local (169.254.0.0/16)
   - Cloud metadata (`169.254.169.254`, AWS metadata; `fd00:ec2::254` IMDSv6; equivalent GCP/Azure)
   - IPv6 ULA (`fc00::/7`)
4. Disables automatic redirect-following in the HTTP client. Each redirect intercepted, target re-validated via `validateUrl`.

### 14.2 Crawler abuse prevention

Per §6.4: per-host concurrency 8, 250ms stagger, robots.txt, backoff on 429/503. Plus the `audits` table per-domain rate limit (1/60min) which prevents reverse-DDoS even with multiple attackers.

### 14.3 OWASP basics (web app)

- **XSS**: React auto-escapes. No `dangerouslySetInnerHTML` without explicit review. CSP header restricts inline scripts and external sources.
- **CSRF**: SameSite=Lax cookies + double-submit token for state-changing endpoints.
- **SQL injection**: Supabase parameterized queries + RLS. No raw SQL with user input.
- **Open redirect**: redirects only to allowlisted internal paths.
- **Session security**: httpOnly + Secure + SameSite=Lax. HSTS header. Magic-link tokens: 256-bit random, 10-min TTL, single-use.

### 14.4 Embed badge isolation

The badge is an `<iframe>`, NOT a `<script>`. Hosted at `crawlmouse.com/embed/[domain]` with `Content-Security-Policy` and `Permissions-Policy` headers. Sandboxed (`allow-scripts allow-same-origin`). Cookies on `crawlmouse.com` are SameSite=Lax, so they're not shared into the iframe in a third-party context.

### 14.5 Public report enumeration

Public report slugs use `nanoid(22)` (~131 bits of entropy). `noindex, nofollow` HTTP header on all `/r/*` responses. `/r/*` blocked in `robots.txt`. Private reports never URL-shareable (always go through `/audit/[id]` which requires session).

### 14.6 Stripe webhook spoofing

`POST /api/webhooks/stripe` verifies `Stripe-Signature` header using `STRIPE_WEBHOOK_SECRET` (Stripe SDK handles in one line). Dedupes events via `stripe_events.id` primary key. Daily reconciliation cron (§12.1) catches any missed events by comparing local pro_until against Stripe's customer list.

### 14.7 Aggregate data legal exposure

k-anonymity threshold: cohorts < 25 sites are not written or returned. No URLs in aggregate. Privacy policy explicit on aggregation rights. RTBF endpoint at `/api/account/delete`.

### 14.8 v1.2 API key + webhook security (patterns ready in v1.0)

- API keys stored as bcrypt(argon2id) hashes; only the prefix (`cm_live_xxxx_`) is shown in UI for identification.
- Webhook payloads signed with HMAC-SHA256 of `(timestamp + body)` using the subscription `secret`. Nonce + timestamp window prevent replay.
- Staging-URL crawls (v1.2) use envelope-encrypted credentials via Supabase Vault with auto-expiry after the audit completes.

### 14.9 Secrets management

Local dev: `.env.local` (gitignored). Production: Vercel environment variables (encrypted at rest). Required secrets:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
INNGEST_SIGNING_KEY
INNGEST_EVENT_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
TURNSTILE_SECRET_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY
ANTHROPIC_API_KEY                   # v1.1 only
OPENAI_API_KEY                      # v1.1 only (embeddings)
POSTHOG_KEY
SENTRY_DSN
SENTRY_AUTH_TOKEN                   # for source map upload
```

---

## 15. Privacy & Compliance

### 15.1 Legal pages

- `/privacy` — privacy policy (covers data we collect, how we use it, aggregation rights, retention, RTBF)
- `/terms` — terms of service (limit of liability, dispute resolution, EU consumer protection clauses)
- `/aup` — acceptable use policy (no auditing sites you don't own without permission for public reports; no abuse of free tier; no using us for SEO spamming)
- `/takedown` — verified-ownership takedown request

### 15.2 Cookies

Only essential cookies: `crawlmouse_anon` (anonymous session), Supabase Auth session cookies, Stripe Checkout cookies during payment. **No tracking cookies, no third-party trackers.** PostHog configured in cookieless mode. No cookie banner required under most interpretations of GDPR/PECR because we set only essential cookies.

### 15.3 Data retention

- Anonymous audits: 30 days, then auto-purged if not linked to a user
- Authenticated audits: until user deletes them or their account
- Public reports: until takedown or owner removes
- Aggregate data: retained indefinitely (it's statistical, not personal)
- Logs: 14 days
- Stripe webhook events: indefinitely (idempotency requirement)

### 15.4 Subprocessor list

Maintained at `/subprocessors`: Supabase (data + auth), Vercel (hosting), Inngest (jobs), Stripe (payments), Resend (email), Cloudflare (Turnstile + DNS), PostHog (analytics), Sentry (errors), Anthropic (LLM, v1.1+), OpenAI (embeddings, v1.1+). Each link to their security/DPA pages.

### 15.5 Geographic compliance

- **GDPR (UK + general)**: explicit privacy policy, RTBF endpoint, lawful basis (legitimate interest for product operation + consent for marketing emails), processor agreements.
- **CCPA (California)**: "Do not sell my data" trivially honored (we don't sell). Same RTBF endpoint serves CCPA opt-out.
- **PIPEDA (Canada), Privacy Act (Australia)**: aligned with GDPR baseline.

---

## 16. Performance Budgets

| Surface | Budget | Measurement |
|---|---|---|
| Landing page LCP | < 1.5s on 4G | Vercel Speed Insights |
| Audit start latency | < 500ms (URL submit → "crawling" UI) | Server timing header |
| Crawl wall-clock (500 pages) | 2–5 minutes | Inngest function duration |
| Crawl wall-clock (2000 pages, Pro) | 8–20 minutes | Inngest function duration |
| Report page render (private) | < 1s | Vercel Speed Insights |
| Live graph FPS | 60fps at 2000 nodes | Manual perf testing |
| API p95 (non-audit endpoints) | < 200ms | Vercel Edge Insights |
| Database query p95 | < 50ms | Supabase Insights |

If any budget regresses by >50%, treat as a blocking bug.

---

## 17. Error Handling

### 17.1 Categorized failures

| Failure category | Behavior |
|---|---|
| Invalid URL submitted | Reject at validation, show friendly error in form |
| SSRF-blocked URL | Reject at validation, show "We don't crawl internal/private URLs" message |
| Target site returns 404 / 5xx | Mark audit `failed` with `failure_reason='target_unreachable'`, show retry suggestion |
| Cloudflare challenge (1020 / 403 with CF header) | Mark `failed` with `failure_reason='blocked_by_cdn'`, suggest contacting site owner |
| robots.txt forbids crawl | Mark `failed` with `failure_reason='robots_disallowed'`, show explanation |
| Sitemap missing AND homepage crawl fails | Mark `failed` with `failure_reason='no_pages_discoverable'`, suggest providing sitemap URL |
| Crawl exceeds page cap | Sample deterministically, complete audit, show "Showing X of Y discovered pages" notice |
| Crawl exceeds time budget (2h) | Cleanup cron marks `failed`, suggests retry |
| Engine internal error | Sentry captures, audit marked `failed`, generic error to user, on-call alerted |

### 17.2 User-facing error UX

- Errors get the mascot treatment: friendly tone, clear next action, never raw stack traces.
- Every error page has a "Get help" link to a support email (initially the founders').
- Retry-eligible failures show a "Try again" button that re-uses the same audit settings.

### 17.3 Background-job resilience

- Inngest auto-retries each `step.run` with exponential backoff (default 3 attempts).
- Steps are designed to be idempotent (e.g., upsert pages by `(audit_id, url)`).
- Stuck audits (no progress > 2h) cleaned by `crawlmouse.cleanup-stale-audits`.

---

## 18. Testing Strategy

### 18.1 Unit tests (`Vitest`)

- `packages/engine` covered at >80% line coverage
- SSRF guard: explicit test cases for every blocked IP range + a battery of edge cases
- Algorithm tests: hand-crafted graphs with known orphan / depth / HHI expectations
- Grade formula: snapshot tests against a corpus of 20 reference audits

### 18.2 Integration tests

- `apps/web` tRPC procedures tested against a Supabase test project (separate from prod)
- Stripe webhooks tested with Stripe CLI replay
- Inngest functions tested with `@inngest/test`

### 18.3 End-to-end tests (`Playwright`)

Critical-path coverage:
- Anonymous audit submission → live graph appears → report renders
- Email magic-link signup
- Domain verification (mocked DNS / meta tag)
- Public report URL renders + noindex headers correct
- Embed badge iframe loads
- Stripe Checkout → webhook → Pro entitlement granted

### 18.4 Real-world crawl smoke tests

A `scripts/smoke-crawl.ts` script runs the engine against 10 pinned real Shopify / WP / Webflow stores nightly (in dev only). Output diff compared against a known-good baseline — flags regressions in CMS detection or grade calculation against real-world data.

### 18.5 Load testing pre-launch

`k6` or similar to simulate 1000 concurrent audit submissions before launch announcement. Verify Inngest concurrency limits, Supabase connection pooling, Vercel function scaling all hold.

---

## 19. Deployment & Ops

### 19.1 Environments

- **Local dev:** `.env.local`, Supabase local stack (Docker), Inngest dev server
- **Preview:** every PR auto-deploys to Vercel preview with isolated Supabase branch
- **Production:** `main` branch auto-deploys to crawlmouse.com

### 19.2 Pre-launch checklist

- [ ] All env vars set in Vercel production
- [ ] Stripe products + prices created (Free $0, Pro $19/mo, Pro $190/yr)
- [ ] Stripe webhook endpoint registered, secret in Vercel env
- [ ] crawlmouse.com DNS pointed to Vercel (A + AAAA + CNAME for www)
- [ ] Resend domain verified (SPF, DKIM, DMARC)
- [ ] Cloudflare Turnstile site key + secret in env
- [ ] Sentry release tagged, source maps uploaded
- [ ] PostHog project created, key in env
- [ ] Inngest production environment connected
- [ ] Supabase RLS policies tested in production
- [ ] /privacy, /terms, /aup, /takedown, /bot pages live with real content
- [ ] /subprocessors page live
- [ ] 10 reference Shopify / WP / Webflow audits run to seed initial benchmark cohort data
- [ ] PostHog funnel events instrumented (landing-view, audit-submitted, audit-completed, email-captured, public-share-clicked, csv-download, pro-upgrade)
- [ ] Sentry alerts configured for: 5xx errors > 1%, audit-failure rate > 10%, Stripe webhook signature failures
- [ ] Load test passed at 1000 concurrent audits

### 19.3 Observability

- **PostHog**: full conversion funnel, session replay sample on errors
- **Sentry**: error rate by route, by component, release tracking
- **Vercel Speed Insights**: Core Web Vitals
- **Supabase Insights**: DB query performance, row counts, RLS-rejected queries
- **Inngest dashboard**: function run rate, step durations, retry counts
- **Stripe dashboard**: subscription state, churn

### 19.4 Incident response

A `/status` page (hosted on a static separate domain — e.g., status.crawlmouse.com via Vercel) for incident comms. Initial process: founders notified by Sentry alerts; respond within 1h business hours, 4h off-hours. Postmortem within 5 business days for any user-affecting incident.

---

## 20. v1.2 Forward-Compatibility

What v1.0 builds NOW so v1.2 (CLI + GitHub Action + agentic webhooks) is a near-incremental addition, not a rewrite:

| v1.2 Need | v1.0 Provides |
|---|---|
| CLI calls Audit API | `packages/engine` is pure TS lib; `apps/cli` directory placeholder exists |
| API key authentication | `api_keys` table + dual-auth middleware exist; UI hidden in v1.0 |
| Pre-launch / staging crawls | Crawler accepts `basicAuth?` + `headers?` in options |
| Per-deployment tracking | `audits.commit_sha`, `audits.environment`, `audits.branch`, `audits.deployment_id` columns exist |
| Webhook delivery | `webhook_subscriptions` table + Inngest dispatch function pattern designed |
| OpenAPI REST surface | `trpc-openapi` auto-generates from tRPC; `/api/v1/openapi.json` lives at v1.0 |
| Diff against previous audit | Audit comparison can be done via the existing schema; UI added in v1.2 |
| Slack/Discord integrations | Webhook subscribers receive standard signed payloads; partners (Slack app, Discord bot) wrap the webhooks |

**Extra v1.0 effort to enable all of this: ~3.5 days.** Compared to ~2–3 weeks of v1.2 retrofitting if not designed in, this is the easy call.

---

## 21. Open Questions / Decisions Deferred

These do NOT block the build but are noted for future resolution:

1. **Mascot illustration**: hand-coded SVG ships in v1.0; commissioned illustrator brief drafted as separate deliverable. Budget ~$300, 1–2 weeks turnaround. Drop the polished version in before public marketing push.
2. **Grade formula refinement**: weights may need adjustment once we have real audit data. v1.0 ships with the 40/20/20/20 split as `grade-formula-v1`. Plan a re-tune after 1000+ audits in production.
3. **Free-tier example count** (3 vs 5 vs 10 top examples per finding category): v1.0 ships with 5. Easy to A/B test post-launch.
4. **Domain verification default** (DNS TXT vs meta tag): v1.0 surfaces both, defaults to meta tag (lower friction for non-technical merchants). DNS is the "advanced" option.
5. **Export format** (CSV-only vs CSV + Excel): v1.0 ships CSV-only. Excel via library `exceljs` is straightforward to add if requested.
6. **Customer validation conversations**: recommend 5–10 conversations with real Shopify merchants before public launch — concrete validation of the grade hook + paywall placement. Schedule before week 6.
7. **Pre-announce v1.2 timing**: "Coming Q3 2026" is on the landing per agreement; revisit if early-access waitlist signal differs from expectation.
8. **WordPress launch positioning** (`/wp` landing variant): defer until Shopify launch traction is real; build same engine, ship separate marketing page.
9. **Cloudflare Workers re-evaluation**: at 1M+ MAU.
10. **SOC 2 roadmap**: target end of year 2 if dev/agency segment grows; matters for paid enterprise.

---

*End of design specification. Next deliverable: implementation plan, via the writing-plans skill, scoped to v1.0 and the order of build sequencing.*
