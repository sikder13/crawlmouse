import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
  NEXT_SINCE,
} from '@/lib/v2/account/sites-test-support';

// The client report schedule routes and the recipient's two links (CC-31 D8). The session and
// service-role clients are the PostgREST stand-in over PGlite with every migration applied, so
// `is_member_for_site`, `seat_may`, row security and migration 20261114000002's schedule functions
// run for real; Inngest's send and the rate limit are fakes, and no mail is sent.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  log: [] as string[],
  send: vi.fn(async (_e: unknown) => undefined),
  limits: [] as { key: string; limit: number; windowMs: number; failClosed: boolean }[],
  over: new Set<string>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return adminOver(h.db);
  },
}));
vi.mock('../../../../../../../../inngest/client', () => ({ inngest: { send: h.send } }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (
    key: string,
    limit: number,
    windowMs: number,
    opts?: { failClosed?: boolean },
  ) => {
    h.limits.push({ key, limit, windowMs, failClosed: opts?.failClosed === true });
    return {
      allowed: !h.over.has(key.split(':')[0]!),
      remaining: 0,
      resetAt: new Date(Date.now() + 90_000),
    };
  },
}));

import { CONFIRM_MAILS_PER_DAY } from '@/lib/v2/agency/confirm-bounds';
import { POST as USE_CONFIRM } from '../../../confirm/route';
import { POST as USE_DECLINE } from '../../../decline/route';
import { POST as USE_PAUSE } from '../../../pause/route';
import { GET as LAND_CONFIRM } from '../../../../../s/confirm/[token]/route';
import {
  GET as LAND_DECLINE,
  POST as ONE_CLICK_DECLINE,
} from '../../../../../s/decline/[token]/route';
import { GET as LAND_PAUSE, POST as ONE_CLICK } from '../../../../../s/pause/[token]/route';
import { PATCH as CLIENT, POST as CLIENT_FORM } from './client/route';
import { POST as CONFIRM } from './confirm/route';
import { POST as RESUME } from './resume/route';
import { DELETE, POST as SCHEDULE_FORM, PUT } from './route';

