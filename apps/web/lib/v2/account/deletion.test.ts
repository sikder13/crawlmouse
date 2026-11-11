import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { FIX_EMAIL_REQUESTS } from '../../../__tests__/helpers/v2-027b-standins';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import {
  BAN_ATTEMPTS,
  confirmDeletion,
  requestAccountDeletion,
  restoreAccount,
  type DeletionEvent,
  type DeletionPorts,
} from './deletion';
import type { AccountEmailEvent } from './emails';

/**
 * The deletion's three steps over the real SQL (PGlite, every migration) and recording ports for
 * what SQL cannot do: the Auth ban, Inngest, the emails and the events.
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await db.exec(FIX_EMAIL_REQUESTS);
}, 300_000);
afterAll(async () => db.close());

/** A service-role RPC over PGlite, with PostgREST's named arguments. */
const rpc: DeletionPorts['rpc'] = async <T>(fn: string, args: Record<string, unknown>) => {
  const names = Object.keys(args);
  const { rows } = await db.query<{ r: T }>(
    `select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`,
    names.map((k) => args[k]),
  );
  return rows[0]!.r;
};

function recorder(over: Partial<DeletionPorts> = {}) {
  const log: string[] = [];
  const events: DeletionEvent[] = [];
  const emails: AccountEmailEvent[] = [];
  const captured: Array<[string, string, unknown]> = [];
  const reported: Array<[string, string]> = [];
  let now = new Date();
  const ports: DeletionPorts = {
    rpc: async (fn, args) => {
      log.push(`rpc:${fn}`);
      return rpc(fn, args);
    },
    auth: {
      async ban(id) {
        log.push(`ban:${id}`);
        banned.add(id);
      },
      async unban(id) {
        log.push(`unban:${id}`);
        banned.delete(id);
      },
    },
    async send(e) {
      log.push(`send:${e.map((x) => x.name).join(',')}`);
      events.push(...e);
    },
    async sendEmails(e) {
      log.push('email');
      emails.push(...e);
    },
    async capture(event, accountId, properties) {
      captured.push([event, accountId, properties]);
    },
    rateLimit: async () => true,
    report: (error, userId) => reported.push([String(error), userId]),
    now: () => now,
    ...over,
  };
  return {
    ports,
    log,
    events,
    emails,
    captured,
    reported,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

/** Who the fake Auth admin has banned, across every recorder in this file. */
const banned = new Set<string>();

let serial = 0;
async function owner() {
  const email = `dm-${++serial}@example.com`;
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  await db.query(`insert into public.sites (account_id, host) values ($1, $2)`, [
    accountId,
    `dm-${serial}.example`,
  ]);
  return { userId, accountId, host: `dm-${serial}.example` };
}

/** The raw tokens of the deletion email, as CC-28's mailer issues them from the one row it names. */
async function links(email: AccountEmailEvent) {
  const { rows } = await db.query<{ kind: string; token: string }>(
    `select kind, token from public.issue_account_link($1)`,
    [email.data.tokenId],
  );
  const out = Object.fromEntries(rows.map((r) => [r.kind, r.token]));
  return out as { delete_confirm: string; delete_restore: string };
}

const marked = async (accountId: string) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int n from public.accounts where id = $1 and deletion_confirmed_at is not null`,
      [accountId],
    )
  ).rows[0]!.n === 1;

describe('requestAccountDeletion', () => {
  it('emails one account_delete naming the confirmation row only, which issues both links, and records the event', async () => {
    const o = await owner();
    const rec = recorder();
    expect(
      await requestAccountDeletion(rec.ports, {
        userId: o.userId,
        accountId: o.accountId,
        hostname: o.host.toUpperCase(),
        ip: '203.0.113.9',
      }),
    ).toEqual({ ok: true });
    expect(rec.emails).toHaveLength(1);
    expect(rec.emails[0]!.data).toMatchObject({
      accountId: o.accountId,
      template: 'account_delete',
    });
    const confirmRow = await db.query<{ id: string }>(
      `select id from public.account_tokens where user_id = $1 and kind = 'delete_confirm'`,
      [o.userId],
    );
    expect(rec.emails[0]!.data.tokenId).toBe(confirmRow.rows[0]!.id);
    expect(JSON.stringify(rec.emails)).not.toMatch(/@|[A-Za-z0-9_-]{43}/);
    expect(rec.captured).toEqual([['account_deletion_requested', o.accountId, { tier: 'free' }]]);
    const l = await links(rec.emails[0]!);
    expect(Object.keys(l).sort()).toEqual(['delete_confirm', 'delete_restore']);
  });

  it('maps each refusal to its status, and sends nothing', async () => {
    const o = await owner();
    const rec = recorder();
    expect(
      await requestAccountDeletion(rec.ports, {
        userId: o.userId,
        accountId: o.accountId,
        hostname: 'other.example',
        ip: null,
      }),
    ).toEqual({ ok: false, status: 422, code: 'hostname_mismatch' });
    expect(rec.emails).toEqual([]);
    expect(rec.captured).toEqual([]);
  });

  it('is limited per person and per address, with the user id ending the person’s bucket, before any write', async () => {
    const o = await owner();
    const buckets: string[] = [];
    const limited = (deny: string) =>
      recorder({
        rateLimit: async (bucket, limit) => {
          buckets.push(`${bucket}#${limit}`);
          return !bucket.includes(deny);
        },
      });
    const input = {
      userId: o.userId,
      accountId: o.accountId,
      hostname: o.host,
      ip: '198.51.100.4',
    };
    for (const deny of [':user:', ':ip:']) {
      const rec = limited(deny);
      expect(await requestAccountDeletion(rec.ports, input)).toEqual({
        ok: false,
        status: 429,
        code: 'rate_limited',
      });
      expect(rec.log).toEqual([]);
    }
    expect(buckets).toEqual([
      `account:delete:user:${o.userId}#3`,
      `account:delete:user:${o.userId}#3`,
      'account:delete:ip:198.51.100.4#10',
    ]);
  });
});

