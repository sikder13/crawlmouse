import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';

// Every page that exports no `alternates` inherits the root layout's `canonical: '/'` and so
// declares itself a duplicate of the homepage. This guard pins the per-page metadata that fixes
// that: the self-canonical each marketing/legal page must carry, the bare titles that let the
// root layout's `%s · Crawlmouse` template brand them exactly once, and the noindex on the app
// surfaces that must never compete with /r/<slug> (the indexable report surface by design).
//
// Some of these pages are server components that reach for Supabase at request time. Only the
// module-level `metadata` export is under test, so the data clients are stubbed to nothing —
// none of them is called by an import.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));

const APP = join(__dirname, '..', 'app');

/** The metadata a route actually serves, read from the module Next would read it from. */
async function metaOf(modulePath: string): Promise<Metadata> {
  const mod = (await import(modulePath)) as { metadata?: Metadata };
  return mod.metadata ?? {};
}

const canonicalOf = (m: Metadata) =>
  (m.alternates?.canonical ?? null) as string | null;

// ── Indexable pages: own title + self-canonical ────────────────────────────────────────────
// `description` is listed only where this change introduces one; the title-only rows are pages
// whose copy was already written and only needed de-branding plus a canonical.
const INDEXABLE: {
  route: string;
  module: string;
  title: string;
  description?: string;
}[] = [
  {
    route: '/pricing',
    module: '../app/pricing/page',
    title: 'Pricing',
    description:
      'Crawlmouse is free forever — audit any site, get a real A–F grade, and one complete fix. Pro is $19/month or $190/year for every fix, CSV export, and bigger crawls.',
  },
  {
    route: '/developers',
    module: '../app/developers/page',
    title: 'Crawlmouse for developers — CLI, GitHub Action & webhooks',
    description:
      'A CLI, GitHub Action, and webhooks built on the same engine as the web audit. Grade internal linking from your terminal or CI — join the waitlist.',
  },
  {
    route: '/bot',
    module: '../app/bot/page',
    title: 'CrawlmouseBot — about our crawler',
    description:
      'What CrawlmouseBot is, how it crawls, and how to block it or request a report takedown. We respect robots.txt and crawl gently.',
  },
  { route: '/status', module: '../app/status/page', title: 'Status' },
  { route: '/privacy', module: '../app/privacy/page', title: 'Privacy Policy' },
  { route: '/terms', module: '../app/terms/page', title: 'Terms of Service' },
  { route: '/aup', module: '../app/aup/page', title: 'Acceptable Use' },
  { route: '/subprocessors', module: '../app/subprocessors/page', title: 'Subprocessors' },
  { route: '/takedown', module: '../app/takedown/page', title: 'Takedown request' },
];

describe('per-page metadata — self-canonicals', () => {
  for (const page of INDEXABLE) {
    it(`${page.route} declares itself canonical, not the homepage`, async () => {
      const m = await metaOf(page.module);
      expect(canonicalOf(m), `${page.route} must set its own canonical`).toBe(page.route);
    });

    it(`${page.route} serves its own title`, async () => {
      const m = await metaOf(page.module);
      expect(m.title).toBe(page.title);
    });

    if (page.description) {
      it(`${page.route} serves its own description`, async () => {
        const m = await metaOf(page.module);
        expect(m.description).toBe(page.description);
      });
    }
  }

  // The root layout templates every title as `%s · Crawlmouse`, so a page title that also
  // carries the brand renders it twice ("Status — Crawlmouse · Crawlmouse").
  it('no page title carries the brand the layout template already appends', async () => {
    const doubled: string[] = [];
    for (const page of INDEXABLE) {
      const title = (await metaOf(page.module)).title;
      if (typeof title === 'string' && /Crawlmouse\s*$/.test(title)) doubled.push(page.route);
    }
    expect(doubled, 'these titles would render "X — Crawlmouse · Crawlmouse"').toEqual([]);
  });
});

// ── App surfaces: never indexed ────────────────────────────────────────────────────────────
// /login is indexed by Google today; /audit/<uuid> and /verify/<uuid> are capability URLs whose
// only protection is the accidental homepage canonical. `follow: true` so link equity still
// flows out of them.
const NOINDEX: { route: string; module: string }[] = [
  { route: '/login', module: '../app/login/page' },
  { route: '/dashboard', module: '../app/dashboard/page' },
  { route: '/compare', module: '../app/compare/page' },
  { route: '/audit/[id]', module: '../app/audit/[id]/page' },
  { route: '/verify/[id]', module: '../app/verify/[id]/page' },
];

describe('per-page metadata — noindex on app surfaces', () => {
  for (const page of NOINDEX) {
    it(`${page.route} is noindex, follow`, async () => {
      const m = await metaOf(page.module);
      expect(m.robots).toEqual({ index: false, follow: true });
    });
  }
});

// ── The class, not the instance ────────────────────────────────────────────────────────────
// Route metadata must be exported from a SERVER module. Two behaviours, both measured against
// Next 15.5.18 by planting the export and running `next build`:
//   - from a 'use client' page.tsx or layout.tsx it FAILS the build ("You are attempting to
//     export \"metadata\" from a component marked with \"use client\", which is disallowed");
//   - from any other 'use client' module it compiles clean and is simply never read.
// The first is why /login and /takedown are split into a server shell plus a client form; the
// second is the quieter bug, because the export looks right and does nothing at all.
function appModules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) appModules(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const isClientModule = (src: string) => /^\s*(['"])use client\1/m.test(src.slice(0, 400));
const exportsMetadata = (src: string) =>
  /export\s+(const|async\s+function|function)\s+(metadata|generateMetadata)\b/.test(src);

describe("route metadata never lives in a 'use client' module", () => {
  const files = appModules(APP).map((f) => ({ rel: f.slice(APP.length + 1), src: readFileSync(f, 'utf8') }));
  const clientOffenders = files.filter((f) => isClientModule(f.src) && exportsMetadata(f.src));

  it('finds the app modules to scan', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('no client-marked page or layout exports metadata — Next fails the build on it', () => {
    const routing = clientOffenders.filter((f) => /(^|\/)(page|layout)\.tsx$/.test(f.rel));
    expect(routing.map((f) => f.rel)).toEqual([]);
  });

  it('no other client-marked module exports metadata — Next would silently ignore it', () => {
    const nonRouting = clientOffenders.filter((f) => !/(^|\/)(page|layout)\.tsx$/.test(f.rel));
    expect(nonRouting.map((f) => f.rel)).toEqual([]);
  });
});

// ── Non-regression: the homepage keeps what it has ─────────────────────────────────────────
// The root layout is deliberately NOT part of this change: `canonical: '/'` is correct for
// app/page.tsx and is the default every other route now overrides.
describe('root layout is unchanged', () => {
  const src = readFileSync(join(APP, 'layout.tsx'), 'utf8');

  it("keeps canonical '/' as the default for the homepage", () => {
    expect(src).toContain("alternates: { canonical: '/' }");
  });

  it('keeps the title template that brands every page exactly once', () => {
    expect(src).toContain("title: { default: TITLE, template: '%s · Crawlmouse' }");
  });

  it('keeps the homepage title and description', () => {
    expect(src).toContain(`const TITLE = "Crawlmouse — Grade your site's internal linking";`);
    expect(src).toContain(
      "'Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages '",
    );
  });
});
