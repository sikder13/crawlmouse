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
 * Migration 20261115000001, section A (CC-33 D1, D2): operators, accounts.internal, is_operator(),
 * operator_actions and the three functions that write it, on PGlite with every migration applied.
 */

const MIGRATION = '20261115000001_v2_033_operations.sql';
const ROLLBACK = '20261115000001_v2_033_operations.revert.sql';
const FUNCTIONS = ['is_operator', 'operator_finish', 'operator_log', 'operator_request_check'];

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

/** The text between a file's `§A` marker and its `end §A` marker. */
function sectionA(sql: string): string {
  const start = sql.indexOf('═══ §A');
  const end = sql.indexOf('═══ end §A');
  if (start < 0 || end < start) throw new Error('no §A section');
  return sql.slice(sql.indexOf('\n', start) + 1, sql.lastIndexOf('\n', end));
}

const person = () => signUp(db, `ops-${randomUUID()}@example.com`);

async function operator(): Promise<string> {
  const id = await person();
  await db.query('insert into public.operators (user_id) values ($1)', [id]);
  return id;
}

async function site(accountId: string, extra: { paused_reason?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host, paused_reason) values ($1, $2, $3, $4)`,
    [id, accountId, `${id.slice(0, 8)}.example`, extra.paused_reason ?? null],
  );
  return id;
}

async function failedCheck(siteId: string, status = 'failed'): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                finished_at, failure_reason)
     values ($1, $2, $3, 'scheduled', '2.0.0', now() - interval '3 hours',
             case when $3 = 'failed' then now() - interval '3 hours' end,
             case when $3 = 'failed' then now() - interval '3 hours' end,
             case when $3 = 'failed' then 'internal' end)`,
    [id, siteId, status],
  );
  return id;
}

/** A check row as requestCheck passes it to insertQueued. */
function row(siteId: string, id = randomUUID()) {
  const at = new Date().toISOString();
  return {
    id,
    site_id: siteId,
    trigger: 'manual',
    grade_version: '2.0.0',
    queued_at: at,
    heartbeat_at: at,
    expires_at: null,
  };
}

const slot = (limit = 1000) => ({
  bucket: `test:${randomUUID()}`,
  window_start: '2026-11-10T00:00:00.000Z',
  limit,
});

/** Calls a function as the service role, as the console's admin client does. */
async function call<T>(fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await asRole(db, 'service_role', null, (tx) =>
    tx.query<{ r: T }>(
      `select public.${fn}(${placeholders}) as r`,
      args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)),
    ),
  );
  return rows[0]!.r;
}

type Action = {
  id: number;
  operator_id: string;
  action: string;
  account_id: string | null;
  target: string | null;
  reason: string | null;
  outcome: string | null;
};

async function actionsOf(operatorId: string): Promise<Action[]> {
  const { rows } = await db.query<Action>(
    `select id::int as id, operator_id, action, account_id, target, reason, outcome
       from public.operator_actions where operator_id = $1 order by id`,
    [operatorId],
  );
  return rows;
}

