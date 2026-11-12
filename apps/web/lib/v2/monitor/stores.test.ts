import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import {
  ROWS,
  insertRow,
  personalAccount,
  prepareMeasurement,
  signUp,
} from '../../../__tests__/helpers/v2-check-tables';
import { supabaseAlertStore } from './alerts-store';
import { sendSummary, type SummaryDeps } from './summary';
import { supabaseSummaryStore } from './summary-store';

/**
 * The alert and summary ports over the service-role client (alerts-store.ts, summary-store.ts), run
 * through PostgREST's calls against the migrated schema (review r1, test quality B2): the stand-in
 * answers each query builder call the way supabase-js does, and caps every read at 1,000 rows, as
 * `max_rows` in infra/supabase/config.toml caps production's.
 */

const MAX_ROWS = 1000;
let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
}, 300_000);
afterAll(async () => db.close());

const client = () => postgrestOver(db, { maxRows: MAX_ROWS });

async function paidAccount(timezone = 'UTC') {
  const email = `st-${randomUUID()}@example.com`;
  const userId = await signUp(db, email);
  const { accountId, seatId } = await personalAccount(db, userId);
  await db.query(
    `update public.accounts
        set timezone = $2, state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = now() + interval '7 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'pro_trial', 'since', now()))
      where id = $1`,
    [accountId, timezone],
  );
  return { userId, accountId, seatId, email };
}

async function site(accountId: string | null) {
  const siteId = randomUUID();
  await insertRow(db, 'sites', ROWS.sites(siteId, accountId, `${siteId.slice(0, 8)}.example`));
  return siteId;
}

async function check(siteId: string, previous: string | null = null) {
  const id = randomUUID();
  await insertRow(db, 'checks', { ...ROWS.checks(id, siteId), previous_check_id: previous });
  return id;
}