const ORIGIN = 'https://crawlmouse.com';
const FORM = 'application/x-www-form-urlencoded';
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(() => {
  h.user = null;
  h.log.length = 0;
  h.limits.length = 0;
  h.over = new Set();
  h.send.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', ORIGIN);
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Pick<Person, 'id' | 'email'> | null) => {
  h.user = p && { id: p.id, email: p.email };
};

function request(
  path: string,
  method: string,
  body?: string,
  type = 'application/json',
  cookie?: string,
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      'x-forwarded-for': '203.0.113.9',
      ...(body === undefined ? {} : { 'content-type': type }),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

const ctx = (siteId: string) => ({ params: Promise.resolve({ siteId }) });
const base = (siteId: string) => `/api/report-files/schedules/site/${siteId}`;
const WEEKLY = {
  cadence: 'weekly',
  isoWeekday: 1,
  timeLocal: '09:00',
  timezone: 'UTC',
  sendWhenUnchanged: false,
};

const put = (siteId: string, v: unknown = WEEKLY) =>
  PUT(request(base(siteId), 'PUT', JSON.stringify(v)), ctx(siteId));
const del = (siteId: string) => DELETE(request(base(siteId), 'DELETE'), ctx(siteId));
const patch = (siteId: string, v: unknown) =>
  CLIENT(request(`${base(siteId)}/client`, 'PATCH', JSON.stringify(v)), ctx(siteId));
const resend = (siteId: string) =>
  CONFIRM(request(`${base(siteId)}/confirm`, 'POST', '{}'), ctx(siteId));
const resume = (siteId: string) =>
  RESUME(request(`${base(siteId)}/resume`, 'POST', '{}'), ctx(siteId));

interface World {
  owner: Person;
  manager: Person;
  /** A developer whose seat covers the site. */
  developer: Person;
  /** An account manager whose seat covers another client only. */
  elsewhere: Person;
  stranger: Person;
  accountId: string;
  siteId: string;
  host: string;
}

async function world(tier: 'pro' | 'agency' = 'agency'): Promise<World> {
  const owner = await person(h.db, 'owner');
  await makePaid(h.db, owner.accountId, tier);
  const [site, other] = [
    await keptSite(h.db, owner.accountId),
    await keptSite(h.db, owner.accountId),
  ];
  const [manager, developer, elsewhere, stranger] = [
    await person(h.db, 'manager'),
    await person(h.db, 'developer'),
    await person(h.db, 'elsewhere'),
    await person(h.db, 'stranger'),
  ];
  await addSeat(h.db, owner.accountId, manager, 'account_manager');
  await addSeat(h.db, owner.accountId, developer, 'developer', [site.id]);
  await addSeat(h.db, owner.accountId, elsewhere, 'account_manager', [other.id]);
  return {
    owner,
    manager,
    developer,
    elsewhere,
    stranger,
    accountId: owner.accountId,
    siteId: site.id,
    host: site.host,
  };
}

interface ScheduleRow {
  cadence: string;
  iso_weekday: number;
  time_local: string;
  timezone: string;
  send_when_unchanged: boolean;
  paused_by_recipient_at: Date | null;
  recipient_confirmed_at: Date | null;
  recipient_confirm_hash: string | null;
  next_run_at: Date | null;
}
const schedule = async (siteId: string) =>
  (
    await h.db.query<ScheduleRow>(`select * from public.report_schedules where site_id = $1`, [
      siteId,
    ])
  ).rows[0];
const siteRow = async (siteId: string) =>
  (
    await h.db.query<{
      client_name: string | null;
      client_contact_name: string | null;
      client_contact_email: string | null;
      owner_seat_id: string | null;
    }>(
      `select client_name, client_contact_name, client_contact_email, owner_seat_id from public.sites where id = $1`,
      [siteId],
    )
  ).rows[0]!;

/** A client with a contact and a schedule, written as SQL writes them. */
async function scheduled(w: World, contact = 'client@client.example') {
  await h.db.query(`select public.set_client($1, $2, $3::jsonb)`, [
    w.siteId,
    w.accountId,
    JSON.stringify({ client_contact_email: contact }),
  ]);
  await h.db.query(`select public.set_report_schedule($1, $2, $3::jsonb, now())`, [
    w.siteId,
    w.accountId,
    JSON.stringify({
      cadence: 'weekly',
      iso_weekday: 1,
      time_local: '09:00',
      timezone: 'UTC',
      send_when_unchanged: false,
    }),
  ]);
}
/**
 * A link's token: the confirmation's is minted in SQL; the pause link's is the mailer's, and SQL is
 * given its sha256 (lib/v2/mail/report-pause-token.ts).
 */
const token = async (fn: 'issue_recipient_confirmation' | 'issue_report_pause', siteId: string) => {
  if (fn === 'issue_recipient_confirmation') {
    return (
      await h.db.query<{ r: { token: string } }>(`select public.${fn}($1, now()) r`, [siteId])
    ).rows[0]!.r.token;
  }
  const made = randomBytes(32).toString('base64url');
  await h.db.query(
    `select public.issue_report_pause(
       $1, (select client_contact_email from public.sites where id = $1), $2, now())`,
    [siteId, createHash('sha256').update(made, 'utf8').digest('hex')],
  );
  return made;
};

/** A confirmed contact: the confirmation link issued and used, as SQL does both. */
async function confirmedWorld(): Promise<World> {
  const w = await world();
  await scheduled(w);
  const t = await token('issue_recipient_confirmation', w.siteId);
  await h.db.query(`select public.confirm_report_recipient($1, now())`, [sha256(t)]);
  return w;
}

/** The account's bound on confirmation mail, as each route that asks for the mail must ask it. */
const confirmBound = (accountId: string) => ({
  key: `report-confirm:account:${accountId}`,
  limit: CONFIRM_MAILS_PER_DAY.account,
  windowMs: 86_400_000,
  failClosed: true,
});

describe('what each answer says became of the confirmation', () => {
  const events = () => h.send.mock.calls.map((c) => (c[0] as { name: string }).name);
  const said = async (res: Response) =>
    ((await res.json()) as { confirmation?: string }).confirmation;
  /** The account as an Agency trial with a card, as the entitlement step writes one. */
  const inTrial = (accountId: string) =>
    h.db.query(
      `update public.accounts
          set state = 'agency_trial', trial_variant = 'card_required', trial_used_at = now(),
              trial_ends_at = now() + interval '5 days',
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'agency_trial', 'since', ${NEXT_SINCE}))
        where id = $1`,
      [accountId],
    );

  it('a contact saved before its schedule is asked when the schedule is saved, once', async () => {
    const w = await world();
    as(w.owner);
    expect(await said(await patch(w.siteId, { contactEmail: 'c@client.example' }))).toBe('none');
    expect(events()).toEqual([]);
    h.limits.length = 0;
    expect(await said(await put(w.siteId))).toBe('asked');
    expect(events()).toEqual(['report.confirmation.requested']);
    // The save asks within the account's bound on confirmation mail, which fails closed.
    expect(h.limits).toEqual([confirmBound(w.accountId)]);
    // Saved again, with the link sent and not used: nothing more is asked.
    await h.db.query(
      `update public.report_schedules set recipient_confirm_sent_at = now() where site_id = $1`,
      [w.siteId],
    );
    expect(await said(await put(w.siteId))).toBe('none');
    expect(events()).toHaveLength(1);
  });

  it('in an Agency trial a contact that is not the owner’s own address is asked nothing, is told so, and no bound is counted', async () => {
    const w = await world();
    await inTrial(w.accountId);
    as(w.owner);
    await put(w.siteId);
    h.limits.length = 0;
    const saved = await patch(w.siteId, { contactEmail: 'outside@client.example' });
    expect([saved.status, await said(saved)]).toEqual([200, 'waits']);
    const again = await resend(w.siteId);
    expect([again.status, await again.json()]).toEqual([409, { code: 'confirmation_waits' }]);
    expect(await said(await put(w.siteId))).toBe('waits');
    expect(events()).toEqual([]);
    expect(h.limits).toEqual([]);
    // A form is sent back with the notice that says why.
    const form = await CLIENT_FORM(
      request(
        `${base(w.siteId)}/client`,
        'POST',
        '_method=PATCH&contactEmail=other%40client.example',
        FORM,
      ),
      ctx(w.siteId),
    );
    expect(form.headers.get('location')).toBe('/agency/reports?notice=client_saved_waits');
  });

  it('in an Agency trial the owner’s own address is asked as any contact is', async () => {
    const w = await world();
    await inTrial(w.accountId);
    as(w.owner);
    await put(w.siteId);
    expect(await said(await patch(w.siteId, { contactEmail: w.owner.email.toUpperCase() }))).toBe(
      'asked',
    );
    expect(events()).toEqual(['report.confirmation.requested']);
  });

  it('past the day’s bound a saved contact is told it is asked at the next run', async () => {
    const w = await world();
    as(w.owner);
    await put(w.siteId);
    h.over.add('report-confirm');
    const saved = await patch(w.siteId, { contactEmail: 'c@client.example' });
    expect([saved.status, await said(saved)]).toEqual([200, 'later']);
    expect(events()).toEqual([]);
  });

  it('past the day’s bound a saved schedule stands and asks for nothing', async () => {
    const w = await world();
    as(w.owner);
    await patch(w.siteId, { contactEmail: 'c@client.example' });
    h.over.add('report-confirm');
    const saved = await put(w.siteId);
    expect([saved.status, await said(saved)]).toEqual([200, 'later']);
    expect(events()).toEqual([]);
    expect(await schedule(w.siteId)).toBeDefined();
  });

  it('while its recipient has paused a schedule, no save and no “ask again” asks them anything', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    await h.db.query(`select public.pause_report_schedule($1, now())`, [sha256(t)]);
    as(w.owner);
    h.limits.length = 0;
    const again = await resend(w.siteId);
    expect([again.status, await again.json()]).toEqual([409, { code: 'nothing_to_confirm' }]);
    expect(await said(await put(w.siteId))).toBe('none');
    expect(events()).toEqual([]);
    expect(h.limits).toEqual([]);
    expect((await schedule(w.siteId))!.paused_by_recipient_at).not.toBeNull();

    // The same once the confirmation is gone: resumed, asked, and paused again with the old link,
    // the schedule is one whose contact has not confirmed, and still nothing but resume asks.
    expect(await said(await resume(w.siteId))).toBe('asked');
    await h.db.query(`select public.pause_report_schedule($1, now())`, [sha256(t)]);
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
    h.send.mockClear();
    h.limits.length = 0;
    const unconfirmed = await resend(w.siteId);
    expect([unconfirmed.status, await unconfirmed.json()]).toEqual([
      409,
      { code: 'nothing_to_confirm' },
    ]);
    expect(await said(await put(w.siteId))).toBe('none');
    expect(events()).toEqual([]);
    expect(h.limits).toEqual([]);
  });
});

describe('the notice a form is answered with says what became of the confirmation', () => {
  const location = (res: Response) => [res.status, res.headers.get('location')];
  const to = (code: string) => [303, `/agency/reports?notice=${code}`];
  const scheduleForm = (siteId: string) =>
    SCHEDULE_FORM(
      request(
        base(siteId),
        'POST',
        '_method=PUT&cadence=weekly&isoWeekday=1&timeLocal=09%3A00&timezone=UTC',
        FORM,
      ),
      ctx(siteId),
    );
  const clientForm = (siteId: string, contact: string) =>
    CLIENT_FORM(
      request(
        `${base(siteId)}/client`,
        'POST',
        `_method=PATCH&contactEmail=${encodeURIComponent(contact)}`,
        FORM,
      ),
      ctx(siteId),
    );
  const resumeForm = (siteId: string) =>
    RESUME(request(`${base(siteId)}/resume`, 'POST', '', FORM), ctx(siteId));
  const inTrial = (accountId: string) =>
    h.db.query(
      `update public.accounts
          set state = 'agency_trial', trial_variant = 'card_required', trial_used_at = now(),
              trial_ends_at = now() + interval '5 days',
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'agency_trial', 'since', ${NEXT_SINCE}))
        where id = $1`,
      [accountId],
    );
  const pausedWorld = async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    await h.db.query(`select public.pause_report_schedule($1, now())`, [sha256(t)]);
    return w;
  };

  it('a saved schedule: asked, waiting for the plan, and nothing to ask', async () => {
    const asked = await world();
    as(asked.owner);
    await patch(asked.siteId, { contactEmail: 'c@client.example' });
    expect(location(await scheduleForm(asked.siteId))).toEqual(to('schedule_saved_asked'));

    const waits = await world();
    await inTrial(waits.accountId);
    as(waits.owner);
    await patch(waits.siteId, { contactEmail: 'outside@client.example' });
    expect(location(await scheduleForm(waits.siteId))).toEqual(to('schedule_saved_waits'));

    const none = await world();
    as(none.owner);
    expect(location(await scheduleForm(none.siteId))).toEqual(to('schedule_saved'));
  });

  it('a saved contact: asked, asked at the next run, and nothing to ask', async () => {
    const w = await world();
    as(w.owner);
    await put(w.siteId);
    expect(location(await clientForm(w.siteId, 'c@client.example'))).toEqual(
      to('client_saved_asked'),
    );
    h.over.add('report-confirm');
    expect(location(await clientForm(w.siteId, 'd@client.example'))).toEqual(
      to('client_saved_later'),
    );
    h.over.clear();
    // The same address again: the contact did not change.
    expect(location(await clientForm(w.siteId, 'd@client.example'))).toEqual(to('client_saved'));
  });

  it('a resume: asked, asked at the next run, and waiting for the plan', async () => {
    const asked = await pausedWorld();
    as(asked.owner);
    expect(location(await resumeForm(asked.siteId))).toEqual(to('schedule_resumed'));

    const later = await pausedWorld();
    as(later.owner);
    h.over.add('report-confirm');
    expect(location(await resumeForm(later.siteId))).toEqual(to('schedule_resumed_later'));
    h.over.clear();

    const waits = await pausedWorld();
    await inTrial(waits.accountId);
    as(waits.owner);
    expect(location(await resumeForm(waits.siteId))).toEqual(to('confirmation_waits'));
  });
});

