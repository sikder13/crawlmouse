/**
 * /agency (CC-31 D5), on PGlite with every migration applied: the session client is the PostgREST
 * stand-in as the signed-in user, so row security decides which sites a seat reads; the service
 * role is the stand-in without one. The world is `scopeWorld`: an account on the Agency tier with
 * two client sites, read as its owner, a developer whose seat covers the first site, a person whose
 * seat was removed, and a stranger.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../__tests__/helpers/pglite-migrations';
import { insertRow, ROWS } from '../../__tests__/helpers/v2-check-tables';
import {
  addSeat,
  adminOver,
  keptSite,
  person,
  scopeWorld,
  sessionOver,
  type Person,
  type ScopeWorld,
} from '../../lib/v2/account/sites-test-support';
import { sitesFullMessage } from '../../lib/v2/agency/gates';
import { agencyAccount } from '../../lib/v2/agency/test-support';
import type { AgencyHomeView } from '../../lib/v2/view/agency-matrix';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** The switcher cookie's value on this request, or null for none. */
  chosen: null as string | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));

import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { MatrixScreen } from '@/components/v2/screens/agency/MatrixScreen';
import AgencyPage from './page';

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
  data: AgencyHomeView;
  notice?: { code: string; text: string } | null;
}>;

/** The page as `p` gets it, acting in `chosen` (their default account when null). */
async function open(p: Person | null, chosen: string | null = null, search = {}) {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.user = p && { id: p.id, email: p.email };
  h.chosen = chosen;
  const el = (await AgencyPage({ searchParams: Promise.resolve(search) })) as ReactElement<{
    children: Screen;
  }>;
  return el.props.children;
}

const matrixOf = async (p: Person, chosen: string | null = null) => {
  const screen = await open(p, chosen);
  expect(screen.type).toBe(MatrixScreen);
  const data = screen.props.data;
  if (data.kind !== 'matrix') throw new Error(`expected the matrix, got ${data.kind}`);
  return data;
};

describe('/agency', () => {
  it('is a 404 while V2_CHECKS_PUBLIC is off, even for the owner', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    h.user = { id: w.owner.id, email: w.owner.email };
    await expect(AgencyPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringMatching(/404/),
    });
  });

  it('sends a signed-out caller to sign in', async () => {
    await expect(open(null)).rejects.toMatchObject({ digest: expect.stringContaining('/login') });
  });

  it('the owner sees every client, and the form to add one', async () => {
    const data = await matrixOf(w.owner);
    expect(data.clients.rows.map((r) => r.key).sort()).toEqual([w.site1.id, w.site2.id].sort());
    expect(data.header.actions.map((a) => a.href)).toEqual(['/api/sites']);
  });

  it('asks for the first client report until one was sent, which it reads from the account’s own reports', async () => {
    expect((await matrixOf(w.owner)).next?.step).toBe('report');
    const sent = randomUUID();
    await insertRow(h.db, 'reports', {
      ...ROWS.reports(sent, w.accountId, w.site1.id, w.site1.check),
      kind: 'client_report',
      format: 'html',
      made_by: 'report_schedule',
      status: 'sent',
      sent_at: '2026-11-10T09:00:00.000Z',
      recipient_email: 'reader@client.example',
      byte_count: null,
    });
    try {
      expect((await matrixOf(w.owner)).next).toBeNull();
    } finally {
      await h.db.query(`delete from public.reports where id = $1`, [sent]);
    }
  });

  it('a developer whose seat covers one client sees that client alone, and no form to add one', async () => {
    const data = await matrixOf(w.developer, w.accountId);
    expect(data.clients.rows.map((r) => r.key)).toEqual([w.site1.id]);
    expect(data.clients.rows.map((r) => r.host)).not.toContain(w.site2.host);
    expect(data.header.actions).toEqual([]);
    expect(data.header.line).toContain('1 client site in your seat');
  });

  it('an account manager with every client sees both, and may add one', async () => {
    const data = await matrixOf(w.manager, w.accountId);
    expect(data.clients.rows).toHaveLength(2);
    expect(data.header.actions).toHaveLength(1);
  });

  it('a removed seat’s cookie is not followed: the person sees their own account’s gate', async () => {
    const screen = await open(w.removed, w.accountId);
    expect(screen.props.data.kind).toBe('gate');
    expect(JSON.stringify(screen.props.data)).not.toContain(w.site1.host);
  });

  it('a stranger naming the account sees their own account’s gate, and nothing of it', async () => {
    const screen = await open(w.stranger, w.accountId);
    expect(screen.props.data.kind).toBe('gate');
    expect(JSON.stringify(screen.props.data)).not.toContain(w.site1.host);
  });

  it('a client of the account that is a staging copy is not listed', async () => {
    const copy = await keptSite(h.db, w.accountId, { staging_of_site_id: w.site1.id });
    const data = await matrixOf(w.owner);
    expect(data.clients.rows.map((r) => r.key)).not.toContain(copy.id);
    expect(data.clients.rows).toHaveLength(2);
    await h.db.query(`delete from public.sites where id = $1`, [copy.id]);
  });

  it('passes a refused form’s notice to the screen', async () => {
    const screen = await open(w.owner, null, { notice: 'site_exists' });
    expect(screen.props.notice).toMatchObject({ code: 'site_exists' });
    expect((await open(w.owner)).props.notice).toBeNull();
  });

  it('a client refused because the plan’s sites are all in use is told so from the gate messages', async () => {
    const screen = await open(w.owner, null, { notice: 'upgrade_required' });
    expect(screen.props.notice?.text).toBe(sitesFullMessage('agency'));
  });
});

describe('/agency for a person with a seat on an agency account', () => {
  let boss: Person;
  let colleague: Person;
  let agencyId: string;

  beforeAll(async () => {
    boss = await person(h.db, 'boss');
    colleague = await person(h.db, 'colleague');
    agencyId = (await agencyAccount(h.db, boss, 'Summit Digital')).accountId;
    await addSeat(h.db, agencyId, colleague, 'developer');
  });

  it('acting in their own account: one button, Open <agency>, which is the switch', async () => {
    for (const p of [boss, colleague]) {
      const screen = await open(p);
      expect(screen.props.data).toMatchObject({
        kind: 'open',
        agencies: [
          {
            label: 'Open Summit Digital',
            href: '/api/seats/switch',
            method: 'post',
            fields: { accountId: agencyId },
          },
        ],
      });
    }
  });

  it('acting in the agency: its matrix, with no client yet and the first step of setup', async () => {
    const data = await matrixOf(boss, agencyId);
    expect(data.clients.rows).toEqual([]);
    expect(data.next?.step).toBe('add');
    // A developer may not add a client: there is no step for them to take.
    expect((await matrixOf(colleague, agencyId)).next).toBeNull();
  });

  it('a person the viewer cannot place on one account gets that plain state', async () => {
    await h.db.query(`update public.users set default_account_id = null where id = $1`, [boss.id]);
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.user = { id: boss.id, email: boss.email };
    // The state has no rail and no form, so the page returns it bare.
    const screen = (await AgencyPage({ searchParams: Promise.resolve({}) })) as ReactElement<{
      state: string;
    }>;
    expect(screen.type).toBe(AccountStateScreen);
    expect(screen.props.state).toBe('ambiguous');
    await h.db.query(`update public.users set default_account_id = $2 where id = $1`, [
      boss.id,
      boss.accountId,
    ]);
  });
});
