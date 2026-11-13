import { API_GONE, LEADERBOARDS_GONE } from './copy/cutover';
import { spellings, withoutSlash } from './rewrites';

/**
 * What each retired v1 address answers once v2 has replaced it (CC-36 D1, D2): the one table of the
 * cutover's redirects, 410s and 404s. The middleware answers a row only while every flag the row names
 * is on; with any of them off it does nothing, and v1 serves the address as it does on main. Each
 * flag is in a deployment's environment, so an Instant Rollback to the deployment before a switch-on
 * undoes that step's rows with it.
 *
 * The v1 pages v2 serves at the same address (`/`, `/dashboard`, `/r/:slug`, and the kept public
 * pages) are rewrites, in `V2_REWRITES` (rewrites.ts), not rows here: a row here means the address is
 * retired.
 */

/** A v2 flag a row is answered under (lib/auth/flags.ts, lib/billing/flags.ts). */
export type CutoverFlag = 'pipeline' | 'checksPublic' | 'billing';

export type CutoverAnswer =
  /**
   * A redirect to `to`, the query string kept; a `:name` in `to` takes the matched segment. 308,
   * or 307 where a rollback would leave a browser's cached 308 pointing at a page that is then a 404.
   */
  | { kind: 'redirect'; to: string; status: 307 | 308 }
  /** 410 with a small page saying what was retired, linking home. */
  | { kind: 'gone-page' }
  /** 410 with a JSON body naming the route to call instead, or null when nothing replaces it. */
  | { kind: 'gone-api'; replacement: string | null }
  /** 404 with a JSON body, as an unknown API path would answer. */
  | { kind: 'not-found' };

export interface CutoverRow {
  /**
   * The retired address. A segment written `:name` matches one path segment: of `[A-Za-z0-9_-]+` in
   * a redirect's row (the value goes into its `to`), of any characters otherwise. A last segment `*`
   * matches one or more segments.
   */
  from: string;
  /** Every one must be on for the row to answer. */
  flags: readonly CutoverFlag[];
  answer: CutoverAnswer;
  /** The `path` of the docs/ops/v1-inventory.json item this row rules. */
  inventory: string;
}

/**
 * The last day a retired v1 API route answers 410 (90 days after the earliest planned switch-on,
 * 2026-11-17); after it, the `gone-api` rows and the v1 handlers they shadow are removed.
 */
export const API_ALIAS_LAST_DAY = '2027-02-15';

const apiGone = (from: string, inventory: string, replacement: string | null): CutoverRow => ({
  from,
  flags: ['checksPublic', 'pipeline'],
  answer: { kind: 'gone-api', replacement },
  inventory,
});

export const V1_CUTOVER: readonly CutoverRow[] = [
  {
    from: '/compare',
    flags: ['checksPublic'],
    answer: { kind: 'redirect', to: '/', status: 308 },
    inventory: 'app/compare/page.tsx',
  },
  {
    from: '/compare/:a/:b',
    flags: ['checksPublic'],
    answer: { kind: 'redirect', to: '/audit/:a', status: 308 },
    inventory: 'app/compare/[a]/[b]/page.tsx',
  },
  {
    from: '/top/:platform',
    flags: ['checksPublic'],
    answer: { kind: 'gone-page' },
    inventory: 'app/top/[platform]/page.tsx',
  },
  // Until V2_BILLING (go-live step 5) moves billing to v2, /billing is v1's way to its Stripe portal.
  // Its target is served from V2_CHECKS_PUBLIC (step 4), so it needs both. A 307: /settings/plan is
  // a 404 once the flags are rolled back, and /billing is not an indexed address.
  {
    from: '/billing',
    flags: ['checksPublic', 'billing'],
    answer: { kind: 'redirect', to: '/settings/plan', status: 307 },
    inventory: 'app/billing/route.ts',
  },
  {
    from: '/api/trpc/*',
    flags: ['checksPublic'],
    answer: { kind: 'not-found' },
    inventory: 'app/api/trpc/[trpc]/route.ts',
  },
  // A v1 audit id is not a v2 check id, and v2's start takes a requestId v1 clients do not send, so
  // none of these is forwarded (CC-36 D2, docs/specs/v2/36-cutover.md). No v1 audit starts once
  // start answers 410, so cancel and notify have nothing left to act on, and reaudit's one caller
  // is v1's dashboard, which v2 has taken over. v1's stream, export and llms-txt are not here: the
  // v1 audit page, still served for a v1 audit, reads them.
  apiGone('/api/audits/start', 'app/api/audits/start/route.ts', '/api/checks'),
  apiGone(
    '/api/audits/:id/cancel',
    'app/api/audits/[id]/cancel/route.ts',
    '/api/checks/<checkId>/cancel',
  ),
  apiGone(
    '/api/audits/:id/notify',
    'app/api/audits/[id]/notify/route.ts',
    '/api/checks/<checkId>/notify',
  ),
  apiGone('/api/audits/:id/reaudit', 'app/api/audits/[id]/reaudit/route.ts', null),
];

