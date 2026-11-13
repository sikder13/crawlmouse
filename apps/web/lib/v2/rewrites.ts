/**
 * The v2 pages that take over a v1 address (owner ruling Q17). While a row's flag is on, the
 * middleware rewrites its `from` to its `to`; with the flag off, it is not rewritten and v1 serves
 * `from` as it does on main. A rewrite rather than a branch in v1's page, because a page's stylesheets
 * include those of the modules it imports, dynamic imports too (measured for /dashboard in CC-26b):
 * v1's page stays main's file.
 *
 * This is the one table of v2 rewrites: a session that needs one adds its row here.
 *
 * A target has no address of its own, by two checks. The middleware answers 404 to a request it
 * sees for a target in any spelling it can read (a rewrite it makes does not pass through it again).
 * And it removes `REWRITE_HEADER` from the requests it forwards and sets it only on its own rewrite,
 * so a target page rendered per request that answers 404 without the header (`reachedByRewrite`)
 * is not served by a spelling the first check missed: `/dashboard/v2` does. A prerendered target
 * cannot read a request header, so `/v2-home` (prerendered, CC-22b) and `/v2-report/<slug>`
 * (cached for 300 s as v1's report is, CC-29) have the first check only. The
 * first is pinned in `middleware.test.ts`; the second in `middleware.test.ts` (the marker),
 * `rewrite-target.test.ts` (the reader) and `app/dashboard/v2/page.test.tsx`.
 */

/** The flag a row is served under: `V2_CHECKS_PUBLIC` or `V2_BILLING` (CC-29 D1). */
export type RewriteFlag = 'checksPublic' | 'billing';

export interface V2Rewrite {
  /**
   * The v1 address the v2 page takes over. A last segment written `:name` matches one path segment
   * of a report slug's characters (`[A-Za-z0-9_-]+`), and the same name in `to` takes its value.
   */
  from: string;
  /** The v2 page that serves it. */
  to: string;
  flag: RewriteFlag;
}

export const V2_REWRITES: readonly V2Rewrite[] = [
  // CC-22b: the v2 home. app/page.tsx stays main's file; a flag branch in it linked v2's stylesheets
  // on the flag-off home (measured by CC-22b on 2026-11-10).
  { from: '/', to: '/v2-home', flag: 'checksPublic' },
  // CC-26b: the signed-in dashboard.
  { from: '/dashboard', to: '/dashboard/v2', flag: 'checksPublic' },
  // CC-29: the pages that sell. Pricing and Developers follow the billing flag; the shared report
  // follows the public checks, and its target renders v1's page for a report minted by v1.
  { from: '/pricing', to: '/v2-pricing', flag: 'billing' },
  { from: '/developers', to: '/v2-developers', flag: 'billing' },
  { from: '/r/:slug', to: '/v2-report/:slug', flag: 'checksPublic' },
];

const PARAM = /^:([a-z]+)$/;
const PARAM_VALUE = /^[A-Za-z0-9_-]+$/;

/** `row.from` against one spelling of a path: the row with `to` resolved to a page path, or null. */
function matchRow(row: V2Rewrite, path: string): V2Rewrite | null {
  const from = row.from.split('/');
  const given = path.split('/');
  if (from.length !== given.length) return null;
  let to = row.to;
  for (const [i, part] of from.entries()) {
    const value = given[i]!;
    if (!PARAM.test(part)) {
      if (part !== value) return null;
    } else {
      if (!PARAM_VALUE.test(value)) return null;
      to = to.replace(part, value);
    }
  }
  return { ...row, to };
}

/** The part of a row's target before its first `:name` segment: every path under it is the target's. */
const targetRoot = (to: string): string => to.split('/:')[0]!;

/** Set by the middleware on its own rewrite; removed from every request it forwards otherwise. */
export const REWRITE_HEADER = 'x-crawlmouse-v2-rewrite';

/** `path` without one trailing slash; `/` and `//` keep theirs, so neither is read as the other. */
const withoutSlash = (path: string): string =>
  path.length > 2 && path.endsWith('/') ? path.slice(0, -1) : path;

/**
 * The spellings a request path can reach a page by: as sent, and percent-decoded, which is how
 * Next's production router reads a path before it matches a page (`/dashboard/%76%32` is
 * `/dashboard/v2` there), and with `withRsc` each also without the `.rsc` suffix of a React Server
 * Components request. Null when the path does not decode.
 */
function spellings(pathname: string, withRsc: boolean): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return [pathname, decoded].flatMap((p) => {
    const path = withoutSlash(p);
    return withRsc && path.endsWith('.rsc')
      ? [path, withoutSlash(path.slice(0, -'.rsc'.length))]
      : [path];
  });
}

/**
 * The rewrite for a request path (a trailing slash allowed, as sent or decoded), or null, whatever its
 * flag: the middleware applies it only while `row.flag` is on. A source's `.rsc` spelling is not
 * rewritten: the rewrite serves the page, not its RSC payload.
 */
export function rewriteOf(pathname: string): V2Rewrite | null {
  const paths = spellings(pathname, false) ?? [];
  for (const row of V2_REWRITES) {
    for (const path of paths) {
      const matched = matchRow(row, path);
      if (matched !== null) return matched;
    }
  }
  return null;
}

/**
 * Whether a request path is a rewrite target or under one, in either spelling. A path that does not
 * decode counts as one, so no spelling the check cannot read reaches a target.
 */
export function isRewriteTarget(pathname: string): boolean {
  const paths = spellings(pathname, true);
  if (paths === null) return true;
  return V2_REWRITES.some((r) => {
    const root = targetRoot(r.to);
    return paths.some((p) => p === root || p.startsWith(`${root}/`));
  });
}
