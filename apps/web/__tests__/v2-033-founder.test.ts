import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 20261115000001 section C (CC-33 D3, D6): founder_notices, claim_founder_notice,
 * take_founder_overflow, founder_digest_counts and signin_delivery_seen, on PGlite with every migration
 * applied; founder_signups_unannounced is v2-033-founder-store.test.ts's, through the store that calls it. PGlite has
 * one backend, so claims here run one after the other; concurrent claims are
 * scripts/db/founder-notice-race.test.ts.
 */

const MIGRATION = '20261115000001_v2_033_operations.sql';
const ROLLBACK = '20261115000001_v2_033_operations.revert.sql';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const LIMIT = 20;
const T = (iso: string) => new Date(iso).toISOString();

interface Claim {
  key: string;
  kind?: string;
  account?: string | null;
  internal?: boolean;
  occurred?: string;
  facts?: Record<string, unknown>;
  now: string;
  limit?: number;
  configured?: boolean;
}

const claim = (c: Claim) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ s: string }>(
      'select public.claim_founder_notice($1, $2, $3, $4, $5, $6, $7, $8, $9) as s',
      [
        c.key,
        c.kind ?? 'signup',
        c.account ?? null,
        c.internal ?? false,
        c.occurred ?? c.now,
        JSON.stringify(c.facts ?? {}),
        c.now,
        c.limit ?? LIMIT,
        c.configured ?? true,
      ],
    );
    return rows[0]!.s;
  });

const take = (key: string, rows = 50) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows: r } = await tx.query<{
      t: { total: number; rows: { kind: string; account_id: string | null; internal: boolean }[] };
    }>('select public.take_founder_overflow($1, $2) as t', [key, rows]);
    return r[0]!.t;
  });

const counts = (from: string, to: string) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ c: Record<string, number> }>(
      'select public.founder_digest_counts($1, $2) as c',
      [from, to],
    );
    return rows[0]!.c;
  });

/** Distinct keys for one test, so tests sharing the database never claim each other's rows. */
const keys = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `signup:${tag}-${randomUUID()}-${i}`);

async function row(key: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    'select kind, account_id, internal, state, overflow_key, created_at, facts from public.founder_notices where event_key = $1',
    [key],
  );
  return rows[0];
}

