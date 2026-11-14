/**
 * /internal/accounts/[id] (CC-33 D2). The session and service-role clients are the PostgREST
 * stand-in over PGlite with every migration applied, so is_operator and the record run for real.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call } from '@/__tests__/helpers/postgrest-pglite';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  adminOver,
  keptSite,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { DONE_LINES } from '@/lib/v2/ops/actions';
import { failedCheckOf, operatorPerson, recordLines } from '@/lib/v2/ops/console-test-support';

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

import ConsoleAccountPage from './page';

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

const open = (id: string, q: Record<string, string> = {}) =>
  ConsoleAccountPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(q),
  }) as Promise<ReactElement>;

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

describe('anyone but an operator gets 404, before anything is read', () => {
  it.each(['signed out', 'signed in', 'a member of the account viewed'] as const)(
    '%s',
    async (who) => {
      const owner = await person(h.db, 'owner');
      as(who === 'signed out' ? null : who === 'signed in' ? await person(h.db, 'x') : owner);
      const before = (await recordLines(h.db)).length;
      await expect(open(owner.accountId)).rejects.toMatchObject({
        digest: expect.stringMatching(NOT_FOUND),
      });
      expect(h.made).toBe(0);
      expect((await recordLines(h.db)).length).toBe(before);
    },
  );
});

describe("an operator's view", () => {
  it('is recorded before the account is read, and shows the account', async () => {
    const op = await operatorPerson(h.db);
    const owner = await person(h.db, 'owner');
    const site = await keptSite(h.db, owner.accountId);
    const failed = await failedCheckOf(h.db, site.id);
    as(op);
    const el = await open(owner.accountId);
    expect(h.admin.length).toBeGreaterThan(1);
    expect(h.admin[0]![0]).toEqual([
      'rpc',
      'operator_log',
      expect.objectContaining({ p_action: 'view_account' }),
    ]);
    expect((await recordLines(h.db)).at(-1)).toEqual({
      operator_id: op.id,
      action: 'view_account',
      account_id: owner.accountId,
      target: owner.accountId,
      reason: null,
      outcome: null,
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain(owner.email);
    expect(html).toContain(site.host);
    expect(html).toContain(`action="/api/internal/checks/${failed}/rerun"`);
    expect(html).toContain(`action="/api/internal/accounts/${owner.accountId}/sign-in-link"`);
    expect(html).toContain(`name="userId" value="${owner.id}"`);
  });

  it('a view that cannot be recorded is not shown, and nothing of the account is read', async () => {
    const someone = await person(h.db, 'not-an-operator');
    const owner = await person(h.db, 'owner');
    as(someone);
    h.claimOperator = true;
    await expect(open(owner.accountId)).rejects.toThrow(/operator_log failed/);
    expect(h.admin.map((r) => (r[0] as unknown[])[0])).toEqual(['rpc']);
  });

  it('a malformed id is a 404 and is not recorded; an unknown one is recorded, then a 404', async () => {
    as(await operatorPerson(h.db));
    const before = (await recordLines(h.db)).length;
    await expect(open('nope')).rejects.toMatchObject({ digest: expect.stringMatching(NOT_FOUND) });
    expect((await recordLines(h.db)).length).toBe(before);
    await expect(open(randomUUID())).rejects.toMatchObject({
      digest: expect.stringMatching(NOT_FOUND),
    });
    expect((await recordLines(h.db)).length).toBe(before + 1);
  });

  it('shows the line of the action it was sent back from, and ignores a code it does not know', async () => {
    const owner = await person(h.db, 'owner');
    as(await operatorPerson(h.db));
    expect(renderToStaticMarkup(await open(owner.accountId, { done: 'link_sent' }))).toContain(
      DONE_LINES.link_sent,
    );
    const html = renderToStaticMarkup(await open(owner.accountId, { done: '<b>x</b>' }));
    expect(html).not.toContain('role="status"');
  });
});
