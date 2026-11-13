/**
 * /agency/reports (CC-31 D8), on PGlite with every migration applied: the session client is the
 * PostgREST stand-in as the signed-in user, so row security decides which sites and reports a seat
 * reads; the service role is the stand-in without one, and its requests are logged. The world is
 * `scopeWorld`: an Agency account with two client sites, each with a report schedule, read as its
 * owner, an account manager, a developer whose seat covers the first site, a person whose seat was
 * removed, and a stranger. Here site1's contact has confirmed and site2's was asked; a client
 * report was sent for each, and one more for site1 is scheduled and not sent.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import type { Call } from '../../../__tests__/helpers/postgrest-pglite';
import {
  adminOver,
  keptSite,
  scopeWorld,
  sessionOver,
  type ClientSite,
  type Person,
  type ScopeWorld,
} from '../../../lib/v2/account/sites-test-support';
import { readClientReports } from '../../../lib/v2/agency/client-reports-read';
import type { AccountDataset } from '../../../lib/v2/view/account';
import type { ClientReportsPageView, ClientReportsView } from '../../../lib/v2/view/agency-reports';

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** The switcher cookie's value on this request, or null for none. */
  chosen: null as string | null,
  /** Each request the service role made, as the calls that built it. */
  admin: [] as [string, ...unknown[]][][],
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
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => adminOver(h.db, h.admin as Call[][]),
}));

import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { ClientReportsScreen } from '@/components/v2/screens/agency/ReportsScreen';
import ClientReportsPage from './page';

let w: ScopeWorld;
const sent = { site1: randomUUID(), site2: randomUUID() };
const scheduled = randomUUID();
const CONTACT = { site1: 'ops@first-client.example', site2: 'hello@second-client.example' };

/** A client report of `site`, written as `write_client_report` writes one. */
async function clientReport(
  id: string,
  site: ClientSite,
  to: string,
  state: { status: 'sent' | 'scheduled'; sentAt: string | null; file: 'stored' | 'pending' },
) {
  await h.db.query(
    `insert into public.reports (id, account_id, site_id, kind, format, status, made_by, created_at,
                                 covers_check_ids, scheduled_for, sent_at, recipient_email,
                                 file_state, storage_path)
     values ($1, $2, $3, 'client_report', 'html', $4, 'report_schedule', '2026-10-26T14:00:00Z',
             array[$5::uuid], '2026-10-26T14:00:00Z', $6, $7, $8,
             public.report_file_path($2, $1, 'html'))`,
    [id, w.accountId, site.id, state.status, site.check, state.sentAt, to, state.file],
  );
}

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
  w = await scopeWorld(h.db);
  for (const [site, to] of [
    [w.site1, CONTACT.site1],
    [w.site2, CONTACT.site2],
  ] as const) {
    await h.db.query(`update public.sites set client_contact_email = $2 where id = $1`, [
      site.id,
      to,
    ]);
  }
  // site1: asked on 20 Oct and confirmed; its next run is Mon 16 Nov, 08:00 in Denver.
  await h.db.query(
    `update public.report_schedules
        set recipient_confirm_sent_at = '2026-10-20T15:00:00Z',
            recipient_confirmed_at = '2026-10-20T16:00:00Z',
            next_run_at = '2026-11-16T15:00:00Z'
      where site_id = $1`,
    [w.site1.id],
  );
  // site2: asked on 31 Oct, not confirmed.
  await h.db.query(
    `update public.report_schedules set recipient_confirm_sent_at = '2026-10-31T15:00:00Z'
      where site_id = $1`,
    [w.site2.id],
  );
  await clientReport(sent.site1, w.site1, CONTACT.site1, {
    status: 'sent',
    sentAt: '2026-10-26T14:00:05Z',
    file: 'stored',
  });
  await clientReport(sent.site2, w.site2, CONTACT.site2, {
    status: 'sent',
    sentAt: '2026-10-27T14:00:05Z',
    file: 'pending',
  });
  await clientReport(scheduled, w.site1, CONTACT.site1, {
    status: 'scheduled',
    sentAt: null,
    file: 'pending',
  });
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  h.chosen = null;
  h.admin.length = 0;
});

type Screen = ReactElement<{
  data: ClientReportsPageView;
  notice?: { code: string; text: string } | null;
}>;

/** The page as `p` gets it, acting in `chosen` (their default account when null). */
async function open(p: Person | null, chosen: string | null = null, search = {}) {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  h.user = p && { id: p.id, email: p.email };
  h.chosen = chosen;
  const el = (await ClientReportsPage({ searchParams: Promise.resolve(search) })) as ReactElement<{
    children: Screen;
  }>;
  return el.props.children;
}