const mark = (accountId: string, column: 'deletion_confirmed_at' | 'deleted_at') =>
  db.query(
    column === 'deleted_at'
      ? `update public.accounts set deleted_at = now() where id = $1`
      : `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
    [accountId],
  );

describe('supabaseAlertStore.context', () => {
  it('reads a kept site’s later check: its account, zone, host, channel, and not first', async () => {
    const a = await paidAccount('Europe/Berlin');
    const s = await site(a.accountId);
    await db.query(`update public.sites set slack_channel = '#seo' where id = $1`, [s]);
    const first = await check(s);
    const second = await check(s, first);
    expect(await supabaseAlertStore(client()).context(second)).toEqual({
      checkId: second,
      siteId: s,
      accountId: a.accountId,
      siteRemoved: false,
      accountMarked: false,
      previousCheckId: first,
      firstCheck: false,
      finished: true,
      host: `${s.slice(0, 8)}.example`,
      slackChannel: '#seo',
      finishedAt: ROWS.checks(second, s).finished_at,
      zone: 'Europe/Berlin',
    });
  });

  it('reads a site’s first check as first', async () => {
    const a = await paidAccount();
    const c = await check(await site(a.accountId));
    expect(await supabaseAlertStore(client()).context(c)).toMatchObject({
      firstCheck: true,
      previousCheckId: null,
    });
  });

  it('reads an account marked for deletion, or deleted, as marked', async () => {
    for (const column of ['deletion_confirmed_at', 'deleted_at'] as const) {
      const a = await paidAccount();
      const s = await site(a.accountId);
      const c = await check(s, await check(s));
      const store = supabaseAlertStore(client());
      expect((await store.context(c))?.accountMarked).toBe(false);
      await mark(a.accountId, column);
      expect((await store.context(c))?.accountMarked).toBe(true);
    }
  });

  it('reads a removed site, an audit nobody kept, and no such check', async () => {
    const a = await paidAccount();
    const s = await site(a.accountId);
    const later = await check(s, await check(s));
    const store = supabaseAlertStore(client());
    expect((await store.context(later))?.siteRemoved).toBe(false);
    await db.query(`update public.sites set removed_at = now() where id = $1`, [s]);
    expect((await store.context(later))?.siteRemoved).toBe(true);
    const unkept = await check(await site(null));
    expect(await store.context(unkept)).toMatchObject({ accountId: null, accountMarked: false });
    expect(await store.context(randomUUID())).toBeNull();
  });
});

describe('supabaseAlertStore.slackUrl', () => {
  it('answers the URL for a paid account, and null once the account is marked', async () => {
    const a = await paidAccount();
    const url = 'https://hooks.slack.com/services/T0000/B0000/storeAdapter1';
    await db.query(`select public.set_account_slack_webhook($1, $2)`, [a.accountId, url]);
    const store = supabaseAlertStore(client());
    expect(await store.slackUrl(a.accountId, new Date())).toBe(url);
    await mark(a.accountId, 'deletion_confirmed_at');
    expect(await store.slackUrl(a.accountId, new Date())).toBeNull();
  });
});

describe('supabaseSummaryStore.account', () => {
  it('reads the zone, and an account marked for deletion, or deleted, as marked', async () => {
    const store = supabaseSummaryStore(client(), () => {});
    for (const column of ['deletion_confirmed_at', 'deleted_at'] as const) {
      const a = await paidAccount('America/New_York');
      expect(await store.account(a.accountId)).toEqual({
        marked: false,
        zone: 'America/New_York',
      });
      await mark(a.accountId, column);
      expect((await store.account(a.accountId))?.marked).toBe(true);
    }
    expect(await store.account(randomUUID())).toBeNull();
  });

  it('reads a zone the runtime does not know as UTC', async () => {
    const a = await paidAccount();
    await db.query(`update public.accounts set timezone = 'Mars/Olympus' where id = $1`, [
      a.accountId,
    ]);
    expect((await supabaseSummaryStore(client(), () => {}).account(a.accountId))?.zone).toBe('UTC');
  });
});

describe('supabaseSummaryStore.sites: a baseline is not a change (S2, D6)', () => {
  it('answers a week holding only a baseline as no change, and sendSummary sends nothing', async () => {
    const store = supabaseSummaryStore(client(), () => {});
    const a = await paidAccount();
    const s = await site(a.accountId);
    const c = await check(s);
    await insertRow(db, 'changes', {
      ...ROWS.changes(randomUUID(), s, c),
      kind: 'baseline',
      severity: null,
      subject: 'content',
      summary: 'First check: the baseline',
      where: 'all pages',
      ua: null,
      detected_at: '2026-11-10T00:00:00.000Z',
    });
    const week = ['2026-11-09T00:00:00.000Z', '2026-11-16T00:00:00.000Z'] as const;
    expect(await store.sites(a.accountId, ...week)).toEqual([
      { siteId: s, host: `${s.slice(0, 8)}.example`, changes: [] },
    ]);
    const unused = () => {
      throw new Error('reached past the empty-week rule');
    };
    const answer = await sendSummary(
      {
        store,
        mail: {
          ledger: unused,
          transport: unused,
          pepper: 'p',
          now: () => new Date(),
          log: () => {},
        },
        linkSecret: 's'.repeat(40),
        unsubscribeLinks: unused,
        capture: unused,
        log: () => {},
        now: () => new Date(),
      } as unknown as SummaryDeps,
      { accountId: a.accountId, weekKey: '2026-W46', weekStart: week[1] },
    );
    expect(answer).toEqual({ skip: 'empty' });
    // The control: an opened row the same week is a change, and is read.
    await insertRow(db, 'changes', {
      ...ROWS.changes(randomUUID(), s, c),
      detected_at: '2026-11-11T00:00:00.000Z',
    });
    const read = await store.sites(a.accountId, ...week);
    expect(read[0]!.changes.map((x) => x.kind)).toEqual(['opened']);
  });
});

describe('the recipients through PostgREST’s set-returning calls (review r1, security S1)', () => {
  it('alert recipients: the seats whose scope covers the site', async () => {
    const a = await paidAccount();
    const one = await site(a.accountId);
    const two = await site(a.accountId);
    const email = `scoped-${randomUUID()}@example.com`;
    const userId = await signUp(db, email);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at,
                                 client_scope_all)
       values ($1, $2, $3, 'account_manager', 'active', now(), false) returning id`,
      [a.accountId, userId, email],
    );
    const scoped = rows[0]!.id;
    await insertRow(db, 'seat_sites', ROWS.seat_sites(scoped, two, a.accountId));
    const store = supabaseAlertStore(client());
    expect(await store.emailRecipients(a.accountId, one)).toEqual([
      { seatId: a.seatId, email: a.email },
    ]);
    expect(await store.emailRecipients(a.accountId, two)).toEqual([
      { seatId: a.seatId, email: a.email },
      { seatId: scoped, email },
    ]);
    expect(await supabaseSummaryStore(client(), () => {}).recipients(a.accountId)).toEqual([
      { seatId: a.seatId, email: a.email, sites: null },
      { seatId: scoped, email, sites: [two] },
    ]);
  });
});