describe('operators', () => {
  it.each(['anon', 'authenticated'] as const)('%s cannot read or write it', async (role) => {
    const op = await operator();
    for (const sql of [
      'select * from public.operators',
      `insert into public.operators (user_id) values ('${randomUUID()}')`,
      `delete from public.operators where user_id = '${op}'`,
    ]) {
      await expect(asRole(db, role, op, (tx) => tx.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('the service role reads, adds and removes a row, and cannot rewrite one', async () => {
    const id = await person();
    await asRole(db, 'service_role', null, async (tx) => {
      await tx.query('insert into public.operators (user_id) values ($1)', [id]);
      const { rows } = await tx.query('select user_id from public.operators where user_id = $1', [
        id,
      ]);
      expect(rows).toEqual([{ user_id: id }]);
      await tx.query('delete from public.operators where user_id = $1', [id]);
    });
    await expect(
      asRole(db, 'service_role', null, (tx) =>
        tx.query('update public.operators set added_at = now() where user_id = $1', [id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('holds no reference to users, so deleting an operator user is not blocked by it', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where conrelid = 'public.operators'::regclass and contype = 'f'`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe('accounts.internal', () => {
  it('is false for a new account', async () => {
    const { accountId } = await personalAccount(db, await person());
    const { rows } = await db.query('select internal from public.accounts where id = $1', [
      accountId,
    ]);
    expect(rows).toEqual([{ internal: false }]);
  });

  it('a member cannot read it on their own account; anon cannot either', async () => {
    const userId = await person();
    const { accountId } = await personalAccount(db, userId);
    // The member reads a granted column of the same row, so the refusal below is the column's.
    const ok = await asRole(db, 'authenticated', userId, (tx) =>
      tx.query('select state from public.accounts where id = $1', [accountId]),
    );
    expect(ok.rows).toHaveLength(1);
    for (const role of ['authenticated', 'anon'] as const) {
      await expect(
        asRole(db, role, userId, (tx) =>
          tx.query('select internal from public.accounts where id = $1', [accountId]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('the service role sets it', async () => {
    const { accountId } = await personalAccount(db, await person());
    await asRole(db, 'service_role', null, (tx) =>
      tx.query('update public.accounts set internal = true where id = $1', [accountId]),
    );
    const { rows } = await db.query('select internal from public.accounts where id = $1', [
      accountId,
    ]);
    expect(rows).toEqual([{ internal: true }]);
  });
});

describe('is_operator()', () => {
  const ask = (role: 'anon' | 'authenticated' | 'service_role', userId: string | null) =>
    asRole(db, role, userId, async (tx) => {
      const { rows } = await tx.query<{ r: boolean }>('select public.is_operator() as r');
      return rows[0]!.r;
    });

  it("answers true for an operator's own session", async () => {
    expect(await ask('authenticated', await operator())).toBe(true);
  });

  it('answers false for a signed-in user who is not an operator, a member of an account included', async () => {
    const userId = await person();
    await personalAccount(db, userId);
    expect(await ask('authenticated', userId)).toBe(false);
  });

  it('answers false with no session', async () => {
    expect(await ask('authenticated', null)).toBe(false);
  });

  it('anon may not execute it', async () => {
    await expect(ask('anon', null)).rejects.toThrow(/permission denied/);
  });

  it('is security definer with the allowed search_path', async () => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      `select prosecdef, proconfig from pg_proc where proname = 'is_operator'`,
    );
    expect(rows).toEqual([
      { prosecdef: true, proconfig: ['search_path=pg_catalog, public, pg_temp'] },
    ]);
  });
});

describe('operator_actions', () => {
  it.each(['anon', 'authenticated'] as const)('%s cannot read or write it', async (role) => {
    const op = await operator();
    for (const sql of [
      'select * from public.operator_actions',
      `insert into public.operator_actions (operator_id, action) values ('${op}', 'search')`,
    ]) {
      await expect(asRole(db, role, op, (tx) => tx.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('the service role reads and adds rows, and cannot change or delete one', async () => {
    const op = await operator();
    const id = await call<number>('operator_log', [op, 'search', null, 'email', null]);
    for (const sql of [
      `update public.operator_actions set reason = 'x' where id = ${Number(id)}`,
      `update public.operator_actions set outcome = 'x' where id = ${Number(id)}`,
      `delete from public.operator_actions where id = ${Number(id)}`,
    ]) {
      await expect(asRole(db, 'service_role', null, (tx) => tx.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    }
    expect(await actionsOf(op)).toHaveLength(1);
  });

  it('refuses an address in any text column', async () => {
    const op = await operator();
    const at = ['someone', 'example.com'].join('@');
    for (const col of ['target', 'reason', 'outcome']) {
      await expect(
        db.query(
          `insert into public.operator_actions (operator_id, action, ${col}) values ($1, 'search', $2)`,
          [op, at],
        ),
      ).rejects.toThrow(/check constraint/);
    }
  });

  it('holds no reference to accounts, so the record outlives a purged account', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where conrelid = 'public.operator_actions'::regclass and contype = 'f'`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe('operator_log', () => {
  it('writes one row, as given, and answers its id', async () => {
    const op = await operator();
    const { accountId } = await personalAccount(db, await person());
    const id = await call<number>('operator_log', [op, 'view_account', accountId, accountId, null]);
    expect(await actionsOf(op)).toEqual([
      {
        id: Number(id),
        operator_id: op,
        action: 'view_account',
        account_id: accountId,
        target: accountId,
        reason: null,
        outcome: null,
      },
    ]);
  });

  it('refuses a caller who is not an operator, and writes nothing', async () => {
    const someone = await person();
    await expect(call('operator_log', [someone, 'search', null, 'email', null])).rejects.toThrow(
      /not an operator/,
    );
    expect(await actionsOf(someone)).toEqual([]);
  });

  it('refuses rerun_check, which only operator_request_check records', async () => {
    const op = await operator();
    await expect(
      call('operator_log', [op, 'rerun_check', null, randomUUID(), 'x']),
    ).rejects.toThrow(/operator_request_check/);
    expect(await actionsOf(op)).toEqual([]);
  });

  it.each(['anon', 'authenticated'] as const)('%s may not execute it', async (role) => {
    const op = await operator();
    await expect(
      asRole(db, role, op, (tx) =>
        tx.query(`select public.operator_log($1, 'search', null, 'email', null)`, [op]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('operator_request_check', () => {
  const request = (
    op: string,
    target: string,
    r: ReturnType<typeof row>,
    cap = 2,
    reason = 'customer asked',
  ) => call<{ outcome: string }>('operator_request_check', [op, target, reason, r, cap, slot()]);

  it('queues the check and writes one rerun_check row with the outcome, in the same call', async () => {
    const op = await operator();
    const { accountId } = await personalAccount(db, await person());
    const s = await site(accountId);
    const failed = await failedCheck(s);
    const r = row(s);
    expect(await request(op, failed, r)).toEqual({ outcome: 'created' });
    const { rows } = await db.query('select status from public.checks where id = $1', [r.id]);
    expect(rows).toEqual([{ status: 'queued' }]);
    expect(await actionsOf(op)).toEqual([
      expect.objectContaining({
        action: 'rerun_check',
        account_id: accountId,
        target: failed,
        reason: 'customer asked',
        outcome: 'created',
      }),
    ]);
  });

  it('a capped request writes one row too, with the outcome capped, and no check', async () => {
    const op = await operator();
    const { accountId } = await personalAccount(db, await person());
    const s = await site(accountId);
    const failed = await failedCheck(s);
    await db.query(
      `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                  finished_at, failure_reason)
       values ($1, $2, 'failed', 'manual', '2.0.0', now() - interval '1 hour',
               now() - interval '1 hour', now(), 'internal')`,
      [randomUUID(), s],
    );
    const r = row(s);
    expect((await request(op, failed, r, 1)).outcome).toBe('capped');
    const { rows } = await db.query('select 1 from public.checks where id = $1', [r.id]);
    expect(rows).toEqual([]);
    const actions = await actionsOf(op);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action: 'rerun_check', outcome: 'capped' });
  });

  it('a paused site writes one row with the outcome paused', async () => {
    const op = await operator();
    const { accountId } = await personalAccount(db, await person());
    const s = await site(accountId, { paused_reason: 'user' });
    const failed = await failedCheck(s);
    expect((await request(op, failed, row(s))).outcome).toBe('paused');
    expect((await actionsOf(op)).map((a) => a.outcome)).toEqual(['paused']);
  });

  it('refuses a target that did not fail, or is another site’s, and writes nothing', async () => {
    const op = await operator();
    const { accountId } = await personalAccount(db, await person());
    const s = await site(accountId);
    const other = await site(accountId);
    const queued = await failedCheck(s, 'queued');
    const elsewhere = await failedCheck(other);
    for (const target of [queued, elsewhere, randomUUID()]) {
      const r = row(s);
      await expect(request(op, target, r)).rejects.toThrow(/not a failed check of this site/);
      const { rows } = await db.query('select 1 from public.checks where id = $1', [r.id]);
      expect(rows).toEqual([]);
    }
    expect(await actionsOf(op)).toEqual([]);
  });

  it('refuses a caller who is not an operator, and queues nothing', async () => {
    const someone = await person();
    const { accountId } = await personalAccount(db, someone);
    const s = await site(accountId);
    const failed = await failedCheck(s);
    const r = row(s);
    await expect(request(someone, failed, r)).rejects.toThrow(/not an operator/);
    const { rows } = await db.query('select 1 from public.checks where id = $1', [r.id]);
    expect(rows).toEqual([]);
  });

  it.each(['anon', 'authenticated'] as const)('%s may not execute it', async (role) => {
    const op = await operator();
    await expect(
      asRole(db, role, op, (tx) =>
        tx.query(`select public.operator_request_check($1, $2, 'x', '{}'::jsonb, 1, '{}'::jsonb)`, [
          op,
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('operator_finish', () => {
  it('sets the outcome of a resend_sign_in row once, and never again', async () => {
    const op = await operator();
    const { accountId } = await personalAccount(db, await person());
    const id = await call<number>('operator_log', [
      op,
      'resend_sign_in',
      accountId,
      randomUUID(),
      'locked out',
    ]);
    expect(await call<boolean>('operator_finish', [id, 'sent'])).toBe(true);
    expect(await call<boolean>('operator_finish', [id, 'refused'])).toBe(false);
    expect((await actionsOf(op)).map((a) => a.outcome)).toEqual(['sent']);
  });

  it('leaves any other action alone, and refuses an outcome it does not know', async () => {
    const op = await operator();
    const id = await call<number>('operator_log', [op, 'search', null, 'email', null]);
    expect(await call<boolean>('operator_finish', [id, 'sent'])).toBe(false);
    const resend = await call<number>('operator_log', [
      op,
      'resend_sign_in',
      null,
      randomUUID(),
      'x',
    ]);
    await expect(call('operator_finish', [resend, 'whatever'])).rejects.toThrow(/outcome/);
    expect((await actionsOf(op)).map((a) => a.outcome)).toEqual([null, null]);
  });

  it.each(['anon', 'authenticated'] as const)('%s may not execute it', async (role) => {
    await expect(
      asRole(db, role, null, (tx) => tx.query(`select public.operator_finish(1, 'sent')`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('the section applies twice and its revert removes it', () => {
  async function definitions(d: PGlite) {
    return (
      await d.query<{ proname: string; def: string }>(
        `select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by p.proname`,
        [FUNCTIONS],
      )
    ).rows;
  }
  const present = async (d: PGlite) =>
    (
      await d.query<{ n: number }>(
        `select ((select count(*) from pg_proc where proname = any($1))
               + (select count(*) from pg_tables
                   where tablename in ('operators', 'operator_actions'))
               + (select count(*) from information_schema.columns
                   where table_name = 'accounts' and column_name = 'internal'))::int as n`,
        [FUNCTIONS],
      )
    ).rows[0]!.n;

  it('the migration file applied again leaves the functions as they were', async () => {
    const before = await definitions(db);
    expect(before.map((d) => d.proname)).toEqual(FUNCTIONS);
    await db.exec(readMigration(MIGRATION));
    expect(await definitions(db)).toEqual(before);
  });

  it('the revert section drops everything it adds, twice, and the migration re-applies', async () => {
    const own = await freshDb();
    try {
      await applyAllMigrations(own);
      const before = await definitions(own);
      expect(await present(own)).toBe(FUNCTIONS.length + 3);
      const revert = sectionA(readRollback(ROLLBACK));
      await own.exec(revert);
      expect(await present(own)).toBe(0);
      await own.exec(revert);
      expect(await present(own)).toBe(0);
      await own.exec(readMigration(MIGRATION));
      expect(await definitions(own)).toEqual(before);
    } finally {
      await own.close();
    }
  }, 300_000);
});