async function reportsOf(p: Person, chosen: string | null = null, search = {}) {
  const screen = await open(p, chosen, search);
  expect(screen.type).toBe(ClientReportsScreen);
  const data = screen.props.data;
  if (data.kind !== 'reports') throw new Error(`expected the reports page, got ${data.kind}`);
  return data;
}
const rowOf = (data: ClientReportsView, site: ClientSite) =>
  data.clients.rows.find((r) => r.key === site.id)!;

describe('/agency/reports', () => {
  it('is a 404 while V2_CHECKS_PUBLIC is off, even for the owner', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    h.user = { id: w.owner.id, email: w.owner.email };
    await expect(ClientReportsPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringMatching(/404/),
    });
    expect(h.admin).toEqual([]);
  });

  it('sends a signed-out caller to sign in', async () => {
    await expect(open(null)).rejects.toMatchObject({ digest: expect.stringContaining('/login') });
  });

  it('the owner sees each client with its contact, where the contact stands, and its next run', async () => {
    const data = await reportsOf(w.owner);
    expect(data.clients.rows.map((r) => r.key).sort()).toEqual([w.site1.id, w.site2.id].sort());
    expect(data.header.line).toBe('2 weekly');
    expect(rowOf(data, w.site1)).toMatchObject({
      host: w.site1.host,
      contact: { address: CONTACT.site1, state: 'confirmed' },
      schedule: 'weekly, Mon 08:00 their time',
      // 15:00 UTC on 16 Nov is 08:00 in Denver, the schedule's zone.
      nextRun: 'Mon 16 Nov 08:00 America/Denver',
    });
    expect(rowOf(data, w.site2).contact).toMatchObject({
      address: CONTACT.site2,
      state: 'asked',
      label: 'asked to confirm Sat 31 Oct',
    });
    expect(rowOf(data, w.site2).nextRun).toBe('none');
  });

  it('the owner is offered each row’s actions, and a chosen client’s forms', async () => {
    const data = await reportsOf(w.owner, null, { client: w.site2.id });
    expect(rowOf(data, w.site1).actions.map((a) => a.label)).toEqual(['Change']);
    expect(rowOf(data, w.site2).actions.map((a) => [a.label, a.href])).toEqual([
      ['Ask again', `/api/report-files/schedules/site/${w.site2.id}/confirm`],
      ['Change', `/agency/reports?client=${w.site2.id}#change`],
    ]);
    expect(data.change).toMatchObject({
      host: w.site2.host,
      client: {
        action: `/api/report-files/schedules/site/${w.site2.id}/client`,
        email: CONTACT.site2,
      },
      schedule: {
        action: `/api/report-files/schedules/site/${w.site2.id}`,
        zone: 'America/Denver',
      },
    });
    // With no client chosen there is no form.
    expect((await reportsOf(w.owner)).change).toBeNull();
  });

  it('lists the reports that were sent, newest first, and not the one still scheduled', async () => {
    const data = await reportsOf(w.owner);
    expect(data.sent.sub).toBe('2 of 2 shown, the newest first');
    expect(data.sent.rows.map((r) => [r.key, r.host, r.to])).toEqual([
      [sent.site2, w.site2.host, CONTACT.site2],
      [sent.site1, w.site1.host, CONTACT.site1],
    ]);
    expect(data.sent.rows.map((r) => r.key)).not.toContain(scheduled);
    // site1's document is stored, so it opens; site2's is still being made.
    expect(data.sent.rows.map((r) => r.open?.href ?? null)).toEqual([
      null,
      `/reports/${sent.site1}`,
    ]);
  });

  it('an account manager with every client sees both, with the forms', async () => {
    const data = await reportsOf(w.manager, w.accountId, { client: w.site1.id });
    expect(data.clients.rows).toHaveLength(2);
    expect(data.clients.rows.every((r) => r.actions.length > 0)).toBe(true);
    expect(data.change?.host).toBe(w.site1.host);
  });

  it('a developer whose seat covers one client sees that client alone, and no form', async () => {
    for (const client of [w.site1.id, w.site2.id]) {
      const data = await reportsOf(w.developer, w.accountId, { client });
      expect(data.clients.rows.map((r) => r.key)).toEqual([w.site1.id]);
      expect(data.header.line).toBe('1 weekly, of the client sites in your seat');
      expect(data.clients.rows.flatMap((r) => r.actions)).toEqual([]);
      expect(data.change).toBeNull();
      expect(data.header.action).toBeNull();
      expect(data.sent.rows.map((r) => r.key)).toEqual([sent.site1]);
      const all = JSON.stringify(data);
      expect(all).not.toContain(w.site2.host);
      expect(all).not.toContain(w.site2.id);
      expect(all).not.toContain(CONTACT.site2);
      expect(all).not.toContain('/api/report-files/schedules');
    }
  });

  it('asks the service role about the scoped seat’s one site and its own reports, and no other', async () => {
    await reportsOf(w.developer, w.accountId);
    const about = (table: string) =>
      h.admin.filter((calls) => calls.some(([m, t]) => m === 'from' && t === table));
    const filters = (calls: [string, ...unknown[]][]) => calls.filter(([m]) => m === 'in');
    // The records' own read of the schedules and this page's: each names the one site.
    const schedules = about('report_schedules');
    expect(
      schedules.some((calls) =>
        calls.some(([m, columns]) => m === 'select' && String(columns).includes('recipient_')),
      ),
    ).toBe(true);
    for (const calls of schedules) {
      expect(filters(calls)).toEqual([['in', 'site_id', [w.site1.id]]]);
    }
    // The file states are read for the reports the developer's own session returned.
    const reports = about('reports').map(filters).flat();
    expect(reports).toContainEqual(['in', 'id', [sent.site1]]);
    expect(JSON.stringify(h.admin)).not.toContain(w.site2.id);
    expect(JSON.stringify(h.admin)).not.toContain(sent.site2);
  });

  it('a removed seat’s cookie is not followed: the person sees their own account’s gate', async () => {
    const screen = await open(w.removed, w.accountId);
    expect(screen.props.data.kind).toBe('gate');
    expect(JSON.stringify(screen.props.data)).not.toContain(w.site1.host);
  });

  it('a stranger naming the account sees their own account’s gate, and nothing of it', async () => {
    const screen = await open(w.stranger, w.accountId, { client: w.site1.id });
    expect(screen.props.data).toMatchObject({ kind: 'gate', title: 'Client reports' });
    const all = JSON.stringify(screen.props.data);
    for (const part of [w.site1.host, w.site1.id, CONTACT.site1, sent.site1]) {
      expect(all).not.toContain(part);
    }
  });

  it('a client of the account that is a staging copy is not listed', async () => {
    const copy = await keptSite(h.db, w.accountId, { staging_of_site_id: w.site1.id });
    const data = await reportsOf(w.owner);
    expect(data.clients.rows.map((r) => r.key)).not.toContain(copy.id);
    expect(data.clients.rows).toHaveLength(2);
    await h.db.query(`delete from public.sites where id = $1`, [copy.id]);
  });

  it('passes a form’s notice to the screen', async () => {
    const screen = await open(w.owner, null, { notice: 'schedule_saved' });
    expect(screen.props.notice).toMatchObject({
      code: 'schedule_saved',
      text: 'The schedule was saved.',
    });
    expect((await open(w.owner)).props.notice).toBeNull();
  });

  it('a person the viewer cannot place on one account gets that plain state', async () => {
    await h.db.query(`update public.users set default_account_id = null where id = $1`, [
      w.manager.id,
    ]);
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    h.user = { id: w.manager.id, email: w.manager.email };
    const screen = (await ClientReportsPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement<{
      state: string;
    }>;
    expect(screen.type).toBe(AccountStateScreen);
    expect(screen.props.state).toBe('ambiguous');
    await h.db.query(`update public.users set default_account_id = $2 where id = $1`, [
      w.manager.id,
      w.manager.accountId,
    ]);
  });
});

