import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TAKEDOWN_PER_DOMAIN_PER_DAY, TAKEDOWN_PER_IP_PER_DAY } from '@/lib/limits';

// CC-37 A-5: the per-domain bucket is spent only once the report lookup has found a report, so posts
// for a domain with no report cannot use up the bucket of a domain that later gets one. The limiter
// is an in-memory counter keyed like `rate_limits`; the admin client serves `public_reports` from a
// list and records `takedown_requests` inserts.
const h = vi.hoisted(() => ({
  buckets: new Map<string, number>(),
  reports: [] as { slug: string; domain: string }[],
  inserts: [] as Record<string, unknown>[],
  ip: '198.51.100.1',
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number) => {
    const n = (h.buckets.get(key) ?? 0) + 1;
    h.buckets.set(key, n);
    return { allowed: n <= limit };
  },
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => h.ip }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => true }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'public_reports') {
        let domain = '';
        const q = {
          select: () => q,
          eq: (_c: string, v: string) => ((domain = v), q),
          is: () => q,
          order: () => q,
          limit: () => q,
          maybeSingle: async () => ({
            data: h.reports.find((r) => r.domain === domain) ?? null,
            error: null,
          }),
        };
        return q;
      }
      if (table === 'takedown_requests') {
        return {
          insert: async (row: Record<string, unknown>) => {
            h.inserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from './route';

let ipSeq = 0;
/** A takedown post from a fresh address each time, so the per-IP bucket never decides these tests. */
const post = (domain: string, ip = `198.51.100.${++ipSeq}`) => {
  h.ip = ip;
  return POST(
    new Request('http://localhost/api/takedown', {
      method: 'POST',
      body: JSON.stringify({
        domain,
        requesterEmail: ['owner', 'example.org'].join('@'),
        reason: 'This report is about my site and I want it removed.',
      }),
    }),
  );
};
const domainBucket = (d: string) => h.buckets.get(`takedown:domain:${d}`) ?? 0;

beforeEach(() => {
  h.buckets.clear();
  h.reports = [{ slug: 'has-report-abc', domain: 'has-report.example' }];
  h.inserts = [];
  ipSeq = 0;
});

describe('POST /api/takedown — per-domain bucket after the report lookup (A-5)', () => {
  it('posts for a domain with no report are 404 and spend no domain bucket', async () => {
    for (let i = 0; i < TAKEDOWN_PER_DOMAIN_PER_DAY; i++) {
      const res = await post('no-report.example');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'no_report_for_domain' });
    }
    expect(domainBucket('no-report.example')).toBe(0);
    // A fourth post, for a domain that has a report, is accepted.
    expect((await post('has-report.example')).status).toBe(200);
    expect(h.inserts).toHaveLength(1);
  });

  it('a domain that gets a report after refused posts has its whole limit', async () => {
    for (let i = 0; i < TAKEDOWN_PER_DOMAIN_PER_DAY; i++) {
      expect((await post('later.example')).status).toBe(404);
    }
    h.reports.push({ slug: 'later-xyz', domain: 'later.example' });
    for (let i = 0; i < TAKEDOWN_PER_DOMAIN_PER_DAY; i++) {
      expect((await post('later.example')).status).toBe(200);
    }
    expect(h.inserts).toHaveLength(TAKEDOWN_PER_DOMAIN_PER_DAY);
  });

  it('a domain with a report still meets its limit', async () => {
    for (let i = 0; i < TAKEDOWN_PER_DOMAIN_PER_DAY; i++) {
      expect((await post('has-report.example')).status).toBe(200);
    }
    const res = await post('has-report.example');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(h.inserts).toHaveLength(TAKEDOWN_PER_DOMAIN_PER_DAY);
  });

  it('the per-IP bucket is still spent before the lookup, for a domain with no report', async () => {
    for (let i = 0; i < TAKEDOWN_PER_IP_PER_DAY; i++) {
      expect((await post('no-report.example', '203.0.113.9')).status).toBe(404);
    }
    expect((await post('has-report.example', '203.0.113.9')).status).toBe(429);
    expect(h.inserts).toHaveLength(0);
  });
});