describe('who may use the schedule routes', () => {
  const calls = (w: World) =>
    [
      ['PUT schedule', () => put(w.siteId)],
      ['DELETE schedule', () => del(w.siteId)],
      ['PATCH client', () => patch(w.siteId, { clientName: 'X' })],
      ['POST confirm', () => resend(w.siteId)],
      ['POST resume', () => resume(w.siteId)],
    ] as const;

  /** The two routes' form handlers, which are their own exports. */
  const formCalls = (w: World) =>
    [
      [
        'POST schedule (a form)',
        () =>
          SCHEDULE_FORM(
            request(
              base(w.siteId),
              'POST',
              '_method=PUT&cadence=weekly&isoWeekday=3&timeLocal=08%3A30&timezone=UTC',
              FORM,
            ),
            ctx(w.siteId),
          ),
      ],
      [
        'POST client (a form)',
        () =>
          CLIENT_FORM(
            request(`${base(w.siteId)}/client`, 'POST', 'clientName=X', FORM),
            ctx(w.siteId),
          ),
      ],
    ] as const;

  it('each answers 404 with the flag off and 401 signed out, before any service-role client; so does each form handler', async () => {
    const w = await world();
    for (const [name, call] of [...calls(w), ...formCalls(w)]) {
      as(null);
      expect((await call()).status, name).toBe(401);
      as(w.owner);
      vi.stubEnv('V2_CHECKS_PUBLIC', '');
      expect((await call()).status, name).toBe(404);
      vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    }
    expect(h.log).toEqual([]);
    expect(await schedule(w.siteId)).toBeUndefined();
  });

  it('each refuses a developer whose seat covers the site: 403 role_refused', async () => {
    const w = await world();
    as(w.developer);
    for (const [name, call] of calls(w)) {
      const res = await call();
      expect(res.status, name).toBe(403);
      expect(await res.json()).toEqual({ code: 'role_refused' });
    }
    expect(h.log).toEqual([]);
    expect(await schedule(w.siteId)).toBeUndefined();
    expect((await siteRow(w.siteId)).client_name).toBeNull();
  });

  it('each answers 404 for a seat that does not cover the site, a stranger, and a malformed id', async () => {
    const w = await world();
    for (const who of [w.elsewhere, w.stranger]) {
      as(who);
      for (const [name, call] of calls(w)) {
        const res = await call();
        expect(res.status, `${name} ${who.email}`).toBe(404);
        expect(await res.json()).toEqual({ code: 'not_found' });
      }
    }
    as(w.owner);
    expect((await put('not-an-id')).status).toBe(404);
    expect(h.log).toEqual([]);
    expect(await schedule(w.siteId)).toBeUndefined();
  });

  it('each answers 402 with the gate’s name on a plan without client reports', async () => {
    const w = await world('pro');
    as(w.owner);
    for (const [name, call] of calls(w)) {
      const res = await call();
      expect(res.status, name).toBe(402);
      expect(await res.json()).toEqual({ code: 'upgrade_required', gate: 'agencyBranding' });
    }
    expect(h.log).toEqual([]);
    expect(await schedule(w.siteId)).toBeUndefined();
  });

  it('an account manager may use them', async () => {
    const w = await world();
    as(w.manager);
    expect((await put(w.siteId)).status).toBe(200);
    expect((await patch(w.siteId, { clientName: 'Harborlight' })).status).toBe(200);
  });
});

