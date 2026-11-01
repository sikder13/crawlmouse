import { PREVIEWS } from './pages';

/**
 * Before any test: request each preview route once, one at a time. `next dev` compiles a route on
 * its first request, and several compiling at once under the parallel workers has run past a
 * test's two minutes on CI (a page.goto timing out). The routes, not each moment: a query string
 * reuses its route's compiled page.
 */
export default async function warmRoutes() {
  const base = `http://localhost:${process.env.VISUAL_PORT ?? 3130}`;
  const routes = [...new Set(PREVIEWS.map((p) => p.path.split('?')[0]!))];
  for (const route of routes) {
    const res = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(240_000) });
    if (!res.ok) throw new Error(`${route} answered ${res.status} while warming`);
  }
}