describe('confirmDeletion', () => {
  async function requested() {
    const o = await owner();
    const rec = recorder();
    await requestAccountDeletion(rec.ports, {
      userId: o.userId,
      accountId: o.accountId,
      hostname: o.host,
      ip: null,
    });
    return { o, ...(await links(rec.emails[0]!)) };
  }

  it('confirms in SQL, then bans while the database says so, then sends one deletion_confirmed per account', async () => {
    const { o, delete_confirm } = await requested();
    const rec = recorder();
    expect(await confirmDeletion(rec.ports, delete_confirm)).toEqual({ ok: true });
    expect(rec.log).toEqual([
      'rpc:confirm_account_deletion',
      'rpc:erasure_pending',
      `ban:${o.userId}`,
      'rpc:erasure_pending',
      'send:account.deletion_confirmed',
    ]);
    expect(rec.events).toEqual([
      { name: 'account.deletion_confirmed', data: { userId: o.userId, accountId: o.accountId } },
    ]);
    expect(rec.captured).toEqual([
      ['account_deletion_confirmed', o.accountId, { tier: 'free', accounts: 1 }],
    ]);
    expect(await marked(o.accountId)).toBe(true);
    expect(await confirmDeletion(recorder().ports, delete_confirm)).toEqual({
      ok: false,
      status: 410,
      code: 'invalid_link',
    });
  });

  it('a restore token posted to confirm is refused and bans no one', async () => {
    const { o, delete_restore } = await requested();
    const rec = recorder();
    expect(await confirmDeletion(rec.ports, delete_restore)).toEqual({
      ok: false,
      status: 410,
      code: 'invalid_link',
    });
    expect(rec.log).toEqual(['rpc:confirm_account_deletion']);
    expect(await marked(o.accountId)).toBe(false);
  });

  it('retries the ban twice, then reports the user id only and still answers done', async () => {
    const { o, delete_confirm } = await requested();
    let calls = 0;
    const rec = recorder({
      auth: {
        ban: async () => {
          calls++;
          throw new Error('Auth admin 503');
        },
        unban: async () => {},
      },
    });
    expect(await confirmDeletion(rec.ports, delete_confirm)).toEqual({ ok: true });
    expect(calls).toBe(BAN_ATTEMPTS);
    expect(rec.reported).toEqual([['Error: Auth admin 503', o.userId]]);
    expect(rec.events).toHaveLength(1);
  });
});

describe('confirmDeletion’s Inngest send', () => {
  it('is retried within the request, and reported with the user id only once three tries fail', async () => {
    for (const failures of [2, 3]) {
      const o = await owner();
      const rec = recorder();
      await requestAccountDeletion(rec.ports, {
        userId: o.userId,
        accountId: o.accountId,
        hostname: o.host,
        ip: null,
      });
      const l = await links(rec.emails[0]!);
      let left = failures;
      const flaky = recorder({
        send: async (e) => {
          if (left-- > 0) throw new Error('inngest 502');
          flaky.events.push(...e);
        },
      });
      expect(await confirmDeletion(flaky.ports, l.delete_confirm)).toEqual({ ok: true });
      expect(flaky.events).toHaveLength(failures < 3 ? 1 : 0);
      expect(flaky.reported).toEqual(failures < 3 ? [] : [['Error: inngest 502', o.userId]]);
    }
  });
});

