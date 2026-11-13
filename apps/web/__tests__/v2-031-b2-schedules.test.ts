import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addSeat,
  keptSite,
  makePaid,
  person,
  removeSeat,
  type Person,
} from '../lib/v2/account/sites-test-support';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { insertRow, prepareMeasurement, ROWS } from './helpers/v2-check-tables';

/**
 * Migration 031's client report schedules (docs/specs/v2/31-agency.md §10): the confirmation and
 * pause columns of `report_schedules`, and the functions that write a client, a schedule, the two
 * recipient links and a client report, run as `service_role` on PGlite with every migration applied.
 * Each test builds its own account and site.
 */

const MIGRATION = '20261114000002_v2_031_agency.sql';
const ROLLBACK = '20261114000002_v2_031_agency.revert.sql';
/** Thursday 12 November 2026, 12:00 UTC. */
const NOW = '2026-11-12T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number, ms = 0) => new Date(Date.parse(NOW) + days * DAY_MS + ms).toISOString();
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

const FUNCTIONS = [
  'public.report_link_token()',
  'public.report_schedule_next(text, smallint, text, text, timestamptz)',
  'public.set_client(uuid, uuid, jsonb)',
  'public.set_report_schedule(uuid, uuid, jsonb, timestamptz)',
  'public.clear_report_schedule(uuid, uuid)',
  'public.issue_recipient_confirmation(uuid, timestamptz, text)',
  'public.read_report_link(text, timestamptz)',
  'public.confirm_report_recipient(text, timestamptz)',
  'public.issue_report_pause(uuid, text, text, timestamptz)',
  'public.pause_report_schedule(text, timestamptz)',
  'public.resume_report_schedule(uuid, uuid, timestamptz)',
  'public.due_report_schedules(timestamptz, integer)',
  'public.mark_report_schedule_run(uuid, timestamptz)',
  'public.write_client_report(uuid, timestamptz, uuid, timestamptz)',
  'public.mark_client_report_sent(uuid, timestamptz)',
  'public.report_refusal_key(text)',
  'public.report_reask_window()',
  'public.report_refusal(uuid, text)',
  'public.note_report_refusal(uuid, text, jsonb)',
  'public.report_ask_refusals(uuid[], timestamptz)',
  'public.decline_report_requests(text, timestamptz)',
] as const;

const HIDDEN = [
  'recipient_confirm_hash',
  'recipient_confirm_sent_at',
  'recipient_confirmed_at',
  'pause_token_hash',
] as const;

type Answer = { outcome: string } & Record<string, unknown>;

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
}, 120_000);
afterAll(async () => db.close());

/** One statement as the service role, the only role the functions are granted to. */
const service = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  asRole(db, 'service_role', null, async (tx) => (await tx.query<T>(sql, params)).rows);

const answer = async (sql: string, params: unknown[]): Promise<Answer> =>
  (await service<{ r: Answer }>(sql, params))[0]!.r;

const iso = (v: unknown) => new Date(v as string).toISOString();

const WEEKLY = {
  cadence: 'weekly',
  iso_weekday: 1,
  time_local: '09:00',
  timezone: 'UTC',
  send_when_unchanged: false,
};

const setClient = (siteId: string, accountId: string, p: unknown) =>
  answer(`select public.set_client($1, $2, $3::jsonb) r`, [siteId, accountId, JSON.stringify(p)]);
const setSchedule = (siteId: string, accountId: string, p: unknown = WEEKLY, now = NOW) =>
  answer(`select public.set_report_schedule($1, $2, $3::jsonb, $4) r`, [
    siteId,
    accountId,
    JSON.stringify(p),
    now,
  ]);
const clear = (siteId: string, accountId: string) =>
  answer(`select public.clear_report_schedule($1, $2) r`, [siteId, accountId]);
const issueConfirmation = (siteId: string, now = NOW, request: string | null = null) =>
  answer(`select public.issue_recipient_confirmation($1, $2, $3) r`, [siteId, now, request]);
const decline = (token: string, now = NOW) =>
  answer(`select public.decline_report_requests($1, $2) r`, [sha256(token), now]);
/** What the site holds of its recipients' refusals, as stored. */
const refusals = async (siteId: string) =>
  (
    await db.query<{ r: Record<string, string>[] }>(
      `select report_refusals r from public.sites where id = $1`,
      [siteId],
    )
  ).rows[0]!.r;
/** Why the site's contact may not be asked at `now`, or undefined when it may. */
const askRefusal = async (siteId: string, now = NOW) =>
  (
    await service<{ r: Record<string, Record<string, string>> }>(
      `select public.report_ask_refusals(array[$1::uuid], $2) r`,
      [siteId, now],
    )
  )[0]!.r[siteId];
const readLink = (token: string, now = NOW) =>
  answer(`select public.read_report_link($1, $2) r`, [sha256(token), now]);
const confirm = (token: string, now = NOW) =>
  answer(`select public.confirm_report_recipient($1, $2) r`, [sha256(token), now]);
/** The site's contact address as it is now: the address the mailer names when it issues a pause link. */
const contactOf = async (siteId: string) =>
  (
    await db.query<{ e: string | null }>(
      `select client_contact_email e from public.sites where id = $1`,
      [siteId],
    )
  ).rows[0]!.e;
/** A pause link's token as the mailer makes one: 43 base64url characters (report-pause-token.ts). */
const pauseToken = () => randomBytes(32).toString('base64url');
/** The mailer's call: SQL is given the token's sha256. The answer here carries the token as well. */
const issuePause = async (siteId: string, now = NOW, token = pauseToken()) => {
  const a = await answer(`select public.issue_report_pause($1, $4, $2, $3) r`, [
    siteId,
    sha256(token),
    now,
    await contactOf(siteId),
  ]);
  return a.outcome === 'issued' ? { ...a, token } : a;
};
const pause = (token: string, now = NOW) =>
  answer(`select public.pause_report_schedule($1, $2) r`, [sha256(token), now]);
const resume = (siteId: string, accountId: string, now = NOW) =>
  answer(`select public.resume_report_schedule($1, $2, $3) r`, [siteId, accountId, now]);
const due = async (now = NOW, limit = 100) =>
  (
    await service<{ r: Record<string, unknown>[] }>(
      `select public.due_report_schedules($1, $2) r`,
      [now, limit],
    )
  )[0]!.r;
const markRun = async (siteId: string, now = NOW) =>
  (
    await service<{ t: string | null }>(`select public.mark_report_schedule_run($1, $2) t`, [
      siteId,
      now,
    ])
  )[0]!.t;
const writeReport = (siteId: string, slot: string, checkId: string, now = NOW) =>
  answer(`select public.write_client_report($1, $2, $3, $4) r`, [siteId, slot, checkId, now]);
const markSent = (reportId: unknown, now = NOW) =>
  answer(`select public.mark_client_report_sent($1, $2) r`, [reportId, now]);
/** Gives a report an id that sorts after any random one, and returns it. */
const greatestId = async (reportId: string) => {
  const id = `ffffffff-ffff-4fff-bfff-${randomBytes(6).toString('hex')}`;
  await db.query(`update public.reports set id = $2 where id = $1`, [reportId, id]);
  return id;
};
const next = async (cadence: string, weekday: number, time: string, zone: string, after: string) =>
  iso(
    (
      await service<{ t: string }>(`select public.report_schedule_next($1, $2, $3, $4, $5) t`, [
        cadence,
        weekday,
        time,
        zone,
        after,
      ])
    )[0]!.t,
  );

interface ScheduleRow {
  cadence: string;
  iso_weekday: number;
  time_local: string;
  timezone: string;
  send_when_unchanged: boolean;
  page_slug: string;
  paused_by_recipient_at: Date | null;
  next_run_at: Date | null;
  last_run_at: Date | null;
  recipient_confirm_hash: string | null;
  recipient_confirm_sent_at: Date | null;
  recipient_confirmed_at: Date | null;
  pause_token_hash: string | null;
}
const schedule = async (siteId: string) =>
  (
    await db.query<ScheduleRow>(`select * from public.report_schedules where site_id = $1`, [
      siteId,
    ])
  ).rows[0];

interface SiteRow {
  client_name: string | null;
  client_contact_name: string | null;
  client_contact_email: string | null;
  owner_seat_id: string | null;
}
const siteRow = async (siteId: string) =>
  (
    await db.query<SiteRow>(
      `select client_name, client_contact_name, client_contact_email, owner_seat_id from public.sites where id = $1`,
      [siteId],
    )
  ).rows[0]!;

interface Client {
  owner: Person;
  accountId: string;
  siteId: string;
  host: string;
}

/** An Agency account with one client site. */
async function client(): Promise<Client> {
  const owner = await person(db, 'owner');
  await makePaid(db, owner.accountId, 'agency');
  const site = await keptSite(db, owner.accountId);
  return { owner, accountId: owner.accountId, siteId: site.id, host: site.host };
}

/** A client with a contact, a weekly schedule, and the contact confirmed. */
async function confirmed(contact = 'client@client.example'): Promise<Client> {
  const c = await client();
  await setClient(c.siteId, c.accountId, { client_contact_email: contact });
  await setSchedule(c.siteId, c.accountId);
  const issued = await issueConfirmation(c.siteId);
  expect((await confirm(issued.token as string)).outcome).toBe('confirmed');
  return c;
}

/** A finished check of the site, at `finishedAt`. */
async function check(siteId: string, finishedAt = '2026-11-10T06:20:00.000Z'): Promise<string> {
  const id = randomUUID();
  await insertRow(db, 'checks', { ...ROWS.checks(id, siteId), finished_at: finishedAt });
  return id;
}

