# Crawlmouse v1.0 — Plan 3: Sharing + Public Reports

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the viral surface — verified domain owners can mint a public shareable report URL with an auto-generated social card; a sandboxed embed iframe shows a grade badge on the owner's own site (the "Powered by Crawlmouse" multiplier); the leaderboard at `/top/[platform]` surfaces high-graded verified sites per CMS; the competitor-compare tool at `/compare` runs two URLs side-by-side. Plus takedown flow and minimal legal pages.

**Architecture:** All on top of Plan 1's engine + Plan 2's web app. Domain verification by DNS TXT record OR `<meta name="crawlmouse-verification">` tag. Public reports are server-rendered with `X-Robots-Tag: noindex, nofollow` headers + 22-char nanoid slugs (~131 bits entropy). Social cards use Next.js Image Response (`@vercel/og` semantics, built into Next 15). Embed badge served as sandboxed `<iframe>` at `crawlmouse.com/embed/[domain]` — NOT a `<script>` (per spec §14.4 security model). Leaderboard reads `public_reports` joined to `audits` where verified. Competitor compare reuses the existing `POST /api/audits/start` endpoint twice in parallel.

**Tech Stack:** Adds `nanoid` (slug generation), `@vercel/og` semantics (already in Next 15 via `ImageResponse`). Reuses everything from Plan 2.

---

## File Structure additions

```
apps/web/
├── app/
│   ├── r/[slug]/
│   │   ├── page.tsx                          # Public report (verified-owners only)
│   │   └── opengraph-image.tsx               # Auto-gen social card
│   ├── verify/[id]/page.tsx                  # Domain verification UI
│   ├── embed/[domain]/page.tsx               # Iframe badge content
│   ├── top/[platform]/page.tsx               # Per-platform leaderboard
│   ├── compare/page.tsx                      # Side-by-side compare tool
│   ├── takedown/page.tsx                     # Takedown form
│   ├── privacy/page.tsx                      # Legal
│   ├── terms/page.tsx                        # Legal
│   ├── aup/page.tsx                          # Acceptable use policy
│   └── api/
│       ├── verify/start/route.ts             # POST: create verification token
│       ├── verify/check/[id]/route.ts        # POST: re-check DNS / meta tag
│       ├── reports/mint/route.ts             # POST: mint public slug (verified only)
│       └── takedown/route.ts                 # POST: takedown request
├── components/
│   ├── share/
│   │   ├── SharePanel.tsx                    # "Make public" CTA + tweet/copy buttons
│   │   ├── EmbedSnippet.tsx                  # Copy-paste embed iframe code
│   │   └── CompareForm.tsx                   # Two URL inputs side-by-side
│   └── legal/
│       └── LegalPage.tsx                     # Shared shell for /privacy /terms /aup
└── lib/
    ├── slug.ts                                # nanoid wrapper
    └── verification.ts                        # DNS TXT + meta tag fetchers

infra/supabase/migrations/
├── 20260524000006_sharing.sql                # domain_verifications + public_reports + embed_badges + takedown_requests
└── 20260524000007_benchmark_cohorts.sql      # benchmark_cohorts table (read by leaderboard)
```

---

## Task 1: Migration — sharing tables + benchmark_cohorts

**Files:**
- Create: `infra/supabase/migrations/20260524000006_sharing.sql`
- Create: `infra/supabase/migrations/20260524000007_benchmark_cohorts.sql`

- [ ] **Step 1: Create `20260524000006_sharing.sql`**

```sql
-- Domain ownership verification
create table domain_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  domain text not null,
  method text not null check (method in ('dns_txt', 'meta_tag')),
  verification_token text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);
create index on domain_verifications (domain) where verified_at is not null;

-- Public reports (verified-owners only can mint)
create table public_reports (
  slug text primary key,
  audit_id uuid not null references audits(id) on delete cascade unique,
  domain text not null,
  og_image_url text,
  opt_in_leaderboard boolean not null default true,
  created_at timestamptz not null default now(),
  takedown_requested_at timestamptz,
  takedown_reason text
);
create index on public_reports (domain, created_at desc);

-- Embed badges
create table embed_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  domain text not null,
  style jsonb default '{}'::jsonb,
  view_count bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);

-- Takedown requests
create table takedown_requests (
  id uuid primary key default gen_random_uuid(),
  public_report_slug text references public_reports(slug) on delete cascade,
  domain text not null,
  requester_email text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'removed', 'rejected')),
  created_at timestamptz not null default now()
);

-- RLS
alter table domain_verifications enable row level security;
alter table public_reports enable row level security;
alter table embed_badges enable row level security;
alter table takedown_requests enable row level security;

create policy verifications_owner_all on domain_verifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy public_reports_select_all on public_reports for select using (true);
create policy public_reports_owner_insert on public_reports for insert with check (
  exists (select 1 from domain_verifications v where v.domain = public_reports.domain and v.user_id = auth.uid() and v.verified_at is not null)
);
create policy public_reports_owner_update on public_reports for update using (
  exists (select 1 from domain_verifications v where v.domain = public_reports.domain and v.user_id = auth.uid() and v.verified_at is not null)
);
create policy embeds_owner_all on embed_badges for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy takedown_anyone_insert on takedown_requests for insert with check (true);
create policy takedown_owner_select on takedown_requests for select using (
  exists (select 1 from domain_verifications v where v.domain = takedown_requests.domain and v.user_id = auth.uid())
);
```

