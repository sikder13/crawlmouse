/**
 * The v2 pages that take over a v1 address (owner ruling Q17). With V2_CHECKS_PUBLIC on, the
 * middleware rewrites each `from` to its `to`; with it off, nothing is rewritten and v1 serves `from`
 * as it does on main. A rewrite rather than a branch in v1's page, because a page's stylesheets
 * include those of the modules it imports, dynamic imports too (measured for /dashboard in CC-26b):
 * v1's page stays main's file.
 *
 * This is the one table of v2 rewrites: a session that needs one adds its row here.
 *
 * A target has no address of its own. A rewrite made by the middleware does not pass through the
 * middleware again, so a request the middleware sees for a target was asked for directly, and it
 * answers 404, flag on or off (`middleware.test.ts`).
 */

export interface V2Rewrite {
  /** The v1 address the v2 page takes over. */
  from: string;
  /** The v2 page that serves it. */
  to: string;
}

export const V2_REWRITES: readonly V2Rewrite[] = [{ from: '/dashboard', to: '/dashboard/v2' }];

const withoutSlash = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

/**
 * The spellings a request path can reach a page by: as sent, and percent-decoded, which is how
 * Next's production router reads a path before it matches a page (`/dashboard/%76%32` is
 * `/dashboard/v2` there). Null when the path does not decode.
 */
function spellings(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return [withoutSlash(pathname), withoutSlash(decoded)];
}

/** The rewrite for a request path (a trailing slash allowed, either spelling), or null. */
export function rewriteOf(pathname: string): V2Rewrite | null {
  const paths = spellings(pathname) ?? [];
  return V2_REWRITES.find((r) => paths.includes(r.from)) ?? null;
}

/**
 * Whether a request path is a rewrite target or under one, in either spelling. A path that does not
 * decode counts as one, so no spelling the check cannot read reaches a target.
 */
export function isRewriteTarget(pathname: string): boolean {
  const paths = spellings(pathname);
  if (paths === null) return true;
  return V2_REWRITES.some((r) => paths.some((p) => p === r.to || p.startsWith(`${r.to}/`)));
}
