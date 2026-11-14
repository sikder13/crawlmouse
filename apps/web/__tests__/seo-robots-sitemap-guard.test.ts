import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { robotsTxt } from '../lib/robots-txt';
import sitemap from '../app/sitemap';
import { allPostSlugs } from '../lib/blog/posts';
import { V2_REWRITES } from '../lib/v2/rewrites';

// The sitemap is now async + DB-backed: it appends a CLAIM-GATED /r/ section (SPEC 04 §8) — claimed +
// indexable reports are listed; unclaimed mints (indexable=false) never are. We stub the report source
// to EMPTY here so this guard deterministically pins (a) the static marketing/legal/blog set, (b) that
// an empty/unclaimed world leaks NO /r/ URL — the guardrail — and (c) the private-path exclusions. The
// DYNAMIC claimed case (real /r/<slug> URLs appear) is pinned separately in sitemap-report-urls.test.ts,
// and the filter/fail-soft in lib/sitemap-reports.test.ts. `/compare/` stays excluded for this whole
// phase (M3: compare is noindex; the slug-based indexable compare is deferred post-SPEC-04).
//
// SEO crawl-control invariants. robots was historically malformed (two separate `User-Agent: *`
// groups, which crawlers merge or pick from inconsistently) and there was no sitemap. These guards
// pin the corrected shape + the full indexable URL set so a refactor can't silently de-index pages
// or leak private paths into the sitemap.
// robots blocks the private app surfaces but NOT /r/ — /r/ indexing is controlled per-page (page
// robots meta) so the crawler can fetch the page and honor it, rather than the "indexed but blocked"
// anti-pattern.
// Leaderboards (/top/*) follow the SAME page-controlled policy: their page robots meta is noindex
// while the board is empty/thin and flips to indexable once real ranked data accrues, so they are
// intentionally NOT auto-listed in the sitemap (no empty doorway pages advertised to crawlers).

// Empty report source → the guard sees the static set only (deterministic, no DB / no env).
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: () => Promise.resolve([]) }));

const ROBOTS_DISALLOW = ['/embed/', '/audit/', '/dashboard', '/verify/'];
// /r/ is NO LONGER categorically excluded — it is claim-gated (listed only when a report is claimed +
// indexable). Everything below stays private/non-indexable and must never appear in the sitemap.
const SITEMAP_EXCLUDE = [
  '/embed/',
  '/audit/',
  '/dashboard',
  '/verify/',
  '/login',
  '/api/',
  '/compare/',
  // CC-29: the Agency trial form (noindex), and every v2 rewrite target, which has no address of its
  // own (lib/v2/rewrites.ts): /v2-home, /dashboard/v2, /v2-pricing, /v2-developers, /v2-report.
  '/agency-trial',
  ...V2_REWRITES.map((r) => r.to.split('/:')[0]!),
];

describe('robots.txt', () => {
  // robots moved from Next's `robots.ts` metadata convention to a route handler
  // (app/robots.txt/route.ts) so the file could carry the Content-Signal comment, which the
  // typed metadata return value cannot express. This guard therefore reads the emitted TEXT
  // instead of a rules object. The invariants it protects are unchanged, and the byte-level
  // preservation of the old document is pinned in lib/robots-txt.test.ts.
  const txt = robotsTxt();

  it('emits exactly one User-Agent:* group (allow / + private disallows) and references the sitemap', () => {
    expect(
      txt.match(/^User-Agent: \*$/gm) ?? [],
      'must be exactly ONE User-Agent:* group',
    ).toHaveLength(1);
    const star = txt.slice(txt.indexOf('User-Agent: *'));
    const group = star.slice(0, star.indexOf('\n\n'));
    expect(group).toContain('Allow: /');
    for (const p of ROBOTS_DISALLOW)
      expect(group, `robots must disallow ${p}`).toContain(`Disallow: ${p}`);
    expect(txt, 'robots must NOT block /r/ — its indexing is page-controlled').not.toContain(
      'Disallow: /r/',
    );
    expect(txt).toContain('Sitemap: https://crawlmouse.com/sitemap.xml');
  });
});

