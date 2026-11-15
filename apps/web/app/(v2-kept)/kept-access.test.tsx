/**
 * Proofs for the access matrix's rows of the two kept v1 pages that read a person's data (CC-37 D1,
 * ruling 4): `/v2-kept/audit/[id]` and `/v2-kept/verify/[id]`, each through its own export, read as
 * each identity its gate tells apart. The kept page hands everything but the flag to v1's page, so
 * the checks are v1's: the audit's `.eq('id', …)` and the verification's `.eq('user_id', …)`. The
 * stubs below answer a read by applying the filters the page sends, and an unfiltered read with the
 * first row of the table, so a filter taken out of the page shows up as another person's row.
 *
 * What a person must not see is checked over the whole element tree the page returns (its props at
 * any depth), not over a render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALICE_AUDIT = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const BOB_AUDIT = '2d3e4f50-6172-4c8d-ae9f-102a3b4c5d6e';
const NO_AUDIT = '3e4f5061-7283-4d9e-bfa0-213b4c5d6e7f';
const ALICE_VERIFY = '1c2d3e4f-5061-4b7c-9d8e-0f1a2b3c4d5e';
const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {
  audits: [
    { id: ALICE_AUDIT, url: 'https://alice.example/' },
    { id: BOB_AUDIT, url: 'https://bob.example/' },
  ],
  domain_verifications: [
    {
      id: ALICE_VERIFY,
      user_id: ALICE,
      domain: 'alice-verify.example',
      method: 'dns_txt',
      verification_token: 'alice-token',
      verified_at: null,
    },
  ],
};

/** A read of `table` that applies each `.eq` it is sent; with none, the table's first row. */
const read = (table: string) => {
  const filters: [string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    },
    maybeSingle: async () => ({
      data: (TABLES[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
      error: null,
    }),
  };
  return chain;
};

const h = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock('server-only', () => ({}));
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: read }) }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: read,
  }),
}));
// No id here names a v2 check the viewer may read: what is decided is v1's read.
vi.mock('@/app/audit/[id]/_lib/access', () => ({ isReadableAudit: async () => false }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('redirect'), { digest: `NEXT_REDIRECT;${to}` });
  },
  notFound: () => {
    throw Object.assign(new Error('not found'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  },
}));

import KeptAuditPage from './v2-kept/audit/[id]/page';
import KeptVerifyPage from './v2-kept/verify/[id]/page';

beforeEach(() => vi.stubEnv('V2_CHECKS_PUBLIC', '1'));
afterEach(() => {
  vi.unstubAllEnvs();
  h.user = null;
});

/** Every string in the value, at any depth (element props included); functions are skipped. */
function strings(v: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object' && !seen.has(v)) {
    seen.add(v);
    for (const x of Object.values(v)) strings(x, out, seen);
  }
  return out;
}

type Page = typeof KeptAuditPage;
async function open(page: Page, id: string) {
  const props = { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) };
  return page(props).then(
    (el) => ({ drawn: true as const, all: strings(el), digest: '' }),
    (e: { digest?: string }) => {
      if (!e.digest) throw e;
      return { drawn: false as const, all: [] as string[], digest: e.digest };
    },
  );
}
const holds = (all: string[], mark: string) => all.some((s) => s.includes(mark));

describe('/v2-kept/audit/[id], by the id held', () => {
  it('the holder of an audit id sees that audit alone; an id that names none is sent to the v2 overview, and nothing is drawn', async () => {
    const alice = await open(KeptAuditPage, ALICE_AUDIT);
    expect(alice.drawn).toBe(true);
    expect(holds(alice.all, 'alice.example')).toBe(true);
    expect(holds(alice.all, 'bob.example')).toBe(false);

    const none = await open(KeptAuditPage, NO_AUDIT);
    expect(none.drawn).toBe(false);
    expect(none.digest).toBe(`NEXT_REDIRECT;/audit/${NO_AUDIT}/overview`);
  });
});

describe('/v2-kept/verify/[id], by the person signed in', () => {
  it('the owner sees their verification; another signed-in person is a 404; signed out is sent to sign in', async () => {
    h.user = { id: ALICE };
    const owner = await open(KeptVerifyPage, ALICE_VERIFY);
    expect(owner.drawn).toBe(true);
    expect(holds(owner.all, 'alice-verify.example')).toBe(true);

    h.user = { id: BOB };
    const other = await open(KeptVerifyPage, ALICE_VERIFY);
    expect(other.drawn).toBe(false);
    expect(other.digest).toBe('NEXT_HTTP_ERROR_FALLBACK;404');

    h.user = null;
    const out = await open(KeptVerifyPage, ALICE_VERIFY);
    expect(out.drawn).toBe(false);
    expect(out.digest).toBe('NEXT_REDIRECT;/login');
  });
});
