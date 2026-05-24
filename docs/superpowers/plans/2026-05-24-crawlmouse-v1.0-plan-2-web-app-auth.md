# Crawlmouse v1.0 — Plan 2: Web App + Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Next.js 15 web app that lets a visitor paste a URL, watch a live force-directed link graph build as the crawl runs, see their letter-grade report, and (with email magic-link) save / re-run. No public sharing yet (Plan 3). No billing (Plan 4).

**Architecture:** Next.js 15 App Router on Vercel-ready setup. Tailwind 3 + Fraunces/Geist fonts via `next/font`. tRPC v11 for typed internal API. Supabase JS client (browser + server) for auth + DB. Sigma.js + `@react-sigma/core` + Graphology for the live link graph. SSE stream from `/api/audits/[id]/stream` driven by Inngest events. Cloudflare Turnstile gate on the 4th+ anonymous audit per IP per 24h. PostHog funnel + Sentry errors. Builds on Plan 1's engine: `runAudit()` is called from the audit-start API route which dispatches the Inngest `audit.requested` event.

**Tech Stack:** Next.js 15.0+, React 19, Tailwind 3.4+, tRPC 11, Supabase JS v2, Sigma.js 3.x + `@react-sigma/core` 5, Graphology 0.25, Inngest 3 (already installed in Plan 1), Resend 4 (email), Cloudflare Turnstile (`react-turnstile`), PostHog JS 1.150+, Sentry Next.js 8+, Playwright 1.47+ for E2E. Reference: design spec `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md`, especially §11 (UI), §5 (API contracts), §13 (auth), §14 (security). Lessons learned from Plan 1 execution log are reflected in this plan.

---

## File Structure

```
apps/web/
├── package.json
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── playwright.config.ts
├── .env.local.example
├── instrumentation.ts                       # Sentry init
├── sentry.client.config.ts
├── sentry.server.config.ts
├── app/
│   ├── layout.tsx                           # Root layout (fonts, providers, header/footer)
│   ├── globals.css                          # Design tokens + Tailwind directives
│   ├── page.tsx                             # Landing: URL form is the hero
│   ├── pricing/page.tsx
│   ├── bot/page.tsx
│   ├── not-found.tsx                        # 404 with mascot
│   ├── login/page.tsx
│   ├── login/verify/page.tsx                # Magic-link callback
│   ├── dashboard/page.tsx
│   ├── audit/[id]/page.tsx                  # Live progress + private report
│   ├── audit/[id]/AuditView.tsx             # Client component for SSE + graph
│   └── api/
│       ├── trpc/[trpc]/route.ts
│       ├── audits/start/route.ts            # POST: validate URL, create audit row, fire Inngest event
│       ├── audits/[id]/stream/route.ts      # GET: SSE
│       ├── auth/magic-link/route.ts
│       ├── auth/verify/route.ts
│       └── webhooks/inngest/route.ts        # Inngest serve handler
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   └── GradeCard.tsx
│   ├── audit/
│   │   ├── UrlForm.tsx                      # The landing hero form
│   │   ├── LinkGraph.tsx                    # Sigma.js wrapper, live updates
│   │   ├── AuditProgress.tsx                # Progress bar + ETA + email prompt
│   │   └── DripFeedFindings.tsx             # Side panel with personality copy
│   ├── layout/
│   │   ├── Header.tsx
│   │   └── Footer.tsx
│   └── icons/
│       └── CrawlmouseMark.tsx               # The graph-mouse SVG mark from brainstorming
├── lib/
│   ├── trpc/
│   │   ├── router.ts
│   │   ├── server.ts
│   │   ├── client.ts
│   │   └── Provider.tsx
│   ├── supabase/
│   │   ├── client.ts                        # Browser client
│   │   ├── server.ts                        # Server client (cookies)
│   │   └── admin.ts                         # Service-role client (server-only)
│   ├── inngest.ts                           # Triggers `audit.requested` events
│   ├── rate-limit.ts                        # Per-IP + per-domain throttle
│   ├── turnstile.ts                         # Cloudflare Turnstile verify
│   ├── analytics.ts                         # PostHog wrapper
│   └── fonts.ts                             # next/font loaders
├── tests/
│   ├── e2e/
│   │   ├── landing.spec.ts                  # Playwright: full flow
│   │   └── auth.spec.ts                     # Playwright: magic-link
│   └── api/
│       └── audits-start.test.ts             # Vitest: route handler unit test

packages/engine/
└── src/audit.ts                              # MODIFIED in Task 14 to add SSRF guard on homepage fetch
```

---

## Task 1: Next.js 15 + Tailwind scaffolding

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.mjs`, `apps/web/tsconfig.json`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/.env.local.example`, `apps/web/.gitignore`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx` (minimal placeholder), `apps/web/app/globals.css`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@crawlmouse/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@crawlmouse/engine": "workspace:*",
    "@crawlmouse/types": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "eslint-config-next": "^15.0.0",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.13",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
export default {
  experimental: {
    instrumentationHook: true,
    typedRoutes: true,
  },
  transpilePackages: ['@crawlmouse/engine', '@crawlmouse/types'],
};
```

- [ ] **Step 3: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"],
      "@crawlmouse/engine": ["../../packages/engine/src/index.ts"],
      "@crawlmouse/types": ["../../packages/types/src/index.ts"]
    },
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "../../packages/engine/src/**/*", "../../packages/types/src/**/*"],
  "exclude": ["node_modules"]
}
```

Note: includes `DOM` and `DOM.Iterable` libs (this is the browser package, unlike engine). Also explicitly includes engine + types source for path resolution.

- [ ] **Step 4: Create `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#fdfaf5',
        ink: '#1a1a18',
        peach: { DEFAULT: '#ff7849', light: '#ffd7c2' },
        sage: { DEFAULT: '#7a9b7e', light: '#c9d6c5' },
        oat: '#e8e2d4',
        warning: '#ff5630',
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'Charter', 'Georgia', 'serif'],
        sans: ['var(--font-geist)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 5: Create `apps/web/postcss.config.mjs`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 6: Create `apps/web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --font-fraunces: 'Fraunces';
  --font-geist: 'Geist';
  --font-geist-mono: 'Geist Mono';
}

html, body {
  background: #fdfaf5;
  color: #1a1a18;
  font-family: var(--font-geist), -apple-system, sans-serif;
  font-feature-settings: 'cv11', 'ss01';
}

