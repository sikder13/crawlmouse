/**
 * What the D3 rules (`page-rules.ts`) excuse, as data. Read by `__tests__/seo-public-pages.test.tsx`,
 * which fails on any violation not listed here and on any entry here that does not fire in a build
 * it names, so an entry is deleted once its page is fixed.
 *
 * An entry is keyed by page and rule: it excuses every instance of that rule on that page.
 */
import type { RuleId } from './page-rules';

export type Build = 'off' | 'on';

export interface PageException {
  path: string;
  rule: RuleId;
  builds: readonly Build[];
  reason: string;
}

const BOTH: readonly Build[] = ['off', 'on'];

const OUTSIDE = "owner: outside CC-40's paths";
const POST_DESCRIPTION =
  'owner: a post under 100 impressions, outside the rows ruling 3 rewrote (lib/blog/ruled-copy.ts)';
const LAYOUT_DESCRIPTION = `${OUTSIDE}; the page sets no description of its own, so it carries the root layout's`;
const HELP_COPY = `${OUTSIDE}; help copy is lib/v2/help, and an article's title is its question and its H1`;

export const PAGE_EXCEPTIONS: readonly PageException[] = [
  {
    path: '/agencies',
    rule: 'no-in-link',
    builds: ['on'],
    reason: `${OUTSIDE}; "For agencies" is a planned, unlinked item in components/v2/footer-links.ts`,
  },
  // v1 home (app/page.tsx): the feature cards' h3s follow the h1 with no h2 between.
  { path: '/', rule: 'heading-skip', builds: ['off'], reason: OUTSIDE },
  { path: '/pricing', rule: 'description-length', builds: ['off'], reason: OUTSIDE },
  // v1's home sets no description of its own; the v2 home's own (D2) leaves the 'on' build clean.
  { path: '/', rule: 'description-duplicate', builds: ['off'], reason: LAYOUT_DESCRIPTION },
  ...['/status', '/privacy', '/terms', '/aup', '/subprocessors', '/takedown'].map(
    (path): PageException => ({
      path,
      rule: 'description-duplicate',
      builds: BOTH,
      reason: LAYOUT_DESCRIPTION,
    }),
  ),
  ...['/blog/find-orphan-pages-squarespace', '/blog/free-internal-link-audit'].map(
    (path): PageException => ({
      path,
      rule: 'description-length',
      builds: BOTH,
      reason: POST_DESCRIPTION,
    }),
  ),
  {
    path: '/blog/ai-crawler-access-test-2026',
    rule: 'title-length',
    builds: BOTH,
    reason:
      'owner: the title is also the H1; a shorter search-result title is a `seoTitle` the owner has not ruled',
  },
  {
    path: '/developers',
    rule: 'description-length',
    builds: ['on'],
    reason: `${OUTSIDE}; the v2 page's description is lib/v2/view/developers.ts`,
  },
  { path: '/help/audit-expired', rule: 'description-length', builds: ['on'], reason: HELP_COPY },
  {
    path: '/help/cancel-and-refunds',
    rule: 'description-length',
    builds: ['on'],
    reason: HELP_COPY,
  },
  ...[
    '/help/crawler-shown-as-blocked',
    '/help/how-we-crawl',
    '/help/other-tools-scores',
    '/help/trials',
  ].map(
    (path): PageException => ({ path, rule: 'title-length', builds: ['on'], reason: HELP_COPY }),
  ),
];

/**
 * Pages a public page links to that answer but are not in the sitemap, with the builds they answer
 * in, so a link to one is not a link to a missing page. Each is an app surface (`app-surfaces.ts`).
 */
export const LIVE_OUTSIDE_SITEMAP: readonly {
  path: string;
  builds: readonly Build[];
  reason: string;
}[] = [
  { path: '/login', builds: BOTH, reason: 'sign-in, noindex; linked from both headers' },
  {
    path: '/dashboard',
    builds: ['off'],
    reason: "noindex; sends a visitor to /login; linked from v1's header",
  },
  {
    path: '/signup',
    builds: ['on'],
    reason: 'noindex; answers while V2_ACCOUNT_DOOR is on (app/(account)/signup/page.tsx)',
  },
  {
    path: '/agency-trial',
    builds: ['on'],
    reason: 'noindex; answers while V2_BILLING is on (app/agency-trial/page.tsx)',
  },
];

/** Pages whose canonical is deliberately another page: path → that page's path. None today. */
export const CANONICAL_TARGETS: Readonly<Record<string, string>> = {};
