/**
 * VISUAL_PART=k/n: this job checks the k-th of n shares of the preview routes, so the `next dev`
 * behind it compiles only that share. The harness keeps every compiled route (next.config.mjs), and
 * one server holding all of them crossed Next's restart line (used heap above 80% of the limit) in
 * CI: measured at CI's 12,288 MB limit, ~57 MB of live heap per route, a restart after route 132 of
 * 149. A route's query moments share its compiled page, so they stay in one share.
 *
 * Unset, or `1/1`, is every route: local runs, and the production-build steps on next start.
 */
export type Part = { k: number; n: number };

export function parsePart(value: string | undefined): Part {
  if (value === undefined || value === '') return { k: 1, n: 1 };
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value.trim());
  if (!m) throw new Error(`VISUAL_PART must be k/n, such as 1/2: got "${value}"`);
  const k = Number(m[1]);
  const n = Number(m[2]);
  if (k > n) throw new Error(`VISUAL_PART ${value}: k must be at most n`);
  return { k, n };
}

/** The route a path compiles: its query string reuses the route's page. */
export const routeOf = (path: string) => path.split('?')[0]!;

/**
 * Whether this share checks a path. Routes are dealt in the order `routes` lists them, one to each
 * share in turn, so each share holds every n-th route and the shares differ in size by at most one.
 * A route not in `routes` belongs to the first share, so it is checked once.
 */
export function owner(routes: readonly string[], part: Part): (path: string) => boolean {
  const index = new Map<string, number>();
  for (const path of routes) {
    const route = routeOf(path);
    if (!index.has(route)) index.set(route, index.size);
  }
  return (path) => {
    const i = index.get(routeOf(path));
    return i === undefined ? part.k === 1 : i % part.n === part.k - 1;
  };
}

/** Specs that do not loop over the previews: they run in the first share only, not once per share. */
export const ONCE_SPECS = [
  'copy.spec.ts',
  'frames.spec.ts',
  'motion.spec.ts',
  'parity.spec.ts',
  'reference.spec.ts',
  'shell.spec.ts',
  'switch.spec.ts',
] as const;
