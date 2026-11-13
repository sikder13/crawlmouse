/**
 * The console's store, run through the PostgREST stand-in over PGlite with every migration applied,
 * so each query names columns the schema has, as the service role.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import {
  insertRow,
  personalAccount,
  ROWS,
  signUp,
} from '../../../__tests__/helpers/v2-check-tables';

vi.mock('server-only', () => ({}));

import { supabaseConsoleStore, SEARCH_RESULTS_MAX, type ConsoleStore } from './console-store';

let db: PGlite;
let store: ConsoleStore;
let operatorId: string;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  operatorId = await signUp(db, `op-${randomUUID()}@example.com`);
  await db.query('insert into public.operators (user_id) values ($1)', [operatorId]);
  store = supabaseConsoleStore(postgrestOver(db), operatorId);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const address = (tag: string) => [`${tag}-${randomUUID().slice(0, 8)}`, 'example.com'].join('@');

async function person(tag = 'p') {
  const email = address(tag);
  const userId = await signUp(db, email);
  const { accountId, seatId } = await personalAccount(db, userId);
  return { email, userId, accountId, seatId };
}

async function site(accountId: string | null, host = `${randomUUID().slice(0, 8)}.example`) {
  const id = randomUUID();
  await db.query(`insert into public.sites (id, account_id, host) values ($1, $2, $3)`, [
    id,
    accountId,
    host,
  ]);
  return { id, host };
}

async function check(siteId: string, status: 'queued' | 'failed', hoursAgo: number) {
  const id = randomUUID();
  const failed = status === 'failed';
  await db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                finished_at, failure_reason)
     values ($1, $2, $3, 'scheduled', '2.0.0', now() - make_interval(mins => $4),
             case when $5 then now() - make_interval(mins => $4) end,
             case when $5 then now() - make_interval(mins => $4) end,
             case when $5 then 'internal' end)`,
    [id, siteId, status, Math.round(hoursAgo * 60), failed],
  );
  return id;
}

async function actions() {
  const { rows } = await db.query<Record<string, unknown>>(
    `select action, account_id, target, reason, outcome from public.operator_actions
      where operator_id = $1 order by id`,
    [operatorId],
  );
  return rows;
}

describe('resolve', () => {
  it('an account id finds that account', async () => {
    const p = await person();
    expect(await store.resolve({ kind: 'id', id: p.accountId })).toEqual({
      kind: 'account_id',
      accountIds: [p.accountId],
    });
  });

  it("a check id finds its site's account", async () => {
    const p = await person();
    const s = await site(p.accountId);
    const c = await check(s.id, 'failed', 1);
    expect(await store.resolve({ kind: 'id', id: c })).toEqual({
      kind: 'check_id',
      accountIds: [p.accountId],
    });
  });

  it('an anonymous check, and an id that names nothing, find no account', async () => {
    const s = await site(null);
    const c = await check(s.id, 'failed', 1);
    expect(await store.resolve({ kind: 'id', id: c })).toEqual({
      kind: 'check_id',
      accountIds: [],
    });
    expect(await store.resolve({ kind: 'id', id: randomUUID() })).toEqual({
      kind: 'id',
      accountIds: [],
    });
  });

  it('a Stripe customer id finds the account that holds it', async () => {
    const p = await person();
    const customer = `cus_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await db.query('update public.accounts set stripe_customer_id = $1 where id = $2', [
      customer,
      p.accountId,
    ]);
    expect(await store.resolve({ kind: 'stripe_customer', customerId: customer })).toEqual({
      kind: 'stripe_customer',
      accountIds: [p.accountId],
    });
  });

  it("an address finds the user's own account and the accounts they hold a seat on", async () => {
    const p = await person();
    const other = await person();
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'seat@example.com', 'developer', 'active', now())`,
      [other.accountId, p.userId],
    );
    const found = await store.resolve({ kind: 'email', email: p.email });
    expect(found.kind).toBe('email');
    expect([...found.accountIds].sort()).toEqual([p.accountId, other.accountId].sort());
  });

  it('a host finds the accounts that keep it, and not an anonymous site of it', async () => {
    const host = `${randomUUID().slice(0, 8)}.example`;
    const a = await person();
    const b = await person();
    await site(a.accountId, host);
    await site(b.accountId, host);
    await site(null, host);
    const found = await store.resolve({ kind: 'host', host });
    expect([...found.accountIds].sort()).toEqual([a.accountId, b.accountId].sort());
  });

  it(`answers at most ${SEARCH_RESULTS_MAX} accounts`, async () => {
    const host = `${randomUUID().slice(0, 8)}.example`;
    for (let i = 0; i < SEARCH_RESULTS_MAX + 2; i++) await site((await person()).accountId, host);
    expect((await store.resolve({ kind: 'host', host })).accountIds).toHaveLength(
      SEARCH_RESULTS_MAX,
    );
  });

  it('none finds nothing and reads nothing', async () => {
    expect(await store.resolve({ kind: 'none' })).toEqual({ kind: 'none', accountIds: [] });
  });
});

describe('dossier', () => {
  it('reads the account, its seats with their addresses, sites, the last 20 checks, mail, alerts and open fixes', async () => {
    const p = await person('owner');
    const s1 = await site(p.accountId);
    const s2 = await site(p.accountId);
    for (let i = 0; i < 12; i++) await check(s1.id, 'failed', i + 1);
    for (let i = 0; i < 12; i++) await check(s2.id, 'queued', i + 0.5);
    const elsewhere = await site((await person()).accountId);
    await check(elsewhere.id, 'failed', 0.1);
    await db.query(
      `insert into public.email_sends (idempotency_key, kind, address_hash, account_id, status,
                                       attempts, error_code, claimed_at, sent_at, updated_at)
       values ($1, 'alert', $2, $3, 'failed', 3, 'bounced', now(), null, now())`,
      [`k-${randomUUID()}`, 'a'.repeat(64), p.accountId],
    );

    const fixCheck = await check(s1.id, 'failed', 30);
    const open = randomUUID();
    const done = randomUUID();
    await insertRow(db, 'site_fixes', ROWS.site_fixes(open, s1.id, fixCheck, 7));
    await insertRow(db, 'site_fixes', {
      ...ROWS.site_fixes(done, s1.id, fixCheck, 8),
      status: 'verified_resolved',
      last_state: 'not_detected',
      rank: null,
    });
    const rule = randomUUID();
    await insertRow(db, 'alert_rules', ROWS.alert_rules(rule, p.accountId, null));
    const event = randomUUID();
    await insertRow(db, 'alert_events', ROWS.alert_events(event, rule, s1.id, fixCheck));

    const d = (await store.dossier(p.accountId))!;
    expect(d.account).toMatchObject({
      id: p.accountId,
      state: 'free',
      internal: false,
      stripe_customer_id: null,
      deleted_at: null,
    });
    expect(d.seats).toEqual([
      expect.objectContaining({ id: p.seatId, user_id: p.userId, role: 'owner', status: 'active' }),
    ]);
    expect(d.emails).toEqual({ [p.userId]: p.email });
    expect(d.sites.map((s) => s.host).sort()).toEqual([s1.host, s2.host].sort());
    expect(d.checks).toHaveLength(20);
    const times = d.checks.map((c) => Date.parse(c.queued_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(d.checks.every((c) => c.site_id === s1.id || c.site_id === s2.id)).toBe(true);
    expect(d.mail).toEqual([
      expect.objectContaining({
        kind: 'alert',
        status: 'failed',
        attempts: 3,
        error_code: 'bounced',
      }),
    ]);
    expect(Object.keys(d.mail[0]!)).not.toContain('address_hash');
    expect(d.fixes).toEqual([
      { id: open, site_id: s1.id, number: 7, type: 'orphan_pages', status: 'open' },
    ]);
    expect(d.rules.map((r) => r.id)).toEqual([rule]);
    expect(d.alerts.map((a) => a.id)).toEqual([event]);
  });

  it('answers null for an id that is no account', async () => {
    expect(await store.dossier(randomUUID())).toBeNull();
  });
});

describe('seatEmail', () => {
  it("answers an active seat's user address on that account, and null otherwise", async () => {
    const p = await person();
    const stranger = await person();
    expect(await store.seatEmail(p.accountId, p.userId)).toBe(p.email);
    expect(await store.seatEmail(p.accountId, stranger.userId)).toBeNull();
    await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
      p.seatId,
    ]);
    expect(await store.seatEmail(p.accountId, p.userId)).toBeNull();
  });
});

describe('rerunTarget', () => {
  it("reads the check's status and its site's account, removal and pause", async () => {
    const p = await person();
    const s = await site(p.accountId);
    const c = await check(s.id, 'failed', 1);
    expect(await store.rerunTarget(c)).toEqual({
      checkId: c,
      siteId: s.id,
      status: 'failed',
      accountId: p.accountId,
      removedAt: null,
      pausedReason: null,
    });
    expect(await store.rerunTarget(randomUUID())).toBeNull();
  });
});

describe('the record', () => {
  it('logs a search with its kind and count, a view and a re-send, and finishes the re-send once', async () => {
    const p = await person();
    await store.logSearch('email', 2);
    await store.logView(p.accountId);
    const id = await store.logResend(p.accountId, p.userId, 'locked out');
    expect(await store.finish(id, 'sent')).toBe(true);
    expect(await store.finish(id, 'refused')).toBe(false);
    expect((await actions()).slice(-3)).toEqual([
      { action: 'search', account_id: null, target: 'email', reason: null, outcome: '2' },
      {
        action: 'view_account',
        account_id: p.accountId,
        target: p.accountId,
        reason: null,
        outcome: null,
      },
      {
        action: 'resend_sign_in',
        account_id: p.accountId,
        target: p.userId,
        reason: 'locked out',
        outcome: 'sent',
      },
    ]);
  });

  it('a log the database refuses throws', async () => {
    const stranger = supabaseConsoleStore(postgrestOver(db), randomUUID());
    await expect(stranger.logView(randomUUID())).rejects.toThrow(/operator_log failed/);
  });
});