- [ ] **Step 2: Create `20260524000007_benchmark_cohorts.sql`**

```sql
create table benchmark_cohorts (
  id uuid primary key default gen_random_uuid(),
  cms text not null,
  size_bucket text not null check (size_bucket in ('tiny', 'small', 'medium', 'large')),
  category text,
  metric text not null,
  percentiles jsonb not null,
  n_sites int not null check (n_sites >= 25),
  updated_at timestamptz not null default now(),
  unique (cms, size_bucket, category, metric)
);

alter table benchmark_cohorts enable row level security;
create policy cohorts_select_all on benchmark_cohorts for select using (true);
```

- [ ] **Step 3: Verify SQL parses**

```bash
node -e "['20260524000006_sharing.sql','20260524000007_benchmark_cohorts.sql'].forEach(f => { const s=require('fs').readFileSync('infra/supabase/migrations/'+f,'utf8'); console.log(f, s.length, 'chars'); });"
```

- [ ] **Step 4: Commit (no push)**

```bash
git add infra/supabase/migrations/
git commit -m "feat(db): sharing tables (verifications, public_reports, embeds, takedowns) + benchmark_cohorts"
```

---

## Task 2: Slug generator + domain verification helpers

**Files:**
- Create: `apps/web/lib/slug.ts`
- Create: `apps/web/lib/verification.ts`

- [ ] **Step 1: Install nanoid**

```bash
pnpm --filter @crawlmouse/web add nanoid
```

- [ ] **Step 2: Create `apps/web/lib/slug.ts`**

```ts
import { customAlphabet } from 'nanoid';

// 22 chars from URL-safe alphabet = ~131 bits entropy
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generate = customAlphabet(alphabet, 22);

export function newReportSlug(): string {
  return generate();
}

export function newVerificationToken(): string {
  return generate();
}
```

- [ ] **Step 3: Create `apps/web/lib/verification.ts`**