/** A check of the site that has not started. */
const queuedCheck = (id: string, siteId: string) =>
  insertRow(db, 'checks', {
    ...ROWS.checks(id, siteId),
    status: 'queued',
    started_at: null,
    finished_at: null,
    tested_at: null,
    coverage: null,
    technical_seo: null,
    ai_readability: null,
    lineage_id: null,
  });

const mark = (accountId: string) =>
  db.query(
    `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
    [accountId],
  );

describe('the schedule’s confirmation and pause columns', () => {
  it('are read by no client role', async () => {
    const c = await confirmed();
    const denied: string[] = [];
    for (const column of HIDDEN) {
      for (const role of ['anon', 'authenticated'] as const) {
        await asRole(db, role, role === 'anon' ? null : c.owner.id, (tx) =>
          tx.query(`select ${column} from public.report_schedules`),
        ).catch((e: { code?: string }) => {
          if (e.code === '42501') denied.push(`${role}:${column}`);
        });
      }
    }
    expect(denied).toEqual(HIDDEN.flatMap((col) => [`anon:${col}`, `authenticated:${col}`]));
    // The owner reads a granted column of their schedule, so the refusals are the columns'.
    const own = await asRole(db, 'authenticated', c.owner.id, (tx) =>
      tx.query<{ site_id: string }>(`select site_id from public.report_schedules`),
    );
    expect(own.rows.map((r) => r.site_id)).toEqual([c.siteId]);
  });

  it('hold a hash only as 64 lowercase hex characters, the confirmation’s with the time it was issued', async () => {
    const c = await confirmed();
    const set = (assignments: string) =>
      db
        .query(`update public.report_schedules set ${assignments} where site_id = $1`, [c.siteId])
        .then(() => 'ok')
        .catch((e: { constraint?: string }) => e.constraint ?? 'error');
    const hash = `'${'b'.repeat(64)}'`;
    expect(await set(`pause_token_hash = 'not-a-hash'`)).toBe('report_schedules_link_hashes');
    expect(await set(`pause_token_hash = 'B${'b'.repeat(63)}'`)).toBe(
      'report_schedules_link_hashes',
    );
    expect(await set(`recipient_confirm_hash = ${hash}, recipient_confirm_sent_at = null`)).toBe(
      'report_schedules_link_hashes',
    );
    expect(
      await set(`recipient_confirm_hash = 'kJ8sT2mQ9x', recipient_confirm_sent_at = now()`),
    ).toBe('report_schedules_link_hashes');
    expect(await set(`pause_token_hash = ${hash}`)).toBe('ok');
  });
});

describe('report_schedule_next', () => {
  it('weekly: the next such weekday at that time, later than the moment given', async () => {
    // NOW is a Thursday (ISO weekday 4), 12:00 UTC.
    expect(await next('weekly', 1, '09:00', 'UTC', NOW)).toBe('2026-11-16T09:00:00.000Z');
    expect(await next('weekly', 4, '13:00', 'UTC', NOW)).toBe('2026-11-12T13:00:00.000Z');
    expect(await next('weekly', 4, '12:00', 'UTC', NOW)).toBe('2026-11-19T12:00:00.000Z');
    expect(await next('weekly', 4, '09:00', 'UTC', NOW)).toBe('2026-11-19T09:00:00.000Z');
    expect(await next('weekly', 7, '00:00', 'UTC', NOW)).toBe('2026-11-15T00:00:00.000Z');
  });

  it('reads the weekday and the time in the schedule’s zone', async () => {
    // 09:00 in Indianapolis is 14:00 UTC in November (EST).
    expect(await next('weekly', 4, '09:00', 'America/Indiana/Indianapolis', NOW)).toBe(
      '2026-11-12T14:00:00.000Z',
    );
    // Thursday 23:30 in Auckland (UTC+13) is Thursday 10:30 UTC: already past at 12:00 UTC, when
    // it is Friday there, so the next is a week on.
    expect(await next('weekly', 4, '23:30', 'Pacific/Auckland', NOW)).toBe(
      '2026-11-19T10:30:00.000Z',
    );
  });

  it('reads the day in the schedule’s zone where it is not the UTC day: a zone behind UTC, late in its evening', async () => {
    // 02:00 UTC on Thursday 12 November is 21:00 on Wednesday the 11th in Indianapolis: Wednesday
    // 23:00 there is still to come, at 04:00 UTC the same UTC day. Read in UTC it would be a week on.
    expect(
      await next('weekly', 3, '23:00', 'America/Indiana/Indianapolis', '2026-11-12T02:00:00Z'),
    ).toBe('2026-11-12T04:00:00.000Z');
    // 02:00 UTC on Monday 2 November is 21:00 on Sunday the 1st there, the month's first Sunday.
    expect(
      await next('monthly', 7, '23:00', 'America/Indiana/Indianapolis', '2026-11-02T02:00:00Z'),
    ).toBe('2026-11-02T04:00:00.000Z');
  });

  it('property: the next run is after the moment given, on the weekday and at the time asked as the zone reads them, within a week for weekly and in the month’s first seven days for monthly', async () => {
    // An independent reading of the answer: Intl, in the schedule's zone. Hours before 04:00 are
    // left out: a clock time in a zone's spring-forward gap does not exist on that day.
    const ZONES = [
      'UTC',
      'America/Indiana/Indianapolis',
      'America/Los_Angeles',
      'Europe/London',
      'Asia/Kolkata',
      'Pacific/Auckland',
      'Pacific/Kiritimati',
    ];
    const read = (iso: string, zone: string) => {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          weekday: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        })
          .formatToParts(new Date(iso))
          .map((x) => [x.type, x.value]),
      );
      return {
        weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday!) + 1,
        day: Number(parts.day),
        time: `${parts.hour}:${parts.minute}`,
      };
    };
    const HOUR = 60 * 60 * 1000;
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('weekly', 'monthly'),
        fc.integer({ min: 1, max: 7 }),
        fc.integer({ min: 4, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.constantFrom(...ZONES),
        fc.integer({
          min: Date.parse('2026-01-01T00:00:00Z'),
          max: Date.parse('2028-12-31T00:00:00Z'),
        }),
        async (cadence, weekday, hour, minute, zone, afterMs) => {
          const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const after = new Date(afterMs).toISOString();
          const run = await next(cadence, weekday, time, zone, after);
          const at = read(run, zone);
          expect(
            Date.parse(run),
            `${cadence} ${weekday} ${time} ${zone} after ${after}`,
          ).toBeGreaterThan(afterMs);
          expect([at.weekday, at.time]).toEqual([weekday, time]);
          if (cadence === 'weekly') {
            // A week, and the hour a clock change can add.
            expect(Date.parse(run) - afterMs).toBeLessThanOrEqual(7 * 24 * HOUR + HOUR);
          } else {
            expect(at.day).toBeLessThanOrEqual(7);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('monthly: the first such weekday of a month', async () => {
    // The first Monday of November 2026 is the 2nd, of December the 7th; the first Sunday of
    // November is the 1st.
    expect(await next('monthly', 1, '09:00', 'UTC', NOW)).toBe('2026-12-07T09:00:00.000Z');
    expect(await next('monthly', 1, '09:00', 'UTC', '2026-11-01T00:00:00Z')).toBe(
      '2026-11-02T09:00:00.000Z',
    );
    expect(await next('monthly', 1, '09:00', 'UTC', '2026-11-02T09:00:00Z')).toBe(
      '2026-12-07T09:00:00.000Z',
    );
    expect(await next('monthly', 7, '09:00', 'UTC', '2026-10-31T23:00:00Z')).toBe(
      '2026-11-01T09:00:00.000Z',
    );
  });

  it('raises for a zone PostgreSQL does not know and for a cadence that is neither', async () => {
    await expect(next('weekly', 1, '09:00', 'Mars/Olympus', NOW)).rejects.toMatchObject({
      code: '22023',
    });
    await expect(next('on_deploy', 1, '09:00', 'UTC', NOW)).rejects.toMatchObject({
      code: '22023',
    });
  });
});

describe('set_client', () => {
  it('writes the name, the contact address in lower case and the owning seat, and a key it is not given is left', async () => {
    const c = await client();
    const manager = await person(db, 'manager');
    const seat = await addSeat(db, c.accountId, manager, 'account_manager');
    expect(
      await setClient(c.siteId, c.accountId, {
        client_name: '  Harborlight Dental ',
        client_contact_email: ' Hello@Harborlight.Example ',
        owner_seat_id: seat,
      }),
    ).toEqual({ outcome: 'saved', contact_changed: true });
    expect(await siteRow(c.siteId)).toEqual({
      client_name: 'Harborlight Dental',
      client_contact_name: null,
      client_contact_email: 'hello@harborlight.example',
      owner_seat_id: seat,
    });
    expect(await setClient(c.siteId, c.accountId, { client_name: 'Harborlight' })).toEqual({
      outcome: 'saved',
      contact_changed: false,
    });
    expect(await siteRow(c.siteId)).toMatchObject({
      client_name: 'Harborlight',
      client_contact_email: 'hello@harborlight.example',
      owner_seat_id: seat,
    });
    expect(
      await setClient(c.siteId, c.accountId, { client_name: null, owner_seat_id: null }),
    ).toMatchObject({ outcome: 'saved' });
    expect(await siteRow(c.siteId)).toMatchObject({ client_name: null, owner_seat_id: null });
  });

  it('never writes client_contact_name: the key raises 22023, as any key it does not set, and the column stays null', async () => {
    const c = await client();
    for (const p of [
      { client_contact_name: 'Dana Okafor' },
      { client_name: 'X', client_contact_name: 'Dana Okafor' },
      { host: 'evil.example' },
      { account_id: randomUUID() },
      ['client_name'],
      'client_name',
      null,
    ]) {
      await expect(setClient(c.siteId, c.accountId, p), JSON.stringify(p)).rejects.toMatchObject({
        code: '22023',
      });
    }
    await setClient(c.siteId, c.accountId, {
      client_name: 'Kept',
      client_contact_email: 'a@b.example',
    });
    expect(await siteRow(c.siteId)).toMatchObject({
      client_name: 'Kept',
      client_contact_name: null,
    });
  });

  it('raises 22023 for a value that is not an address, and writes nothing', async () => {
    const c = await client();
    for (const bad of ['not an address', 'a@', '@b', 'a@b c', 'a@@b']) {
      await expect(
        setClient(c.siteId, c.accountId, { client_name: 'N', client_contact_email: bad }),
      ).rejects.toMatchObject({ code: '22023' });
    }
    expect(await siteRow(c.siteId)).toMatchObject({
      client_name: null,
      client_contact_email: null,
    });
  });

  it('takes an owning seat only when it is an active seat of the account that covers the site', async () => {
    const c = await client();
    const other = await keptSite(db, c.accountId);
    const [covering, elsewhere, removed, invited, stranger] = [
      await person(db, 'covering'),
      await person(db, 'elsewhere'),
      await person(db, 'removed'),
      randomUUID(),
      await client(),
    ];
    const coveringSeat = await addSeat(db, c.accountId, covering, 'developer', [c.siteId]);
    const elsewhereSeat = await addSeat(db, c.accountId, elsewhere, 'developer', [other.id]);
    const removedSeat = await addSeat(db, c.accountId, removed, 'account_manager');
    await removeSeat(db, removedSeat);
    await db.query(
      `insert into public.seats (id, account_id, invited_email, role, status) values ($1, $2, 'i@example.com', 'developer', 'invited')`,
      [invited, c.accountId],
    );
    const outcomes: Record<string, string> = {};
    for (const [name, seat] of [
      ['another client’s seat', elsewhereSeat],
      ['a removed seat', removedSeat],
      ['an invited seat', invited],
      ['another account’s seat', stranger.owner.seatId],
      ['no such seat', randomUUID()],
      ['a seat scoped to the site', coveringSeat],
      ['the owner’s seat', c.owner.seatId],
    ] as const) {
      outcomes[name] = (await setClient(c.siteId, c.accountId, { owner_seat_id: seat })).outcome;
    }
    expect(outcomes).toEqual({
      'another client’s seat': 'invalid_owner',
      'a removed seat': 'invalid_owner',
      'an invited seat': 'invalid_owner',
      'another account’s seat': 'invalid_owner',
      'no such seat': 'invalid_owner',
      'a seat scoped to the site': 'saved',
      'the owner’s seat': 'saved',
    });
    expect((await siteRow(c.siteId)).owner_seat_id).toBe(c.owner.seatId);
  });

  it('a changed contact clears the confirmation, both links’ hashes and the recipient’s pause; the same address in another case does not', async () => {
    const c = await confirmed('first@client.example');
    const link = await issuePause(c.siteId);
    // A link that waits, then the pause: written to the row, since a pause withdraws a waiting
    // link and a paused schedule is issued none.
    const pending = await issueConfirmationAgain(c);
    await db.query(
      `update public.report_schedules set paused_by_recipient_at = $2 where site_id = $1`,
      [c.siteId, NOW],
    );
    expect(await schedule(c.siteId)).toMatchObject({
      recipient_confirm_hash: sha256(pending),
      pause_token_hash: sha256(link.token as string),
    });
    expect((await schedule(c.siteId))!.paused_by_recipient_at).not.toBeNull();

    expect(
      await setClient(c.siteId, c.accountId, { client_contact_email: 'FIRST@client.example' }),
    ).toEqual({ outcome: 'saved', contact_changed: false });
    // An address stored with a capital by another writer, and a call that names no contact: no
    // change is answered, as none is made.
    await db.query(
      `update public.sites set client_contact_email = 'First@client.example' where id = $1`,
      [c.siteId],
    );
    expect(await setClient(c.siteId, c.accountId, { client_name: 'Renamed' })).toEqual({
      outcome: 'saved',
      contact_changed: false,
    });
    expect((await schedule(c.siteId))!.pause_token_hash).not.toBeNull();

    expect(
      await setClient(c.siteId, c.accountId, { client_contact_email: 'second@client.example' }),
    ).toEqual({ outcome: 'saved', contact_changed: true });
    expect(await schedule(c.siteId)).toMatchObject({
      recipient_confirm_hash: null,
      recipient_confirm_sent_at: null,
      recipient_confirmed_at: null,
      pause_token_hash: null,
      paused_by_recipient_at: null,
      cadence: 'weekly',
    });
    expect(await confirm(pending)).toEqual({ outcome: 'gone' });
    expect(await pause(link.token as string)).toEqual({ outcome: 'gone' });
  });

  it('a contact that is taken away clears the confirmation too', async () => {
    const c = await confirmed();
    expect(await setClient(c.siteId, c.accountId, { client_contact_email: null })).toEqual({
      outcome: 'saved',
      contact_changed: true,
    });
    expect((await schedule(c.siteId))!.recipient_confirmed_at).toBeNull();
  });

  it('answers not_found for another account’s site, a removed site, a staging copy and a marked account, and writes nothing', async () => {
    const [c, other] = [await client(), await client()];
    const gone = await keptSite(db, c.accountId, { removed_at: NOW });
    const staging = await keptSite(db, c.accountId, { staging_of_site_id: c.siteId });
    const p = { client_name: 'X' };
    expect(await setClient(other.siteId, c.accountId, p)).toEqual({ outcome: 'not_found' });
    expect(await setClient(gone.id, c.accountId, p)).toEqual({ outcome: 'not_found' });
    expect(await setClient(staging.id, c.accountId, p)).toEqual({ outcome: 'not_found' });
    await mark(other.accountId);
    expect(await setClient(other.siteId, other.accountId, p)).toEqual({ outcome: 'not_found' });
    expect((await siteRow(other.siteId)).client_name).toBeNull();
  });
});

/** A second confirmation link for a client already confirmed: the confirmation is cleared first. */
async function issueConfirmationAgain(c: Client): Promise<string> {
  await db.query(
    `update public.report_schedules set recipient_confirmed_at = null where site_id = $1`,
    [c.siteId],
  );
  const issued = await issueConfirmation(c.siteId);
  await db.query(
    `update public.report_schedules set recipient_confirmed_at = $2 where site_id = $1`,
    [c.siteId, NOW],
  );
  return issued.token as string;
}

describe('set_report_schedule and clear_report_schedule', () => {
  it('writes the schedule with its next run, and no confirmation', async () => {
    const c = await client();
    const r = await setSchedule(c.siteId, c.accountId);
    expect(r.outcome).toBe('saved');
    expect(iso(r.next_run_at)).toBe('2026-11-16T09:00:00.000Z');
    const row = (await schedule(c.siteId))!;
    expect(row).toMatchObject({
      cadence: 'weekly',
      iso_weekday: 1,
      time_local: '09:00',
      timezone: 'UTC',
      send_when_unchanged: false,
      page_slug: `c-${c.siteId.replaceAll('-', '')}`,
      paused_by_recipient_at: null,
      last_run_at: null,
      recipient_confirm_hash: null,
      recipient_confirmed_at: null,
      pause_token_hash: null,
    });
    expect(row.next_run_at!.toISOString()).toBe('2026-11-16T09:00:00.000Z');
  });

  it('saving again changes the timing and keeps the confirmation, the pause and the last run', async () => {
    const c = await confirmed();
    const link = await issuePause(c.siteId);
    await pause(link.token as string, at(1));
    await markRun(c.siteId, at(1));
    const r = await setSchedule(
      c.siteId,
      c.accountId,
      { ...WEEKLY, cadence: 'monthly', iso_weekday: 5, send_when_unchanged: true },
      at(2),
    );
    expect(iso(r.next_run_at)).toBe('2026-12-04T09:00:00.000Z');
    const row = (await schedule(c.siteId))!;
    expect(row).toMatchObject({ cadence: 'monthly', iso_weekday: 5, send_when_unchanged: true });
    expect(row.recipient_confirmed_at!.toISOString()).toBe(NOW);
    expect(row.paused_by_recipient_at!.toISOString()).toBe(at(1));
    expect(row.last_run_at!.toISOString()).toBe(at(1));
    expect(
      (await db.query(`select 1 from public.report_schedules where site_id = $1`, [c.siteId])).rows,
    ).toHaveLength(1);
  });

  it('raises 22023 for a missing key, a stray key, on_deploy, and a value out of range', async () => {
    const c = await client();
    const missing = Object.fromEntries(
      Object.entries(WEEKLY).filter(([key]) => key !== 'send_when_unchanged'),
    );
    for (const p of [
      missing,
      { ...WEEKLY, open_tracking: true },
      { ...WEEKLY, page_slug: 'x' },
      { ...WEEKLY, cadence: 'on_deploy' },
      { ...WEEKLY, cadence: 'daily' },
      { ...WEEKLY, iso_weekday: 0 },
      { ...WEEKLY, iso_weekday: 8 },
      { ...WEEKLY, iso_weekday: '1' },
      { ...WEEKLY, time_local: '24:00' },
      { ...WEEKLY, time_local: '9:00' },
      { ...WEEKLY, timezone: 'Mars/Olympus' },
      { ...WEEKLY, timezone: null },
      { ...WEEKLY, send_when_unchanged: 'yes' },
      [WEEKLY],
    ]) {
      await expect(setSchedule(c.siteId, c.accountId, p), JSON.stringify(p)).rejects.toMatchObject({
        code: '22023',
      });
    }
    expect(await schedule(c.siteId)).toBeUndefined();
  });

  it('answers not_found for another account’s site, a removed site, a staging copy and a marked account', async () => {
    const [c, other] = [await client(), await client()];
    const gone = await keptSite(db, c.accountId, { removed_at: NOW });
    const staging = await keptSite(db, c.accountId, { staging_of_site_id: c.siteId });
    expect(await setSchedule(other.siteId, c.accountId)).toEqual({ outcome: 'not_found' });
    expect(await setSchedule(gone.id, c.accountId)).toEqual({ outcome: 'not_found' });
    expect(await setSchedule(staging.id, c.accountId)).toEqual({ outcome: 'not_found' });
    await mark(other.accountId);
    expect(await setSchedule(other.siteId, other.accountId)).toEqual({ outcome: 'not_found' });
    expect(await schedule(other.siteId)).toBeUndefined();
  });

  it('clear removes the schedule of that account’s site and no other', async () => {
    const [c, other] = [await confirmed(), await confirmed()];
    expect(await clear(c.siteId, other.accountId)).toEqual({ outcome: 'not_found' });
    expect(await schedule(c.siteId)).toBeDefined();
    expect(await clear(c.siteId, c.accountId)).toEqual({ outcome: 'cleared' });
    expect(await schedule(c.siteId)).toBeUndefined();
    expect(await schedule(other.siteId)).toBeDefined();
    expect(await clear(c.siteId, c.accountId)).toEqual({ outcome: 'not_found' });
  });
});

describe('the confirmation link', () => {
  it('issue returns a 43-character token once with the address, the site and the account’s name, and stores its sha256', async () => {
    const c = await client();
    await db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [
      c.accountId,
    ]);
    await setClient(c.siteId, c.accountId, { client_contact_email: 'client@client.example' });
    await setSchedule(c.siteId, c.accountId);
    const issued = await issueConfirmation(c.siteId);
    expect(issued).toEqual({
      outcome: 'issued',
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      email: 'client@client.example',
      host: c.host,
      account_name: 'Summit Digital',
    });
    const row = (await schedule(c.siteId))!;
    expect(row.recipient_confirm_hash).toBe(sha256(issued.token as string));
    expect(row.recipient_confirm_sent_at!.toISOString()).toBe(NOW);
    expect(row.recipient_confirmed_at).toBeNull();
    const dump = await db.query<{ t: string }>(
      `select row_to_json(rs)::text t from public.report_schedules rs where site_id = $1`,
      [c.siteId],
    );
    expect(dump.rows[0]!.t).not.toContain(issued.token as string);
  });

  it('issuing again replaces the link: the earlier token is gone', async () => {
    const c = await client();
    await setClient(c.siteId, c.accountId, { client_contact_email: 'client@client.example' });
    await setSchedule(c.siteId, c.accountId);
    const first = (await issueConfirmation(c.siteId)).token as string;
    const second = (await issueConfirmation(c.siteId, at(1))).token as string;
    expect(first).not.toBe(second);
    expect(await confirm(first, at(1))).toEqual({ outcome: 'gone' });
    expect(await confirm(second, at(1))).toEqual({ outcome: 'confirmed' });
  });

  it('issues none with no schedule, no contact, a confirmed contact, a removed site and a marked account', async () => {
    const noSchedule = await client();
    await setClient(noSchedule.siteId, noSchedule.accountId, {
      client_contact_email: 'a@b.example',
    });
    const noContact = await client();
    await setSchedule(noContact.siteId, noContact.accountId);
    const done = await confirmed();
    const removed = await confirmedPending();
    await db.query(`update public.sites set removed_at = now() where id = $1`, [removed.siteId]);
    const marked = await confirmedPending();
    await mark(marked.accountId);
    for (const c of [noSchedule, noContact, done, removed, marked]) {
      expect(await issueConfirmation(c.siteId)).toEqual({ outcome: 'none' });
    }
  });

  it('read says what the link is, the site and the account’s name, and no address; it changes nothing', async () => {
    const c = await confirmedPending();
    await db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [
      c.accountId,
    ]);
    const token = (await issueConfirmation(c.siteId)).token as string;
    const before = await schedule(c.siteId);
    const read = await readLink(token);
    expect(read).toEqual({ outcome: 'confirm', host: c.host, account_name: 'Summit Digital' });
    expect(JSON.stringify(read)).not.toContain('@');
    expect(await schedule(c.siteId)).toEqual(before);
    expect(await readLink('never-issued')).toEqual({ outcome: 'gone' });
  });

  it('confirm marks the contact confirmed, once', async () => {
    const c = await confirmedPending();
    const token = (await issueConfirmation(c.siteId)).token as string;
    expect(await confirm(token, at(1))).toEqual({ outcome: 'confirmed' });
    const row = (await schedule(c.siteId))!;
    expect(row.recipient_confirmed_at!.toISOString()).toBe(at(1));
    expect(row.recipient_confirm_hash).toBeNull();
    expect(await confirm(token, at(1))).toEqual({ outcome: 'gone' });
    expect(await readLink(token, at(1))).toEqual({ outcome: 'gone' });
  });

  it('is gone seven days after it was issued, for a removed site and for a marked account', async () => {
    const old = await confirmedPending();
    const oldToken = (await issueConfirmation(old.siteId)).token as string;
    expect((await readLink(oldToken, at(7, -1))).outcome).toBe('confirm');
    expect(await readLink(oldToken, at(7))).toEqual({ outcome: 'gone' });
    expect(await confirm(oldToken, at(7))).toEqual({ outcome: 'gone' });
    expect((await schedule(old.siteId))!.recipient_confirmed_at).toBeNull();

    const marked = await confirmedPending();
    const markedToken = (await issueConfirmation(marked.siteId)).token as string;
    await mark(marked.accountId);
    expect(await confirm(markedToken)).toEqual({ outcome: 'gone' });
    expect((await schedule(marked.siteId))!.recipient_confirmed_at).toBeNull();
  });
});

/** A client with a contact and a schedule, the contact not confirmed. */
async function confirmedPending(): Promise<Client> {
  const c = await client();
  await setClient(c.siteId, c.accountId, { client_contact_email: 'client@client.example' });
  await setSchedule(c.siteId, c.accountId);
  return c;
}

describe('the confirmation in an Agency trial (D8)', () => {
  /** The account as an Agency trial with a card, as the entitlement step writes one. */
  const inTrial = (accountId: string) =>
    db.query(
      `update public.accounts
          set state = 'agency_trial', trial_variant = 'card_required', trial_used_at = now(),
              trial_ends_at = now() + interval '5 days',
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'agency_trial', 'since', now()::text))
        where id = $1`,
      [accountId],
    );

  it('issues none for a contact that is not the owner’s own address, and stores no link', async () => {
    const c = await confirmedPending();
    await inTrial(c.accountId);
    expect(await issueConfirmation(c.siteId)).toEqual({ outcome: 'none' });
    expect(await schedule(c.siteId)).toMatchObject({
      recipient_confirm_hash: null,
      recipient_confirm_sent_at: null,
    });
  });

  it('issues one for the owner’s own address, whatever its case, and for any contact once the trial is over', async () => {
    const own = await client();
    await setClient(own.siteId, own.accountId, {
      client_contact_email: own.owner.email.toUpperCase(),
    });
    await setSchedule(own.siteId, own.accountId);
    await inTrial(own.accountId);
    expect(await issueConfirmation(own.siteId)).toMatchObject({
      outcome: 'issued',
      email: own.owner.email.toLowerCase(),
    });

    const paid = await confirmedPending();
    expect((await issueConfirmation(paid.siteId)).outcome).toBe('issued');
  });
});

describe('the pause link', () => {
  it('issue stores the sha256 it is given, for a confirmed contact, and answers the address, the site and the account’s name', async () => {
    const c = await confirmed('reader@client.example');
    const token = pauseToken();
    expect(
      await answer(`select public.issue_report_pause($1, $2, $3, $4) r`, [
        c.siteId,
        // The address as the mailer holds it, in whatever case and spacing.
        ' Reader@Client.example ',
        sha256(token),
        NOW,
      ]),
    ).toEqual({
      outcome: 'issued',
      email: 'reader@client.example',
      host: c.host,
      account_name: (
        await db.query<{ name: string | null }>(`select name from public.accounts where id = $1`, [
          c.accountId,
        ])
      ).rows[0]!.name,
    });
    expect((await schedule(c.siteId))!.pause_token_hash).toBe(sha256(token));
    expect(await readLink(token)).toMatchObject({ outcome: 'pause', host: c.host });
  });

  it('the same hash again changes nothing, so the link of an earlier report still pauses', async () => {
    const c = await confirmed();
    const token = pauseToken();
    await issuePause(c.siteId, NOW, token);
    const before = await schedule(c.siteId);
    expect((await issuePause(c.siteId, at(7), token)).outcome).toBe('issued');
    expect(await schedule(c.siteId)).toEqual(before);
    expect(await pause(token, at(8))).toEqual({ outcome: 'paused' });
  });

  it('stores nothing for an address that is no longer the site’s contact: a report row of the contact before, handled late, does not replace the new contact’s link', async () => {
    const c = await confirmed('first@client.example');
    await setClient(c.siteId, c.accountId, { client_contact_email: 'second@client.example' });
    const again = await issueConfirmation(c.siteId);
    await confirm(again.token as string);
    const mine = pauseToken();
    await issuePause(c.siteId, NOW, mine);
    // The mailer, late, for the address before.
    expect(
      await answer(`select public.issue_report_pause($1, $2, $3, $4) r`, [
        c.siteId,
        'first@client.example',
        sha256(pauseToken()),
        NOW,
      ]),
    ).toEqual({ outcome: 'none' });
    expect((await schedule(c.siteId))!.pause_token_hash).toBe(sha256(mine));
    expect(await pause(mine, at(1))).toEqual({ outcome: 'paused' });
  });

  it('a contact address blanked by any writer clears what the schedule holds about it, as set_client’s change does', async () => {
    const c = await confirmed();
    const token = pauseToken();
    await issuePause(c.siteId, NOW, token);
    await pause(token, at(1));
    // The erasure's rule writes the column directly (20261112000002, rule 30).
    await db.query(`update public.sites set client_contact_email = null where id = $1`, [c.siteId]);
    expect(await schedule(c.siteId)).toMatchObject({
      recipient_confirm_hash: null,
      recipient_confirm_sent_at: null,
      recipient_confirmed_at: null,
      pause_token_hash: null,
      paused_by_recipient_at: null,
    });
    // A write that leaves the address as it is, or changes its case alone, clears nothing.
    const kept = await confirmed('kept@client.example');
    await db.query(
      `update public.sites set client_contact_email = upper(client_contact_email) where id = $1`,
      [kept.siteId],
    );
    expect((await schedule(kept.siteId))!.recipient_confirmed_at).not.toBeNull();
  });

  it('refuses a value that is not a sha256 in lowercase hex, and a null', async () => {
    const c = await confirmed();
    await expect(
      answer(`select public.issue_report_pause($1, $4, $2, $3) r`, [
        c.siteId,
        pauseToken(),
        NOW,
        await contactOf(c.siteId),
      ]),
    ).rejects.toMatchObject({ constraint: 'report_schedules_link_hashes' });
    await expect(
      answer(`select public.issue_report_pause($1, $4, $2, $3) r`, [
        c.siteId,
        null,
        NOW,
        await contactOf(c.siteId),
      ]),
    ).rejects.toMatchObject({ code: '22004' });
  });

  it('issues none for a contact that has not confirmed, and for a paused schedule', async () => {
    const pending = await confirmedPending();
    expect(await issuePause(pending.siteId)).toEqual({ outcome: 'none' });
    const c = await confirmed();
    await pause((await issuePause(c.siteId)).token as string);
    expect(await issuePause(c.siteId)).toEqual({ outcome: 'none' });
  });

  it('pause stops the schedule from the moment given, keeps the first time on a second press, and reading the link changes nothing', async () => {
    const c = await confirmed();
    const token = (await issuePause(c.siteId)).token as string;
    await readLink(token);
    expect((await schedule(c.siteId))!.paused_by_recipient_at).toBeNull();
    expect(await pause(token, at(1))).toEqual({ outcome: 'paused' });
    expect(await pause(token, at(3))).toEqual({ outcome: 'paused' });
    expect((await schedule(c.siteId))!.paused_by_recipient_at!.toISOString()).toBe(at(1));
    expect(await pause('never-issued')).toEqual({ outcome: 'gone' });
  });

  it('resume clears the pause and sets the next run after the moment of resuming, for that account only', async () => {
    const [c, other] = [await confirmed(), await confirmed()];
    await pause((await issuePause(c.siteId)).token as string, at(1));
    expect(await resume(c.siteId, other.accountId, at(40))).toEqual({ outcome: 'not_found' });
    const r = await resume(c.siteId, c.accountId, at(40));
    expect(r.outcome).toBe('resumed');
    // 40 days on is Tuesday 22 December; the next Monday 09:00 is the 28th.
    expect(iso(r.next_run_at)).toBe('2026-12-28T09:00:00.000Z');
    const row = (await schedule(c.siteId))!;
    expect(row.paused_by_recipient_at).toBeNull();
    expect(row.next_run_at!.toISOString()).toBe('2026-12-28T09:00:00.000Z');
    expect(await resume(c.siteId, c.accountId, at(41))).toEqual({ outcome: 'not_paused' });
  });

  it('a recipient’s pause is final from the sender’s side: resuming restarts no mail, and reports start again only when the recipient confirms again', async () => {
    const c = await confirmed('reader@client.example');
    const token = pauseToken();
    await issuePause(c.siteId, NOW, token);
    await pause(token, at(1));
    expect((await resume(c.siteId, c.accountId, at(2))).outcome).toBe('resumed');
    // The confirmation went with the pause: the schedule is one whose contact has not confirmed.
    expect(await schedule(c.siteId)).toMatchObject({
      paused_by_recipient_at: null,
      recipient_confirmed_at: null,
      recipient_confirm_hash: null,
      recipient_confirm_sent_at: null,
    });
    // No report can be mailed for it, by the due list or by the mailer's own check.
    const dueRow = (await due(at(60))).find((r) => r.site_id === c.siteId)!;
    expect(dueRow.confirmed).toBe(false);
    expect(await issuePause(c.siteId, at(2), token)).toEqual({ outcome: 'none' });
    // The recipient is asked again, and once they confirm the reports go.
    const asked = await issueConfirmation(c.siteId, at(2));
    expect(asked.outcome).toBe('issued');
    expect((await confirm(asked.token as string, at(3))).outcome).toBe('confirmed');
    expect((await issuePause(c.siteId, at(3), token)).outcome).toBe('issued');
  });
});

describe('due_report_schedules', () => {
  const mine = (rows: Record<string, unknown>[], c: Client) =>
    rows.filter((r) => r.site_id === c.siteId);
  /** After the schedule's first run, Monday 16 November 09:00 UTC. */
  const LATER = '2026-11-16T09:00:00.000Z';

  it('lists a schedule from the moment of its next run, with what the runner decides on and no address', async () => {
    const c = await confirmed();
    const checkId = await check(c.siteId);
    expect(mine(await due('2026-11-16T08:59:59.999Z'), c)).toEqual([]);
    const [row] = mine(await due(LATER), c);
    expect(row).toEqual({
      site_id: c.siteId,
      account_id: c.accountId,
      slot: expect.any(String),
      send_when_unchanged: false,
      has_contact: true,
      confirmed: true,
      confirmation_requested: true,
      ask_refused: false,
      contact_is_owner: false,
      state: 'agency',
      tier: 'agency',
      past_due_tier: null,
      past_due_since: null,
      trial_variant: null,
      trial_ends_at: null,
      check_id: checkId,
      changed: true,
    });
    expect(iso(row!.slot)).toBe(LATER);
    expect(JSON.stringify(row)).not.toContain('@');
  });

  it('leaves out a paused schedule, and lists it again once resumed and due', async () => {
    const c = await confirmed();
    await pause((await issuePause(c.siteId)).token as string);
    expect(mine(await due(at(30)), c)).toEqual([]);
    await resume(c.siteId, c.accountId, at(30));
    expect(mine(await due(at(30)), c)).toEqual([]);
    expect(mine(await due(at(40)), c)).toHaveLength(1);
  });

  it('leaves out a removed site, a marked account and a deleted one', async () => {
    const [removed, marked, deleted] = [await confirmed(), await confirmed(), await confirmed()];
    await db.query(`update public.sites set removed_at = now() where id = $1`, [removed.siteId]);
    await mark(marked.accountId);
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [
      deleted.accountId,
    ]);
    const rows = await due(at(30));
    for (const c of [removed, marked, deleted]) expect(mine(rows, c)).toEqual([]);
  });

  it('says whether the contact has confirmed, whether a confirmation was asked for, and whether there is a contact', async () => {
    const none = await client();
    await setSchedule(none.siteId, none.accountId);
    const pending = await confirmedPending();
    const asked = await confirmedPending();
    await issueConfirmation(asked.siteId);
    const rows = await due(LATER);
    const flags = (c: Client) => {
      const [r] = mine(rows, c);
      return [r!.has_contact, r!.confirmed, r!.confirmation_requested];
    };
    expect(flags(none)).toEqual([false, false, false]);
    expect(flags(pending)).toEqual([true, false, false]);
    expect(flags(asked)).toEqual([true, false, true]);
  });

  it('says the contact is the owner’s own address only when it is, in any case, and reports the account’s trial', async () => {
    const own = await client();
    await setClient(own.siteId, own.accountId, {
      client_contact_email: own.owner.email.toUpperCase(),
    });
    await setSchedule(own.siteId, own.accountId);
    const colleague = await client();
    const member = await person(db, 'member');
    await addSeat(db, colleague.accountId, member, 'account_manager');
    await setClient(colleague.siteId, colleague.accountId, { client_contact_email: member.email });
    await setSchedule(colleague.siteId, colleague.accountId);
    await db.query(
      `update public.accounts
          set state = 'agency_trial', trial_variant = 'no_card', trial_ends_at = $2, trial_used_at = now(),
              state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'agency_trial', 'since', now()::text))
        where id = $1`,
      [own.accountId, at(10)],
    );
    const rows = await due(LATER);
    expect(mine(rows, own)[0]).toMatchObject({ contact_is_owner: true, state: 'agency_trial' });
    expect(iso(mine(rows, own)[0]!.trial_ends_at)).toBe(at(10));
    expect(mine(rows, colleague)[0]).toMatchObject({ contact_is_owner: false, state: 'agency' });
  });

  it('names the site’s latest finished check, or none', async () => {
    const c = await confirmed();
    expect(mine(await due(LATER), c)[0]!.check_id).toBeNull();
    await check(c.siteId, '2026-11-09T06:20:00.000Z');
    const latest = await check(c.siteId, '2026-11-11T06:20:00.000Z');
    const queued = randomUUID();
    await queuedCheck(queued, c.siteId);
    expect(mine(await due(LATER), c)[0]!.check_id).toBe(latest);
  });

  it('changed: true before any report was sent; then only when a check queued after the one the last sent report ended on found a change that is not a baseline', async () => {
    const c = await confirmed();
    const covered = await check(c.siteId);
    const changed = async () => mine(await due(at(30)), c)[0]!.changed;
    expect(await changed()).toBe(true);

    const report = await writeReport(c.siteId, LATER, covered, LATER);
    expect(await changed()).toBe(true);
    // A check that finishes after the report's row was written and before its mail went. Under a
    // rule that asked what was detected after the mail, its change would be in no report.
    const between = randomUUID();
    await insertRow(db, 'checks', {
      ...ROWS.checks(between, c.siteId),
      queued_at: '2026-11-01T06:00:00.000Z',
      started_at: '2026-11-01T06:00:05.000Z',
      finished_at: '2026-11-01T06:10:00.000Z',
      tested_at: '2026-11-01T06:00:05.000Z',
    });
    await markSent(report.report_id, LATER);
    expect(await changed()).toBe(false);

    // A change of the check the report covered is in the report, whenever it was detected.
    await insertRow(db, 'changes', {
      ...ROWS.changes(randomUUID(), c.siteId, covered),
      detected_at: at(20),
      where: '/in-the-report',
    });
    expect(await changed()).toBe(false);
    // A later check's baseline is no change.
    await insertRow(db, 'changes', {
      ...ROWS.changes(randomUUID(), c.siteId, between),
      detected_at: '2026-11-01T06:10:00.000Z',
      kind: 'baseline',
      severity: null,
    });
    expect(await changed()).toBe(false);
    // A later check's change is one, though it was detected before the report's mail went.
    await insertRow(db, 'changes', {
      ...ROWS.changes(randomUUID(), c.siteId, between),
      detected_at: '2026-11-01T06:10:00.000Z',
      where: '/after-the-covered-check',
    });
    expect(Date.parse('2026-11-01T06:10:00.000Z')).toBeLessThan(Date.parse(LATER));
    expect(await changed()).toBe(true);
  });

  it('changed: of two reports marked sent at one instant, the later slot’s is the one a change is measured from', async () => {
    const c = await confirmed();
    const checkAt = async (day: string) => {
      const id = randomUUID();
      await insertRow(db, 'checks', {
        ...ROWS.checks(id, c.siteId),
        queued_at: `${day}T06:00:00.000Z`,
        started_at: `${day}T06:00:05.000Z`,
        finished_at: `${day}T06:10:00.000Z`,
        tested_at: `${day}T06:00:05.000Z`,
      });
      return id;
    };
    const [older, newer] = [await checkAt('2026-11-01'), await checkAt('2026-11-08')];
    // The newer check found a change. It is in the later slot's report.
    await insertRow(db, 'changes', {
      ...ROWS.changes(randomUUID(), c.siteId, newer),
      detected_at: '2026-11-08T06:10:00.000Z',
      where: '/in-the-later-report',
    });
    const first = await writeReport(c.siteId, '2026-11-02T09:00:00.000Z', older);
    const second = await writeReport(c.siteId, '2026-11-09T09:00:00.000Z', newer);
    const greatest = await greatestId(first.report_id as string);
    await markSent(second.report_id, at(12));
    await markSent(greatest, at(12));
    // Measured from the earlier slot's report, the newer check's change would count again.
    expect(mine(await due(at(30)), c)[0]!.changed).toBe(false);
  });

  it('lists the earliest first, and no more than the limit', async () => {
    const [a, b] = [await confirmed(), await confirmed()];
    await setSchedule(b.siteId, b.accountId, { ...WEEKLY, iso_weekday: 5 });
    const rows = (await due(at(30))).filter((r) =>
      [a.siteId, b.siteId].includes(r.site_id as string),
    );
    // b's first run is Friday 13 November, a's Monday 16 November.
    expect(rows.map((r) => r.site_id)).toEqual([b.siteId, a.siteId]);
    expect(await due(at(30), 1)).toHaveLength(1);
    expect(await due('2026-01-01T00:00:00Z')).toEqual([]);
  });
});

describe('mark_report_schedule_run', () => {
  it('records the run and moves to the next one, so the schedule is not due again in the same hour', async () => {
    const c = await confirmed();
    const ran = '2026-11-16T09:04:00.000Z';
    expect(iso(await markRun(c.siteId, ran))).toBe('2026-11-23T09:00:00.000Z');
    const row = (await schedule(c.siteId))!;
    expect(row.last_run_at!.toISOString()).toBe(ran);
    expect(row.next_run_at!.toISOString()).toBe('2026-11-23T09:00:00.000Z');
    expect((await due('2026-11-16T09:59:00.000Z')).filter((r) => r.site_id === c.siteId)).toEqual(
      [],
    );
    expect(await markRun(randomUUID(), ran)).toBeNull();
  });
});

describe('a paused schedule and the confirmation', () => {
  it('a pause withdraws a request that is waiting: its link is gone, and none is issued while the pause stands', async () => {
    const c = await confirmed('reader@client.example');
    const token = pauseToken();
    await issuePause(c.siteId, NOW, token);
    await pause(token, at(1));
    await resume(c.siteId, c.accountId, at(2));
    const asked = await issueConfirmation(c.siteId, at(2));
    expect(asked.outcome).toBe('issued');
    // The recipient answers the new request with the pause link of an earlier report.
    expect(await pause(token, at(3))).toEqual({ outcome: 'paused' });
    expect(await schedule(c.siteId)).toMatchObject({
      recipient_confirmed_at: null,
      recipient_confirm_hash: null,
      recipient_confirm_sent_at: null,
    });
    expect(await confirm(asked.token as string, at(3))).toEqual({ outcome: 'gone' });
    expect((await schedule(c.siteId))!.recipient_confirmed_at).toBeNull();
    // Nothing asks a recipient who paused but the account's resume.
    expect(await issueConfirmation(c.siteId, at(3))).toEqual({ outcome: 'none' });
    // Asked once since the pause: the next resume inside the window lifts nothing.
    expect((await resume(c.siteId, c.accountId, at(4))).outcome).toBe('asked_recently');
    expect((await schedule(c.siteId))!.paused_by_recipient_at).not.toBeNull();
  });

  it('a pause leaves a confirmed contact’s record of when it was asked', async () => {
    const c = await confirmed();
    const before = (await schedule(c.siteId))!;
    await pause((await issuePause(c.siteId)).token as string, at(1));
    const after = (await schedule(c.siteId))!;
    expect(after.recipient_confirmed_at).toEqual(before.recipient_confirmed_at);
    expect(after.recipient_confirm_sent_at).toEqual(before.recipient_confirm_sent_at);
  });

  it('resume leaves no link of an earlier request, whatever the row held', async () => {
    const c = await confirmed();
    await pause((await issuePause(c.siteId)).token as string, at(1));
    // A row as no function of this migration leaves it: paused, with a request's link still held.
    const held = sha256('a-link-from-before');
    await db.query(
      `update public.report_schedules
          set recipient_confirmed_at = null, recipient_confirm_hash = $2, recipient_confirm_sent_at = $3
        where site_id = $1`,
      [c.siteId, held, at(1)],
    );
    expect((await resume(c.siteId, c.accountId, at(2))).outcome).toBe('resumed');
    expect(await schedule(c.siteId)).toMatchObject({
      recipient_confirm_hash: null,
      recipient_confirm_sent_at: null,
    });
    expect(await confirm('a-link-from-before', at(2))).toEqual({ outcome: 'gone' });
  });
});

describe('what a recipient refused (owner ruling on Q42)', () => {
  /** A confirmed contact who then paused, at day 1. */
  async function pausedClient(contact = 'reader@client.example') {
    const c = await confirmed(contact);
    const token = pauseToken();
    await issuePause(c.siteId, NOW, token);
    await pause(token, at(1));
    return { ...c, contact, pauseToken: token };
  }
  const WINDOW_DAYS = 30;
  const mine = (rows: Record<string, unknown>[], c: Client) =>
    rows.filter((r) => r.site_id === c.siteId);

  it('the column is read by no client role, and holds no address', async () => {
    const c = await pausedClient('Reader@Client.Example');
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, role === 'anon' ? null : c.owner.id, (tx) =>
          tx.query(`select report_refusals from public.sites`),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    const held = await refusals(c.siteId);
    // One entry, keyed by the sha256 of the address trimmed and in lower case.
    expect(held).toEqual([{ a: sha256('reader@client.example'), paused_at: expect.any(String) }]);
    expect(JSON.stringify(held).toLowerCase()).not.toContain('reader');
    expect(iso(held[0]!.paused_at)).toBe(at(1));
  });

  it('the window is thirty days', async () => {
    const rows = await service<{ days: string }>(
      `select extract(epoch from public.report_reask_window())::int / 86400 || '' days`,
    );
    expect(Number(rows[0]!.days)).toBe(WINDOW_DAYS);
  });

  it('after a pause, resume asks once: a second resume inside the window is refused with when it may ask, and lifts nothing', async () => {
    const c = await pausedClient();
    expect((await resume(c.siteId, c.accountId, at(2))).outcome).toBe('resumed');
    expect(await askRefusal(c.siteId, at(2))).toBeUndefined();
    expect((await issueConfirmation(c.siteId, at(2), 'resume-1')).outcome).toBe('issued');
    // The recipient answers by pausing again with the link of an earlier report.
    await pause(c.pauseToken, at(3));
    const next = at(2 + WINDOW_DAYS);
    const again = await resume(c.siteId, c.accountId, at(10));
    expect([again.outcome, iso(again.next_at)]).toEqual(['asked_recently', next]);
    expect((await schedule(c.siteId))!.paused_by_recipient_at).not.toBeNull();
    expect(await askRefusal(c.siteId, at(10))).toMatchObject({ refused: 'asked_recently' });
    // To the last moment of the window; from the window's end it may ask again.
    expect((await resume(c.siteId, c.accountId, at(2 + WINDOW_DAYS, -1))).outcome).toBe(
      'asked_recently',
    );
    expect((await resume(c.siteId, c.accountId, next)).outcome).toBe('resumed');
    expect((await issueConfirmation(c.siteId, next, 'resume-2')).outcome).toBe('issued');
  });

  it('one confirmation is issued in the window, whatever asks: another request is none, and the same request again is issued', async () => {
    const c = await pausedClient();
    await resume(c.siteId, c.accountId, at(2));
    const first = await issueConfirmation(c.siteId, at(2), 'resume-1');
    expect(first.outcome).toBe('issued');
    // "Ask again", the hourly run, a save: each is another request.
    expect(await issueConfirmation(c.siteId, at(2, 1), 'ask-again')).toEqual({ outcome: 'none' });
    expect(await issueConfirmation(c.siteId, at(20), null)).toEqual({ outcome: 'none' });
    // The request whose mail did not go is retried: the same ask, and the window is not moved.
    const retried = await issueConfirmation(c.siteId, at(2, 5000), 'resume-1');
    expect(retried.outcome).toBe('issued');
    expect(iso((await refusals(c.siteId))[0]!.asked_at)).toBe(at(2));
    expect(await confirm(first.token as string, at(3))).toEqual({ outcome: 'gone' });
    expect((await confirm(retried.token as string, at(3))).outcome).toBe('confirmed');
  });

  it('the recipient’s own confirmation ends what the pause left: nothing is remembered, and a later pause starts again', async () => {
    const c = await pausedClient();
    await resume(c.siteId, c.accountId, at(2));
    const asked = await issueConfirmation(c.siteId, at(2), 'r');
    await confirm(asked.token as string, at(3));
    expect(await refusals(c.siteId)).toEqual([]);
    await pause(c.pauseToken, at(4));
    expect((await resume(c.siteId, c.accountId, at(5))).outcome).toBe('resumed');
    expect((await issueConfirmation(c.siteId, at(5), 'r2')).outcome).toBe('issued');
  });

  it('removing the schedule and saving it again does not clear a pause: the address is asked once, then not again in the window', async () => {
    const c = await pausedClient();
    await clear(c.siteId, c.accountId);
    await setSchedule(c.siteId, c.accountId, WEEKLY, at(2));
    expect((await schedule(c.siteId))!.paused_by_recipient_at).toBeNull();
    expect((await issueConfirmation(c.siteId, at(2), 'save-1')).outcome).toBe('issued');
    // Again, a day later, and a week later: nothing more is issued to that address.
    for (const day of [3, 9]) {
      await clear(c.siteId, c.accountId);
      await setSchedule(c.siteId, c.accountId, WEEKLY, at(day));
      expect(await issueConfirmation(c.siteId, at(day), `save-${day}`)).toEqual({
        outcome: 'none',
      });
    }
    // And no report goes: the new schedule's contact has not confirmed.
    expect(mine(await due(at(60)), c)[0]!.confirmed).toBe(false);
  });

  it.each([
    ['changed to another address and back', 'other@client.example'],
    ['taken away and put back', null],
    ['written with another case and spaces', '  READER@client.example '],
  ])('the account’s own change of contact does not clear it: %s', async (_how, between) => {
    const c = await pausedClient();
    await resume(c.siteId, c.accountId, at(2));
    await issueConfirmation(c.siteId, at(2), 'resume-1');
    await setClient(c.siteId, c.accountId, { client_contact_email: between });
    await setClient(c.siteId, c.accountId, { client_contact_email: c.contact });
    expect(await refusals(c.siteId)).toEqual([
      expect.objectContaining({ a: sha256(c.contact), paused_at: expect.any(String) }),
    ]);
    expect(await askRefusal(c.siteId, at(3))).toMatchObject({ refused: 'asked_recently' });
    expect(await issueConfirmation(c.siteId, at(3), 'after-change')).toEqual({ outcome: 'none' });
  });

  it('another contact of the same site, and the same address on another site, are not refused', async () => {
    const [c, elsewhere] = [await pausedClient(), await confirmed('reader@client.example')];
    await resume(c.siteId, c.accountId, at(2));
    await issueConfirmation(c.siteId, at(2), 'resume-1');
    expect(await askRefusal(elsewhere.siteId, at(3))).toBeUndefined();
    await setClient(c.siteId, c.accountId, { client_contact_email: 'other@client.example' });
    expect(await askRefusal(c.siteId, at(3))).toBeUndefined();
    expect((await issueConfirmation(c.siteId, at(3), 'other')).outcome).toBe('issued');
  });

  describe('“Don’t ask me again”', () => {
    it('with the confirmation link’s token: the request is withdrawn, and nothing asks that address for that site again', async () => {
      const c = await client();
      await setClient(c.siteId, c.accountId, { client_contact_email: 'reader@client.example' });
      await setSchedule(c.siteId, c.accountId);
      const asked = await issueConfirmation(c.siteId, NOW, 'first');
      expect(await decline(asked.token as string, at(1))).toEqual({ outcome: 'declined' });
      expect(await refusals(c.siteId)).toEqual([
        { a: sha256('reader@client.example'), declined_at: expect.any(String) },
      ]);
      expect(await schedule(c.siteId)).toMatchObject({
        recipient_confirm_hash: null,
        recipient_confirm_sent_at: null,
        recipient_confirmed_at: null,
        paused_by_recipient_at: null,
      });
      // The link in the same mail no longer confirms.
      expect(await confirm(asked.token as string, at(1))).toEqual({ outcome: 'gone' });
      // No request, by any path, however long after.
      for (const day of [1, 40, 400]) {
        expect(await askRefusal(c.siteId, at(day))).toEqual({ refused: 'declined' });
        expect(await issueConfirmation(c.siteId, at(day), `r-${day}`)).toEqual({
          outcome: 'none',
        });
      }
      expect(mine(await due(at(60)), c)[0]).toMatchObject({ confirmed: false, ask_refused: true });
      // Removed and saved again, changed away and back: still declined.
      await clear(c.siteId, c.accountId);
      await setSchedule(c.siteId, c.accountId, WEEKLY, at(2));
      await setClient(c.siteId, c.accountId, { client_contact_email: null });
      await setClient(c.siteId, c.accountId, { client_contact_email: 'reader@client.example' });
      expect(await issueConfirmation(c.siteId, at(3), 'again')).toEqual({ outcome: 'none' });
    });

    it('takes a confirmation link past its seven days: a refusal does not expire', async () => {
      const c = await client();
      await setClient(c.siteId, c.accountId, { client_contact_email: 'reader@client.example' });
      await setSchedule(c.siteId, c.accountId);
      const asked = await issueConfirmation(c.siteId, NOW, 'first');
      expect(await confirm(asked.token as string, at(8))).toEqual({ outcome: 'gone' });
      expect(await decline(asked.token as string, at(8))).toEqual({ outcome: 'declined' });
    });

    it('with the pause link’s token: the reports stop too, and the account’s resume is refused', async () => {
      const c = await confirmed('reader@client.example');
      const token = pauseToken();
      await issuePause(c.siteId, NOW, token);
      expect(await decline(token, at(1))).toEqual({ outcome: 'declined' });
      expect(iso((await schedule(c.siteId))!.paused_by_recipient_at)).toBe(at(1));
      expect(mine(await due(at(60)), c)).toEqual([]);
      expect(await resume(c.siteId, c.accountId, at(2))).toEqual({ outcome: 'declined' });
      expect((await schedule(c.siteId))!.paused_by_recipient_at).not.toBeNull();
      // Pressed again, the pause link's token still answers; the first time stands.
      expect(await decline(token, at(5))).toEqual({ outcome: 'declined' });
      expect(iso((await refusals(c.siteId))[0]!.declined_at)).toBe(at(1));
    });

    it('answers gone for a token no schedule holds, and records nothing', async () => {
      const c = await confirmed();
      expect(await decline(pauseToken())).toEqual({ outcome: 'gone' });
      expect(await refusals(c.siteId)).toEqual([]);
    });
  });

  describe('the erasure', () => {
    it('a contact blanked by any writer but set_client takes what that address refused with it', async () => {
      const c = await pausedClient();
      // The erasure's rule 30, as it writes: the address set null in the site's row.
      await db.query(
        `update public.sites set client_contact_email = null where lower(client_contact_email) = $1`,
        [c.contact],
      );
      expect(await refusals(c.siteId)).toEqual([]);
    });

    it('a report’s recipient blanked (rule 29) takes what that address refused on the report’s site, though it is the contact no longer', async () => {
      const c = await confirmed('reader@client.example');
      const report = await writeReport(c.siteId, '2026-11-16T09:00:00.000Z', await check(c.siteId));
      const token = pauseToken();
      await issuePause(c.siteId, NOW, token);
      await pause(token, at(1));
      await setClient(c.siteId, c.accountId, { client_contact_email: 'successor@client.example' });
      expect(await refusals(c.siteId)).toHaveLength(1);
      await db.query(`update public.reports set recipient_email = null where id = $1`, [
        report.report_id,
      ]);
      expect(await refusals(c.siteId)).toEqual([]);
    });
  });
});

describe('write_client_report and mark_client_report_sent', () => {
  const SLOT = '2026-11-16T09:00:00.000Z';

  it('writes one scheduled client report a site and slot, for the contact address and the owning seat', async () => {
    const c = await confirmed('reader@client.example');
    await setClient(c.siteId, c.accountId, { owner_seat_id: c.owner.seatId });
    const checkId = await check(c.siteId);
    const first = await writeReport(c.siteId, SLOT, checkId, '2026-11-16T09:03:00.000Z');
    expect(first).toEqual({
      outcome: 'written',
      report_id: expect.any(String),
      status: 'scheduled',
    });
    const again = await writeReport(c.siteId, SLOT, checkId, '2026-11-16T09:40:00.000Z');
    expect(again).toEqual({ outcome: 'exists', report_id: first.report_id, status: 'scheduled' });
    const { rows } = await db.query<Record<string, unknown>>(
      `select id, kind, format, status, made_by, covers_check_ids, scheduled_for, sent_at,
              recipient_email, owner_seat_id, storage_path, file_state, account_id
         from public.reports where site_id = $1 and kind = 'client_report'`,
      [c.siteId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'client_report',
      format: 'html',
      status: 'scheduled',
      made_by: 'report_schedule',
      covers_check_ids: [checkId],
      sent_at: null,
      recipient_email: 'reader@client.example',
      owner_seat_id: c.owner.seatId,
      // Its document is a file like any report's: named from this write, stored when it is mailed.
      storage_path: `${c.accountId}/${first.report_id}.doc.json`,
      file_state: 'pending',
      account_id: c.accountId,
    });
    expect(iso(rows[0]!.scheduled_for)).toBe(SLOT);
    const nextSlot = await writeReport(c.siteId, '2026-11-23T09:00:00.000Z', checkId);
    expect(nextSlot.outcome).toBe('written');
    expect(nextSlot.report_id).not.toBe(first.report_id);
  });

  it('of two reports marked sent at one instant, the later slot’s is the last one sent', async () => {
    const c = await confirmed();
    const [older, newer] = [await check(c.siteId), await check(c.siteId)];
    const first = await writeReport(c.siteId, '2026-11-16T09:00:00.000Z', older);
    const second = await writeReport(c.siteId, '2026-11-23T09:00:00.000Z', newer);
    // The earlier slot's report is given the greater id, so an order that fell to the id would
    // take it; both are marked at the same instant.
    const greatest = await greatestId(first.report_id as string);
    await markSent(second.report_id, at(12));
    await markSent(greatest, at(12));
    const third = await check(c.siteId);
    const next = await writeReport(c.siteId, '2026-11-30T09:00:00.000Z', third);
    const covers = (
      await db.query<{ covers_check_ids: string[] }>(
        `select covers_check_ids from public.reports where id = $1`,
        [next.report_id],
      )
    ).rows[0]!.covers_check_ids;
    expect(covers).toEqual([newer, third]);
  });

  it('covers the check the last sent report ended on, before the new one; a report not sent, and the same check, add nothing', async () => {
    const c = await confirmed();
    const covers = async (reportId: unknown) =>
      (
        await db.query<{ covers_check_ids: string[] }>(
          `select covers_check_ids from public.reports where id = $1`,
          [reportId],
        )
      ).rows[0]!.covers_check_ids;
    const first = await check(c.siteId);
    const one = await writeReport(c.siteId, SLOT, first);
    expect(await covers(one.report_id)).toEqual([first]);
    // Not sent: the next report still has nothing to compare with.
    const second = await check(c.siteId);
    const two = await writeReport(c.siteId, '2026-11-23T09:00:00.000Z', second);
    expect(await covers(two.report_id)).toEqual([second]);
    await markSent(two.report_id, at(11));
    // Sent: the one after it compares with the check it ended on.
    const third = await check(c.siteId);
    const three = await writeReport(c.siteId, '2026-11-30T09:00:00.000Z', third);
    expect(await covers(three.report_id)).toEqual([second, third]);
    await markSent(three.report_id, at(18));
    // The same check again (nothing was checked since): one check, not a pair of itself.
    const four = await writeReport(c.siteId, '2026-12-07T09:00:00.000Z', third);
    expect(await covers(four.report_id)).toEqual([third]);
  });

  it('writes none without a contact, for another site’s check, and for a check that has not finished', async () => {
    const c = await confirmed();
    const other = await confirmed();
    const theirs = await check(other.siteId);
    const queued = randomUUID();
    await queuedCheck(queued, c.siteId);
    expect(await writeReport(c.siteId, SLOT, theirs)).toEqual({ outcome: 'none' });
    expect(await writeReport(c.siteId, SLOT, queued)).toEqual({ outcome: 'none' });
    const mineCheck = await check(c.siteId);
    await setClient(c.siteId, c.accountId, { client_contact_email: null });
    expect(await writeReport(c.siteId, SLOT, mineCheck)).toEqual({ outcome: 'none' });
    expect(
      (await db.query(`select 1 from public.reports where site_id = $1`, [c.siteId])).rows,
    ).toEqual([]);
  });

  it('marks a report sent once, and says first for the account’s first only', async () => {
    const c = await confirmed();
    const checkId = await check(c.siteId);
    const one = await writeReport(c.siteId, SLOT, checkId);
    const two = await writeReport(c.siteId, '2026-11-23T09:00:00.000Z', checkId);
    expect(await markSent(one.report_id, at(4))).toEqual({
      outcome: 'sent',
      account_id: c.accountId,
      first: true,
    });
    expect(await markSent(one.report_id, at(5))).toEqual({ outcome: 'already' });
    expect(await markSent(two.report_id, at(11))).toEqual({
      outcome: 'sent',
      account_id: c.accountId,
      first: false,
    });
    const { rows } = await db.query<{ status: string; sent_at: Date }>(
      `select status, sent_at from public.reports where id = $1`,
      [one.report_id],
    );
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.sent_at.toISOString()).toBe(at(4));
    expect(await writeReport(c.siteId, SLOT, checkId)).toMatchObject({
      outcome: 'exists',
      status: 'sent',
    });
  });

  it('marks nothing for a report that is not a client report, and for no report', async () => {
    const c = await confirmed();
    const pdf = randomUUID();
    await insertRow(db, 'reports', ROWS.reports(pdf, c.accountId, c.siteId, randomUUID()));
    expect(await markSent(pdf)).toEqual({ outcome: 'not_found' });
    expect(await markSent(randomUUID())).toEqual({ outcome: 'not_found' });
  });
});

describe('grants', () => {
  it('lets service_role execute each function, and no client role or PUBLIC', async () => {
    const { rows } = await db.query<{ f: string; role: string; can: boolean }>(
      `select f.f, r.role, has_function_privilege(r.role, f.f, 'EXECUTE') can
         from unnest($1::text[]) f(f)
        cross join (values ('anon'), ('authenticated'), ('public'), ('service_role')) r(role)`,
      [`{${FUNCTIONS.map((f) => `"${f}"`).join(',')}}`],
    );
    const may: Record<string, string[]> = {};
    for (const r of rows) if (r.can) (may[r.f] ??= []).push(r.role);
    expect(may).toEqual(Object.fromEntries(FUNCTIONS.map((f) => [f, ['service_role']])));
  });

  it('refuses a signed-in owner who calls one directly', async () => {
    const c = await confirmed();
    for (const sql of [
      `select public.set_client('${c.siteId}', '${c.accountId}', '{"client_name":"x"}')`,
      `select public.due_report_schedules(now(), 10)`,
      `select public.issue_recipient_confirmation('${c.siteId}', now())`,
      `select public.issue_report_pause('${c.siteId}', 'x@example.com', '${'a'.repeat(64)}', now())`,
      `select public.resume_report_schedule('${c.siteId}', '${c.accountId}', now())`,
    ]) {
      await expect(
        asRole(db, 'authenticated', c.owner.id, (tx) => tx.query(sql)),
        sql,
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('pins the search_path of each to pg_catalog, pg_temp', async () => {
    const { rows } = await db.query<{ f: string; config: string[] | null }>(
      `select f.f, p.proconfig config from unnest($1::text[]) f(f)
         join pg_proc p on p.oid = f.f::regprocedure`,
      [`{${FUNCTIONS.map((f) => `"${f}"`).join(',')}}`],
    );
    expect(Object.fromEntries(rows.map((r) => [r.f, r.config]))).toEqual(
      Object.fromEntries(FUNCTIONS.map((f) => [f, ['search_path=pg_catalog, pg_temp']])),
    );
  });
});

describe('the migration', () => {
  it('applies twice, reverts to no schedule function and none of the four columns, reverts twice, and applies again', async () => {
    const names = FUNCTIONS.map((f) => f.slice('public.'.length, f.indexOf('('))).sort();
    const state = async () => ({
      functions: (
        await db.query<{ proname: string }>(
          `select proname from pg_proc
            where pronamespace = 'public'::regnamespace and proname = any($1::text[]) order by 1`,
          [`{${names.join(',')}}`],
        )
      ).rows.map((r) => r.proname),
      columns: (
        await db.query<{ attname: string }>(
          `select attname from pg_attribute
            where attrelid = 'public.report_schedules'::regclass and attname = any($1::text[])
              and not attisdropped order by 1`,
          [`{${HIDDEN.join(',')}}`],
        )
      ).rows.map((r) => r.attname),
      constraint: (
        await db.query(
          `select 1 from pg_constraint where conrelid = 'public.report_schedules'::regclass
              and conname = 'report_schedules_link_hashes'`,
        )
      ).rows.length,
      indexes: (
        await db.query(
          `select 1 from pg_indexes where schemaname = 'public'
              and indexname in ('report_schedules_confirm_hash_uq', 'report_schedules_pause_hash_uq')`,
        )
      ).rows.length,
    });
    const applied = { functions: names, columns: [...HIDDEN].sort(), constraint: 1, indexes: 2 };
    const reverted = { functions: [], columns: [], constraint: 0, indexes: 0 };

    await db.exec(readMigration(MIGRATION));
    expect(await state()).toEqual(applied);
    await db.exec(readRollback(ROLLBACK));
    expect(await state()).toEqual(reverted);
    await db.exec(readRollback(ROLLBACK));
    expect(await state()).toEqual(reverted);
    await db.exec(readMigration(MIGRATION));
    expect(await state()).toEqual(applied);
  });
});