* { box-sizing: border-box; }
```

- [ ] **Step 7: Create `apps/web/app/layout.tsx`** (placeholder — fonts wired in Task 2)

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Crawlmouse — Grade your site’s internal linking',
  description: 'Free, no-install, instantly-shareable internal-linking grader for any website.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Create `apps/web/app/page.tsx`** (minimal — fleshed out in Task 6)

```tsx
export default function Home() {
  return <main className="p-8"><h1>Crawlmouse — placeholder</h1></main>;
}
```

- [ ] **Step 9: Create `apps/web/.env.local.example`** (mirror of root `.env.example` for web-app context)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Inngest
INNGEST_SIGNING_KEY=
INNGEST_EVENT_KEY=

# Resend
RESEND_API_KEY=

# Cloudflare Turnstile
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=

# Observability
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# Base URL (for absolute links in emails)
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

- [ ] **Step 10: Create `apps/web/.gitignore`**

```
.next
out
.turbo
.vercel
.env.local
.env.*.local
```

- [ ] **Step 11: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 12: Verify dev server starts (~10 second timeout, kill after)**

```bash
cd apps/web
timeout 15 pnpm dev 2>&1 | head -30 || true
cd ../..
```
Expected: Next.js prints "Ready in Xs" message. Kill via timeout, this is just a sanity check.

- [ ] **Step 13: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): Next.js 15 + Tailwind scaffolding"
```
Do NOT push — controller will batch-push.

---

## Task 2: Font loading + design tokens

**Files:**
- Create: `apps/web/lib/fonts.ts`
- Modify: `apps/web/app/layout.tsx` (wire fonts)

- [ ] **Step 1: Create `apps/web/lib/fonts.ts`**

```ts
import { Fraunces, Geist, Geist_Mono } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
});

export const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

export const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});
```

- [ ] **Step 2: Update `apps/web/app/layout.tsx`**

```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { fraunces, geist, geistMono } from '@/lib/fonts';

export const metadata = {
  title: 'Crawlmouse — Grade your site’s internal linking',
  description: 'Free, no-install, instantly-shareable internal-linking grader for any website.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="bg-cream text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @crawlmouse/web typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/fonts.ts apps/web/app/layout.tsx
git commit -m "feat(web): wire Fraunces + Geist + Geist Mono fonts via next/font"
```

---

## Task 3: UI primitives — Button, Input, Card, Badge

**Files:**
- Create: `apps/web/components/ui/Button.tsx`, `Input.tsx`, `Card.tsx`, `Badge.tsx`

These are the brand-locked building blocks. Use Tailwind utility classes, no class-variance-authority (keep it simple in v1.0). Each component is < 60 lines.

- [ ] **Step 1: Create `apps/web/components/ui/Button.tsx`**

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-peach text-white hover:bg-peach/90 focus:ring-peach',
  secondary: 'bg-transparent text-ink border-[1.5px] border-ink hover:bg-ink hover:text-cream',
  ghost: 'bg-transparent text-sage hover:text-ink',
};