describe('PUT and DELETE …/schedules/site/[siteId]', () => {
  it('saves the schedule and answers when it runs next; saving again changes it', async () => {
    const w = await world();
    as(w.owner);
    const res = await put(w.siteId);
    expect(res.status).toBe(200);
    const { nextRunAt } = (await res.json()) as { nextRunAt: string };
    const row = (await schedule(w.siteId))!;
    expect(row).toMatchObject({
      cadence: 'weekly',
      iso_weekday: 1,
      time_local: '09:00',
      timezone: 'UTC',
      send_when_unchanged: false,
    });
    expect(row.next_run_at!.toISOString()).toBe(nextRunAt);
    expect(new Date(nextRunAt).getUTCDay()).toBe(1);
    expect(Date.parse(nextRunAt)).toBeGreaterThan(Date.now());

    await put(w.siteId, { ...WEEKLY, cadence: 'monthly', isoWeekday: 5, sendWhenUnchanged: true });
    expect(await schedule(w.siteId)).toMatchObject({
      cadence: 'monthly',
      iso_weekday: 5,
      send_when_unchanged: true,
    });
  });

  it('answers 400 invalid for a body that is not a schedule, and writes nothing', async () => {
    const w = await world();
    as(w.owner);
    for (const bad of [
      {},
      { ...WEEKLY, cadence: 'on_deploy' },
      { ...WEEKLY, isoWeekday: 8 },
      { ...WEEKLY, timeLocal: '9am' },
      { ...WEEKLY, timezone: 'Mars/Olympus' },
      // An offset: Intl reads it east of UTC and Postgres west.
      { ...WEEKLY, timezone: '+05:00' },
      // Names Intl and Postgres both take and the contract does not: stored, each would make the
      // account's records fail to parse when they are read.
      { ...WEEKLY, timezone: 'Japan' },
      { ...WEEKLY, timezone: 'EST' },
      { ...WEEKLY, timezone: 'america/denver' },
      { ...WEEKLY, timezone: 'utc' },
      { ...WEEKLY, openTracking: true },
      { ...WEEKLY, siteId: randomUUID() },
    ]) {
      const res = await put(w.siteId, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ code: 'invalid' });
    }
    expect(await schedule(w.siteId)).toBeUndefined();
  });

  it('reads a form: the weekday as text, the box ticked or left out, and answers with a notice', async () => {
    const w = await world();
    as(w.owner);
    const form = (body: string) =>
      SCHEDULE_FORM(request(base(w.siteId), 'POST', body, FORM), ctx(w.siteId));
    const res = await form(
      '_method=PUT&cadence=weekly&isoWeekday=3&timeLocal=08%3A30&timezone=America%2FIndiana%2FIndianapolis&sendWhenUnchanged=on',
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/agency/reports?notice=schedule_saved');
    expect(await schedule(w.siteId)).toMatchObject({
      iso_weekday: 3,
      time_local: '08:30',
      timezone: 'America/Indiana/Indianapolis',
      send_when_unchanged: true,
    });
    await form('_method=PUT&cadence=weekly&isoWeekday=3&timeLocal=08%3A30&timezone=UTC');
    expect((await schedule(w.siteId))!.send_when_unchanged).toBe(false);

    const gone = await form('_method=DELETE');
    expect(gone.headers.get('location')).toBe('/agency/reports?notice=schedule_cleared');
    expect(await schedule(w.siteId)).toBeUndefined();
  });

  it('DELETE removes the schedule, and answers 404 when there is none', async () => {
    const w = await world();
    as(w.owner);
    await put(w.siteId);
    const res = await del(w.siteId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: true });
    expect(await schedule(w.siteId)).toBeUndefined();
    expect((await del(w.siteId)).status).toBe(404);
  });
});