describe('readClientReports', () => {
  /** Records that name both sites, whoever reads them. */
  const both = (): AccountDataset =>
    ({
      sites: [{ id: w.site1.id }, { id: w.site2.id }],
      reports: [],
    }) as unknown as AccountDataset;

  it('reads the reports through the caller’s own session: a scoped seat gets its client’s', async () => {
    const developer = { id: w.developer.id, email: w.developer.email };
    const read = await readClientReports(
      { session: sessionOver(h.db, developer), admin: adminOver(h.db) },
      both(),
    );
    expect(read.d.reports.map((r) => r.id)).toEqual([sent.site1]);
    const owner = { id: w.owner.id, email: w.owner.email };
    const all = await readClientReports(
      { session: sessionOver(h.db, owner), admin: adminOver(h.db) },
      both(),
    );
    expect(all.d.reports.map((r) => r.id).sort()).toEqual([sent.site1, sent.site2].sort());
  });

  it('a stranger’s session reads none of them', async () => {
    const stranger = { id: w.stranger.id, email: w.stranger.email };
    const read = await readClientReports(
      { session: sessionOver(h.db, stranger), admin: adminOver(h.db) },
      both(),
    );
    expect(read.d.reports).toEqual([]);
    expect(read.side.fileStates).toEqual(new Map());
  });

  it('keeps the reports the records already hold, and reads nothing for an account with no site', async () => {
    const log: Call[][] = [];
    const none = { sites: [], reports: [{ id: 'kept' }] } as unknown as AccountDataset;
    const read = await readClientReports(
      { session: sessionOver(h.db, null), admin: adminOver(h.db, log) },
      none,
    );
    expect(read.d).toBe(none);
    expect(read.side).toEqual({ schedules: new Map(), fileStates: new Map() });
    expect(log).toEqual([]);
  });
});