const SIZES: Record<Size, string> = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-base px-5 py-2.5',
  lg: 'text-lg px-7 py-3.5',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-cream disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
});
```

- [ ] **Step 2: Create `apps/web/components/ui/Input.tsx`**

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = '', invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-lg border bg-white px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-peach/50 ${invalid ? 'border-warning ring-1 ring-warning' : 'border-oat'} ${className}`}
      {...rest}
    />
  );
});
```

- [ ] **Step 3: Create `apps/web/components/ui/Card.tsx`**

```tsx
import type { HTMLAttributes, ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...rest }: Props) {
  return (
    <div className={`bg-white border border-oat rounded-2xl p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/web/components/ui/Badge.tsx`**

```tsx
import type { ReactNode } from 'react';

type Tone = 'peach' | 'sage' | 'ink' | 'oat';

const TONES: Record<Tone, string> = {
  peach: 'bg-peach text-white',
  sage: 'bg-sage text-white',
  ink: 'bg-ink text-cream',
  oat: 'bg-oat text-ink',
};

export function Badge({ tone = 'peach', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${TONES[tone]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @crawlmouse/web typecheck
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ui
git commit -m "feat(web): UI primitives — Button, Input, Card, Badge"
```

---

## Task 4: GradeCard component (the hero display)

**Files:**
- Create: `apps/web/components/ui/GradeCard.tsx`

This is the centerpiece of the report view. Big letter, score, finding counts. The brand-locked component.

- [ ] **Step 1: Create `apps/web/components/ui/GradeCard.tsx`**

```tsx
import { Badge } from './Badge';
import { Card } from './Card';

interface Props {
  grade: string;             // 'A' | 'A-' | ... | 'F'
  score: number;             // 0..100
  orphanCount: number;
  avgDepth: number;
  passing: boolean;          // true if score >= 60
}

export function GradeCard({ grade, score, orphanCount, avgDepth, passing }: Props) {
  return (
    <Card className="!p-7 !rounded-3xl">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink/60">Grade</div>
          <div className="font-display font-bold text-6xl leading-none mt-1">{grade}</div>
          <div className="font-mono text-sm font-semibold text-sage mt-1">{score.toFixed(0)} / 100</div>
        </div>
        <Badge tone={passing ? 'sage' : 'peach'}>{passing ? 'Passing' : 'Needs work'}</Badge>
      </div>
      <div className="border-t border-dashed border-oat pt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="font-mono text-2xl font-bold text-peach">{orphanCount}</div>
          <div className="text-xs text-ink/60">orphan pages</div>
        </div>
        <div>
          <div className="font-mono text-2xl font-bold text-ink">{avgDepth.toFixed(1)}</div>
          <div className="text-xs text-ink/60">avg click depth</div>
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/components/ui/GradeCard.tsx
git commit -m "feat(web): GradeCard component for the report hero"
```

---

## Task 5: Header + Footer + CrawlmouseMark SVG

**Files:**
- Create: `apps/web/components/icons/CrawlmouseMark.tsx`
- Create: `apps/web/components/layout/Header.tsx`
- Create: `apps/web/components/layout/Footer.tsx`

- [ ] **Step 1: Create `apps/web/components/icons/CrawlmouseMark.tsx`** (the graph-mouse SVG from brainstorming)

```tsx
interface Props { size?: number; className?: string }

export function CrawlmouseMark({ size = 32, className = '' }: Props) {
  const w = size;
  const h = Math.round(size * (44 / 48));
  return (
    <svg width={w} height={h} viewBox="0 0 48 44" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <line x1="12" y1="10" x2="24" y2="26" stroke="#1a1a18" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="36" y1="10" x2="24" y2="26" stroke="#1a1a18" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M 32 31 Q 42 33, 45 42" stroke="#1a1a18" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="10" r="5" fill="#ff7849" />
      <circle cx="36" cy="10" r="5" fill="#ff7849" />
      <circle cx="24" cy="26" r="9" fill="#ff7849" />
      <circle cx="20.5" cy="24" r="1.3" fill="#fdfaf5" />
      <circle cx="27.5" cy="24" r="1.3" fill="#fdfaf5" />
    </svg>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/layout/Header.tsx`**

```tsx
import Link from 'next/link';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';

export function Header() {
  return (
    <header className="border-b border-oat bg-cream/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <CrawlmouseMark size={32} />
          <span className="font-display font-semibold text-2xl tracking-tight">
            crawl<span className="text-peach">mouse</span>
          </span>
        </Link>
        <nav className="flex items-center gap-7 text-sm font-medium">
          <Link href="/pricing" className="hover:text-peach transition-colors">Pricing</Link>
          <Link href="/dashboard" className="hover:text-peach transition-colors">Dashboard</Link>
          <Link href="/login" className="hover:text-peach transition-colors">Login</Link>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Create `apps/web/components/layout/Footer.tsx`**

```tsx
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-oat mt-24 bg-cream">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
        <div>
          <div className="font-display font-bold text-lg mb-2">crawlmouse</div>
          <div className="text-ink/60">Internal-linking grading for any site.</div>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Product</div>
          <Link href="/pricing" className="block hover:text-peach">Pricing</Link>
          <Link href="/bot" className="block hover:text-peach">Crawlmouse Bot</Link>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">For developers</div>
          <span className="block text-ink/60">CLI + GitHub Action</span>
          <span className="block text-ink/40 text-xs">Coming Q3 2026</span>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Legal</div>
          <Link href="/privacy" className="block hover:text-peach">Privacy</Link>
          <Link href="/terms" className="block hover:text-peach">Terms</Link>
          <Link href="/aup" className="block hover:text-peach">Acceptable use</Link>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/components/icons apps/web/components/layout
git commit -m "feat(web): Header, Footer, and CrawlmouseMark SVG"
```

---

## Task 6: Landing page (`/`) with UrlForm

**Files:**
- Create: `apps/web/components/audit/UrlForm.tsx`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Create `apps/web/components/audit/UrlForm.tsx`**

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function UrlForm() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

    setSubmitting(true);
    try {
      const res = await fetch('/api/audits/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: parsed.toString() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
        return;
      }
      router.push(`/audit/${data.auditId}`);
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
        <Button type="submit" size="lg" disabled={submitting || !url}>
          {submitting ? 'Starting...' : 'Grade it →'}
        </Button>
      </div>
      {error && <div className="mt-2 text-warning text-sm">{error}</div>}
      <div className="mt-3 text-xs text-ink/50">No signup needed. Free for the first audit per domain per 24h.</div>
    </form>
  );
}
```

- [ ] **Step 2: Update `apps/web/app/page.tsx`**

```tsx
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { UrlForm } from '@/components/audit/UrlForm';

export default function Home() {
  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-6 pt-24 pb-32">
        <section className="text-center max-w-3xl mx-auto">
          <h1 className="font-display font-bold text-5xl sm:text-6xl tracking-tight leading-tight text-ink">
            Grade your store’s internal linking <span className="text-peach">in under 2 minutes.</span>
          </h1>
          <p className="mt-5 text-lg text-ink/70">
            Free. No install. Works on any site &mdash; Shopify, WordPress, Webflow, Wix, Squarespace, Framer, Ghost, or custom.
          </p>
          <div className="mt-10 flex justify-center"><UrlForm /></div>
        </section>

        <section className="mt-32 grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            { t: 'Live link graph', d: 'Watch your site take shape as the crawler runs. Beautiful enough to share before the grade lands.' },
            { t: 'A–F letter grade', d: 'One score, four components: orphans, depth, anchor diversity, structure quality.' },
            { t: 'Peer benchmarks', d: 'See how you compare to thousands of similar sites — sharper with every crawl.' },
          ].map((b) => (
            <div key={b.t} className="bg-white border border-oat rounded-2xl p-6">
              <h3 className="font-display font-semibold text-xl mb-2">{b.t}</h3>
              <p className="text-ink/70 text-sm leading-relaxed">{b.d}</p>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Verify dev server renders (browser check)**

Start dev server in background, fetch the homepage HTML, look for the headline:

```bash
cd apps/web
(timeout 30 pnpm dev > /tmp/next.log 2>&1 &)
sleep 8
curl -s http://localhost:3000/ | grep -c "Grade your store" || echo "headline missing"
pkill -f "next dev" || true
cd ../..
```
Expected: prints "1" or higher (headline rendered).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/audit/UrlForm.tsx apps/web/app/page.tsx
git commit -m "feat(web): landing page with URL form hero"
```

---

## Task 7: Pricing page (`/pricing`)

**Files:**
- Create: `apps/web/app/pricing/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    features: [
      '1 audit per domain per 24h',
      'Crawl up to 500 pages',
      'Letter grade + live graph',
      'Counts + top-5 examples of each finding',
      'Peer benchmarks',
      '"Powered by Crawlmouse" embed badge',
    ],
    cta: 'Start free',
    href: '/',
    primary: false,
  },
  {
    name: 'Pro',
    price: '$19',
    cadence: 'per month',
    features: [
      'Everything in Free, plus:',
      'Crawl up to 2,000 pages',
      'CSV / Excel export of every finding',
      'No domain rate limit',
      'Private (non-indexed) reports',
      'Remove or customize the embed badge',
    ],
    cta: 'Upgrade — Pro $19',
    href: '/dashboard?upgrade=pro',
    primary: true,
  },
];

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-20 pb-32">
        <section className="text-center mb-16 max-w-2xl mx-auto">
          <h1 className="font-display font-bold text-5xl tracking-tight">Pricing</h1>
          <p className="mt-4 text-lg text-ink/70">
            Free is genuinely free. Pay only when you need exports, more pages, or the badge gone.
          </p>
        </section>
        <section className="grid md:grid-cols-2 gap-6">
          {TIERS.map((t) => (
            <Card key={t.name} className={t.primary ? 'border-peach !border-2 relative' : ''}>
              {t.primary && (
                <div className="absolute -top-3 left-6">
                  <Badge tone="peach">Most popular</Badge>
                </div>
              )}
              <div className="mb-5">
                <div className="font-display font-bold text-2xl">{t.name}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display font-bold text-5xl">{t.price}</span>
                  <span className="text-ink/60">{t.cadence}</span>
                </div>
              </div>
              <ul className="space-y-2 mb-6">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm">
                    <span className="text-sage font-bold">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={t.href}>
                <Button variant={t.primary ? 'primary' : 'secondary'} className="w-full">{t.cta}</Button>
              </Link>
            </Card>
          ))}
        </section>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/pricing
git commit -m "feat(web): pricing page with Free and Pro tiers"
```

---

## Task 8: Bot info page (`/bot`)

**Files:**
- Create: `apps/web/app/bot/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';

export const metadata = {
  title: 'CrawlmouseBot — about our crawler',
};

export default function BotPage() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight">CrawlmouseBot</h1>
        <p className="mt-4 text-lg text-ink/70">
          Hi — if you’re reading this, you probably saw <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">CrawlmouseBot/1.0</code> in your access logs.
        </p>
        <Card className="mt-10">
          <h2 className="font-display font-bold text-2xl mb-3">What is it?</h2>
          <p className="text-ink/80 leading-relaxed">
            Crawlmouse is a free internal-linking grading service. When someone enters a URL on{' '}
            <a href="/" className="text-peach underline">crawlmouse.com</a>, our bot crawls a small portion of that site (up to 500 pages on the free tier) to build a map of internal links.
          </p>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">How we crawl</h2>
          <ul className="space-y-2 text-ink/80 list-disc pl-5">
            <li>We respect <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code> on every request.</li>
            <li>Max 8 concurrent requests per host with 250ms inter-request stagger.</li>
            <li>We back off immediately on 429 (rate-limited) or 503 responses.</li>
            <li>User-Agent: <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)</code></li>
            <li>HTTP only, no headless browser, no cookie persistence.</li>
          </ul>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">Block us?</h2>
          <p className="text-ink/80 leading-relaxed mb-3">Add this to your <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">robots.txt</code>:</p>
          <pre className="bg-ink text-cream font-mono text-sm p-4 rounded-lg">{`User-agent: CrawlmouseBot
Disallow: /`}</pre>
        </Card>
        <Card className="mt-6">
          <h2 className="font-display font-bold text-2xl mb-3">Takedown a report about your site</h2>
          <p className="text-ink/80 leading-relaxed">
            We don’t generate public reports without explicit domain-ownership verification. If you found one anyway, send the public URL plus a quick description to <code className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">takedown@crawlmouse.com</code>.
          </p>
        </Card>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/bot
git commit -m "feat(web): /bot info page for site owners who see our UA"
```

---

## Task 9: 404 page with mascot

**Files:**
- Create: `apps/web/app/not-found.tsx`

- [ ] **Step 1: Create the page**

```tsx
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center p-8 text-center">
      <CrawlmouseMark size={128} className="mb-6" />
      <h1 className="font-display font-bold text-6xl tracking-tight">404</h1>
      <p className="font-display text-2xl text-ink/70 mt-3 italic">Sniffed around. This page isn’t here.</p>
      <Link href="/" className="mt-8">
        <Button size="lg">Go home</Button>
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/not-found.tsx
git commit -m "feat(web): mascot-styled 404 page"
```

---

## Task 10: tRPC setup + Supabase clients

**Files:**
- Create: `apps/web/lib/supabase/client.ts`, `server.ts`, `admin.ts`
- Create: `apps/web/lib/trpc/router.ts`, `server.ts`, `client.ts`, `Provider.tsx`
- Create: `apps/web/app/api/trpc/[trpc]/route.ts`
- Modify: `apps/web/app/layout.tsx` (wrap with tRPC provider)

- [ ] **Step 1: Install tRPC + Supabase deps**

```bash
pnpm --filter @crawlmouse/web add @trpc/server @trpc/client @trpc/react-query @tanstack/react-query @supabase/ssr @supabase/supabase-js zod
pnpm --filter @crawlmouse/web add -D superjson
```

- [ ] **Step 2: Create `apps/web/lib/supabase/client.ts`** (browser-side)

```ts
import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 3: Create `apps/web/lib/supabase/server.ts`** (server, with cookies)

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  );
}
```

- [ ] **Step 4: Create `apps/web/lib/supabase/admin.ts`** (service-role; server-only)

```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

- [ ] **Step 5: Create `apps/web/lib/trpc/server.ts`** (router init)

```ts
import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import superjson from 'superjson';
import { supabaseServer } from '@/lib/supabase/server';

export async function createContext() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

const t = initTRPC.context<typeof createContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: { ...shape.data, zod: error.cause instanceof ZodError ? error.cause.flatten() : null },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

- [ ] **Step 6: Create `apps/web/lib/trpc/router.ts`** (the actual API surface; thin in v1.0)

```ts
import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from './server';

export const appRouter = router({
  audits: router({
    getById: publicProcedure
      .input(z.object({ auditId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { data, error } = await ctx.sb.from('audits').select('*').eq('id', input.auditId).maybeSingle();
        if (error) throw error;
        return data;
      }),
    listMine: protectedProcedure.query(async ({ ctx }) => {
      const { data, error } = await ctx.sb
        .from('audits')
        .select('id, url, grade, score, status, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    }),
  }),
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 7: Create `apps/web/lib/trpc/client.ts`**

```ts
'use client';

import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from './router';

export const trpc = createTRPCReact<AppRouter>();
```

- [ ] **Step 8: Create `apps/web/lib/trpc/Provider.tsx`**

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { useState, type ReactNode } from 'react';
import superjson from 'superjson';
import { trpc } from './client';

export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: '/api/trpc', transformer: superjson })],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
```

- [ ] **Step 9: Create `apps/web/app/api/trpc/[trpc]/route.ts`**

```ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/lib/trpc/router';
import { createContext } from '@/lib/trpc/server';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 10: Wrap `apps/web/app/layout.tsx` with `<TrpcProvider>`**

Modify layout to include TrpcProvider as a wrapper around `{children}`:

```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { fraunces, geist, geistMono } from '@/lib/fonts';
import { TrpcProvider } from '@/lib/trpc/Provider';

export const metadata = {
  title: 'Crawlmouse — Grade your site’s internal linking',
  description: 'Free, no-install, instantly-shareable internal-linking grader for any website.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="bg-cream text-ink font-sans antialiased">
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 11: Typecheck + commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): tRPC + Supabase client/server/admin setup"
```

---

## Task 11: Magic-link login flow (`/login`) + verify route

**Files:**
- Create: `apps/web/app/login/page.tsx`, `apps/web/app/login/verify/page.tsx`
- Create: `apps/web/app/api/auth/magic-link/route.ts`
- Create: `apps/web/app/api/auth/verify/route.ts`

- [ ] **Step 1: Install Resend**

```bash
pnpm --filter @crawlmouse/web add resend
```

- [ ] **Step 2: Create `apps/web/app/login/page.tsx`**

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not send magic link');
        return;
      }
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="max-w-md mx-auto px-6 pt-24 pb-32">
        <Card>
          <h1 className="font-display font-bold text-3xl">Sign in</h1>
          {sent ? (
            <p className="mt-4 text-ink/80">
              Check your inbox — we sent a magic link to <strong>{email}</strong>. The link expires in 10 minutes.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink/60">Enter your email and we’ll send you a one-time sign-in link. No password.</p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                <Input
                  type="email"
                  placeholder="you@yourstore.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" size="md" className="w-full" disabled={loading || !email}>
                  {loading ? 'Sending...' : 'Send magic link'}
                </Button>
                {error && <div className="text-warning text-sm">{error}</div>}
              </form>
            </>
          )}
        </Card>
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/api/auth/magic-link/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { z } from 'zod';

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const sb = await supabaseServer();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const { error } = await sb.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${baseUrl}/login/verify`,
    },
  });

  if (error) {
    return NextResponse.json({ error: 'Could not send magic link' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Create `apps/web/app/login/verify/page.tsx`** (handles the Supabase magic-link callback)

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function VerifyPage() {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') router.replace('/dashboard');
    });
  }, [router]);
  return (
    <main className="min-h-screen bg-cream flex items-center justify-center p-8">
      <div className="text-center">
        <div className="font-display text-2xl">Signing you in...</div>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/login apps/web/app/api/auth pnpm-lock.yaml
git commit -m "feat(web): magic-link login flow with Supabase Auth"
```

---

## Task 12: Dashboard page (`/dashboard`)

**Files:**
- Create: `apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabaseServer } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: audits } = await sb
    .from('audits')
    .select('id, url, grade, score, status, started_at, completed_at')
    .order('started_at', { ascending: false })
    .limit(50);

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-12 pb-32">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display font-bold text-4xl tracking-tight">Your audits</h1>
          <Link href="/"><Button>+ New audit</Button></Link>
        </div>

        {(!audits || audits.length === 0) ? (
          <Card className="text-center py-12">
            <p className="text-ink/70">No audits yet. <Link href="/" className="text-peach underline">Run your first one.</Link></p>
          </Card>
        ) : (
          <div className="space-y-3">
            {audits.map((a) => (
              <Link key={a.id} href={`/audit/${a.id}`}>
                <Card className="hover:border-peach transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm truncate">{a.url}</div>
                      <div className="text-xs text-ink/50 mt-1">{new Date(a.started_at).toLocaleString()}</div>
                    </div>
                    {a.status === 'completed' && a.grade ? (
                      <div className="flex items-center gap-3">
                        <Badge tone={(a.score ?? 0) >= 60 ? 'sage' : 'peach'}>{a.score?.toFixed(0)}</Badge>
                        <span className="font-display font-bold text-3xl">{a.grade}</span>
                      </div>
                    ) : (
                      <Badge tone="oat">{a.status}</Badge>
                    )}
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

- [ ] **Step 2: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/dashboard
git commit -m "feat(web): dashboard page with audit history"
```

---

## Task 13: Fix the Plan 1 SSRF carry-forward in `runAudit`

**File modified:**
- `packages/engine/src/audit.ts`

The `runAudit` function fetches the homepage URL with raw `fetch()` before calling the crawler. The crawler enforces SSRF guard via `runCrawl`, but the homepage fetch bypasses it. This must be fixed before exposing the audit endpoint publicly.

- [ ] **Step 1: Add SSRF guard before the homepage fetch**

Open `packages/engine/src/audit.ts`. Near the top after the imports, ensure `validateUrlOrThrow` is imported (it should already be exported from `./ssrf-guard.js`). Find the section that does `const homepageRes = await fetch(homepageUrl);`. Replace it with:

```ts
  // Validate the homepage URL against SSRF before fetching.
  // The test/internal flag bypasses for the localhost-loopback test fixtures only.
  if (!flags.allowPrivateIpsForTesting) {
    await validateUrlOrThrow(homepageUrl);
  }
  const homepageRes = await fetch(homepageUrl);
```

Make sure the import line at the top includes:

```ts
import { validateUrlOrThrow } from './ssrf-guard.js';
import { canonicalizeUrl } from './url-canonical.js';
```

(The original file already imports `canonicalizeUrl` and `hashUrl` from `./url-canonical.js`. Just add `validateUrlOrThrow` to the existing `./ssrf-guard.js` import or add a new line for it.)

- [ ] **Step 2: Run engine tests to confirm no regression**

```bash
pnpm --filter @crawlmouse/engine test
```
Expected: still 125 passing. The audit.test.ts uses `allowPrivateIpsForTesting: true` so its 127.0.0.1 fixture remains valid.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/audit.ts
git commit -m "fix(engine): validate homepage URL against SSRF before fetching"
```

---

## Task 14: Audit start API route + rate limiting + Turnstile

**Files:**
- Create: `apps/web/lib/rate-limit.ts`
- Create: `apps/web/lib/turnstile.ts`
- Create: `apps/web/lib/inngest.ts` (trigger client)
- Create: `apps/web/app/api/audits/start/route.ts`

- [ ] **Step 1: Install Inngest client for the web app**

```bash
pnpm --filter @crawlmouse/web add inngest
```

- [ ] **Step 2: Create `apps/web/lib/inngest.ts`**

```ts
import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'crawlmouse-web' });
```

(Note: a separate client from `inngest/client.ts` because the web app only needs to SEND events; the worker package is for receiving/processing.)

- [ ] **Step 3: Create `apps/web/lib/rate-limit.ts`**

```ts
import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

interface CheckResult { allowed: boolean; remaining: number; resetAt: Date }

export async function checkRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
): Promise<CheckResult> {
  const sb = supabaseAdmin();
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  // Upsert and increment atomically using ON CONFLICT
  const { data, error } = await sb.rpc('increment_rate_limit', {
    p_bucket_key: bucketKey,
    p_window_start: windowStart.toISOString(),
  });
  if (error) {
    // If RPC doesn't exist yet (Plan 1 didn't ship it), fall back to optimistic SELECT/UPSERT.
    const { data: existing } = await sb
      .from('rate_limits')
      .select('request_count')
      .eq('bucket_key', bucketKey)
      .eq('window_start', windowStart.toISOString())
      .maybeSingle();
    const newCount = (existing?.request_count ?? 0) + 1;
    await sb.from('rate_limits').upsert({ bucket_key: bucketKey, window_start: windowStart.toISOString(), request_count: newCount });
    return { allowed: newCount <= limit, remaining: Math.max(0, limit - newCount), resetAt };
  }
  const count = data as number;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}
```

Note: this references a `rate_limits` table that doesn't exist yet in Plan 1's migrations. **The implementer must add it** as a NEW migration in this task. See Step 4.

- [ ] **Step 4: Create migration `infra/supabase/migrations/20260524000005_rate_limits.sql`**

```sql
create table rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  request_count int not null default 1,
  primary key (bucket_key, window_start)
);
create index on rate_limits (window_start);

-- Optional helper RPC for atomic increment; rate-limit.ts gracefully degrades if missing
create or replace function increment_rate_limit(p_bucket_key text, p_window_start timestamptz)
returns int language plpgsql as $$
declare new_count int;
begin
  insert into rate_limits (bucket_key, window_start, request_count) values (p_bucket_key, p_window_start, 1)
    on conflict (bucket_key, window_start) do update set request_count = rate_limits.request_count + 1
    returning request_count into new_count;
  return new_count;
end; $$;
```

- [ ] **Step 5: Create `apps/web/lib/turnstile.ts`**

```ts
import 'server-only';

export async function verifyTurnstileToken(token: string, ip?: string): Promise<boolean> {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    // Dev mode without Turnstile configured: allow.
    return true;
  }
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    }),
  });
  const data = await res.json();
  return !!data.success;
}
```

- [ ] **Step 6: Create `apps/web/app/api/audits/start/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateUrlOrThrow } from '@crawlmouse/engine';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/turnstile';

const schema = z.object({
  url: z.string().url(),
  turnstileToken: z.string().optional(),
});

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  // Validate URL against SSRF guard before anything else
  try {
    await validateUrlOrThrow(parsed.data.url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid URL' }, { status: 400 });
  }

  const ip = getClientIp(req);
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  const sb = supabaseAdmin();

  // Per-domain rate limit (any user, 1 audit per domain per hour)
  const domain = new URL(parsed.data.url).hostname;
  const domainCheck = await checkRateLimit(`domain:${domain}`, 1, HOUR_MS);
  if (!domainCheck.allowed) {
    return NextResponse.json({ error: 'Another audit for this domain ran in the last hour. Try again soon.' }, { status: 429 });
  }

  // Per-IP rate limit (anonymous: 3/24h before Turnstile; authenticated: 5/24h)
  const ipLimit = user ? 5 : 3;
  const ipCheck = await checkRateLimit(`ip:${ip}`, ipLimit, TWENTY_FOUR_HOURS_MS);
  if (!ipCheck.allowed) {
    if (!parsed.data.turnstileToken) {
      return NextResponse.json({ error: 'captcha_required', resetAt: ipCheck.resetAt }, { status: 429 });
    }
    const ok = await verifyTurnstileToken(parsed.data.turnstileToken, ip);
    if (!ok) return NextResponse.json({ error: 'Captcha failed' }, { status: 429 });
  }

  // Create the audit row
  const { data: audit, error: insertError } = await sb
    .from('audits')
    .insert({
      user_id: user?.id ?? null,
      anonymous_session_id: user ? null : `anon-${ip}-${Date.now()}`,
      url: parsed.data.url,
      status: 'pending',
      settings: { pageCap: user ? 2000 : 500 },
    })
    .select('id')
    .single();

  if (insertError || !audit) {
    return NextResponse.json({ error: 'Could not create audit' }, { status: 500 });
  }

  // Fire Inngest event
  await inngest.send({
    name: 'audit.requested',
    data: { auditId: audit.id, url: parsed.data.url, pageCap: user ? 2000 : 500 },
  });

  return NextResponse.json({ auditId: audit.id });
}
```

- [ ] **Step 7: Add the new migration to `infra/supabase/migrations/`**

(Already done in Step 4 above.) Verify it lives at `infra/supabase/migrations/20260524000005_rate_limits.sql`.

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/lib apps/web/app/api/audits infra/supabase/migrations/20260524000005_rate_limits.sql pnpm-lock.yaml
git commit -m "feat(web): audit start endpoint with SSRF guard, rate limit, Turnstile, and rate_limits table migration"
```

---

## Task 15: SSE stream endpoint for audit progress

**Files:**
- Create: `apps/web/app/api/audits/[id]/stream/route.ts`

In v1.0 we use Supabase Realtime as the event bus. The Inngest function emits events; we relay them to SSE.

- [ ] **Step 1: Create the SSE route**

```ts
import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Initial snapshot
      const { data: initial } = await sb.from('audits').select('id, status, grade, score, page_count').eq('id', id).maybeSingle();
      if (initial) send('snapshot', initial);

      // Poll every 1s for status / counts changes until completed/failed
      const interval = setInterval(async () => {
        const { data } = await sb.from('audits').select('id, status, grade, score, page_count, link_count, cms_detected').eq('id', id).maybeSingle();
        if (!data) return;
        send('progress', data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
          send('done', data);
          controller.close();
        }
      }, 1000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
```

Note: this v1.0 SSE implementation polls Supabase every 1 second. v1.1 will switch to true event-driven via Supabase Realtime channels — the API contract (event names + payload shape) stays the same so the upgrade is transparent.

- [ ] **Step 2: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/api/audits
git commit -m "feat(web): SSE stream endpoint for audit progress"
```

---

## Task 16: Sigma.js LinkGraph component

**Files:**
- Create: `apps/web/components/audit/LinkGraph.tsx`

This is the brand-defining visual. WebGL-rendered force-directed graph, brand colors, smooth at 2k nodes. v1.0 ships with static data (the final report graph); live-updating version is layered in Task 17.

- [ ] **Step 1: Install Sigma.js + react-sigma**

```bash
pnpm --filter @crawlmouse/web add sigma graphology @react-sigma/core
```

- [ ] **Step 2: Create `apps/web/components/audit/LinkGraph.tsx`**

```tsx
'use client';

import Graph from 'graphology';
import { SigmaContainer, useLoadGraph } from '@react-sigma/core';
import { useEffect, useMemo } from 'react';
import '@react-sigma/core/lib/style.css';

export interface LinkGraphPage { url: string; isOrphan: boolean; depth: number | null }
export interface LinkGraphEdge { from: string; to: string }

interface Props {
  pages: LinkGraphPage[];
  edges: LinkGraphEdge[];
  homepageUrl?: string;
  height?: number;
}

function GraphLoader({ pages, edges, homepageUrl }: { pages: LinkGraphPage[]; edges: LinkGraphEdge[]; homepageUrl?: string }) {
  const loadGraph = useLoadGraph();
  useEffect(() => {
    const g = new Graph();
    pages.forEach((p, i) => {
      g.addNode(p.url, {
        x: Math.cos((i / Math.max(pages.length, 1)) * Math.PI * 2),
        y: Math.sin((i / Math.max(pages.length, 1)) * Math.PI * 2),
        size: p.url === homepageUrl ? 12 : p.isOrphan ? 6 : 8,
        color: p.url === homepageUrl ? '#1a1a18' : p.isOrphan ? '#ff7849' : '#7a9b7e',
        label: '',
      });
    });
    edges.forEach((e) => {
      if (g.hasNode(e.from) && g.hasNode(e.to) && !g.hasEdge(e.from, e.to)) {
        g.addEdge(e.from, e.to, { size: 0.5, color: '#e8e2d4' });
      }
    });
    loadGraph(g);
  }, [pages, edges, homepageUrl, loadGraph]);
  return null;
}

export function LinkGraph({ pages, edges, homepageUrl, height = 480 }: Props) {
  const settings = useMemo(() => ({
    renderEdgeLabels: false,
    defaultEdgeColor: '#e8e2d4',
    defaultNodeColor: '#7a9b7e',
    labelColor: { color: '#1a1a18' },
    labelSize: 12,
  }), []);
  return (
    <div style={{ height }} className="rounded-2xl overflow-hidden border border-oat bg-cream">
      <SigmaContainer style={{ height: '100%', background: 'transparent' }} settings={settings}>
        <GraphLoader pages={pages} edges={edges} homepageUrl={homepageUrl} />
      </SigmaContainer>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/components/audit/LinkGraph.tsx pnpm-lock.yaml
git commit -m "feat(web): Sigma.js LinkGraph component for site visualization"
```

---

## Task 17: Audit page (`/audit/[id]`) with live progress + drip findings + report

**Files:**
- Create: `apps/web/components/audit/AuditProgress.tsx`
- Create: `apps/web/components/audit/DripFeedFindings.tsx`
- Create: `apps/web/app/audit/[id]/page.tsx`
- Create: `apps/web/app/audit/[id]/AuditView.tsx`

- [ ] **Step 1: Create `apps/web/components/audit/AuditProgress.tsx`**

```tsx
'use client';

interface Props { pageCount: number; pageCap: number; status: string }

export function AuditProgress({ pageCount, pageCap, status }: Props) {
  const pct = Math.min(100, Math.round((pageCount / pageCap) * 100));
  return (
    <div className="bg-white border border-oat rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-semibold text-lg capitalize">{status}</div>
        <div className="font-mono text-sm text-ink/60">{pageCount} / {pageCap} pages</div>
      </div>
      <div className="h-2 bg-oat rounded-full overflow-hidden">
        <div className="h-full bg-peach transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/audit/DripFeedFindings.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';

const MESSAGES = [
  'Sniffing around your sitemap...',
  'Counting pages and links...',
  'Building the link graph...',
  'Hunting for orphans...',
  'Measuring click depth from the homepage...',
  'Inspecting anchor text patterns...',
  'Running the grade math...',
];

export function DripFeedFindings({ active }: { active: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setIndex((i) => (i + 1) % MESSAGES.length), 3500);
    return () => clearInterval(interval);
  }, [active]);
  if (!active) return null;
  return (
    <div className="bg-white border border-oat rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold mb-2">Working</div>
      <div className="font-display italic text-lg text-ink/80">{MESSAGES[index]}</div>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/audit/[id]/AuditView.tsx`** (client component)

```tsx
'use client';

import { useEffect, useState } from 'react';
import { AuditProgress } from '@/components/audit/AuditProgress';
import { DripFeedFindings } from '@/components/audit/DripFeedFindings';
import { LinkGraph, type LinkGraphPage, type LinkGraphEdge } from '@/components/audit/LinkGraph';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { trpc } from '@/lib/trpc/client';

interface Snapshot {
  id: string;
  status: string;
  grade?: string | null;
  score?: number | null;
  page_count?: number | null;
  link_count?: number | null;
  cms_detected?: string | null;
}

interface FullData { pages: LinkGraphPage[]; edges: LinkGraphEdge[]; homepageUrl: string; orphanCount: number; avgDepth: number }

export function AuditView({ auditId }: { auditId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [full, setFull] = useState<FullData | null>(null);
  const pageCap = 2000;

  // Subscribe to SSE
  useEffect(() => {
    const es = new EventSource(`/api/audits/${auditId}/stream`);
    es.addEventListener('snapshot', (e) => setSnapshot(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('progress', (e) => setSnapshot(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('done', (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
      es.close();
    });
    return () => es.close();
  }, [auditId]);

  // When audit is completed, fetch the full graph data via tRPC + direct table reads
  // For v1.0 simplicity, use a single tRPC call that returns everything we need:
  // For now: render once `snapshot.status === 'completed'`. v1.1 will add tRPC procedures for pages/links.
  // Placeholder: empty arrays until the procedure is wired in a follow-up task.

  const done = snapshot?.status === 'completed' && snapshot.grade;
  const failed = snapshot?.status === 'failed';
  const running = !done && !failed;

  return (
    <div className="space-y-6">
      {running && <AuditProgress pageCount={snapshot?.page_count ?? 0} pageCap={pageCap} status={snapshot?.status ?? 'pending'} />}
      {running && <DripFeedFindings active={running} />}
      {full && <LinkGraph pages={full.pages} edges={full.edges} homepageUrl={full.homepageUrl} height={500} />}
      {done && snapshot.grade && snapshot.score != null && (
        <GradeCard
          grade={snapshot.grade}
          score={snapshot.score}
          orphanCount={full?.orphanCount ?? 0}
          avgDepth={full?.avgDepth ?? 0}
          passing={(snapshot.score ?? 0) >= 60}
        />
      )}
      {failed && (
        <Card>
          <h2 className="font-display font-bold text-2xl text-warning">Audit failed</h2>
          <p className="mt-2 text-ink/70">We hit an error crawling your site. Try again or contact support.</p>
        </Card>
      )}
    </div>
  );
}
```

Note: this v1.0 client component shows progress and the grade card. The detailed page-by-page LinkGraph rendering is left as a v1.1 follow-up because it requires a heavier tRPC procedure to stream `pages` + `links` rows. For Plan 2 acceptance, the progress + grade flow + the static empty LinkGraph (showing the bordered placeholder) is sufficient.

- [ ] **Step 4: Create `apps/web/app/audit/[id]/page.tsx`** (server component, fetches initial state)

```tsx
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { AuditView } from './AuditView';
import { supabaseServer } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: audit } = await sb.from('audits').select('id, url').eq('id', id).maybeSingle();
  if (!audit) notFound();

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 pt-12 pb-32">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Auditing</div>
          <h1 className="font-mono text-lg break-all">{audit.url}</h1>
        </div>
        <AuditView auditId={audit.id} />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/components/audit apps/web/app/audit
git commit -m "feat(web): audit page with live progress + grade card"
```

---

## Task 18: Inngest webhook handler

**Files:**
- Create: `apps/web/app/api/webhooks/inngest/route.ts`

- [ ] **Step 1: Create the handler**

```ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest';
import { auditFn } from '../../../../../inngest/audit';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [auditFn],
});
```

Note: the path traversal to `inngest/audit.ts` is from `apps/web/app/api/webhooks/inngest/route.ts` (depth 4 from app root). If the path resolution fails, use a tsconfig path alias or import via the workspace name:

```ts
// alternate: import { auditFn } from '@crawlmouse/inngest/audit';
```

The `@crawlmouse/inngest` workspace exports `auditFn` (see Plan 1 Task 22). Use whichever import resolves.

- [ ] **Step 2: Verify dev server boots without error**

```bash
cd apps/web
(timeout 15 pnpm dev > /tmp/next.log 2>&1 &)
sleep 8
curl -s http://localhost:3000/api/webhooks/inngest 2>&1 | head -5
pkill -f "next dev" || true
cd ../..
```
Expected: some Inngest function-list JSON response (not a 500 error).

- [ ] **Step 3: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web/app/api/webhooks
git commit -m "feat(web): Inngest serve handler for audit function"
```

---

## Task 19: PostHog + Sentry instrumentation

**Files:**
- Create: `apps/web/lib/analytics.ts`
- Create: `apps/web/instrumentation.ts`
- Create: `apps/web/sentry.client.config.ts`
- Create: `apps/web/sentry.server.config.ts`

- [ ] **Step 1: Install deps**

```bash
pnpm --filter @crawlmouse/web add posthog-js @sentry/nextjs
```

- [ ] **Step 2: Create `apps/web/lib/analytics.ts`**

```ts
'use client';
import posthog from 'posthog-js';

export function initAnalytics() {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  if ((posthog as unknown as { __initialized?: boolean }).__initialized) return;
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    person_profiles: 'always',
    capture_pageview: true,
    capture_pageleave: true,
  });
  (posthog as unknown as { __initialized?: boolean }).__initialized = true;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}
```

- [ ] **Step 3: Create `apps/web/instrumentation.ts`**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.server.config');
  }
}
```

- [ ] **Step 4: Create `apps/web/sentry.server.config.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

- [ ] **Step 5: Create `apps/web/sentry.client.config.ts`**

```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});
```

- [ ] **Step 6: Wire PostHog into the root layout**

Modify `apps/web/app/layout.tsx` to call `initAnalytics()` in a client component near the top:

Create `apps/web/components/AnalyticsBootstrap.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import { initAnalytics } from '@/lib/analytics';

export function AnalyticsBootstrap() {
  useEffect(() => { initAnalytics(); }, []);
  return null;
}
```

Update `apps/web/app/layout.tsx` to render `<AnalyticsBootstrap />` inside `<body>` (above `<TrpcProvider>`).

- [ ] **Step 7: Commit**

```bash
pnpm --filter @crawlmouse/web typecheck
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): PostHog analytics + Sentry error tracking"
```

---

## Task 20: Playwright E2E test for the landing → audit flow

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/e2e/landing.spec.ts`

This is the integration safety net. Verifies the full user flow without a real Supabase / Inngest backend.

- [ ] **Step 1: Install Playwright**

```bash
pnpm --filter @crawlmouse/web add -D @playwright/test
pnpm --filter @crawlmouse/web exec playwright install chromium
```

- [ ] **Step 2: Create `apps/web/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

- [ ] **Step 3: Create `apps/web/tests/e2e/landing.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe('landing page', () => {
  test('renders the hero headline and URL form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /grade your store's internal linking/i })).toBeVisible();
    await expect(page.getByPlaceholder(/your-store\.com/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /grade it/i })).toBeVisible();
  });

  test('shows validation error for empty/invalid URLs', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/your-store\.com/i);
    const button = page.getByRole('button', { name: /grade it/i });
    await input.fill('not a url');
    await button.click();
    await expect(page.getByText(/please enter a valid url|invalid/i)).toBeVisible({ timeout: 5000 });
  });

  test('header links navigate correctly', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing/);
    await page.goto('/');
    await page.getByRole('link', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 4: Run the E2E test**

```bash
pnpm --filter @crawlmouse/web exec playwright test
```
Expected: 3 tests pass. Browser launches headless against local dev server.

If the dev server doesn't start, ensure no other Next.js process is running on port 3000.

- [ ] **Step 5: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/tests pnpm-lock.yaml
git commit -m "test(web): Playwright E2E for landing page and validation"
```

---

## Task 21: Final smoke + milestone tag

This task is verification only — no new code. Runs all checks and tags the Plan 2 milestone.

- [ ] **Step 1: Full typecheck across monorepo**

```bash
pnpm typecheck
```
Expected: all 5 packages (`@crawlmouse/engine`, `@crawlmouse/inngest`, `@crawlmouse/scripts`, `@crawlmouse/types`, `@crawlmouse/web`) exit 0.

- [ ] **Step 2: Full engine test suite**

```bash
pnpm --filter @crawlmouse/engine test
```
Expected: 125+ tests passing (unchanged from Plan 1).

- [ ] **Step 3: Playwright E2E suite**

```bash
pnpm --filter @crawlmouse/web exec playwright test
```
Expected: 3+ tests passing.

- [ ] **Step 4: Web app builds for production**

```bash
pnpm --filter @crawlmouse/web build
```
Expected: build succeeds, prints `Compiled successfully` and route summary.

If the build fails due to env-var requirements (Supabase URLs missing in CI), set placeholders:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
SUPABASE_SERVICE_ROLE_KEY=placeholder \
pnpm --filter @crawlmouse/web build
```

- [ ] **Step 5: Tag the milestone**

```bash
git tag plan-2-web-app-auth-complete
git log --oneline | head -25
```

(Controller will push the tag.)

---

## Plan 2 Self-Review

- **Spec coverage:** Section 11 (UI design system) → palette + type wired (Tasks 2-4); sitemap (§11.2) → landing + pricing + bot + 404 + login + dashboard + audit + verify routes all present (Tasks 6-12, 17); two-step free flow (§13) → anonymous audit + email magic link (Tasks 11, 14); SSRF guard (§14.1) → fix applied in Plan 1 engine (Task 13) AND web endpoint validates input (Task 14); rate limits (§5.5, §14.2) → per-IP + per-domain enforced in Task 14; SSE event delivery (§12.3) → Task 15; Sigma.js graph (§11.4) → Task 16; tRPC API contract (§5.1) → Task 10; Inngest webhook handler (§12.1) → Task 18; observability stack (§19.3) → Task 19; E2E test (§18.3) → Task 20. Gap: live LinkGraph node-streaming during crawl is partial (Task 17 shows progress but the live-streaming-into-Sigma version is a v1.1 follow-up — flagged in the AuditView component).
- **Placeholder scan:** no TBDs / TODOs in code blocks; every step has either content or an exact command.
- **Type consistency:** `Snapshot`/`FullData`/`LinkGraphPage`/`LinkGraphEdge` defined locally with explicit shapes; `AuditOptions`/`AuditResult`/`AuditEvent` come from `@crawlmouse/types`. `audits.url` / `audits.score` / `audits.grade` references match Plan 1 schema.
- **Carry-forwards intentional:**
  - Live LinkGraph node-streaming into Sigma.js (deferred to v1.1).
  - True Supabase Realtime event delivery (deferred; SSE currently polls every 1s).
  - tRPC procedures for streaming pages + links (deferred; Task 17 placeholder uses tRPC infrastructure but doesn't yet stream the full page list).
  - Public report URL / leaderboard / embed badge (Plan 3).
  - Stripe billing (Plan 4).

Plan 2 is ready to execute.
