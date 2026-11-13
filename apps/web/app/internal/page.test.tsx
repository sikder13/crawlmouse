/**
 * /internal, the support console's search page (CC-33 D2), over PGlite through the PostgREST stand-in.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { adminOver, person, sessionOver, type Person } from '@/lib/v2/account/sites-test-support';
import { operatorPerson } from '@/lib/v2/ops/console-test-support';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  made: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.made += 1;
    return adminOver(h.db);
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

  it('says when a search found nothing', async () => {
    as(await operatorPerson(h.db));
    expect(renderToStaticMarkup(await open({ found: '0' }))).toContain(
      'No account matches that search.',
    );
  });
});