describe('restoreAccount', () => {
  async function confirmed() {
    const o = await owner();
    const rec = recorder();
    await requestAccountDeletion(rec.ports, {
      userId: o.userId,
      accountId: o.accountId,
      hostname: o.host,
      ip: null,
    });
    const l = await links(rec.emails[0]!);
    await confirmDeletion(recorder().ports, l.delete_confirm);
    return { o, ...l };
  }

  it('restores in SQL first, then lifts the ban, and asks to resume only what the deletion stopped', async () => {
    const { o, delete_restore } = await confirmed();
    await db.query(`select public.record_deletion_cancel($1, $2, 'sub_ours', true)`, [
      o.userId,
      o.accountId,
    ]);
    const rec = recorder();
    expect(await restoreAccount(rec.ports, delete_restore)).toEqual({ ok: true });
    expect(rec.log).toEqual([
      'rpc:read_deletion_link',
      'rpc:restore_account',
      'rpc:erasure_pending',
      `unban:${o.userId}`,
      'send:account.restored',
    ]);
    expect(rec.events).toEqual([
      { name: 'account.restored', data: { userId: o.userId, subscriptionIds: ['sub_ours'] } },
    ]);
    expect(rec.captured).toEqual([['account_restored', o.accountId, { tier: 'free' }]]);
    expect(await marked(o.accountId)).toBe(false);
    expect(banned.has(o.userId)).toBe(false);
  });

  it('after the window, changes no ban and restores nothing', async () => {
    const { o, delete_restore } = await confirmed();
    const rec = recorder();
    rec.setNow(new Date(Date.now() + 7 * 86_400_000 + 60_000));
    expect(await restoreAccount(rec.ports, delete_restore)).toEqual({
      ok: false,
      status: 410,
      code: 'window_closed',
    });
    expect(rec.log).toEqual(['rpc:read_deletion_link']);
    expect(await marked(o.accountId)).toBe(true);
    expect(banned.has(o.userId)).toBe(true);
  });

  it('two restores at once: one restores, the other is refused, and the person ends unbanned', async () => {
    const { o, delete_restore } = await confirmed();
    expect(banned.has(o.userId)).toBe(true);
    const answers = await Promise.all([
      restoreAccount(recorder().ports, delete_restore),
      restoreAccount(recorder().ports, delete_restore),
    ]);
    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    expect(await marked(o.accountId)).toBe(false);
    expect(banned.has(o.userId)).toBe(false);
  });

  it('a restore whose answer is lost after it committed still unbans', async () => {
    const { o, delete_restore } = await confirmed();
    const lost = recorder({
      rpc: async (fn, args) => {
        const r = await rpc(fn, args);
        if (fn === 'restore_account') throw new Error('connection reset');
        return r;
      },
    });
    expect(await restoreAccount(lost.ports, delete_restore)).toEqual({ ok: true });
    expect(await marked(o.accountId)).toBe(false);
    expect(banned.has(o.userId)).toBe(false);
  });

  it('a restore that failed before it committed leaves the ban and the token usable', async () => {
    const { o, delete_restore } = await confirmed();
    const failing = recorder({
      rpc: async (fn, args) => {
        if (fn === 'restore_account') throw new Error('connection reset');
        return rpc(fn, args);
      },
    });
    await expect(restoreAccount(failing.ports, delete_restore)).rejects.toThrow(/connection reset/);
    expect(await marked(o.accountId)).toBe(true);
    expect(banned.has(o.userId)).toBe(true);
    expect(await restoreAccount(recorder().ports, delete_restore)).toEqual({ ok: true });
    expect(banned.has(o.userId)).toBe(false);
  });

  it('a confirm whose ban lands after a fast restore leaves the person unbanned', async () => {
    const o = await owner();
    const rec = recorder();
    await requestAccountDeletion(rec.ports, {
      userId: o.userId,
      accountId: o.accountId,
      hostname: o.host,
      ip: null,
    });
    const l = await links(rec.emails[0]!);
    const slow = recorder();
    const realBan = slow.ports.auth.ban;
    slow.ports.auth.ban = async (id) => {
      // The person restores between the confirm's SQL and its ban.
      expect(await restoreAccount(recorder().ports, l.delete_restore)).toEqual({ ok: true });
      await realBan(id);
    };
    expect(await confirmDeletion(slow.ports, l.delete_confirm)).toEqual({ ok: true });
    expect(await marked(o.accountId)).toBe(false);
    expect(banned.has(o.userId)).toBe(false);
  });

  it('a confirmation token posted to restore is refused', async () => {
    const { delete_confirm } = await confirmed();
    expect(await restoreAccount(recorder().ports, delete_confirm)).toEqual({
      ok: false,
      status: 410,
      code: 'invalid_link',
    });
  });
});