/** `n` more copies of change `id`, each a second later, at a `where` of its own (the idempotency key). */
const copies = (id: string, n: number) =>
  db.query(
    `insert into public.changes
     select (jsonb_populate_record(c, jsonb_build_object(
               'id', gen_random_uuid(), 'detected_at', c.detected_at + make_interval(secs => g),
               'where', c."where" || ' #' || gen_random_uuid()))).*
       from public.changes c, generate_series(1, $2) g
      where c.id = $1`,
    [id, n],
  );

describe('reads past PostgREST’s 1,000 rows (review r1, correctness S3)', () => {
  it('alert data: every change of the check, and every event of the fixes they name', async () => {
    const a = await paidAccount();
    const s = await site(a.accountId);
    const c = await check(s, await check(s));
    const fixId = randomUUID();
    await insertRow(db, 'site_fixes', ROWS.site_fixes(fixId, s, c, 1));
    const first = randomUUID();
    await insertRow(db, 'changes', { ...ROWS.changes(first, s, c), fix_id: fixId });
    await copies(first, 1204);
    await db.query(
      `insert into public.fix_events (id, fix_id, at, kind, check_id)
       select gen_random_uuid(), $1, now() + make_interval(secs => g), 'reopened', $2
         from generate_series(1, 1100) g`,
      [fixId, c],
    );
    const store = supabaseAlertStore(client());
    const ctx = (await store.context(c))!;
    const data = await store.data({ ...ctx, accountId: a.accountId });
    expect(data.changes).toHaveLength(1205);
    expect(new Set(data.changes.map((x) => x.id)).size).toBe(1205);
    expect(data.fixEvents).toHaveLength(1100);
  });

  it('the summary: every change of the week past 1,000, and the cap logged only past 5,000', async () => {
    const logs: unknown[] = [];
    const store = supabaseSummaryStore(client(), (event, fields) => logs.push({ event, fields }));
    const a = await paidAccount();
    const s = await site(a.accountId);
    const c = await check(s);
    const first = randomUUID();
    await insertRow(db, 'changes', {
      ...ROWS.changes(first, s, c),
      detected_at: '2026-11-10T00:00:00.000Z',
    });
    await copies(first, 1499);
    const week = ['2026-11-09T00:00:00.000Z', '2026-11-16T00:00:00.000Z'] as const;
    const read = async () =>
      (await store.sites(a.accountId, ...week)).reduce((n, x) => n + x.changes.length, 0);
    expect(await read()).toBe(1500);
    expect(logs).toEqual([]);
    await copies(first, 3500);
    expect(await read()).toBe(5000);
    expect(logs).toEqual([]);
    await copies(first, 1);
    expect(await read()).toBe(5000);
    expect(logs).toEqual([
      { event: 'summary.read_capped', fields: { account: a.accountId, rows: 5000 } },
    ]);
  });

  it('the due list: every account due, a page at a time after the last one read', async () => {
    const accounts: string[] = [];
    for (let k = 0; k < 7; k++) accounts.push((await paidAccount('Pacific/Kiritimati')).accountId);
    const store = supabaseSummaryStore(client(), () => {});
    // Monday 2026-11-16 08:30 in Kiritimati (UTC+14) is 18:30 UTC on Sunday.
    const now = new Date('2026-11-15T18:30:00.000Z');
    const seen: string[] = [];
    let after: string | null = null;
    for (let pages = 0; pages < 100; pages++) {
      const page = await store.due(now, after, 3);
      seen.push(...page.map((d) => d.accountId));
      if (page.length < 3) break;
      after = page.at(-1)!.accountId;
    }
    const mine = seen.filter((id) => accounts.includes(id));
    expect(mine.sort()).toEqual([...accounts].sort());
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([...seen].sort());
  });
});
