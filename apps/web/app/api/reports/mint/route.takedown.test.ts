import { beforeEach, describe, expect, it, vi } from 'vitest';

// The v1 path of POST /api/reports/mint on a host with a taken-down report. Possession of a completed
// audit's id is the permission there, so this is the path that needs no account.

let takenDown = false;
let existing: { slug: string } | null = null;
const insert = vi.fn();
const AUDIT = '123e4567-e89b-12d3-a456-426614174000';
const row = { id: AUDIT, url: 'https://ex.com', status: 'completed', grade: 'B', score: 80 };

vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '9.9.9.9' }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => true }));
vi.mock('@/lib/mint-snapshot', () => ({ buildMintSnapshot: async () => ({ version: 1 }) }));
vi.mock('@/lib/slug', () => ({ newReportSlug: () => 'slug-new' }));
vi.mock('@/lib/host-takedown', () => ({ hostTakenDown: async () => takenDown }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'audits' ? row : existing }),
        }),
      }),
      insert: async (payload: unknown) => {
        insert(payload);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from './route';

const mint = () =>
  POST(
    new Request('http://localhost/api/reports/mint', {
      method: 'POST',
      body: JSON.stringify({ auditId: AUDIT }),
    }),
  );

beforeEach(() => {
  takenDown = false;
  existing = null;
  insert.mockClear();
});

describe('POST /api/reports/mint, an audit of a host with a taken-down report', () => {
  it('is 409 and writes nothing', async () => {
    takenDown = true;
    const res = await mint();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'host_taken_down' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not answer the slug of a report already there', async () => {
    takenDown = true;
    existing = { slug: 'the-old-slug' };
    expect(await (await mint()).json()).toEqual({ error: 'host_taken_down' });
  });

  it('the control: with no takedown it mints', async () => {
    expect((await mint()).status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