describe('PATCH …/client', () => {
  it('saves the name, the contact and the owning seat, and asks the new contact to confirm with an event that holds no address', async () => {
    const w = await world();
    as(w.owner);
    await put(w.siteId);
    const res = await patch(w.siteId, {
      clientName: ' Harborlight Dental ',
      contactEmail: ' Hello@Harborlight.Example ',
      ownerSeatId: w.owner.seatId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contactChanged: true, confirmation: 'asked' });
    expect(await siteRow(w.siteId)).toEqual({
      client_name: 'Harborlight Dental',
      client_contact_name: null,
      client_contact_email: 'hello@harborlight.example',
      owner_seat_id: w.owner.seatId,
    });
    expect(h.send).toHaveBeenCalledTimes(1);
    const event = h.send.mock.calls[0]![0] as { id: string; name: string; data: unknown };
    expect(event).toMatchObject({
      name: 'report.confirmation.requested',
      data: { site_id: w.siteId },
    });
    expect(event.id.startsWith(`report_confirm:${w.siteId}:`)).toBe(true);
    // The handler's ledger key holds request_id: the event's id and the mail's key name one ask.
    expect(event.id).toBe(
      `report_confirm:${w.siteId}:${(event.data as { request_id: string }).request_id}`,
    );
    expect(JSON.stringify(event)).not.toContain('harborlight');
    expect(h.limits).toEqual([confirmBound(w.accountId)]);
  });

  it('asks for no confirmation when the contact did not change, or was taken away', async () => {
    const w = await world();
    as(w.owner);
    await scheduled(w, 'same@client.example');
    await patch(w.siteId, { clientName: 'Renamed', contactEmail: 'SAME@client.example' });
    await patch(w.siteId, { contactEmail: null });
    expect(h.send).not.toHaveBeenCalled();
    expect((await siteRow(w.siteId)).client_contact_email).toBeNull();
  });

  it('past the account’s daily bound the save stands and no confirmation is asked for', async () => {
    const w = await world();
    as(w.owner);
    h.over.add('report-confirm');
    expect((await patch(w.siteId, { contactEmail: 'new@client.example' })).status).toBe(200);
    expect((await siteRow(w.siteId)).client_contact_email).toBe('new@client.example');
    expect(h.send).not.toHaveBeenCalled();
  });

  it('a changed contact loses its confirmation', async () => {
    const w = await confirmedWorld();
    as(w.owner);
    expect((await schedule(w.siteId))!.recipient_confirmed_at).not.toBeNull();
    await patch(w.siteId, { contactEmail: 'other@client.example' });
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
  });

  it('answers 400 for a contact name, an address that is not one, a stray key, an empty body, and a seat that cannot own the client', async () => {
    const w = await world();
    as(w.owner);
    for (const bad of [
      { clientContactName: 'Dana Okafor' },
      { client_contact_name: 'Dana Okafor' },
      { contactEmail: 'not an address' },
      { clientName: 'X', accountId: randomUUID() },
      {},
    ]) {
      const res = await patch(w.siteId, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ code: 'invalid' });
    }
    const res = await patch(w.siteId, { ownerSeatId: w.stranger.seatId });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_owner' });
    expect(await siteRow(w.siteId)).toEqual({
      client_name: null,
      client_contact_name: null,
      client_contact_email: null,
      owner_seat_id: null,
    });
  });

  it('reads a form: an empty field clears, and the answer is a notice', async () => {
    const w = await world();
    as(w.owner);
    await patch(w.siteId, { clientName: 'Old name' });
    const res = await CLIENT_FORM(
      request(
        `${base(w.siteId)}/client`,
        'POST',
        '_method=PATCH&clientName=&contactEmail=c%40client.example',
        FORM,
      ),
      ctx(w.siteId),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/agency/reports?notice=client_saved');
    expect(await siteRow(w.siteId)).toMatchObject({
      client_name: null,
      client_contact_email: 'c@client.example',
    });
  });
});

describe('POST …/confirm', () => {
  it('asks for the confirmation again while the contact has not confirmed', async () => {
    const w = await world();
    as(w.owner);
    await scheduled(w);
    const res = await resend(w.siteId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: true });
    expect(h.send.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual([
      'report.confirmation.requested',
    ]);
    // Within the account's bound on confirmation mail, which fails closed.
    expect(h.limits).toEqual([confirmBound(w.accountId)]);
  });

  it('answers 409 nothing_to_confirm with no schedule, no contact, and a contact that has confirmed', async () => {
    const [bare, noContact, done] = [await world(), await world(), await confirmedWorld()];
    as(noContact.owner);
    await put(noContact.siteId);
    for (const w of [bare, noContact, done]) {
      as(w.owner);
      const res = await resend(w.siteId);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ code: 'nothing_to_confirm' });
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it('answers 429 past the account’s daily bound, and asks for nothing', async () => {
    const w = await world();
    as(w.owner);
    await scheduled(w);
    h.over.add('report-confirm');
    const res = await resend(w.siteId);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(h.send).not.toHaveBeenCalled();
    // The refused press is counted once: the bound is asked once, and its answer gives the time.
    expect(h.limits).toEqual([confirmBound(w.accountId)]);
  });
});

describe('the recipient’s confirmation link', () => {
  const land = (t: string) =>
    LAND_CONFIRM(request(`/s/confirm/${t}`, 'GET'), { params: Promise.resolve({ token: t }) });
  const use = (cookie?: string, body = '{}', type = 'application/json') =>
    USE_CONFIRM(request('/api/report-files/confirm', 'POST', body, type, cookie));

  it('the link moves its token into a cookie and changes nothing', async () => {
    const w = await world();
    await scheduled(w);
    const t = await token('issue_recipient_confirmation', w.siteId);
    as(null);
    const res = await land(t);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/s/confirm`);
    expect(res.headers.get('set-cookie')).toContain(`cm_link_report_confirm=${t};`);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
    expect(h.log).toEqual([]);
  });

  it('the page’s POST confirms with the cookie’s token, once, signed out', async () => {
    const w = await world();
    await scheduled(w);
    const t = await token('issue_recipient_confirmation', w.siteId);
    as(null);
    const res = await use(`cm_link_report_confirm=${t}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: true });
    expect(res.headers.get('set-cookie')).toContain('cm_link_report_confirm=;');
    expect((await schedule(w.siteId))!.recipient_confirmed_at).not.toBeNull();
    const again = await use(`cm_link_report_confirm=${t}`);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ code: 'report_link_gone' });
  });

  it('a form is sent back to its page with the line', async () => {
    const w = await world();
    await scheduled(w);
    const t = await token('issue_recipient_confirmation', w.siteId);
    const res = await use(`cm_link_report_confirm=${t}`, '', FORM);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/s/confirm?notice=report_confirmed');
    const gone = await use(`cm_link_report_confirm=${t}`, '', FORM);
    expect(gone.headers.get('location')).toBe('/s/confirm?notice=report_link_gone');
  });

  it('reads the token from the cookie alone: none there is 410, one in the body is 400, and nothing is confirmed', async () => {
    const w = await world();
    await scheduled(w);
    const t = await token('issue_recipient_confirmation', w.siteId);
    expect((await use()).status).toBe(410);
    expect((await use(undefined, JSON.stringify({ token: t }))).status).toBe(400);
    expect((await use(`cm_link_report_pause=${t}`)).status).toBe(410);
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
  });

  it('answers 404 with the flag off, and 429 past the address’s bound', async () => {
    const w = await world();
    await scheduled(w);
    const t = await token('issue_recipient_confirmation', w.siteId);
    h.over.add('report-confirm-use');
    expect((await use(`cm_link_report_confirm=${t}`)).status).toBe(429);
    h.over.clear();
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await use(`cm_link_report_confirm=${t}`)).status).toBe(404);
    expect((await land(t)).status).toBe(404);
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
  });
});

