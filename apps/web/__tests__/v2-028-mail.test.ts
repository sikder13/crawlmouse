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
import { SHA, personalAccount, signUp } from './helpers/v2-check-tables';
import { LEDGER_CASES } from '../lib/v2/mail/ledger-cases';

/**
 * Migration 028, section A (docs/specs/v2/28-monitoring.md, D1 and D7): the mailer's send ledger and
 * the suppression record. Two transactions racing for one key are scripts/db/monitoring-race.test.ts's;
 * PGlite has one backend.
 */

const MIGRATION = '20261113000001_v2_028_monitoring.sql';
const ROLLBACK = '20261113000001_v2_028_monitoring.revert.sql';
const T0 = '2026-11-13T10:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => db.close());

type Answer = { outcome: string; attempt?: number };

async function call<T = Answer>(fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await asRole(db, 'service_role', null, (tx) =>
    tx.query<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args),
  );
  return rows[0]!.r;
}

const claim = (
  key: string,
  kind: string,
  hash: string,
  now: string,
  account: string | null = null,
) => call('claim_email_send', [key, kind, hash, account, now]);
const finish = (
  key: string,
  status: string,
  now: string,
  provider: string | null = null,
  error: string | null = null,
) => call<boolean>('finish_email_send', [key, status, provider, error, now]);
const rowOf = async (key: string) =>
  (
    await db.query<{
      status: string;
      attempts: number;
      error_code: string | null;
      provider_message_id: string | null;
    }>(
      `select status, attempts, error_code, provider_message_id from public.email_sends where idempotency_key = $1`,
      [key],
    )
  ).rows[0];

let n = 0;
const fresh = () => ({ key: `test:${randomUUID()}`, hash: SHA(++n) });