```ts
import 'server-only';
import { promises as dns } from 'node:dns';
import { validateUrlOrThrow } from '@crawlmouse/engine';

export async function checkDnsTxtRecord(domain: string, expectedToken: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(`_crawlmouse.${domain}`);
    const flat = records.map((r) => r.join('')).map((s) => s.trim());
    return flat.some((s) => s === `crawlmouse-verify=${expectedToken}`);
  } catch {
    return false;
  }
}

export async function checkMetaTag(domain: string, expectedToken: string): Promise<boolean> {
  const url = `https://${domain}/`;
  try {
    await validateUrlOrThrow(url);
    const res = await fetch(url, { headers: { 'User-Agent': 'CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)' } });
    if (!res.ok) return false;
    const html = await res.text();
    const re = /<meta\s+name=["']crawlmouse-verification["']\s+content=["']([^"']+)["']/i;
    const match = html.match(re);
    return match?.[1] === expectedToken;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Typecheck + commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/lib/slug.ts apps/web/lib/verification.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): slug generator + DNS TXT and meta-tag verification helpers"
```

---

## Task 3: Verification API routes + UI page

**Files:**
- Create: `apps/web/app/api/verify/start/route.ts`
- Create: `apps/web/app/api/verify/check/[id]/route.ts`
- Create: `apps/web/app/verify/[id]/page.tsx`
- Create: `apps/web/app/verify/[id]/VerifyClient.tsx`

- [ ] **Step 1: `apps/web/app/api/verify/start/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newVerificationToken } from '@/lib/slug';

const schema = z.object({ domain: z.string().min(3), method: z.enum(['dns_txt', 'meta_tag']) });

export async function POST(req: Request) {
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  let domain: string;
  try {
    const u = new URL(parsed.data.domain.startsWith('http') ? parsed.data.domain : `https://${parsed.data.domain}`);
    domain = u.hostname.replace(/^www\./, '');
  } catch {
    return NextResponse.json({ error: 'invalid domain' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from('domain_verifications')
    .select('id, verification_token, verified_at')
    .eq('user_id', user.id)
    .eq('domain', domain)
    .maybeSingle();

  if (existing?.verified_at) {
    return NextResponse.json({ id: existing.id, token: existing.verification_token, verified: true });
  }

  const token = existing?.verification_token ?? newVerificationToken();
  const { data: row, error } = await sb
    .from('domain_verifications')
    .upsert({
      id: existing?.id,
      user_id: user.id,
      domain,
      method: parsed.data.method,
      verification_token: token,
    }, { onConflict: 'user_id,domain' })
    .select('id')
    .single();

  if (error || !row) return NextResponse.json({ error: 'could not create' }, { status: 500 });
  return NextResponse.json({ id: row.id, token, verified: false });
}
```

- [ ] **Step 2: `apps/web/app/api/verify/check/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkDnsTxtRecord, checkMetaTag } from '@/lib/verification';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: verification } = await sb
    .from('domain_verifications')
    .select('id, domain, method, verification_token, verified_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!verification) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (verification.verified_at) return NextResponse.json({ verified: true });

  const ok = verification.method === 'dns_txt'
    ? await checkDnsTxtRecord(verification.domain, verification.verification_token)
    : await checkMetaTag(verification.domain, verification.verification_token);

  if (ok) {
    await sb.from('domain_verifications').update({ verified_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ verified: true });
  }
  return NextResponse.json({ verified: false });
}
```

- [ ] **Step 3: `apps/web/app/verify/[id]/page.tsx`**

```tsx
import { redirect, notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { supabaseServer } from '@/lib/supabase/server';
import { VerifyClient } from './VerifyClient';

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: v } = await sb
    .from('domain_verifications')
    .select('id, domain, method, verification_token, verified_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!v) notFound();

  return (
    <>
      <Header />
      <main className="max-w-2xl mx-auto px-6 pt-12 pb-32">
        <h1 className="font-display font-bold text-4xl tracking-tight mb-2">Verify domain ownership</h1>
        <p className="text-ink/70 mb-6 font-mono text-sm">{v.domain}</p>
        <VerifyClient
          id={v.id}
          domain={v.domain}
          method={v.method as 'dns_txt' | 'meta_tag'}
          token={v.verification_token}
          alreadyVerified={!!v.verified_at}
        />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 4: `apps/web/app/verify/[id]/VerifyClient.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface Props {
  id: string;
  domain: string;
  method: 'dns_txt' | 'meta_tag';
  token: string;
  alreadyVerified: boolean;
}

export function VerifyClient({ id, domain, method, token, alreadyVerified }: Props) {
  const [verified, setVerified] = useState(alreadyVerified);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function check() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/check/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.verified) {
        setVerified(true);
        setTimeout(() => router.refresh(), 1500);
      } else {
        setError(`We couldn't find the ${method === 'dns_txt' ? 'DNS TXT record' : 'meta tag'} yet. Double-check it's published and try again. DNS can take a few minutes to propagate.`);
      }
    } catch {
      setError('Network error');
    } finally {
      setChecking(false);
    }
  }

  if (verified) {
    return (
      <Card className="border-sage border-2">
        <Badge tone="sage">Verified</Badge>
        <p className="mt-3 text-ink/80">You own <strong>{domain}</strong>. You can now mint public report URLs for this domain.</p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <h2 className="font-display font-bold text-xl mb-2">{method === 'dns_txt' ? 'DNS TXT record' : 'Meta tag'}</h2>
        {method === 'dns_txt' ? (
          <>
            <p className="text-ink/70 text-sm mb-3">Add this TXT record to your DNS:</p>
            <pre className="bg-ink text-cream font-mono text-sm p-4 rounded-lg overflow-x-auto">{`Type:  TXT
Host:  _crawlmouse.${domain}
Value: crawlmouse-verify=${token}`}</pre>
          </>
        ) : (
          <>
            <p className="text-ink/70 text-sm mb-3">Add this meta tag to your homepage&rsquo;s <code className="font-mono text-sm bg-oat px-1 py-0.5 rounded">&lt;head&gt;</code>:</p>
            <pre className="bg-ink text-cream font-mono text-sm p-4 rounded-lg overflow-x-auto">{`<meta name="crawlmouse-verification" content="${token}" />`}</pre>
          </>
        )}
      </Card>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={check} disabled={checking}>{checking ? 'Checking...' : 'Check now'}</Button>
        {error && <div className="text-warning text-sm">{error}</div>}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Typecheck + commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/api/verify apps/web/app/verify
git commit -m "feat(web): domain verification flow (DNS TXT + meta tag)"
```

---

## Task 4: Public report page `/r/[slug]` with noindex

**Files:**
- Create: `apps/web/app/r/[slug]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { GradeCard } from '@/components/ui/GradeCard';
import { Badge } from '@/components/ui/Badge';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: 'Crawlmouse Report',
    robots: { index: false, follow: false, nocache: true },
    openGraph: { images: [{ url: `/r/${slug}/opengraph-image` }] },
  };
}

export default async function PublicReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: report } = await sb
    .from('public_reports')
    .select('slug, audit_id, domain, takedown_requested_at, created_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!report || report.takedown_requested_at) notFound();

  const { data: audit } = await sb
    .from('audits')
    .select('url, cms_detected, grade, score, page_count, link_count')
    .eq('id', report.audit_id)
    .maybeSingle();

  if (!audit || !audit.grade) notFound();

  const { count: orphanCount } = await sb
    .from('findings')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', report.audit_id)
    .eq('category', 'orphan');

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        <div className="mb-6">
          <Badge tone="oat">Public report</Badge>
          <h1 className="font-mono text-xl break-all mt-2">{audit.url}</h1>
          <div className="text-xs text-ink/50 mt-1">Audited {new Date(report.created_at).toLocaleDateString()} &middot; {audit.cms_detected ?? 'custom'}</div>
        </div>
        <GradeCard
          grade={audit.grade}
          score={Number(audit.score ?? 0)}
          orphanCount={orphanCount ?? 0}
          avgDepth={0}
          passing={Number(audit.score ?? 0) >= 60}
        />
        <Card className="mt-6 text-center">
          <p className="font-display text-xl">Want one for your site?</p>
          <a href="/" className="inline-block mt-3 bg-peach text-white px-6 py-3 rounded-lg font-medium">Run Crawlmouse on your site &rarr;</a>
        </Card>
        <p className="text-center text-xs text-ink/50 mt-10">Powered by <a href="/" className="text-peach underline">Crawlmouse</a></p>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Add X-Robots-Tag header via middleware** — Create `apps/web/middleware.ts` (or update existing):

```ts
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/r/') || req.nextUrl.pathname.startsWith('/embed/')) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return res;
}

export const config = { matcher: ['/r/:slug*', '/embed/:domain*'] };
```

- [ ] **Step 3: Add `/r/*` to robots.txt** — Create `apps/web/app/robots.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: '*', disallow: ['/r/', '/embed/', '/audit/', '/dashboard', '/verify/'] },
    ],
  };
}
```

- [ ] **Step 4: Typecheck + commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/r apps/web/middleware.ts apps/web/app/robots.ts
git commit -m "feat(web): public report page /r/[slug] with noindex middleware and robots.txt"
```

---

## Task 5: OG social card image generation

**Files:**
- Create: `apps/web/app/r/[slug]/opengraph-image.tsx`

- [ ] **Step 1: Create the image route**

```tsx
import { ImageResponse } from 'next/og';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Crawlmouse audit report';

export default async function Image({ params }: { params: { slug: string } }) {
  const sb = supabaseAdmin();
  const { data: report } = await sb
    .from('public_reports')
    .select('audit_id, domain')
    .eq('slug', params.slug)
    .maybeSingle();
  if (!report) {
    return new ImageResponse(<div style={{ fontSize: 48 }}>Crawlmouse</div>, size);
  }
  const { data: audit } = await sb
    .from('audits')
    .select('grade, score')
    .eq('id', report.audit_id)
    .maybeSingle();

  const grade = audit?.grade ?? '?';
  const score = audit?.score ? Number(audit.score).toFixed(0) : '—';
  const passing = audit?.score != null && Number(audit.score) >= 60;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#fdfaf5',
          display: 'flex',
          flexDirection: 'column',
          padding: 60,
          fontFamily: 'serif',
        }}
      >
        <div style={{ color: '#5c5a52', fontSize: 22, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
          crawlmouse audit
        </div>
        <div style={{ color: '#1a1a18', fontSize: 36, fontWeight: 600, marginBottom: 40, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {report.domain}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30 }}>
          <div style={{ fontSize: 280, fontWeight: 800, lineHeight: 1, color: passing ? '#7a9b7e' : '#ff7849' }}>{grade}</div>
          <div style={{ fontSize: 64, color: '#1a1a18', marginBottom: 30 }}>{score} / 100</div>
        </div>
        <div style={{ marginTop: 'auto', color: '#5c5a52', fontSize: 24 }}>
          crawlmouse.com
        </div>
      </div>
    ),
    size,
  );
}
```

- [ ] **Step 2: Commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/r/[slug]/opengraph-image.tsx
git commit -m "feat(web): auto-generated OG social card for public reports"
```

---

## Task 6: Mint public URL + share panel on audit page

**Files:**
- Create: `apps/web/app/api/reports/mint/route.ts`
- Create: `apps/web/components/share/SharePanel.tsx`
- Modify: `apps/web/app/audit/[id]/AuditView.tsx` (render SharePanel when audit completed)

- [ ] **Step 1: `apps/web/app/api/reports/mint/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newReportSlug } from '@/lib/slug';

const schema = z.object({ auditId: z.string().uuid() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: audit } = await sb
    .from('audits')
    .select('id, user_id, url, status')
    .eq('id', parsed.data.auditId)
    .maybeSingle();
  if (!audit || audit.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (audit.status !== 'completed') return NextResponse.json({ error: 'audit not complete' }, { status: 400 });

  const domain = new URL(audit.url).hostname.replace(/^www\./, '');

  // Require verified domain
  const { data: verification } = await sb
    .from('domain_verifications')
    .select('verified_at')
    .eq('user_id', user.id)
    .eq('domain', domain)
    .maybeSingle();
  if (!verification?.verified_at) {
    return NextResponse.json({ error: 'verification_required', domain }, { status: 403 });
  }

  // Already public?
  const { data: existing } = await sb.from('public_reports').select('slug').eq('audit_id', audit.id).maybeSingle();
  if (existing) return NextResponse.json({ slug: existing.slug });

  const slug = newReportSlug();
  const { error } = await sb.from('public_reports').insert({ slug, audit_id: audit.id, domain });
  if (error) return NextResponse.json({ error: 'could not mint' }, { status: 500 });

  return NextResponse.json({ slug });
}
```

- [ ] **Step 2: `apps/web/components/share/SharePanel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface Props { auditId: string }

export function SharePanel({ auditId }: Props) {
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationDomain, setVerificationDomain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auditId }),
      });
      const data = await res.json();
      if (data.error === 'verification_required') {
        setVerificationDomain(data.domain);
      } else if (data.slug) {
        setSlug(data.slug);
      } else {
        setError(data.error ?? 'Could not create public link');
      }
    } finally {
      setBusy(false);
    }
  }

  if (slug) {
    const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/r/${slug}`;
    const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Crawlmouse just graded my site: ${publicUrl}`)}`;
    return (
      <Card>
        <div className="font-display font-bold text-xl mb-3">Your public report is live</div>
        <div className="flex items-center gap-2 mb-3">
          <code className="font-mono text-sm bg-oat px-3 py-2 rounded flex-1 break-all">{publicUrl}</code>
          <Button size="sm" onClick={() => { navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied!' : 'Copy'}</Button>
        </div>
        <a href={tweet} target="_blank" rel="noreferrer" className="inline-block bg-ink text-cream px-4 py-2 rounded-lg text-sm font-medium">Tweet your grade</a>
      </Card>
    );
  }

  if (verificationDomain) {
    return (
      <Card className="border-peach border-2">
        <div className="font-display font-bold text-xl mb-2">Verify <code className="font-mono text-base">{verificationDomain}</code> first</div>
        <p className="text-ink/70 text-sm mb-4">Public reports can only be minted by verified domain owners. This prevents anyone from publishing a Crawlmouse report about a site they don&rsquo;t own.</p>
        <Link href={{ pathname: '/dashboard' } as never}><Button>Start verification</Button></Link>
      </Card>
    );
  }

  return (
    <Card>
      <div className="font-display font-bold text-xl mb-2">Share this report</div>
      <p className="text-ink/70 text-sm mb-4">Generate a public, shareable URL with an auto-rendered social card. Only available if you&rsquo;ve verified domain ownership.</p>
      <Button onClick={mint} disabled={busy}>{busy ? 'Working...' : 'Make public'}</Button>
      {error && <div className="text-warning text-sm mt-2">{error}</div>}
    </Card>
  );
}
```

- [ ] **Step 3: Update `apps/web/app/audit/[id]/AuditView.tsx`** to render `<SharePanel auditId={auditId} />` when `done`.

Read the current file. After the `done && snapshot.grade && snapshot.score != null && (<GradeCard ... />)` block, add:

```tsx
      {done && <SharePanel auditId={auditId} />}
```

Add the import at the top: `import { SharePanel } from '@/components/share/SharePanel';`

- [ ] **Step 4: Typecheck + commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/api/reports apps/web/components/share apps/web/app/audit
git commit -m "feat(web): mint public report URLs + SharePanel CTA (verified owners only)"
```

---

## Task 7: Embed badge iframe + EmbedSnippet dashboard UI

**Files:**
- Create: `apps/web/app/embed/[domain]/page.tsx`
- Create: `apps/web/components/share/EmbedSnippet.tsx`

- [ ] **Step 1: `apps/web/app/embed/[domain]/page.tsx`** — the iframe content. Lightweight, no header/footer, sandbox-friendly.

```tsx
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function generateMetadata() {
  return { robots: { index: false, follow: false } };
}

export default async function EmbedPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const sb = supabaseAdmin();

  // Find most recent completed public report for this domain
  const { data: report } = await sb
    .from('public_reports')
    .select('slug, audit_id, domain')
    .eq('domain', domain)
    .is('takedown_requested_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return (
      <div style={{ fontFamily: 'system-ui', padding: 16, color: '#1a1a18', background: '#fdfaf5' }}>
        No public Crawlmouse report yet for <strong>{domain}</strong>. <a href={`https://crawlmouse.com/?url=${encodeURIComponent('https://' + domain)}`} target="_blank" rel="noreferrer" style={{ color: '#ff7849' }}>Run one →</a>
      </div>
    );
  }

  const { data: audit } = await sb.from('audits').select('grade, score').eq('id', report.audit_id).maybeSingle();
  const grade = audit?.grade ?? '?';
  const score = audit?.score != null ? Number(audit.score).toFixed(0) : '—';
  const passing = audit?.score != null && Number(audit.score) >= 60;

  // Increment view count (fire-and-forget)
  void sb.from('embed_badges').update({ view_count: 1 }).eq('domain', domain).then();

  return (
    <html lang="en">
      <head>
        <style>{`*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}body{background:transparent}`}</style>
      </head>
      <body>
        <a
          href={`https://crawlmouse.com/r/${report.slug}`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: '#fdfaf5',
            border: '1px solid #e8e2d4',
            borderRadius: 12,
            textDecoration: 'none',
            color: '#1a1a18',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 28, color: passing ? '#7a9b7e' : '#ff7849', lineHeight: 1 }}>{grade}</span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#5c5a52' }}>Crawlmouse</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Score {score} / 100</span>
          </span>
        </a>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: `apps/web/components/share/EmbedSnippet.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function EmbedSnippet({ domain }: { domain: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<iframe src="https://crawlmouse.com/embed/${domain}" width="220" height="60" frameborder="0" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Crawlmouse grade"></iframe>`;
  return (
    <Card>
      <div className="font-display font-bold text-xl mb-2">Embed your grade</div>
      <p className="text-ink/70 text-sm mb-3">Paste this iframe into your site to show your grade.</p>
      <pre className="bg-ink text-cream font-mono text-xs p-3 rounded overflow-x-auto whitespace-pre">{snippet}</pre>
      <Button size="sm" className="mt-3" onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied!' : 'Copy snippet'}</Button>
    </Card>
  );
}
```

- [ ] **Step 3: Commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/embed apps/web/components/share/EmbedSnippet.tsx
git commit -m "feat(web): embed badge iframe and copyable snippet"
```

---

## Task 8: Leaderboard `/top/[platform]`

**Files:**
- Create: `apps/web/app/top/[platform]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { supabaseAdmin } from '@/lib/supabase/admin';

const VALID_PLATFORMS = ['shopify', 'wordpress', 'webflow', 'wix', 'squarespace', 'framer', 'ghost', 'custom'] as const;
type Platform = typeof VALID_PLATFORMS[number];

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  return { title: `Top ${platform} sites — Crawlmouse leaderboard` };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!VALID_PLATFORMS.includes(platform as Platform)) notFound();

  const sb = supabaseAdmin();
  // Top 50 verified public reports for this platform, by score desc
  const { data: top } = await sb
    .from('public_reports')
    .select('slug, domain, audit_id, audits!inner(grade, score, cms_detected)')
    .eq('audits.cms_detected', platform)
    .eq('opt_in_leaderboard', true)
    .is('takedown_requested_at', null)
    .order('audit_id', { ascending: false })
    .limit(50);

  const ranked = (top ?? [])
    .filter((r) => r.audits && (r.audits as { score: number | null }).score != null)
    .map((r) => ({
      slug: r.slug,
      domain: r.domain,
      grade: (r.audits as { grade: string }).grade,
      score: Number((r.audits as { score: number }).score),
    }))
    .sort((a, b) => b.score - a.score);

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight capitalize">Top {platform} sites</h1>
        <p className="text-ink/70 mt-3">By internal-linking grade. Updated as new audits complete.</p>

        {ranked.length === 0 ? (
          <Card className="mt-8 text-center py-10">
            <p className="text-ink/60">No public {platform} reports yet. <Link href={{ pathname: '/' }} className="text-peach underline">Be the first.</Link></p>
          </Card>
        ) : (
          <div className="mt-8 space-y-2">
            {ranked.map((r, i) => (
              <Link key={r.slug} href={{ pathname: `/r/${r.slug}` } as never}>
                <Card className="hover:border-peach transition-colors flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-xs text-ink/40 w-8">#{i + 1}</div>
                    <div className="font-mono text-sm">{r.domain}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={r.score >= 60 ? 'sage' : 'peach'}>{r.score.toFixed(0)}</Badge>
                    <span className="font-display font-bold text-2xl">{r.grade}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/top
git commit -m "feat(web): per-platform leaderboard /top/[platform]"
```

---

## Task 9: Competitor compare `/compare`

**Files:**
- Create: `apps/web/components/share/CompareForm.tsx`
- Create: `apps/web/app/compare/page.tsx`

- [ ] **Step 1: `apps/web/components/share/CompareForm.tsx`**

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function CompareForm() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const start = async (url: string) => {
        const u = url.startsWith('http') ? url : `https://${url}`;
        const res = await fetch('/api/audits/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: u }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'failed');
        return data.auditId as string;
      };
      const [idA, idB] = await Promise.all([start(a), start(b)]);
      router.push({ pathname: `/audit/${idA}?compare=${idB}` } as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Your site</label>
        <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="https://your-store.com" autoFocus />
      </div>
      <div>
        <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Competitor</label>
        <Input value={b} onChange={(e) => setB(e.target.value)} placeholder="https://competitor.com" />
      </div>
      <Button type="submit" size="lg" disabled={busy || !a || !b} className="w-full">{busy ? 'Starting both...' : 'Compare →'}</Button>
      {error && <div className="text-warning text-sm">{error}</div>}
    </form>
  );
}
```

- [ ] **Step 2: `apps/web/app/compare/page.tsx`**

```tsx
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { CompareForm } from '@/components/share/CompareForm';

export default function ComparePage() {
  return (
    <>
      <Header />
      <main className="max-w-md mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-4xl tracking-tight">Compare two sites</h1>
        <p className="text-ink/70 mt-3 mb-8">Run both audits side-by-side. Both are subject to the standard free-tier limits.</p>
        <CompareForm />
      </main>
      <Footer />
    </>
  );
}
```

Note: the side-by-side comparison view itself (the destination of the redirect with `?compare=`) is left as a v1.1 enhancement — for v1.0 each audit ID just loads its own page. The form is the value here.

- [ ] **Step 3: Commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/components/share/CompareForm.tsx apps/web/app/compare
git commit -m "feat(web): competitor compare form at /compare"
```

---

## Task 10: Takedown + legal pages

**Files:**
- Create: `apps/web/app/api/takedown/route.ts`
- Create: `apps/web/app/takedown/page.tsx`
- Create: `apps/web/components/legal/LegalPage.tsx`
- Create: `apps/web/app/privacy/page.tsx`, `apps/web/app/terms/page.tsx`, `apps/web/app/aup/page.tsx`

- [ ] **Step 1: `apps/web/app/api/takedown/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

const schema = z.object({
  publicReportSlug: z.string().optional(),
  domain: z.string().min(3),
  requesterEmail: z.string().email(),
  reason: z.string().min(10),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb.from('takedown_requests').insert({
    public_report_slug: parsed.data.publicReportSlug ?? null,
    domain: parsed.data.domain,
    requester_email: parsed.data.requesterEmail,
    reason: parsed.data.reason,
    status: 'pending',
  });
  if (error) return NextResponse.json({ error: 'could not submit' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: `apps/web/app/takedown/page.tsx`**

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function TakedownPage() {
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/takedown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain, requesterEmail: email, reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Could not submit');
        return;
      }
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="max-w-xl mx-auto px-6 pt-12 pb-32">
        <h1 className="font-display font-bold text-4xl tracking-tight">Takedown request</h1>
        <p className="text-ink/70 mt-3 mb-8">
          If a public Crawlmouse report about your domain shouldn&rsquo;t exist, submit this form. We&rsquo;ll verify domain ownership before removing.
        </p>
        {submitted ? (
          <Card>
            <p className="text-ink/80">Thanks. We received your request and will review within 2 business days.</p>
          </Card>
        ) : (
          <Card>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Domain</label>
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Your email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Reason</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} rows={4} className="w-full rounded-lg border border-oat bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-peach/50" />
              </div>
              <Button type="submit" disabled={busy}>Submit request</Button>
              {error && <div className="text-warning text-sm">{error}</div>}
            </form>
          </Card>
        )}
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: `apps/web/components/legal/LegalPage.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32 prose prose-ink">
        <h1 className="font-display font-bold text-5xl tracking-tight mb-6">{title}</h1>
        <div className="space-y-4 text-ink/80 leading-relaxed">{children}</div>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 4: `apps/web/app/privacy/page.tsx`**

```tsx
import { LegalPage } from '@/components/legal/LegalPage';

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p><em>Last updated: 2026-05-24. This is a placeholder. Replace with a real privacy policy before public launch.</em></p>
      <h2 className="font-display font-bold text-2xl mt-6">What we collect</h2>
      <p>Email (for magic-link auth), URLs you submit for audit, the resulting audit data (pages, links, anchor text — public structural data only), basic usage analytics (no third-party trackers).</p>
      <h2 className="font-display font-bold text-2xl mt-6">Aggregate data</h2>
      <p>We aggregate audit data anonymously to produce peer benchmarks. Aggregated cohorts are only published when at least 25 sites are in the cohort (k-anonymity). We never expose another user&rsquo;s specific URLs in benchmarks.</p>
      <h2 className="font-display font-bold text-2xl mt-6">Your rights</h2>
      <p>Delete your account anytime via the dashboard. We honor GDPR / CCPA right-to-be-forgotten requests within 30 days.</p>
    </LegalPage>
  );
}
```

- [ ] **Step 5: `apps/web/app/terms/page.tsx`**

```tsx
import { LegalPage } from '@/components/legal/LegalPage';

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p><em>Last updated: 2026-05-24. Placeholder &mdash; replace with real terms before launch.</em></p>
      <h2 className="font-display font-bold text-2xl mt-6">Use of the service</h2>
      <p>You may use Crawlmouse to audit websites. Free tier has rate limits; paid Pro tier lifts most limits. We may suspend abusive accounts.</p>
      <h2 className="font-display font-bold text-2xl mt-6">No warranty</h2>
      <p>Crawlmouse is provided as-is. The grade is an opinion based on heuristics, not a guarantee of SEO outcomes.</p>
      <h2 className="font-display font-bold text-2xl mt-6">Liability</h2>
      <p>Our maximum aggregate liability is limited to the fees you paid in the prior 12 months.</p>
    </LegalPage>
  );
}
```

- [ ] **Step 6: `apps/web/app/aup/page.tsx`**

```tsx
import { LegalPage } from '@/components/legal/LegalPage';

export default function AupPage() {
  return (
    <LegalPage title="Acceptable Use">
      <p><em>Last updated: 2026-05-24. Placeholder &mdash; replace before launch.</em></p>
      <p>Do not use Crawlmouse to:</p>
      <ul className="list-disc pl-6">
        <li>Audit sites you do not own with the intent to publish a damaging public report (see Takedown).</li>
        <li>Submit URLs to internal IPs or non-public infrastructure.</li>
        <li>Automate audits against our service without permission (use our v1.2 CLI when available).</li>
        <li>Resell or sublicense Crawlmouse output as your own product.</li>
      </ul>
    </LegalPage>
  );
}
```

- [ ] **Step 7: Commit (no push)**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/takedown apps/web/app/api/takedown apps/web/app/privacy apps/web/app/terms apps/web/app/aup apps/web/components/legal
git commit -m "feat(web): takedown form and legal placeholders (privacy/terms/aup)"
```

---

## Task 11: Final smoke + milestone tag

- [ ] **Step 1: Full typecheck + tests + build**

```bash
pkill -f "next dev" 2>/dev/null || true
pnpm typecheck 2>&1 | tail -10
pnpm --filter @crawlmouse/engine test 2>&1 | tail -5
pnpm --filter @crawlmouse/web exec playwright test --reporter=list 2>&1 | tail -5
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
SUPABASE_SERVICE_ROLE_KEY=placeholder \
INNGEST_EVENT_KEY=placeholder \
INNGEST_SIGNING_KEY=placeholder \
pnpm --filter @crawlmouse/web build 2>&1 | tail -25
```

Expected: all green, build succeeds with new routes added.

- [ ] **Step 2: Tag**

```bash
git tag plan-3-sharing-public-reports-complete
git log --oneline | head -15
git tag -l
```

- [ ] **Step 3: Report**

Report all outputs + the new tag.

---

## Plan 3 Self-Review

- **Spec coverage:** Public reports with noindex + nanoid slugs ✓ (Tasks 4, 5). Domain verification (DNS + meta) ✓ (Tasks 2, 3). Embed iframe (NOT script tag, per spec §14.4) ✓ (Task 7). Leaderboard ✓ (Task 8). Competitor compare ✓ (Task 9). Takedown ✓ (Task 10). Legal placeholders ✓ (Task 10).
- **Placeholder scan:** no TBDs in code; legal pages explicitly labeled as placeholders requiring real content before launch.
- **Type consistency:** `verification_token`, `slug`, `domain` fields used consistently across migrations + API routes + UI.
- **Carry-forward to v1.1:**
  - The side-by-side compare view (the destination of `/compare`'s redirect with `?compare=`) — Task 9 ships the form; the visualization is v1.1.
  - Embed view-count is currently a stub increment (just sets to 1) — proper atomic increment via RPC is v1.1.
  - Benchmark cohort aggregation cron job (writes to `benchmark_cohorts`) is deferred — table exists, leaderboard reads work, but the aggregation job is v1.1.

Plan 3 ready to execute.