describe('the recipient’s pause link, and POST …/resume', () => {
  const land = (t: string) =>
    LAND_PAUSE(request(`/s/pause/${t}`, 'GET'), { params: Promise.resolve({ token: t }) });
  const use = (cookie?: string) =>
    USE_PAUSE(request('/api/report-files/pause', 'POST', '{}', 'application/json', cookie));
  const oneClick = (t: string, body = 'List-Unsubscribe=One-Click', type = FORM) =>
    ONE_CLICK(
      new Request(`${ORIGIN}/s/pause/${t}`, {
        method: 'POST',
        headers: { 'content-type': type, 'x-forwarded-for': '198.51.100.7' },
        body,
      }),
      { params: Promise.resolve({ token: t }) },
    );
  const paused = async (w: World) => (await schedule(w.siteId))!.paused_by_recipient_at;

  it('with the flag off the pause link changes nothing: its GET, a mail client’s one-click POST and the page’s POST are each a 404', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await land(t)).status).toBe(404);
    expect((await oneClick(t)).status).toBe(404);
    expect((await use(`cm_link_report_pause=${t}`)).status).toBe(404);
    expect(await paused(w)).toBeNull();
    // With it on, the same one-click POST pauses.
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect((await oneClick(t)).status).toBeLessThan(400);
    expect(await paused(w)).not.toBeNull();
  });

  it('a GET of the link pauses nothing: it moves the token into a cookie', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    as(null);
    const res = await land(t);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/s/pause`);
    expect(res.headers.get('set-cookie')).toContain(`cm_link_report_pause=${t};`);
    expect(await paused(w)).toBeNull();
    expect(h.log).toEqual([]);
  });

  it('the page’s POST pauses with the cookie’s token; the owner’s resume asks the recipient to confirm again', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    as(null);
    const res = await use(`cm_link_report_pause=${t}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paused: true });
    expect(await paused(w)).not.toBeNull();

    // The sender's "resume" restarts nothing: it lifts the pause and asks the recipient to confirm
    // again (owner ruling), with the confirmation's own event and bound.
    as(w.owner);
    h.send.mockClear();
    h.limits.length = 0;
    const back = await resume(w.siteId);
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({ confirmation: 'asked' });
    expect(await paused(w)).toBeNull();
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
    expect(h.send.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual([
      'report.confirmation.requested',
    ]);
    expect(h.limits).toEqual([confirmBound(w.accountId)]);
    const again = await resume(w.siteId);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: 'not_paused' });
  });

  it('past the day’s bound a resume still lifts the pause and restarts no mail: the contact is asked at the next run', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    as(null);
    await use(`cm_link_report_pause=${t}`);
    expect(await paused(w)).not.toBeNull();
    as(w.owner);
    h.over.add('report-confirm');
    h.send.mockClear();
    const back = await resume(w.siteId);
    expect([back.status, ((await back.json()) as { confirmation: string }).confirmation]).toEqual([
      200,
      'later',
    ]);
    expect(h.send).not.toHaveBeenCalled();
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
  });

  it('a mail client’s one-click POST pauses with the token in the path and no cookie', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    as(null);
    const res = await oneClick(t);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await paused(w)).not.toBeNull();
  });

  it('the one-click POST pauses with a multipart body too, which RFC 8058 allows and some mail clients send', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    const form = new FormData();
    form.set('List-Unsubscribe', 'One-Click');
    const res = await ONE_CLICK(
      new Request(`${ORIGIN}/s/pause/${t}`, {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.7' },
        body: form,
      }),
      { params: Promise.resolve({ token: t }) },
    );
    expect(res.status).toBe(200);
    expect(await paused(w)).not.toBeNull();
    // A multipart body that says something else, or says it twice, pauses nothing.
    const other = await confirmedWorld();
    const t2 = await token('issue_report_pause', other.siteId);
    for (const fields of [
      [['List-Unsubscribe', 'Yes']],
      [
        ['List-Unsubscribe', 'One-Click'],
        ['x', '1'],
      ],
    ]) {
      const bad = new FormData();
      for (const [name, value] of fields) bad.append(name!, value!);
      const refused = await ONE_CLICK(
        new Request(`${ORIGIN}/s/pause/${t2}`, { method: 'POST', body: bad }),
        { params: Promise.resolve({ token: t2 }) },
      );
      expect(refused.status, JSON.stringify(fields)).toBe(400);
    }
    expect(await paused(other)).toBeNull();
  });

  it('the one-click POST refuses any other body, an unknown token and a malformed one, and pauses nothing', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    for (const [body, type] of [
      ['', FORM],
      ['List-Unsubscribe=Yes', FORM],
      ['List-Unsubscribe=One-Click&x=1', FORM],
      ['{"List-Unsubscribe":"One-Click"}', 'application/json'],
    ] as const) {
      expect((await oneClick(t, body, type)).status, body).toBe(400);
    }
    expect((await oneClick('A'.repeat(43))).status).toBe(404);
    h.limits.length = 0;
    h.log.length = 0;
    expect((await oneClick('short')).status).toBe(404);
    expect(h.limits).toEqual([]);
    expect(h.log).toEqual([]);
    expect(await paused(w)).toBeNull();
  });

  it('a confirmation link’s token pauses nothing', async () => {
    const w = await world();
    await scheduled(w);
    const t = await token('issue_recipient_confirmation', w.siteId);
    expect((await use(`cm_link_report_pause=${t}`)).status).toBe(410);
    expect((await oneClick(t)).status).toBe(404);
    expect(await paused(w)).toBeNull();
  });
});

