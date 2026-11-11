import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/fixes/[id]/email-developer (CC-26b D9, questions.md Q8). The route's guards and
// lib/v2/account/fixes.ts run over PGlite through the PostgREST stand-in; the rate limiter and the
// Inngest client are fakes that record what they are asked.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as string | null,
  log: [] as string[],
  sent: [] as unknown[],
  limited: new Set<string>(),
  limits: [] as [string, number, number, unknown][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', async () => {
  const { clients } = await import('@/lib/v2/account/test-support/fix-world');
  return {
    supabaseServer: async () => {
      h.log.push('supabaseServer');
      return clients(h.db, h.user).session;
    },
  };
});
vi.mock('@/lib/supabase/admin', async () => {
  const { clients } = await import('@/lib/v2/account/test-support/fix-world');
  return {
    supabaseAdmin: () => {
      h.log.push('supabaseAdmin');
      return clients(h.db, null).admin;
    },
  };
});
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number, windowMs: number, opts: unknown) => {
    h.log.push('rateLimit');
    h.limits.push([key, limit, windowMs, opts]);
    const prefix = key.split(':').slice(0, 2).join(':');
    return {
      allowed: !h.limited.has(prefix),
      remaining: 0,
      resetAt: new Date(Date.now() + 90_000),
    };
  },
}));
vi.mock('../../../../../../../inngest/client', () => ({
  inngest: {
    send: async (event: unknown) => {
      h.log.push('inngest.send');
      h.sent.push(event);
      return { ids: ['x'] };
    },
  },
}));

import { fixWorld, type FixWorld } from '@/lib/v2/account/test-support/fix-world';
import { POST } from './route';

let fw: FixWorld;
beforeAll(async () => {
  fw = await fixWorld();
  h.db = fw.db;
}, 120_000);
afterAll(async () => {
  await fw?.db.close();
});
beforeEach(() => {
  process.env.V2_CHECKS_PUBLIC = '1';
  h.log.length = 0;
  h.sent.length = 0;
  h.limits.length = 0;
  h.limited.clear();
  h.user = fw.w.ownerId;
});

const post = (id: string, body: string, type = 'application/json') =>
  POST(
    new Request(`https://crawlmouse.com/api/fixes/${id}/email-developer`, {
      method: 'POST',
      headers: { origin: 'https://crawlmouse.com', 'content-type': type },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
const answer = async (res: Response) => [res.status, await res.json()];
const json = (email: unknown) => JSON.stringify({ email });

describe('POST /api/fixes/[id]/email-developer', () => {
  it('404 with V2_CHECKS_PUBLIC unset, before anything else runs', async () => {
    delete process.env.V2_CHECKS_PUBLIC;
    expect(await answer(await post(fw.ranked[0]!, json('dev@agency.example')))).toEqual([
      404,
      { error: 'not_found' },
    ]);
    expect(h.log).toEqual([]);
  });

  it('401 auth_required signed out: no service role, no limit spent, nothing sent', async () => {
    h.user = null;
    expect(await answer(await post(fw.ranked[0]!, json('dev@agency.example')))).toEqual([
      401,
      { error: 'auth_required' },
    ]);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('404 for another account’s fix: no service role, no limit spent, nothing sent', async () => {
    const theirs = fw.stranger.seeded.site_fixes[0]!.pk.id as string;
    expect(await answer(await post(theirs, json('dev@agency.example')))).toEqual([
      404,
      { error: 'not_found' },
    ]);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('402 fixesVisible for a fix Free does not open, before any limit', async () => {
    expect(await answer(await post(fw.ranked[4]!, json('dev@agency.example')))).toEqual([
      402,
      { error: 'upgrade_required', gate: 'fixesVisible' },
    ]);
    expect(h.log).not.toContain('rateLimit');
    expect(h.sent).toEqual([]);
  });

  it.each([
    ['not an address', json('not-an-address')],
    ['no address', '{}'],
    ['another field too', JSON.stringify({ email: 'dev@agency.example', cc: 'x@y.example' })],
  ])('400 invalid_email for %s, before any limit', async (_, body) => {
    expect(await answer(await post(fw.ranked[0]!, body))).toEqual([
      400,
      { error: 'invalid_email' },
    ]);
    expect(h.log).not.toContain('rateLimit');
    expect(h.sent).toEqual([]);
  });

  it('a developer seat sends one event naming the fix’s own ids, the seat and the address', async () => {
    h.user = fw.w.scopedUserId;
    expect(await answer(await post(fw.ranked[0]!, json('Dev@Agency.example')))).toEqual([
      200,
      { queued: true },
    ]);
    expect(h.sent).toHaveLength(1);
    const day = new Date().toISOString().slice(0, 10);
    expect(h.sent[0]).toMatchObject({
      id: expect.stringMatching(new RegExp(`^fix-email:${fw.ranked[0]}:[0-9a-f]{32}:${day}$`)),
      name: 'fix.email_developer_requested',
      data: {
        fixId: fw.ranked[0],
        siteId: fw.w.site1,
        accountId: fw.w.accountId,
        requestedBySeatId: fw.w.scopedSeatId,
        to: 'dev@agency.example',
      },
    });
    expect(JSON.stringify((h.sent[0] as { id: string }).id)).not.toContain('agency');
    expect(h.limits).toEqual([
      [`fix-email:user:${fw.w.scopedUserId}`, 5, 3_600_000, { failClosed: true }],
      [`fix-email:fix:${fw.ranked[0]}`, 3, 86_400_000, { failClosed: true }],
    ]);
  });

  it.each(['fix-email:user', 'fix-email:fix'])(
    '429 rate_limited with Retry-After when %s is spent, and nothing sent',
    async (bucket) => {
      h.limited.add(bucket);
      const res = await post(fw.ranked[0]!, json('dev@agency.example'));
      expect(await answer(res)).toEqual([429, { error: 'rate_limited' }]);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(h.sent).toEqual([]);
    },
  );
});
