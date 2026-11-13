/**
 * /internal, the support console's search page (CC-33 D2), over PGlite through the PostgREST stand-in.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call } from '@/__tests__/helpers/postgrest-pglite';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { adminOver, person, sessionOver, type Person } from '@/lib/v2/account/sites-test-support';
import { operatorPerson, recordLines } from '@/lib/v2/ops/console-test-support';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** Answers is_operator true whoever the user is, standing in for a broken operator check. */
  claimOperator: false,
  admin: [] as unknown[][],
  made: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    const s = sessionOver(h.db, h.user);
    if (!h.claimOperator) return s;
    return { ...s, auth: s.auth, rpc: async () => ({ data: true, error: null }) };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.made += 1;
    return adminOver(h.db, h.admin as Call[][]);
  },
}));

import ConsolePage from './page';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(() => {
  h.user = null;
  h.claimOperator = false;
  h.admin.length = 0;
  h.made = 0;
});

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};
const open = (q: Record<string, string> = {}) =>
  ConsolePage({ searchParams: Promise.resolve(q) }) as Promise<ReactElement>;

describe('/internal', () => {
  it.each(['signed out', 'signed in'] as const)(
    'is a 404 for a caller %s, before any read',
    async (who) => {
      as(who === 'signed out' ? null : await person(h.db, 'x'));
      await expect(open()).rejects.toMatchObject({
        digest: expect.stringMatching(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/),
      });
      expect(h.made).toBe(0);
    },
  );

  it('shows the search form, posting to the search route, and reads nothing without results', async () => {
    as(await operatorPerson(h.db));
    const html = renderToStaticMarkup(await open());
    expect(html).toContain('action="/api/internal/search"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="q"');
    expect(h.made).toBe(0);
  });

  it('lists the accounts named in the address, each a link to its page, and ignores what is not an id', async () => {
    as(await operatorPerson(h.db));
    const a = await person(h.db, 'a');
    const b = await person(h.db, 'b');
    const html = renderToStaticMarkup(
      await open({ accounts: `${a.accountId},<script>,${b.accountId}` }),
    );
    expect(html).toContain(`href="/internal/accounts/${a.accountId}"`);
    expect(html).toContain(`href="/internal/accounts/${b.accountId}"`);
    expect(html).not.toContain('<script>');
  });

  it('records one list_accounts line per account listed, before it reads them', async () => {
    const op = await operatorPerson(h.db);
    as(op);
    const a = await person(h.db, 'a');
    const b = await person(h.db, 'b');
    const before = (await recordLines(h.db)).length;
    const html = renderToStaticMarkup(await open({ accounts: `${a.accountId},${b.accountId}` }));
    expect(html).toContain(`href="/internal/accounts/${a.accountId}"`);
    const lines = (await recordLines(h.db)).slice(before);
    expect(lines).toEqual(
      [a.accountId, b.accountId].map((id) =>
        expect.objectContaining({
          operator_id: op.id,
          action: 'list_accounts',
          account_id: id,
          target: id,
          reason: null,
          outcome: null,
        }),
      ),
    );
    const methods = h.admin.map((r) => (r[0] as unknown[]).slice(0, 2));
    expect(methods).toEqual([
      ['rpc', 'operator_log'],
      ['rpc', 'operator_log'],
      ['from', 'accounts'],
    ]);
  });

  it('a listing that cannot be recorded is not shown, and no account is read', async () => {
    as(await person(h.db, 'not-an-operator'));
    h.claimOperator = true;
    const a = await person(h.db, 'a');
    await expect(open({ accounts: a.accountId })).rejects.toThrow(/operator_log failed/);
    expect(h.admin.map((r) => (r[0] as unknown[])[0])).toEqual(['rpc']);
  });

  it('lists and records at most 20 ids, and records nothing for what is not an id', async () => {
    as(await operatorPerson(h.db));
    const ids = Array.from({ length: 22 }, () => randomUUID());
    const before = (await recordLines(h.db)).length;
    await open({ accounts: ['nope', ...ids, ids[0]!].join(',') });
    const lines = (await recordLines(h.db)).slice(before);
    expect(lines.map((l) => l.account_id)).toEqual(ids.slice(0, 20));
    expect(lines.every((l) => l.action === 'list_accounts')).toBe(true);
  });

  it('says when a search found nothing', async () => {
    as(await operatorPerson(h.db));
    expect(renderToStaticMarkup(await open({ found: '0' }))).toContain(
      'No account matches that search.',
    );
  });
});