describe('what a recipient refused, at the account’s routes (owner ruling on Q42)', () => {
  const events = () => h.send.mock.calls.map((c) => (c[0] as { name: string }).name);
  const pauseWith = (t: string) =>
    h.db.query(`select public.pause_report_schedule($1, now())`, [sha256(t)]);
  /** The mailer's issue for one request, as SQL does it: the link's token. */
  const issue = async (siteId: string, request: string) =>
    (
      await h.db.query<{ r: { outcome: string; token?: string } }>(
        `select public.issue_recipient_confirmation($1, now(), $2) r`,
        [siteId, request],
      )
    ).rows[0]!.r;
  const resumeForm = (siteId: string) =>
    RESUME(request(`${base(siteId)}/resume`, 'POST', '', FORM), ctx(siteId));

  it('resume asks once: after the request, a second resume is 409 asked_recently with when it may ask, lifts nothing and asks nothing', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    await pauseWith(t);
    as(w.owner);
    expect((await resume(w.siteId)).status).toBe(200);
    expect((await issue(w.siteId, 'resume-1')).outcome).toBe('issued');
    await pauseWith(t);
    h.send.mockClear();
    h.limits.length = 0;

    const again = await resume(w.siteId);
    const body = (await again.json()) as { code: string; nextAllowedAt: string };
    expect([again.status, body.code]).toEqual([409, 'asked_recently']);
    // Thirty days from the request, to the day.
    const days = (Date.parse(body.nextAllowedAt) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect((await schedule(w.siteId))!.paused_by_recipient_at).not.toBeNull();
    expect(events()).toEqual([]);
    expect(h.limits).toEqual([]);

    // A form is sent back with the line and the day.
    const form = await resumeForm(w.siteId);
    const to = new URL(form.headers.get('location')!, ORIGIN);
    expect([form.status, to.pathname, to.searchParams.get('notice')]).toEqual([
      303,
      '/agency/reports',
      'asked_recently',
    ]);
    expect(to.searchParams.get('next')).toBe(body.nextAllowedAt);
  });

  it('removing the schedule and saving it again, or changing the contact away and back, asks a recipient who paused nothing more', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    await pauseWith(t);
    as(w.owner);
    await resume(w.siteId);
    await issue(w.siteId, 'resume-1');
    h.send.mockClear();

    await del(w.siteId);
    const saved = await put(w.siteId);
    expect(((await saved.json()) as { confirmation: string }).confirmation).toBe('recent');
    const away = await patch(w.siteId, { contactEmail: 'other@client.example' });
    expect(((await away.json()) as { confirmation: string }).confirmation).toBe('asked');
    h.send.mockClear();
    const back = await patch(w.siteId, { contactEmail: 'client@client.example' });
    expect(((await back.json()) as { confirmation: string }).confirmation).toBe('recent');
    const again = await resend(w.siteId);
    expect([again.status, ((await again.json()) as { code: string }).code]).toEqual([
      409,
      'asked_recently',
    ]);
    expect(events()).toEqual([]);

    // The form's notice says the contact is not asked.
    const form = await SCHEDULE_FORM(
      request(
        base(w.siteId),
        'POST',
        '_method=PUT&cadence=weekly&isoWeekday=1&timeLocal=09%3A00&timezone=UTC',
        FORM,
      ),
      ctx(w.siteId),
    );
    expect(form.headers.get('location')).toBe('/agency/reports?notice=schedule_saved_not_asked');
  });

  it('a contact that answered “Don’t ask me again” is asked by nothing: resume, “ask again” and each save say so', async () => {
    const w = await world();
    await scheduled(w);
    const asked = await issue(w.siteId, 'first');
    await h.db.query(`select public.decline_report_requests($1, now())`, [sha256(asked.token!)]);
    as(w.owner);
    h.limits.length = 0;

    const again = await resend(w.siteId);
    expect([again.status, await again.json()]).toEqual([409, { code: 'contact_declined' }]);
    const saved = await put(w.siteId);
    expect(((await saved.json()) as { confirmation: string }).confirmation).toBe('declined');
    // The address in another case is the same address.
    await patch(w.siteId, { contactEmail: null });
    const back = await patch(w.siteId, { contactEmail: 'CLIENT@client.example' });
    expect(await back.json()).toEqual({ contactChanged: true, confirmation: 'declined' });
    expect(events()).toEqual([]);
    expect(h.limits).toEqual([]);
    const form = await CLIENT_FORM(
      request(`${base(w.siteId)}/client`, 'POST', '_method=PATCH&clientName=Renamed', FORM),
      ctx(w.siteId),
    );
    expect(form.headers.get('location')).toBe('/agency/reports?notice=client_saved');
  });

  it('a contact that declined from the pause page: the schedule is paused, and resume is 409 contact_declined', async () => {
    const w = await confirmedWorld();
    const t = await token('issue_report_pause', w.siteId);
    await h.db.query(`select public.decline_report_requests($1, now())`, [sha256(t)]);
    as(w.owner);
    const back = await resume(w.siteId);
    expect([back.status, await back.json()]).toEqual([409, { code: 'contact_declined' }]);
    expect((await resumeForm(w.siteId)).headers.get('location')).toBe(
      '/agency/reports?notice=contact_declined',
    );
    expect((await schedule(w.siteId))!.paused_by_recipient_at).not.toBeNull();
    expect(events()).toEqual([]);
  });
});

