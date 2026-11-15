import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  keptSite,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { failedCheckOf, operatorPerson, recordLines } from '@/lib/v2/ops/console-test-support';

// POST /api/internal/search (CC-33 D2). The session and service-role clients are the PostgREST
// stand-in over PGlite with every migration applied.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return adminOver(h.db);
  },
}));

import { POST } from './route';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(() => {
  h.log.length = 0;
  h.user = null;
});

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const search = (q: string) =>
  POST(
    new Request('https://crawlmouse.com/api/internal/search', {
      method: 'POST',
      headers: {
        origin: 'https://crawlmouse.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ q }).toString(),
    }),
  );

describe('anyone but an operator gets 404, and nothing is read', () => {
  it.each(['signed out', 'signed in'] as const)('%s', async (who) => {
    const owner = await person(h.db, 'owner');
    as(who === 'signed out' ? null : owner);
    const res = await search(owner.email);
    expect(res.status).toBe(404);
    expect(h.log).not.toContain('supabaseAdmin');
  });
});

describe("an operator's search", () => {
  it('one account: straight to its page, recorded by kind and count, never the address', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    as(op);
    const res = await search(owner.email.toUpperCase());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/internal/accounts/${owner.accountId}`);
    expect((await recordLines(h.db)).at(-1)).toEqual({
      operator_id: op.id,
      action: 'search',
      account_id: null,
      target: 'email',
      reason: null,
      outcome: '1',
    });
  });

  it('several accounts: the search page with their ids, and no address in the URL', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    const agency = await person(h.db, 'agency');
    await addSeat(h.db, agency.accountId, owner, 'developer');
    as(op);
    const res = await search(owner.email);
    const location = res.headers.get('location')!;
    expect(location.startsWith('/internal?accounts=')).toBe(true);
    expect(location).not.toContain('%40');
    expect(location).not.toContain('@');
    const ids = new URL(location, 'https://x.test').searchParams.get('accounts')!.split(',');
    expect(ids.sort()).toEqual([owner.accountId, agency.accountId].sort());
    expect((await recordLines(h.db)).at(-1)).toMatchObject({ target: 'email', outcome: '2' });
  });

  it('a host and a check id each resolve to the account', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    const site = await keptSite(h.db, owner.accountId);
    as(op);
    expect((await search(`https://${site.host}/x`)).headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}`,
    );
    expect((await recordLines(h.db)).at(-1)).toMatchObject({ target: 'host', outcome: '1' });
    const check = await failedCheckOf(h.db, site.id);
    expect((await search(check)).headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}`,
    );
    expect((await recordLines(h.db)).at(-1)).toMatchObject({ target: 'check_id', outcome: '1' });
  });

  it('nothing found: the search page says so, and the search is recorded', async () => {
    const op = await operatorPerson(h.db);
    as(op);
    const res = await search(['nobody', 'example.com'].join('@'));
    expect(res.headers.get('location')).toBe('/internal?found=0');
    expect((await recordLines(h.db)).at(-1)).toMatchObject({ target: 'email', outcome: '0' });
  });

  it('a body that is not a form or JSON is refused, and nothing is searched', async () => {
    as(await operatorPerson(h.db));
    const before = (await recordLines(h.db)).length;
    const res = await POST(
      new Request('https://crawlmouse.com/api/internal/search', {
        method: 'POST',
        headers: { origin: 'https://crawlmouse.com', 'content-type': 'text/plain' },
        body: 'q=x',
      }),
    );
    expect(res.status).toBe(400);
    expect((await recordLines(h.db)).length).toBe(before);
  });

  it('no line the console writes holds an address', async () => {
    const lines = await recordLines(h.db);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) for (const v of Object.values(l)) expect(String(v)).not.toContain('@');
  });
});
