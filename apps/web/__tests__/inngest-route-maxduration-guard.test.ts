import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Inngest serve route (/api/webhooks/inngest) executes each audit STEP as its own HTTP
// invocation, so the route's function-duration ceiling bounds how long a single crawl step may run.
// On Vercel Hobby that defaults to ~60s, which kills large-site crawls (near the 500-page free cap)
// mid-run. With Vercel Pro we pin an explicit maxDuration so deep crawls can finish. Dropping this
// export silently re-breaks large audits in prod (unit tests can't catch the timeout) — this guard
// fails first.
const ROUTE = resolve(__dirname, '..', 'app/api/webhooks/inngest/route.ts');

describe('inngest serve route maxDuration', () => {
  it('exports a maxDuration high enough for large crawls (300s — the proven Vercel Pro value)', () => {
    // Strip comments first so a commented-out `// export const maxDuration = 300` cannot satisfy the
    // match (which would silently revert the route to the ~60s default).
    const src = readFileSync(ROUTE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const m = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
    expect(
      m,
      'route must `export const maxDuration` so large crawls are not killed at the default 60s limit',
    ).toBeTruthy();
    const seconds = Number(m![1]);
    expect(seconds, 'maxDuration must be >= 300s for deep crawls').toBeGreaterThanOrEqual(300);
    // Vercel Pro WITHOUT Fluid Compute caps at 300s; 300 is the proven-safe value (the SSE stream
    // route already ships it). Keep the ceiling at 300 until Fluid Compute is confirmed enabled, so a
    // future bump that would be rejected at deploy fails here first.
    expect(seconds, 'maxDuration must stay <= 300s (non-Fluid Pro ceiling) unless Fluid Compute is confirmed').toBeLessThanOrEqual(300);
  });
});
