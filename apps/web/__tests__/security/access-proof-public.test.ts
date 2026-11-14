/**
 * Proofs for access-matrix rows whose route no other test imports (CC-37 D1): each test here calls
 * the route handler itself, so a row's proof reaches the file the row is about.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// Vitest does not read tsconfig `paths`, through which Next resolves the worker package.
vi.mock('@crawlmouse/inngest', () => import('../../../../inngest/client'));
vi.mock('@crawlmouse/inngest/audit', () => import('../../../../inngest/audit'));
vi.mock('@crawlmouse/inngest/billing', () => import('../../../../inngest/billing'));

const reads = vi.hoisted(() => ({
  report: null as null | { slug: string; grade: string | null; score: number | null },
  domains: [] as string[],
  tables: [] as string[],
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: async () => ({}) }) }));
vi.mock('@/lib/badge-report', async (original) => ({
  ...(await original<typeof import('@/lib/badge-report')>()),
  readLatestVisibleReport: async (_sb: unknown, domain: string) => {
    reads.domains.push(domain);
    return reads.report;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: (table: string) => {
      reads.tables.push(table);
      throw new Error(`read ${table}`);
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  reads.report = null;
  reads.domains = [];
  reads.tables = [];
});

describe('the public routes, called', { timeout: 60_000 }, () => {
  it('robots.txt serves the document lib/robots-txt.ts builds, as text', async () => {
    const { GET } = await import('../../app/robots.txt/route');
    const { robotsTxt } = await import('../../lib/robots-txt');
    const res = GET();
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe(robotsTxt());
  });

  it('the tRPC route runs no procedure on a POST: the router has no mutation', async () => {
    const { GET, POST } = await import('../../app/api/trpc/[trpc]/route');
    const { appRouter } = await import('../../lib/trpc/router');
    const paths = Object.keys(appRouter._def.procedures);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const res = await POST(
        new Request(`https://crawlmouse.com/api/trpc/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      );
      expect(res.status, path).toBe(405);
    }
    expect(reads.tables).toEqual([]);
    // The route does run a query: signed out, the owner-scoped list is a 401 and reads nothing.
    const listed = await GET(new Request('https://crawlmouse.com/api/trpc/audits.listMine'));
    expect(listed.status).toBe(401);
    expect(reads.tables).toEqual([]);
  });

  it('the embed badge of a domain with no visible report shows no grade', async () => {
    const { GET } = await import('../../app/embed/[domain]/route');
    const call = (d: string) =>
      GET(new Request(`https://crawlmouse.com/embed/${d}`), {
        params: Promise.resolve({ domain: d }),
      });
    const none = await (await call('Example.COM')).text();
    expect(reads.domains).toEqual(['example.com']);
    expect(none).toContain('No public Crawlmouse report yet');
    expect(none).not.toContain('/r/');
    // The case above is not vacuous: a visible report is drawn, with its link.
    reads.report = { slug: 'example-com-1', grade: 'B', score: 81 };
    const drawn = await (await call('example.com')).text();
    expect(drawn).toContain('/r/example-com-1');
    expect(drawn).not.toContain('No public Crawlmouse report yet');
  });

  it('the Inngest route refuses an unsigned call when a signing key is set', async () => {
    vi.stubEnv('INNGEST_DEV', '0');
    vi.stubEnv('INNGEST_SIGNING_KEY', `signkey-prod-${'ab'.repeat(32)}`);
    vi.resetModules();
    const { POST } = await import('../../app/api/webhooks/inngest/route');
    const url =
      'https://crawlmouse.com/api/webhooks/inngest?fnId=crawlmouse-crawlmouse.audit&stepId=step';
    const res = await (POST as unknown as (r: Request, c: unknown) => Promise<Response>)(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: { name: 'audit.requested', data: {} },
          events: [],
          steps: {},
          ctx: {},
        }),
      }),
      {},
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: 'Unauthorized' });
  });
});