const PARAM = /^:([a-z]+)$/;
/** A `:name` value that may go into a redirect's `to`. */
const URL_SAFE_VALUE = /^[A-Za-z0-9_-]+$/;

/** The values of `from`'s `:name` segments in `path`, or null when `path` is not `from`. */
function matchPattern(from: string, path: string, urlSafe: boolean): Map<string, string> | null {
  const want = from.split('/');
  const got = path.split('/');
  const tail = want.at(-1) === '*';
  if (tail ? got.length < want.length : got.length !== want.length) return null;
  const values = new Map<string, string>();
  for (const [i, part] of want.entries()) {
    const value = got[i]!;
    if (part === '*') return value === '' ? null : values;
    const param = PARAM.exec(part);
    if (param === null) {
      if (part !== value) return null;
    } else {
      if (value === '' || (urlSafe && !URL_SAFE_VALUE.test(value))) return null;
      values.set(part, value);
    }
  }
  return values;
}

export interface CutoverMatch {
  row: CutoverRow;
  /** The answer, a redirect's `to` with its `:name` segments filled in. */
  answer: CutoverAnswer;
}

/**
 * The row for a request path, whatever its flags (the middleware answers it only while they are
 * on), read in each spelling the router can reach a page or route by: as sent and percent-decoded,
 * one trailing slash allowed, and each also without the `.rsc` suffix of a React Server Components
 * request (an API path with that suffix reaches no route, so its answer changes from 404 to the
 * row's). A path that does not decode is read as sent. Null when no row matches.
 */
export function cutoverOf(pathname: string): CutoverMatch | null {
  const paths = spellings(pathname, true) ?? [withoutSlash(pathname)];
  for (const row of V1_CUTOVER) {
    for (const path of paths) {
      const redirect = row.answer.kind === 'redirect' ? row.answer : null;
      const values = matchPattern(row.from, path, redirect !== null);
      if (values === null) continue;
      if (redirect === null) return { row, answer: row.answer };
      let to = redirect.to;
      for (const [name, value] of values) to = to.replace(name, value);
      return { row, answer: { ...redirect, to } };
    }
  }
  return null;
}

/** The JSON body of a `gone-api` answer. */
export function apiGoneBody(replacement: string | null): {
  code: 'gone';
  error: string;
  replacement: string | null;
  until: string;
} {
  return {
    code: 'gone',
    error: replacement === null ? API_GONE.removed : API_GONE.replaced(replacement),
    replacement,
    until: API_ALIAS_LAST_DAY,
  };
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The v2 tokens the gone page draws with, by their names in styles/v2/tokens.css, light then dark.
 * `cutover.test.ts` reads both values of each from that file.
 */
export const GONE_PAGE_TOKENS = {
  'v2-bg': ['#f7f8fa', '#0f1317'],
  'v2-fg': ['#13161b', '#e6e9ed'],
  'v2-mut': ['#5b6472', '#97a1ad'],
  'v2-line': ['#e2e6eb', '#242b33'],
  'v2-acc': ['#ff7849', '#ff7849'],
  'v2-on-acc': ['#13161b', '#13161b'],
} as const;

const tokenCss = (scheme: 0 | 1): string =>
  Object.entries(GONE_PAGE_TOKENS)
    .map(([name, values]) => `--${name}:${values[scheme]}`)
    .join(';');

/**
 * The `gone-page` document. A middleware rewrite cannot give a page its own status (Next 15.5's
 * router keeps the rewritten page's; questions.md Q2), so the middleware answers with this whole
 * document: the v2 tokens' values inline, no stylesheet, no script, noindex.
 */
export function gonePageHtml(): string {
  const c = LEADERBOARDS_GONE;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(c.title)} · Crawlmouse</title>
<style>
:root{color-scheme:light dark;${tokenCss(0)}}
@media (prefers-color-scheme:dark){:root{${tokenCss(1)}}}
*{box-sizing:border-box}
body{margin:0;background:var(--v2-bg);color:var(--v2-fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{border-bottom:1px solid var(--v2-line);padding:20px 24px}
header a{color:var(--v2-fg);font-weight:600;text-decoration:none}
main{max-width:36rem;margin:0 auto;padding:64px 24px}
h1{font-size:2rem;line-height:1.2;font-weight:600;margin:0 0 16px}
p{color:var(--v2-mut);margin:0 0 24px}
main a{display:inline-block;background:var(--v2-acc);color:var(--v2-on-acc);font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px}
main a:focus-visible{outline:2px solid var(--v2-fg);outline-offset:2px}
</style>
</head>
<body>
<header><a href="/">Crawlmouse</a></header>
<main>
<h1>${escapeHtml(c.heading)}</h1>
<p>${escapeHtml(c.body)}</p>
<a href="/">${escapeHtml(c.home)}</a>
</main>
</body>
</html>
`;
}