describe('claim before send (D1)', () => {
  it('lets the first claim of a key go, at attempt 1, and records it as sending', async () => {
    const { key, hash } = fresh();
    expect(await claim(key, 'check_notify', hash, T0)).toEqual({ outcome: 'go', attempt: 1 });
    expect(await rowOf(key)).toMatchObject({ status: 'sending', attempts: 1 });
  });

  it('answers busy to a second claim inside two minutes, and done once the first is sent', async () => {
    const { key, hash } = fresh();
    await claim(key, 'alert', hash, T0);
    expect(await claim(key, 'alert', hash, at(1.9))).toEqual({ outcome: 'busy' });
    expect(await finish(key, 'sent', at(1), 'msg_1')).toBe(true);
    expect(await claim(key, 'alert', hash, at(2))).toEqual({ outcome: 'done' });
    expect(await claim(key, 'alert', hash, at(60 * 24 * 30))).toEqual({ outcome: 'done' });
    expect(await rowOf(key)).toMatchObject({ status: 'sent', provider_message_id: 'msg_1' });
  });

  it('retries a failed send at most three attempts, then answers exhausted', async () => {
    const { key, hash } = fresh();
    expect(await claim(key, 'fix_to_developer', hash, T0)).toEqual({ outcome: 'go', attempt: 1 });
    await finish(key, 'failed', at(1), null, 'provider_500');
    expect(await rowOf(key)).toMatchObject({ status: 'failed', error_code: 'provider_500' });
    expect(await claim(key, 'fix_to_developer', hash, at(2))).toEqual({
      outcome: 'go',
      attempt: 2,
    });
    await finish(key, 'failed', at(3), null, 'provider_500');
    expect(await claim(key, 'fix_to_developer', hash, at(4))).toEqual({
      outcome: 'go',
      attempt: 3,
    });
    await finish(key, 'failed', at(5), null, 'provider_500');
    expect(await claim(key, 'fix_to_developer', hash, at(6))).toEqual({ outcome: 'exhausted' });
    expect(await rowOf(key)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('takes back a claim left sending for more than two minutes (a worker that died mid-send)', async () => {
    const { key, hash } = fresh();
    await claim(key, 'trial_reminder', hash, T0);
    expect(await claim(key, 'trial_reminder', hash, at(1.9))).toEqual({ outcome: 'busy' });
    expect(await claim(key, 'trial_reminder', hash, at(2.1))).toEqual({
      outcome: 'go',
      attempt: 2,
    });
  });

  it('records a result only for a key that is sending', async () => {
    const { key, hash } = fresh();
    expect(await finish(key, 'sent', T0)).toBe(false);
    await claim(key, 'alert', hash, T0);
    expect(await finish(key, 'sent', at(1), 'm')).toBe(true);
    expect(await finish(key, 'failed', at(2), null, 'late')).toBe(false);
    expect(await rowOf(key)).toMatchObject({ status: 'sent', error_code: null });
  });

  it('refuses a key reused for another kind of message', async () => {
    const { key, hash } = fresh();
    await claim(key, 'alert', hash, T0);
    await expect(claim(key, 'weekly_summary', hash, at(1))).rejects.toThrow(
      /names a alert message/,
    );
  });

  it('refuses a missing argument and an unknown kind', async () => {
    await expect(
      claim(`k:${randomUUID()}`, 'alert', SHA(1), null as unknown as string),
    ).rejects.toThrow(/required/);
    await expect(claim(`k:${randomUUID()}`, 'newsletter', SHA(1), T0)).rejects.toThrow(
      /check constraint/,
    );
    await expect(claim(`k:${randomUUID()}`, 'alert', 'not-a-hash', T0)).rejects.toThrow(
      /check constraint/,
    );
  });
});

describe('the ledger cases (ledger-cases.ts, also run on memoryLedger)', () => {
  it.each(LEDGER_CASES.map((c) => [c.name, c] as const))('%s', async (_, c) => {
    const { key, hash } = fresh();
    let minute = 0;
    // Every step lands inside the two-minute lease: the lease's own cases are above.
    const next = () => at((minute += 0.1));
    for (const step of c.steps) {
      if ('suppress' in step) await call('record_email_suppression', [hash, 'hard_bounce', next()]);
      else if ('claim' in step) {
        expect(await claim(key, step.kind ?? c.kind, hash, next())).toEqual(step.claim);
      } else {
        const provider = step.finish === 'sent' ? 'm1' : null;
        expect(await finish(key, step.finish, next(), provider, step.code ?? null)).toBe(
          step.answer,
        );
      }
    }
    const row = await rowOf(key);
    expect({ status: row!.status, errorCode: row!.error_code }).toEqual(c.row);
  });

  it('suppresses a stale claim of a worker that died, once a bounce is recorded', async () => {
    const { key, hash } = fresh();
    await claim(key, 'alert', hash, T0);
    await call('record_email_suppression', [hash, 'hard_bounce', at(1)]);
    expect(await claim(key, 'alert', hash, at(2.1))).toEqual({ outcome: 'suppressed' });
    expect(await rowOf(key)).toMatchObject({
      status: 'failed',
      error_code: 'suppressed',
      attempts: 1,
    });
  });
});

describe('suppression (D7)', () => {
  it('records a hard bounce, and a complaint outranks it; the first time stays', async () => {
    const hash = SHA(9001);
    await call('record_email_suppression', [hash, 'hard_bounce', T0]);
    await call('record_email_suppression', [hash, 'complaint', at(5)]);
    await call('record_email_suppression', [hash, 'hard_bounce', at(10)]);
    const { rows } = await db.query<{ reason: string; first_at: Date; last_at: Date }>(
      `select reason, first_at, last_at from public.email_suppressions where address_hash = $1`,
      [hash],
    );
    expect(rows[0]!.reason).toBe('complaint');
    expect(rows[0]!.first_at.toISOString()).toBe(T0);
    expect(rows[0]!.last_at.toISOString()).toBe(at(10));
    expect(await call<string>('email_address_suppressed', [hash])).toBe('complaint');
    expect(await call<string | null>('email_address_suppressed', [SHA(9002)])).toBeNull();
  });

  it.each(['check_notify', 'fix_to_developer', 'alert', 'weekly_summary'])(
    'answers suppressed for %s to a suppressed address, records it with no attempt, and never lets it go',
    async (kind) => {
      const hash = SHA(9100 + kind.length);
      await call('record_email_suppression', [hash, 'hard_bounce', T0]);
      const key = `s:${randomUUID()}`;
      expect(await claim(key, kind, hash, at(1))).toEqual({ outcome: 'suppressed' });
      expect(await claim(key, kind, hash, at(30))).toEqual({ outcome: 'suppressed' });
      expect(await rowOf(key)).toMatchObject({ status: 'suppressed', attempts: 0 });
    },
  );

  it.each(['trial_reminder', 'email_change_confirm', 'email_change_notice', 'account_delete'])(
    'lets account mail (%s) go to a suppressed address',
    async (kind) => {
      const hash = SHA(9200 + kind.length);
      await call('record_email_suppression', [hash, 'complaint', T0]);
      expect(await claim(`a:${randomUUID()}`, kind, hash, at(1))).toEqual({
        outcome: 'go',
        attempt: 1,
      });
    },
  );

  it('refuses a reason other than hard_bounce or complaint', async () => {
    await expect(call('record_email_suppression', [SHA(9300), 'soft_bounce', T0])).rejects.toThrow(
      /reason/,
    );
  });
});

describe('what the clients can reach', () => {
  it('grants anon and authenticated nothing on the three new tables', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select bool_or(has_table_privilege(r, t, 'select,insert,update,delete,truncate,references,trigger')) ok
         from unnest(array['anon', 'authenticated']) r,
              unnest(array['public.email_sends', 'public.email_suppressions', 'public.slack_sends']) t`,
    );
    expect(rows[0]!.ok).toBe(false);
  });

  it('lets no client role execute a function this migration adds', async () => {
    const fns = [
      ...readMigration(MIGRATION).matchAll(/create or replace function (public\.\w+)\(/g),
    ].map((m) => m[1]!);
    expect(fns.length).toBeGreaterThan(0);
    const { rows } = await db.query<{ fn: string; role: string }>(
      `select p.oid::regprocedure::text fn, r role
         from pg_proc p cross join unnest(array['anon', 'authenticated']) r
        where p.oid::regproc::text = any($1) and has_function_privilege(r, p.oid, 'execute')`,
      [fns],
    );
    expect(rows).toEqual([]);
  });

  it('keeps the address out of the ledger: no column holds text that is not a hash, key or code', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('email_sends', 'email_suppressions', 'slack_sends')
          and column_name ~ '(email|address|to|recipient|body|subject)$'`,
    );
    expect(rows).toEqual([]);
  });
});

describe('the account reference', () => {
  it('is set null, not cascaded, when an account goes', async () => {
    const { accountId } = await personalAccount(
      db,
      await signUp(db, `led-${randomUUID()}@example.com`),
    );
    const { key, hash } = fresh();
    await claim(key, 'alert', hash, T0, accountId);
    const { rows } = await db.query<{ confdeltype: string }>(
      `select confdeltype from pg_constraint
        where conrelid in ('public.email_sends'::regclass, 'public.slack_sends'::regclass) and contype = 'f'`,
    );
    expect(rows.map((r) => r.confdeltype)).toEqual(['n', 'n']);
  });
});

describe('the migration applies twice and its revert removes it', () => {
  it('re-applies, reverts twice, and re-applies again', async () => {
    const own = await freshDb();
    try {
      await applyAllMigrations(own);
      await own.exec(readMigration(MIGRATION));
      await own.exec(readRollback(ROLLBACK));
      await own.exec(readRollback(ROLLBACK));
      const { rows } = await own.query<{ n: number }>(
        `select count(*)::int n from pg_class where relname in ('email_sends', 'email_suppressions', 'slack_sends')`,
      );
      expect(rows[0]!.n).toBe(0);
      await own.exec(readMigration(MIGRATION));
    } finally {
      await own.close();
    }
  }, 300_000);

  it('the revert puts erase_rules back to 027b’s definition, character for character', async () => {
    const own = await freshDb();
    try {
      const upTo027b = (f: string) => f <= '20261112000002_v2_027b_account.sql';
      await applyAllMigrations(own, undefined, upTo027b);
      const before = await own.query<{ d: string }>(
        `select pg_get_functiondef('public.erase_rules()'::regprocedure) d`,
      );
      await own.exec(readMigration(MIGRATION));
      const during = await own.query<{ d: string }>(
        `select pg_get_functiondef('public.erase_rules()'::regprocedure) d`,
      );
      expect(during.rows[0]!.d).not.toBe(before.rows[0]!.d);
      await own.exec(readRollback(ROLLBACK));
      const after = await own.query<{ d: string }>(
        `select pg_get_functiondef('public.erase_rules()'::regprocedure) d`,
      );
      expect(after.rows[0]!.d).toBe(before.rows[0]!.d);
    } finally {
      await own.close();
    }
  }, 300_000);
});