describe('founder_notices', () => {
  it('is RLS-on and refused to anon and authenticated outright', async () => {
    const { rows } = await db.query<{ rls: boolean }>(
      "select relrowsecurity as rls from pg_class where oid = 'public.founder_notices'::regclass",
    );
    expect(rows[0]!.rls).toBe(true);
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, role === 'anon' ? null : randomUUID(), (tx) =>
          tx.query('select 1 from public.founder_notices limit 1'),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('holds no foreign key on account_id', async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_constraint where conrelid = 'public.founder_notices'::regclass and contype = 'f'",
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses a key longer than the ledger can carry under its prefix, and an unknown kind', async () => {
    await expect(
      claim({ key: `signup:${'x'.repeat(180)}`, now: T('2026-11-01T00:00:00Z') }),
    ).rejects.toThrow(/founder_notices_event_key_check/);
    await expect(
      claim({ key: `x:${randomUUID()}`, kind: 'overflow', now: T('2026-11-01T00:00:00Z') }),
    ).rejects.toThrow(/founder_notices_kind_check/);
  });
});

describe('claim_founder_notice', () => {
  it('is executable by service_role only', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, role === 'anon' ? null : randomUUID(), (tx) =>
          tx.query(
            "select public.claim_founder_notice('signup:x', 'signup', null, false, now(), '{}', now(), 20, true)",
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('answers send under the bound and stores the row at p_now, with what it was given', async () => {
    const now = '2026-11-02T10:00:00.000Z';
    const account = randomUUID();
    const [key] = keys('one', 1);
    expect(
      await claim({
        key: key!,
        kind: 'payment',
        account,
        occurred: '2026-11-02T09:59:00.000Z',
        facts: { plan: 'pro', amount: 1900, currency: 'usd' },
        now,
      }),
    ).toBe('send');
    expect(await row(key!)).toEqual({
      kind: 'payment',
      account_id: account,
      internal: false,
      state: 'send',
      overflow_key: null,
      created_at: new Date(now),
      facts: { plan: 'pro', amount: 1900, currency: 'usd' },
    });
  });

  it('sends p_limit in an hour and holds the rest; an hour on, it sends again', async () => {
    // A window of its own: no other test claims in March 2027.
    const now = '2027-03-01T10:00:00.000Z';
    const ks = keys('bound', LIMIT + 3);
    const states = [];
    for (const k of ks) states.push(await claim({ key: k, now }));
    expect(states.filter((s) => s === 'send')).toHaveLength(LIMIT);
    expect(states.slice(LIMIT)).toEqual(['held', 'held', 'held']);
    // 59 minutes on, the first 20 are still in the hour.
    expect(await claim({ key: keys('bound-59', 1)[0]!, now: '2027-03-01T10:59:00.000Z' })).toBe(
      'held',
    );
    // Exactly an hour on, they are not: the window is the hour before p_now, open at its start.
    expect(await claim({ key: keys('bound-60', 1)[0]!, now: '2027-03-01T11:00:00.000Z' })).toBe(
      'send',
    );
  });

  it('bounds internal accounts and the rest separately', async () => {
    const now = '2027-04-01T10:00:00.000Z';
    for (const k of keys('int', LIMIT))
      expect(await claim({ key: k, internal: true, now })).toBe('send');
    expect(await claim({ key: keys('int-over', 1)[0]!, internal: true, now })).toBe('held');
    // Twenty internal sends hold no customer's notice.
    for (const k of keys('ext', LIMIT)) expect(await claim({ key: k, now })).toBe('send');
    expect(await claim({ key: keys('ext-over', 1)[0]!, now })).toBe('held');
  });

  it('answers skipped when unconfigured, and counts no skipped row against the bound', async () => {
    const now = '2027-05-01T10:00:00.000Z';
    for (const k of keys('skip', LIMIT + 5))
      expect(await claim({ key: k, now, configured: false })).toBe('skipped');
    expect(await claim({ key: keys('skip-then', 1)[0]!, now })).toBe('send');
  });

  it('answers the stored decision for a key already claimed, whatever would be decided now', async () => {
    const now = '2027-06-01T10:00:00.000Z';
    const [sent] = keys('again-send', 1);
    expect(await claim({ key: sent!, now })).toBe('send');
    for (const k of keys('again-fill', LIMIT)) await claim({ key: k, now });
    // The bound is full now, but the key was decided `send`: a retry sends.
    expect(await claim({ key: sent!, now })).toBe('send');
    const [held] = keys('again-held', 1);
    expect(await claim({ key: held!, now })).toBe('held');
    // Two hours on the bound is free, but the key was held: it stays held for the overflow notice.
    expect(await claim({ key: held!, now: '2027-06-01T12:00:00.000Z' })).toBe('held');
    const [skipped] = keys('again-skip', 1);
    expect(await claim({ key: skipped!, now, configured: false })).toBe('skipped');
    expect(await claim({ key: skipped!, now })).toBe('skipped');
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.founder_notices where event_key = any($1)',
      [[sent, held, skipped]],
    );
    expect(rows[0]!.n).toBe(3);
  });

  it('refuses a key claimed as another kind', async () => {
    const [k] = keys('kind', 1);
    await claim({ key: k!, now: '2026-11-03T00:00:00.000Z' });
    await expect(
      claim({ key: k!, kind: 'payment', now: '2026-11-03T00:00:00.000Z' }),
    ).rejects.toThrow(/names a signup notice/);
  });
});

describe('take_founder_overflow', () => {
  it('takes the held rows under its key once, and answers the same rows for that key again', async () => {
    // Clear the held rows earlier tests left, under a key of their own.
    await take(`overflow:clear-${randomUUID()}`);
    const now = '2027-07-01T10:00:00.000Z';
    for (const k of keys('ov-fill', LIMIT)) await claim({ key: k, now });
    const account = randomUUID();
    const held = keys('ov', 3);
    for (const k of held) expect(await claim({ key: k, account, now })).toBe('held');
    const key = `overflow:${randomUUID()}`;
    const first = await take(key);
    expect(first.total).toBe(3);
    expect(first.rows.map((r) => r.account_id)).toEqual([account, account, account]);
    // A row held after the first take is not added to the same key's answer.
    const late = keys('ov-late', 1);
    expect(await claim({ key: late[0]!, now })).toBe('held');
    expect(await take(key)).toEqual(first);
    // The next key takes it.
    expect((await take(`overflow:${randomUUID()}`)).total).toBe(1);
    expect((await row(late[0]!))!.overflow_key).not.toBe(key);
  });

  it('bounds the rows it lists and says the total', async () => {
    await take(`overflow:clear-${randomUUID()}`);
    const now = '2027-08-01T10:00:00.000Z';
    for (const k of keys('ovb-fill', LIMIT)) await claim({ key: k, now });
    for (const k of keys('ovb', 5)) await claim({ key: k, now });
    const t = await take(`overflow:${randomUUID()}`, 2);
    expect(t.total).toBe(5);
    expect(t.rows).toHaveLength(2);
  });

  it('lists the oldest held rows first and keeps the oldest when it bounds them', async () => {
    await take(`overflow:clear-${randomUUID()}`);
    const now = '2027-10-01T10:00:00.000Z';
    for (const k of keys('ovo-fill', LIMIT)) await claim({ key: k, now });
    const byMinute: Record<string, string> = {};
    for (const minute of ['03', '01', '04', '02']) {
      byMinute[minute] = randomUUID();
      expect(
        await claim({
          key: keys(`ovo-${minute}`, 1)[0]!,
          account: byMinute[minute],
          occurred: `2027-10-01T09:${minute}:00.000Z`,
          now,
        }),
      ).toBe('held');
    }
    const t = await take(`overflow:${randomUUID()}`, 2);
    expect(t.total).toBe(4);
    expect(t.rows.map((r) => r.account_id)).toEqual([byMinute['01'], byMinute['02']]);
  });

  it('re-takes the rows of a notice whose mail gave up, and no other key’s (review C6)', async () => {
    await take(`overflow:clear-${randomUUID()}`);
    const now = '2027-11-01T10:00:00.000Z';
    for (const k of keys('ovx-fill', LIMIT)) await claim({ key: k, now });
    // The ledger row of a notice's mail; the rule reads its key, status and attempts, not its kind.
    const ledger = (overflowKey: string, status: string, attempts: number) =>
      db.query(
        `insert into public.email_sends (idempotency_key, kind, address_hash, status, attempts,
                                         claimed_at, sent_at, updated_at)
         values ($1, 'alert', $2, $3, $4, $5, case when $3 = 'sent' then $5::timestamptz end, $5)`,
        [
          `founder_event:${overflowKey}`,
          randomUUID().replace(/-/g, '').padEnd(64, '0'),
          status,
          attempts,
          now,
        ],
      );
    // Three notices take their rows first; then their mails' ledger rows say how each ended.
    const heldUnder = async (tag: string, n: number) => {
      const account = randomUUID();
      for (const k of keys(tag, n)) expect(await claim({ key: k, account, now })).toBe('held');
      const key = `overflow:${randomUUID()}`;
      expect((await take(key)).total).toBe(n);
      return { account, key };
    };
    const gaveUp = await heldUnder('ovx-gave-up', 2);
    const retrying = await heldUnder('ovx-retrying', 1);
    const sent = await heldUnder('ovx-sent', 1);
    await ledger(gaveUp.key, 'failed', 3);
    await ledger(retrying.key, 'failed', 1);
    await ledger(sent.key, 'sent', 1);
    const exhausted = gaveUp.account;
    const fresh = randomUUID();
    expect(await claim({ key: keys('ovx-new', 1)[0]!, account: fresh, now })).toBe('held');
    const next = await take(`overflow:${randomUUID()}`);
    expect(next.total).toBe(3);
    expect(next.rows.map((r) => r.account_id).sort()).toEqual([exhausted, exhausted, fresh].sort());
  });

  it('refuses a key that is not an overflow key', async () => {
    await expect(take('signup:x')).rejects.toThrow(/an overflow key/);
  });
});

describe('founder_digest_counts', () => {
  // A window no other test writes in, so the counts are this test's rows alone.
  const FROM = '2031-01-05T05:00:00.000Z';
  const TO = '2031-01-06T05:00:00.000Z';
  const IN = '2031-01-05T12:00:00.000Z';
  const BEFORE = '2031-01-05T04:59:59.999Z';
  const AT_END = TO;

  async function account(internal: boolean) {
    const { accountId } = await personalAccount(
      db,
      await signUp(db, `digest-${randomUUID()}@example.com`),
    );
    await db.query('update public.accounts set internal = $2 where id = $1', [accountId, internal]);
    return accountId;
  }

  /** A trial that began at `start` and ended at `end`: the account is back on Free. */
  async function trialEnded(accountId: string, trial: string, start: string, end: string) {
    await db.query(
      `update public.accounts
          set state_history = jsonb_build_array(state_history -> 0,
                jsonb_build_object('state', $2::text, 'since', $3::text),
                jsonb_build_object('state', 'free', 'since', $4::text))
        where id = $1`,
      [accountId, trial, start, end],
    );
  }

  async function site(accountId: string | null) {
    const id = randomUUID();
    await db.query('insert into public.sites (id, account_id, host) values ($1, $2, $3)', [
      id,
      accountId,
      `${id.slice(0, 8)}.example`,
    ]);
    return id;
  }

  async function check(siteId: string, queuedAt: string, failedAt: string | null) {
    await db.query(
      `insert into public.checks (site_id, status, trigger, grade_version, queued_at, started_at,
                                  finished_at, failure_reason)
       values ($1, $2, 'manual', '2.0.0', $3, $4, $4, $5)`,
      failedAt === null
        ? [siteId, 'queued', queuedAt, null, null]
        : [siteId, 'failed', queuedAt, failedAt, 'stalled'],
    );
  }

  it('is executable by service_role only, and refuses an empty window', async () => {
    await expect(
      asRole(db, 'authenticated', randomUUID(), (tx) =>
        tx.query("select public.founder_digest_counts(now() - interval '1 day', now())"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(counts(TO, FROM)).rejects.toThrow(/p_from before p_to/);
  });

  it('counts each figure in [from, to), and leaves internal accounts out', async () => {
    const customer = await account(false);
    const staff = await account(true);

    // Notices: one of each kind in the window for a customer; the same for staff (left out); and one
    // just before the window and one at its end (left out).
    const kinds = ['signup', 'trial_started', 'payment', 'payment_failed', 'cancellation'];
    for (const kind of kinds) {
      await claim({
        key: `${kind}:${randomUUID()}`,
        kind,
        account: customer,
        now: IN,
        limit: 1000,
      });
      await claim({
        key: `${kind}:${randomUUID()}`,
        kind,
        account: staff,
        internal: true,
        now: IN,
        limit: 1000,
      });
      await claim({
        key: `${kind}:${randomUUID()}`,
        kind,
        account: customer,
        now: BEFORE,
        limit: 1000,
      });
      await claim({
        key: `${kind}:${randomUUID()}`,
        kind,
        account: customer,
        now: AT_END,
        limit: 1000,
      });
    }
    // A second payment and an agency account created, which no figure counts.
    await claim({
      key: `payment:${randomUUID()}`,
      kind: 'payment',
      account: customer,
      now: IN,
      limit: 1000,
    });
    await claim({ key: `agency:${randomUUID()}`, kind: 'agency_created', now: IN, limit: 1000 });

    // Trials: a customer's Pro trial and another customer's Agency trial end in the window; a
    // staff trial ends in it too (left out); a trial that ended before it is left out.
    await trialEnded(customer, 'pro_trial', '2031-01-01T00:00:00.000Z', IN);
    await trialEnded(await account(false), 'agency_trial', '2031-01-01T00:00:00.000Z', IN);
    await trialEnded(staff, 'pro_trial', '2031-01-01T00:00:00.000Z', IN);
    await trialEnded(await account(false), 'pro_trial', '2031-01-01T00:00:00.000Z', BEFORE);

    // Checks: a customer's site, an unkept audit's site and a staff site, each with one check
    // queued and one failed in the window, and one queued before it.
    for (const s of [await site(customer), await site(null), await site(staff)]) {
      await check(s, IN, null);
      await check(s, IN, IN);
      await check(s, BEFORE, null);
    }
    // A check queued before the window that failed in it is a failure in the window, not a run.
    await check(await site(customer), BEFORE, IN);

    // Mail: two bounce events and a delivery in the window, a bounce before it; one new suppression
    // in it and one first seen before it (last seen in it); one ledger failure in it, one sent.
    for (const [type, at] of [
      ['bounced', IN],
      ['bounced', IN],
      ['delivered', IN],
      ['bounced', BEFORE],
    ] as const) {
      await db.query(
        'insert into public.email_events (email_address, event_type, created_at) values ($1, $2, $3)',
        [`b-${randomUUID()}@example.com`, type, at],
      );
    }
    const hash = () => randomUUID().replace(/-/g, '').padEnd(64, '0');
    await db.query(
      `insert into public.email_suppressions (address_hash, reason, first_at, last_at)
       values ($1, 'hard_bounce', $3, $3), ($2, 'complaint', $4, $3)`,
      [hash(), hash(), IN, BEFORE],
    );
    await db.query(
      `insert into public.email_sends (idempotency_key, kind, address_hash, status, attempts, error_code,
                                       claimed_at, sent_at, updated_at)
       values ($1, 'alert', $3, 'failed', 3, 'network', $5, null, $5),
              ($2, 'alert', $4, 'sent', 1, null, $5, $5, $5)`,
      [`digest:${randomUUID()}`, `digest:${randomUUID()}`, hash(), hash(), IN],
    );

    expect(await counts(FROM, TO)).toEqual({
      signups_confirmed: 1,
      trials_started: 1,
      trials_ended: 2,
      payments_first_or_returning: 2,
      payments_failed: 1,
      cancellations: 1,
      checks_run_all: 4,
      checks_failed_all: 3,
      mail_bounce_events: 2,
      mail_suppressions_new: 1,
      mail_send_failures: 1,
    });
  });
});

describe('founder_digest_counts, send failures (review C5)', () => {
  it('leaves out an internal account’s failed send and the founder notices’ own', async () => {
    // §K adds the founder kinds to email_sends' kind check; until then this database widens it.
    await db.query(
      'alter table public.email_sends drop constraint if exists email_sends_kind_check',
    );
    const at = '2031-02-05T12:00:00.000Z';
    const account = async (internal: boolean) => {
      const { accountId } = await personalAccount(
        db,
        await signUp(db, `fail-${randomUUID()}@example.com`),
      );
      await db.query('update public.accounts set internal = $2 where id = $1', [
        accountId,
        internal,
      ]);
      return accountId;
    };
    const failed = (kind: string, accountId: string | null) =>
      db.query(
        `insert into public.email_sends (idempotency_key, kind, address_hash, account_id, status, attempts,
                                         error_code, claimed_at, updated_at)
         values ($1, $2, $3, $4, 'failed', 3, 'network', $5, $5)`,
        [
          `fail:${randomUUID()}`,
          kind,
          randomUUID().replace(/-/g, '').padEnd(64, '0'),
          accountId,
          at,
        ],
      );
    await failed('alert', await account(false));
    await failed('check_notify', null);
    await failed('alert', await account(true));
    await failed('founder_event', null);
    await failed('founder_digest', null);
    const c = await asRole(db, 'service_role', null, async (tx) => {
      const { rows } = await tx.query<{ c: Record<string, number> }>(
        'select public.founder_digest_counts($1, $2) as c',
        ['2031-02-05T05:00:00.000Z', '2031-02-06T05:00:00.000Z'],
      );
      return rows[0]!.c;
    });
    // A customer's failed send and one that names no account; not staff's, not the founder's.
    expect(c.mail_send_failures).toBe(2);
  });
});

describe('signin_delivery_seen', () => {
  const seen = (address: string, since: string) =>
    asRole(db, 'service_role', null, async (tx) => {
      const { rows } = await tx.query<{ s: boolean }>(
        'select public.signin_delivery_seen($1, $2) as s',
        [address, since],
      );
      return rows[0]!.s;
    });
  const event = (address: string, type: string, at: string) =>
    db.query(
      'insert into public.email_events (email_address, event_type, created_at) values ($1, $2, $3)',
      [address, type, at],
    );

  it('is executable by service_role only', async () => {
    await expect(
      asRole(db, 'authenticated', randomUUID(), (tx) =>
        tx.query("select public.signin_delivery_seen('a@example.com', now())"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('answers whether a delivery to the address, in any case, was recorded at or after the time', async () => {
    const local = `canary-${randomUUID().slice(0, 8)}`;
    const address = `${local}@example.test`;
    const at = '2026-11-13T12:00:00.000Z';
    expect(await seen(address, at)).toBe(false);
    // A delivery before the time, a sent event at it, and a delivery to another address do not count.
    await event(address, 'delivered', '2026-11-13T11:59:59.999Z');
    await event(address, 'sent', at);
    await event(`x${address}`, 'delivered', at);
    expect(await seen(address, at)).toBe(false);
    await event(address.toUpperCase(), 'delivered', at);
    expect(await seen(address, at)).toBe(true);
    expect(await seen(address.toUpperCase(), at)).toBe(true);
  });
});

describe('the migration and its revert', () => {
  it('applies twice, and the revert removes section C and lets it apply again', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d);
      await d.exec(readMigration(MIGRATION));
      await d.exec(readRollback(ROLLBACK));
      await d.exec(readRollback(ROLLBACK));
      const gone = await d.query<{ t: string | null; f: number }>(
        `select to_regclass('public.founder_notices')::text as t,
                (select count(*)::int from pg_proc where proname in
                  ('claim_founder_notice', 'take_founder_overflow', 'founder_digest_counts',
                   'signin_delivery_seen', 'founder_signups_unannounced')) as f`,
      );
      expect(gone.rows[0]).toEqual({ t: null, f: 0 });
      await d.exec(readMigration(MIGRATION));
      const back = await d.query<{ t: string | null }>(
        "select to_regclass('public.founder_notices')::text as t",
      );
      expect(back.rows[0]!.t).toBe('founder_notices');
    } finally {
      await d.close();
    }
  }, 300_000);
});

// Last in the file: its rows are later than every other test's, and the bound counts every row created
// after the hour's start, so a later row would count against an earlier test's claims.
describe('claim_founder_notice, held rows', () => {
  it('counts only `send` rows against the bound: held rows in the hour do not hold the next notice', async () => {
    for (const k of keys('sendonly', LIMIT))
      expect(await claim({ key: k, now: '2032-09-01T10:00:00.000Z' })).toBe('send');
    for (const k of keys('sendonly-held', LIMIT))
      expect(await claim({ key: k, now: '2032-09-01T10:30:00.000Z' })).toBe('held');
    // The 10:00 sends are out of the hour; the 10:30 held rows are in it, and count for nothing.
    expect(
      await claim({ key: keys('sendonly-next', 1)[0]!, now: '2032-09-01T11:00:01.000Z' }),
    ).toBe('send');
  });
});