describe('sitemap.ts', () => {
  let urls: string[];
  beforeAll(async () => {
    urls = (await sitemap()).map((e) => e.url);
  });
  const has = (p: string) => urls.includes('https://crawlmouse.com' + p);

  it('lists every indexable marketing / legal / blog URL as an absolute crawlmouse.com URL', () => {
    for (const u of urls) expect(u).toMatch(/^https:\/\/crawlmouse\.com(\/|$)/);
    expect(urls, 'home').toContain('https://crawlmouse.com');
    for (const p of [
      '/pricing',
      '/ai-readiness-checker',
      '/developers',
      '/status',
      '/bot',
      '/privacy',
      '/terms',
      '/aup',
      '/subprocessors',
      '/takedown',
      '/blog',
    ]) {
      expect(has(p), `sitemap must include ${p}`).toBe(true);
    }
    // Leaderboards (/top/*) are page-controlled (noindex while empty/thin, indexable once
    // real ranked data accrues — robots meta in app/top/[platform]/page.tsx), same rationale
    // as an unclaimed /r/. So they are NOT auto-listed in the sitemap.
    expect(
      urls.some((u) => u.includes('/top/')),
      'leaderboards are page-controlled (noindex when empty), not sitemap-listed',
    ).toBe(false);
    for (const slug of allPostSlugs())
      expect(has('/blog/' + slug), `sitemap must include /blog/${slug}`).toBe(true);
  });

  it('leaks NO /r/ URL when there are no claimed+indexable reports (the claim-gate guardrail)', () => {
    // With the report source stubbed empty, an unclaimed/empty world must advertise no report page.
    expect(
      urls.some((u) => u.includes('/r/')),
      'unclaimed/empty → no /r/ in the sitemap',
    ).toBe(false);
  });

  it('excludes private / non-indexable paths (incl. /compare/ — noindex this phase, M3)', () => {
    for (const bad of SITEMAP_EXCLUDE) {
      expect(
        urls.some((u) => u.includes(bad)),
        `sitemap must NOT include ${bad}`,
      ).toBe(false);
    }
  });

  it('excludes them with both v2 flags on too, when the flag-gated pages are listed', async () => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    try {
      const lit = (await sitemap()).map((e) => e.url);
      expect(lit).toContain('https://crawlmouse.com/agencies');
      expect(SITEMAP_EXCLUDE).toEqual(
        expect.arrayContaining(['/agency-trial', '/v2-pricing', '/v2-developers', '/v2-report']),
      );
      for (const bad of SITEMAP_EXCLUDE)
        expect(
          lit.some((u) => u.includes(bad)),
          `sitemap must NOT include ${bad}`,
        ).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('every entry has a VALID lastModified date', async () => {
    for (const e of await sitemap()) {
      expect(e.lastModified, `${e.url} needs lastModified`).toBeTruthy();
      const t = new Date(e.lastModified as string | number | Date).getTime();
      expect(Number.isNaN(t), `${e.url} lastModified must be a valid date`).toBe(false);
    }
  });
});

// CC-29: the new public pages answer 404 while their flag is off (/agencies under V2_BILLING, the
// three /check pages under V2_CHECKS_PUBLIC), and a sitemap entry must never answer an error
// (OPERATING-RULES §13). So each is listed exactly while its own flag is on, and /pricing and
// /developers, which v1 or v2 serves either way, are listed whatever the flags say.
describe('sitemap.ts — the flag-gated pages (CC-29 D9)', () => {
  const GATED = {
    V2_BILLING: ['/agencies'],
    V2_CHECKS_PUBLIC: [
      '/check/gptbot',
      '/check/javascript',
      '/check/robots-ai',
      // CC-33 D4: the help centre.
      '/help',
      '/help/what-an-audit-measures',
      '/help/how-grades-are-calculated',
      '/help/crawler-shown-as-blocked',
      '/help/fix-still-open',
      '/help/audit-expired',
      '/help/sign-in-email',
      '/help/trials',
      '/help/cancel-and-refunds',
      '/help/other-tools-scores',
      '/help/how-we-crawl',
      '/help/plans',
      '/help/delete-account',
    ],
  } as const;
  const ALL = Object.values(GATED).flat();
  afterEach(() => vi.unstubAllEnvs());

  const paths = async (flags: { V2_BILLING: string; V2_CHECKS_PUBLIC: string }) => {
    for (const [name, value] of Object.entries(flags)) vi.stubEnv(name, value);
    return (await sitemap()).map((e) => e.url.replace('https://crawlmouse.com', ''));
  };

  it('lists no flag-gated page while both flags are off', async () => {
    const listed = await paths({ V2_BILLING: '', V2_CHECKS_PUBLIC: '' });
    expect(
      listed.filter(
        (p) => ALL.includes(p as never) || p.startsWith('/check') || p.startsWith('/help'),
      ),
    ).toEqual([]);
    expect(listed).toEqual(expect.arrayContaining(['/pricing', '/developers']));
  });

  it.each([
    ['V2_BILLING', { V2_BILLING: '1', V2_CHECKS_PUBLIC: '' }],
    ['V2_CHECKS_PUBLIC', { V2_BILLING: '', V2_CHECKS_PUBLIC: '1' }],
  ] as const)(
    'lists the pages of %s, and only those, while it alone is on',
    async (flag, flags) => {
      const listed = await paths(flags);
      expect(listed.filter((p) => ALL.includes(p as never))).toEqual([...GATED[flag]]);
      expect(listed).toEqual(expect.arrayContaining(['/pricing', '/developers']));
    },
  );

  it('lists every one, once, while both are on', async () => {
    const listed = await paths({ V2_BILLING: '1', V2_CHECKS_PUBLIC: '1' });
    expect(listed.filter((p) => ALL.includes(p as never))).toEqual(ALL);
    expect(new Set(listed).size).toBe(listed.length);
  });
});
