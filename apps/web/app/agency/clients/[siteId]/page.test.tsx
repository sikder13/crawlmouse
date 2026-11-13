/**
 * /agency/clients/[siteId] (CC-31 D5), on PGlite with every migration applied, as each person of
 * `scopeWorld`: the owner, a developer whose seat covers the first client and not the second, a
 * person whose seat was removed, and a stranger. A client the caller's seat does not cover is a
 * 404, as a site that does not exist is.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../../__tests__/helpers/pglite-migrations';
import type { Call } from '../../../../__tests__/helpers/postgrest-pglite';
import {
  adminOver,
  keptSite,
  makePaid,
  person,
  scopeWorld,
  sessionOver,
  type Person,
  type ScopeWorld,
} from '../../../../lib/v2/account/sites-test-support';
import type { ShellView } from '../../../../lib/v2/view/account-shell';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  chosen: null as string | null,
  /** Each request the caller's client sent, as its chain of calls. */
  calls: [] as Call[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user, h.calls),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));

import { ClientScreen } from '@/components/v2/screens/agency/ClientScreen';
import { MatrixScreen } from '@/components/v2/screens/agency/MatrixScreen';
import { FirstCheckScreen } from '@/components/v2/screens/site/FirstCheckScreen';
import ClientPage from './page';

let w: ScopeWorld;

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  w = await scopeWorld(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  h.chosen = null;
});

type Screen = ReactElement<{
  data: { kind?: string; shell: ShellView; header?: { title: string } };
}>;

/** The page of `siteId` as `p` gets it, acting in `chosen` (their default account when null). */
async function open(siteId: string, p: Person | null, chosen: string | null = null) {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.user = p && { id: p.id, email: p.email };
  h.chosen = chosen;
  h.calls.length = 0;
  const el = (await ClientPage({
    params: Promise.resolve({ siteId }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ children: Screen }>;
  return el.props.children;
}

const notFound = { digest: expect.stringMatching(/404/) };

describe('/agency/clients/[siteId]', () => {
  it('has a document title of its own, and stays out of search results', async () => {
    const { metadata } = await import('./page');
    expect(metadata).toEqual({
      title: 'Client',
      robots: { index: false, follow: false },
      alternates: { canonical: null },
    });
  });

  it('is a 404 while V2_CHECKS_PUBLIC is off, even for the owner', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    h.user = { id: w.owner.id, email: w.owner.email };
    await expect(
      ClientPage({
        params: Promise.resolve({ siteId: w.site1.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toMatchObject(notFound);
  });

  it('sends a signed-out caller to sign in', async () => {
    await expect(open(w.site1.id, null)).rejects.toMatchObject({
      digest: expect.stringContaining('/login'),
    });
  });

  it('the owner opens each client', async () => {
    for (const site of [w.site1, w.site2]) {
      const screen = await open(site.id, w.owner);
      expect(screen.type).toBe(ClientScreen);
      expect(screen.props.data.header?.title).toBe(site.host);
    }
  });

  it('a developer opens the client their seat covers', async () => {
    const screen = await open(w.site1.id, w.developer, w.accountId);
    expect(screen.type).toBe(ClientScreen);
  });

  it('a client the developer’s seat does not cover is a 404, as a site that does not exist is', async () => {
    await expect(open(w.site2.id, w.developer, w.accountId)).rejects.toMatchObject(notFound);
    await expect(open(w.site2.id, w.developer)).rejects.toMatchObject(notFound);
    await expect(open(randomUUID(), w.developer, w.accountId)).rejects.toMatchObject(notFound);
  });

  it('refuses such a client at its first read, made as the caller: nothing of the account is read after it', async () => {
    await expect(open(w.site2.id, w.developer, w.accountId)).rejects.toMatchObject(notFound);
    // One request: the site, read with the caller's own client, whose row policy hid it.
    expect(h.calls.map((request) => request[0])).toEqual([['from', 'sites']]);
  });

  it('a removed seat and a stranger get a 404 for every client', async () => {
    for (const p of [w.removed, w.stranger]) {
      for (const site of [w.site1, w.site2]) {
        await expect(open(site.id, p, w.accountId)).rejects.toMatchObject(notFound);
      }
    }
  });

  it('a staging copy, a removed site and a malformed id are each a 404', async () => {
    const copy = await keptSite(h.db, w.accountId, { staging_of_site_id: w.site1.id });
    const gone = await keptSite(h.db, w.accountId, { removed_at: new Date().toISOString() });
    await expect(open(copy.id, w.owner)).rejects.toMatchObject(notFound);
    await expect(open(gone.id, w.owner)).rejects.toMatchObject(notFound);
    await expect(open('not-an-id', w.owner)).rejects.toMatchObject(notFound);
    await h.db.query(`delete from public.sites where id = any($1)`, [[copy.id, gone.id]]);
  });

  it('a client with no check yet is shown as its first check, on the agency rail', async () => {
    const fresh = await keptSite(h.db, w.accountId);
    const screen = await open(fresh.id, w.owner);
    expect(screen.type).toBe(FirstCheckScreen);
    expect(screen.props.data.shell.nav.filter((n) => n.current).map((n) => n.label)).toEqual([
      'Clients',
    ]);
    await h.db.query(`delete from public.sites where id = $1`, [fresh.id]);
  });

  it('a site of an account below Agency is the gate, not the client page', async () => {
    const pro = await person(h.db, 'pro');
    await makePaid(h.db, pro.accountId, 'pro');
    const site = await keptSite(h.db, pro.accountId);
    const screen = await open(site.id, pro);
    expect(screen.type).toBe(MatrixScreen);
    expect(screen.props.data.kind).toBe('gate');
  });

  it('opened while acting in another account, the rail offers the switch to the client’s account', async () => {
    // The developer's default account is their own; the client is the agency's.
    const screen = await open(w.site1.id, w.developer);
    expect(screen.type).toBe(ClientScreen);
    expect(screen.props.data.shell.switcher?.visiting?.switchTo.fields).toEqual({
      accountId: w.accountId,
    });
    const acting = await open(w.site1.id, w.developer, w.accountId);
    expect(acting.props.data.shell.switcher).toMatchObject({ visiting: null });
  });
});