describe('“Don’t ask me again”: the link, the one-click POST and the pages’ form', () => {
  const land = (t: string) =>
    LAND_DECLINE(request(`/s/decline/${t}`, 'GET'), { params: Promise.resolve({ token: t }) });
  const oneClick = (t: string, body = 'List-Unsubscribe=One-Click', type = FORM) =>
    ONE_CLICK_DECLINE(request(`/s/decline/${t}`, 'POST', body, type), {
      params: Promise.resolve({ token: t }),
    });
  const use = (cookie?: string, body = '{}', type = 'application/json') =>
    USE_DECLINE(request('/api/report-files/decline', 'POST', body, type, cookie));
  const refusals = async (siteId: string) =>
    (
      await h.db.query<{ r: Record<string, string>[] }>(
        `select report_refusals r from public.sites where id = $1`,
        [siteId],
      )
    ).rows[0]!.r;
  const asked = async () => {
    const w = await world();
    await scheduled(w);
    return { w, t: await token('issue_recipient_confirmation', w.siteId) };
  };

  it('with the flag off each is a 404 and nothing is recorded', async () => {
    const { w, t } = await asked();
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    as(null);
    for (const res of [
      await land(t),
      await oneClick(t),
      await use(`cm_link_report_decline=${t}`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(await refusals(w.siteId)).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it('a GET of the link records nothing: it moves the token into the decline cookie', async () => {
    const { w, t } = await asked();
    as(null);
    const res = await land(t);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/s/decline`);
    expect(res.headers.get('set-cookie')).toContain(`cm_link_report_decline=${t}`);
    expect(await refusals(w.siteId)).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it('a mail client’s one-click POST records the refusal with the token in the path and no cookie; any other body records nothing', async () => {
    const { w, t } = await asked();
    as(null);
    for (const [body, type] of [
      ['List-Unsubscribe=Other', FORM],
      ['{}', 'application/json'],
    ] as const) {
      expect((await oneClick(t, body, type)).status).toBe(400);
    }
    expect((await oneClick('x'.repeat(43))).status).toBe(404);
    expect(await refusals(w.siteId)).toEqual([]);
    // A value that is not token-shaped is a 404 before the limiter and before any read.
    h.limits.length = 0;
    h.log.length = 0;
    expect((await oneClick('not-a-token')).status).toBe(404);
    expect([h.limits, h.log]).toEqual([[], []]);

    const res = await oneClick(t);
    expect([res.status, await res.text()]).toEqual([200, '']);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await refusals(w.siteId)).toEqual([
      { a: sha256('client@client.example'), declined_at: expect.any(String) },
    ]);
    // The confirmation link of the same mail no longer confirms.
    const confirmed = await USE_CONFIRM(
      request(
        '/api/report-files/confirm',
        'POST',
        '{}',
        'application/json',
        `cm_link_report_confirm=${t}`,
      ),
    );
    expect(confirmed.status).toBe(410);
    expect((await schedule(w.siteId))!.recipient_confirmed_at).toBeNull();
    // Thirty an hour for an address, on the one-click and on the page's press.
    const bound = (name: string) =>
      h.limits
        .filter((l) => l.key.startsWith(`${name}:ip:`))
        .map((l) => [l.limit, l.windowMs, l.failClosed]);
    expect(bound('report-decline-click')[0]).toEqual([30, 3_600_000, false]);
    h.limits.length = 0;
    await use(`cm_link_report_decline=${t}`);
    expect(bound('report-decline-use')).toEqual([[30, 3_600_000, false]]);
  });

  it('the page’s POST records it with the decline cookie’s token, clears the cookie, and a form goes to the page with the line', async () => {
    const { w, t } = await asked();
    as(null);
    const res = await use(`cm_link_report_decline=${t}`, '', FORM);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/s/decline?notice=report_declined');
    expect(res.headers.get('set-cookie')).toMatch(/^cm_link_report_decline=; .*Max-Age=0/);
    expect(await refusals(w.siteId)).toHaveLength(1);
    // Pressed again with the same token: the request it came with is withdrawn, so it is gone.
    const again = await use(`cm_link_report_decline=${t}`);
    expect([again.status, await again.json()]).toEqual([410, { code: 'report_link_gone' }]);
  });

  it('from the confirmation page and from the pause page, the form names its page and that page’s cookie is the one read', async () => {
    const first = await asked();
    as(null);
    // The token is in the confirmation cookie; with no `from`, the decline cookie is read: none.
    const cookie = `cm_link_report_confirm=${first.t}`;
    expect((await use(cookie)).status).toBe(410);
    expect(await refusals(first.w.siteId)).toEqual([]);
    const fromConfirm = await use(cookie, 'from=confirm', FORM);
    expect(fromConfirm.headers.get('location')).toBe('/s/decline?notice=report_declined');
    expect(fromConfirm.headers.get('set-cookie')).toMatch(/^cm_link_report_confirm=; /);
    expect(await refusals(first.w.siteId)).toHaveLength(1);

    const sending = await confirmedWorld();
    const pauseToken = await token('issue_report_pause', sending.siteId);
    const fromPause = await use(
      `cm_link_report_pause=${pauseToken}`,
      JSON.stringify({ from: 'pause' }),
    );
    expect([fromPause.status, await fromPause.json()]).toEqual([200, { declined: true }]);
    // Declined from the pause page: the reports stop as well.
    expect((await schedule(sending.siteId))!.paused_by_recipient_at).not.toBeNull();
    expect(await refusals(sending.siteId)).toEqual([
      { a: sha256('client@client.example'), declined_at: expect.any(String) },
    ]);
  });

  it('refuses a field it does not know, a `from` that is not a page, and a token in the body: 400, nothing recorded', async () => {
    const { w, t } = await asked();
    as(null);
    const cookie = `cm_link_report_decline=${t}`;
    for (const body of [
      JSON.stringify({ token: t }),
      JSON.stringify({ from: 'decline' }),
      JSON.stringify({ from: 'pause', site: w.siteId }),
    ]) {
      expect((await use(cookie, body)).status).toBe(400);
    }
    expect(await refusals(w.siteId)).toEqual([]);
  });

  it('answers 429 past the address’s bound, before any read', async () => {
    const { w, t } = await asked();
    as(null);
    h.over.add('report-decline-use');
    expect((await use(`cm_link_report_decline=${t}`)).status).toBe(429);
    h.over.add('report-decline-click');
    expect((await oneClick(t)).status).toBe(429);
    expect(await refusals(w.siteId)).toEqual([]);
    expect(h.log).toEqual([]);
  });
});
