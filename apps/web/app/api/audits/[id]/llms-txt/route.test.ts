import { describe, it, expect, vi, beforeEach } from 'vitest';

// Integration test for the Pro-owner-gated llms.txt generator route (mirrors the CSV export gating).
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

let userResult: { data: { user: { id: string } | null } };
let proUntil: string | null;
let auditRow: { id: string; url: string; user_id: string | null } | null;
let pagesRows: Array<Record<string, unknown>>;
let pagesSelectArg = '';

vi.mock('@/lib/supabase/fetch-all', () => ({
  POSTGREST_PAGE: 1000,
  fetchAll: (_c: unknown, table: string, cols: string) => {
    if (table === 'pages') { pagesSelectArg = cols; return Promise.resolve(pagesRows); }
    return Promise.resolve([]);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: auditRow, error: null }) };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({
    auth: { getUser: () => Promise.resolve(userResult) },
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { pro_until: proUntil }, error: null }) };
      return chain;
    },
  }),
}));

import { GET } from './route';

const run = () => GET(new Request('http://localhost/api/audits/aud-1/llms-txt'), { params: Promise.resolve({ id: 'aud-1' }) });

beforeEach(() => {
  userResult = { data: { user: { id: 'owner-1' } } };
  proUntil = FUTURE;
  auditRow = { id: 'aud-1', url: 'https://ex.com/', user_id: 'owner-1' };
  pagesRows = [
    { url: 'https://ex.com/about', title: 'About', pagerank: 0.2, excluded_from_grade: false },
    { url: 'https://ex.com/', title: 'Home', pagerank: 0.9, excluded_from_grade: false },
    { url: 'https://ex.com/dead', title: 'Dead', pagerank: null, excluded_from_grade: true }, // must be excluded
  ];
  pagesSelectArg = '';
});

describe('GET /api/audits/[id]/llms-txt (Pro-owner-gated generator)', () => {
  it('401 when unauthenticated', async () => {
    userResult = { data: { user: null } };
    expect((await run()).status).toBe(401);
  });

  it('402 when the user is not Pro', async () => {
    proUntil = null;
    expect((await run()).status).toBe(402);
  });

  it('404 when the audit is not owned by the caller (same as missing — no id enumeration)', async () => {
    userResult = { data: { user: { id: 'intruder' } } };
    expect((await run()).status).toBe(404);
  });

  it('200 text/plain for the Pro owner: ordered llms.txt, honest note, excluded/dead pages omitted', async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();
    expect(body.startsWith('# ex.com')).toBe(true);
    const links = body.split('\n').filter((l) => l.startsWith('- ['));
    expect(links[0]).toBe('- [Home](https://ex.com/)'); // highest PageRank first
    expect(body).not.toContain('Dead'); // excluded_from_grade page is omitted
    expect(body).toContain('read mainly by AI coding agents'); // the honest, non-ranking note
    expect(pagesSelectArg).toContain('pagerank'); // reads the ordering signal
  });
});
