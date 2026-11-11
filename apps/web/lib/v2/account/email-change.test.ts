import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import type { AccountEmailEvent } from './emails';
import {
  confirmEmailChange,
  requestEmailChange,
  undoEmailChange,
  type EmailChangePorts,
} from './email-change';
import { hashToken, newToken } from './tokens';

/**
 * The email change's three steps over their ports. The `rpc` port is the PostgREST stand-in over
 * the migrated schema, so section A's SQL runs for real; Auth, the mailer, the event sender, the
 * rate limit and the error reporter are recorders.
 */

let db: PGlite;

// Applying every migration to a fresh PGlite takes several seconds, more under a parallel run.
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);
afterAll(async () => db.close());

let n = 0;
async function person() {
  n += 1;
  const email = `owner${n}@example.com`;
  const userId = await signUp(db, email);
  const { accountId, seatId } = await personalAccount(db, userId);
  return { userId, accountId, seatId, email };
}

interface Recorded {
  emails: AccountEmailEvent[];
  captured: [string, string, unknown][];
  auth: string[];
  buckets: string[];
  reports: [string, Record<string, string>][];
}

function ports(over: Partial<EmailChangePorts> = {}): { ports: EmailChangePorts; rec: Recorded } {
  const rec: Recorded = { emails: [], captured: [], auth: [], buckets: [], reports: [] };
  const sb = postgrestOver(db);
  return {
    rec,
    ports: {
      rpc: (fn, args) => sb.rpc(fn, args),
      auth: {
        async updateEmail(userId, email) {
          rec.auth.push(`update ${userId} ${email}`);
          await db.query(`update auth.users set email = $2 where id = $1`, [userId, email]);
          return 'ok';
        },
        async deleteUser(userId) {
          rec.auth.push(`delete ${userId}`);
          await db.query(`delete from auth.users where id = $1`, [userId]);
        },
      },
      sendEmails: async (events) => {
        rec.emails.push(...events);
      },
      capture: async (event, accountId, properties) => {
        rec.captured.push([event, accountId, properties]);
      },
      rateLimit: async (bucket) => {
        rec.buckets.push(bucket);
        return true;
      },
      report: (signal, extra) => {
        rec.reports.push([signal, { ...extra }]);
      },
      now: () => new Date(),
      ...over,
    },
  };
}

/** The raw token the mailer would issue for a link row (CC-28's `issue_account_link`). */
async function rawOf(tokenId: string): Promise<string> {
  const { rows } = await db.query<{ token: string }>(
    `select token from public.issue_account_link($1)`,
    [tokenId],
  );
  return rows[0]!.token;
}

async function sessions(userId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select id from auth.sessions where user_id = $1 order by id`,
    [userId],
  );
  return rows.map((r) => r.id);
}

async function addSessions(userId: string, ids: string[]) {
  for (const id of ids)
    await db.query(`insert into auth.sessions (id, user_id) values ($1, $2)`, [id, userId]);
}

const emailOf = async (userId: string) =>
  (await db.query<{ email: string }>(`select email from public.users where id = $1`, [userId]))
    .rows[0]!.email;

/** Requests and confirms a change; returns the confirm link's and the undo link's raw tokens. */
async function changed(p: Awaited<ReturnType<typeof person>>, to: string) {
  const a = ports();
  expect(
    await requestEmailChange(a.ports, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: to,
      ip: '203.0.113.9',
    }),
  ).toEqual({ ok: true });
  const confirm = await rawOf(a.rec.emails[0]!.data.tokenId);
  const undo = await rawOf(a.rec.emails[1]!.data.tokenId);
  expect(await confirmEmailChange(ports().ports, { token: confirm, caller: null })).toEqual({
    ok: true,
  });
  return { confirm, undo };
}

describe('requestEmailChange', () => {
  it('counts the request per person and per hashed address, and emails both addresses at once', async () => {
    const p = await person();
    const { ports: pp, rec } = ports();
    const out = await requestEmailChange(pp, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: '  New.Address@Example.ORG ',
      ip: '203.0.113.9',
    });
    expect(out).toEqual({ ok: true });
    // printf '%s' '203.0.113.9' | sha256sum
    const ipHash = 'd861b7e91033ebc1c1e8e7af3929010158b3241b54ca87ef73e79c32f26400ec';
    expect(rec.buckets).toEqual([`account-email:user:${p.userId}`, `account-email:ip:${ipHash}`]);
    expect(rec.emails.map((e) => [e.data.template, e.data.accountId])).toEqual([
      ['email_change_confirm', p.accountId],
      ['email_change_notice', p.accountId],
    ]);
    const { rows } = await db.query<{ kind: string; new_email: string; old_email: string }>(
      `select kind, new_email, old_email from public.account_tokens where id = any($1) order by kind`,
      [rec.emails.map((e) => e.data.tokenId)],
    );
    expect(rows).toEqual([
      { kind: 'email_change', new_email: 'new.address@example.org', old_email: p.email },
      { kind: 'email_change_undo', new_email: 'new.address@example.org', old_email: p.email },
    ]);
    expect(JSON.stringify(rec.emails)).not.toContain('example.org');
  });

  it('answers the same whether or not the new address is in use', async () => {
    const holder = await person();
    // Two people, one request each: a person has one change in flight at a time.
    const ask = async (newEmail: string) => {
      const p = await person();
      const { ports: pp, rec } = ports();
      const out = await requestEmailChange(pp, {
        accountId: p.accountId,
        userId: p.userId,
        currentEmail: p.email,
        newEmail,
        ip: '203.0.113.9',
      });
      return [out, rec.emails.map((e) => e.data.template)];
    };
    const free = await ask('nobody-has-this@example.org');
    const taken = await ask(holder.email);
    expect(taken).toEqual(free);
  });

  it('refuses a malformed or overlong address before counting it', async () => {
    const p = await person();
    for (const newEmail of ['not-an-address', `${'a'.repeat(250)}@x.io`, 42]) {
      const { ports: pp, rec } = ports();
      expect(
        await requestEmailChange(pp, {
          accountId: p.accountId,
          userId: p.userId,
          currentEmail: p.email,
          newEmail,
          ip: '203.0.113.9',
        }),
      ).toEqual({ ok: false, status: 400, code: 'invalid_email' });
      expect(rec.buckets).toEqual([]);
    }
  });

  it('refuses the current address, in any case', async () => {
    const p = await person();
    const { ports: pp, rec } = ports();
    expect(
      await requestEmailChange(pp, {
        accountId: p.accountId,
        userId: p.userId,
        currentEmail: p.email,
        newEmail: p.email.toUpperCase(),
        ip: '203.0.113.9',
      }),
    ).toEqual({ ok: false, status: 400, code: 'same_address' });
    expect(rec.emails).toEqual([]);
  });

  it('refuses with 429 when either daily limit is spent, and sends nothing', async () => {
    const p = await person();
    for (const spent of ['account-email:user:', 'account-email:ip:']) {
      const { ports: pp, rec } = ports({
        rateLimit: async (bucket) => !bucket.startsWith(spent),
      });
      expect(
        await requestEmailChange(pp, {
          accountId: p.accountId,
          userId: p.userId,
          currentEmail: p.email,
          newEmail: 'limited@example.org',
          ip: '203.0.113.9',
        }),
      ).toEqual({ ok: false, status: 429, code: 'rate_limited' });
      expect(rec.emails).toEqual([]);
    }
  });

  it('refuses with 409 deletion_pending while the person’s deletion is under way, and sends nothing', async () => {
    const p = await person();
    await db.query(
      `select public.create_account_token($1, $2, 'delete_confirm', now() + interval '1 hour')`,
      [p.accountId, p.userId],
    );
    const { ports: pp, rec } = ports();
    expect(
      await requestEmailChange(pp, {
        accountId: p.accountId,
        userId: p.userId,
        currentEmail: p.email,
        newEmail: 'while-deleting@example.org',
        ip: '203.0.113.9',
      }),
    ).toEqual({ ok: false, status: 409, code: 'deletion_pending' });
    expect(rec.emails).toEqual([]);
  });

  it('refuses a second change while the first one’s undo link is live', async () => {
    const p = await person();
    await changed(p, 'first@example.org');
    expect(
      await requestEmailChange(ports().ports, {
        accountId: p.accountId,
        userId: p.userId,
        currentEmail: 'first@example.org',
        newEmail: 'second@example.org',
        ip: '203.0.113.9',
      }),
    ).toEqual({ ok: false, status: 409, code: 'email_change_pending' });
  });
});

describe('confirmEmailChange', () => {
  it('moves Auth and the rows, and ends the other sessions but the confirming one', async () => {
    const p = await person();
    const a = ports();
    await requestEmailChange(a.ports, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: 'confirmed@example.org',
      ip: '203.0.113.9',
    });
    const raw = await rawOf(a.rec.emails[0]!.data.tokenId);
    const mine = '00000000-0000-4000-8000-00000000000a';
    const other = '00000000-0000-4000-8000-00000000000b';
    await addSessions(p.userId, [mine, other]);

    const { ports: pp, rec } = ports();
    expect(
      await confirmEmailChange(pp, {
        token: raw,
        caller: { userId: p.userId, sessionId: mine },
      }),
    ).toEqual({ ok: true });
    expect(rec.auth).toEqual([`update ${p.userId} confirmed@example.org`]);
    expect(await emailOf(p.userId)).toBe('confirmed@example.org');
    expect(await sessions(p.userId)).toEqual([mine]);
    expect(rec.captured).toEqual([['account_email_changed', p.accountId, { tier: 'free' }]]);
    // The old address was told at the request; a second notice would re-issue its link.
    expect(rec.emails).toEqual([]);
  });

  it('ends every session when the confirming browser is not signed in as the person', async () => {
    const p = await person();
    const stranger = await person();
    const a = ports();
    await requestEmailChange(a.ports, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: 'elsewhere@example.org',
      ip: '203.0.113.9',
    });
    const raw = await rawOf(a.rec.emails[0]!.data.tokenId);
    const s1 = '00000000-0000-4000-8000-0000000000c1';
    await addSessions(p.userId, [s1]);
    expect(
      await confirmEmailChange(ports().ports, {
        token: raw,
        caller: { userId: stranger.userId, sessionId: s1 },
      }),
    ).toEqual({ ok: true });
    expect(await sessions(p.userId)).toEqual([]);
  });

  it('accepts its link once, and refuses an expired one', async () => {
    const p = await person();
    const { confirm } = await changed(p, 'used@example.org');
    expect(await confirmEmailChange(ports().ports, { token: confirm, caller: null })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });

    const q = await person();
    const a = ports();
    await requestEmailChange(a.ports, {
      accountId: q.accountId,
      userId: q.userId,
      currentEmail: q.email,
      newEmail: 'late@example.org',
      ip: '203.0.113.9',
    });
    const raw = await rawOf(a.rec.emails[0]!.data.tokenId);
    const later = ports({ now: () => new Date(Date.now() + 61 * 60_000) });
    expect(await confirmEmailChange(later.ports, { token: raw, caller: null })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });
    expect(later.rec.auth).toEqual([]);
  });

  it('refuses an undo link posted to the confirm', async () => {
    const p = await person();
    const { undo } = await changed(p, 'kind@example.org');
    const { ports: pp, rec } = ports();
    expect(await confirmEmailChange(pp, { token: undo, caller: null })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });
    expect(rec.auth).toEqual([]);
  });

  it('shows a taken address at the confirm, and changes nothing', async () => {
    const p = await person();
    const holder = await person();
    const a = ports();
    await requestEmailChange(a.ports, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: holder.email,
      ip: '203.0.113.9',
    });
    const raw = await rawOf(a.rec.emails[0]!.data.tokenId);
    const { ports: pp, rec } = ports();
    expect(await confirmEmailChange(pp, { token: raw, caller: null })).toEqual({
      ok: false,
      status: 409,
      code: 'address_taken',
    });
    expect(rec.auth).toEqual([]);
    expect(await emailOf(p.userId)).toBe(p.email);
  });

  it('puts the rows back and answers 502 when Auth refuses', async () => {
    const p = await person();
    const a = ports();
    await requestEmailChange(a.ports, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: 'auth-down@example.org',
      ip: '203.0.113.9',
    });
    const raw = await rawOf(a.rec.emails[0]!.data.tokenId);
    const s1 = '00000000-0000-4000-8000-0000000000d1';
    await addSessions(p.userId, [s1]);
    const { ports: pp, rec } = ports({
      auth: {
        updateEmail: async () => {
          throw new Error('auth down');
        },
        deleteUser: async () => {},
      },
    });
    expect(await confirmEmailChange(pp, { token: raw, caller: null })).toEqual({
      ok: false,
      status: 502,
      code: 'auth_failed',
    });
    expect(await emailOf(p.userId)).toBe(p.email);
    expect(await sessions(p.userId)).toEqual([s1]);
    expect(rec.emails).toEqual([]);
    expect(rec.reports.map(([s]) => s)).toEqual(['account.email_change.auth_failed']);
  });

  it('answers address_taken when Auth says the address is taken, with the rows put back', async () => {
    const p = await person();
    const a = ports();
    await requestEmailChange(a.ports, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: 'raced@example.org',
      ip: '203.0.113.9',
    });
    const raw = await rawOf(a.rec.emails[0]!.data.tokenId);
    const { ports: pp } = ports({
      auth: { updateEmail: async () => 'address_taken', deleteUser: async () => {} },
    });
    expect(await confirmEmailChange(pp, { token: raw, caller: null })).toEqual({
      ok: false,
      status: 409,
      code: 'address_taken',
    });
    expect(await emailOf(p.userId)).toBe(p.email);
  });
});

describe('undoEmailChange', () => {
  it('before the confirm, stops the change without touching Auth, and ends every session', async () => {
    const p = await person();
    const a = ports();
    await requestEmailChange(a.ports, {
      accountId: p.accountId,
      userId: p.userId,
      currentEmail: p.email,
      newEmail: 'from-a-stolen-session@example.net',
      ip: '203.0.113.9',
    });
    const confirm = await rawOf(a.rec.emails[0]!.data.tokenId);
    const undo = await rawOf(a.rec.emails[1]!.data.tokenId);
    await addSessions(p.userId, ['00000000-0000-4000-8000-0000000000e9']);
    const { ports: pp, rec } = ports();
    expect(await undoEmailChange(pp, { token: undo })).toEqual({ ok: true });
    expect(rec.auth).toEqual([]);
    expect(await sessions(p.userId)).toEqual([]);
    expect(await confirmEmailChange(ports().ports, { token: confirm, caller: null })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });
    expect(await emailOf(p.userId)).toBe(p.email);
  });

  it('sets Auth and the rows back to the old address and ends every session', async () => {
    const p = await person();
    const { undo } = await changed(p, 'stolen@example.net');
    await addSessions(p.userId, ['00000000-0000-4000-8000-0000000000e1']);
    const { ports: pp, rec } = ports();
    expect(await undoEmailChange(pp, { token: undo })).toEqual({ ok: true });
    expect(rec.auth).toEqual([`update ${p.userId} ${p.email}`]);
    expect(await emailOf(p.userId)).toBe(p.email);
    expect(await sessions(p.userId)).toEqual([]);
  });

  it('deletes a sign-up of the old address that holds nothing, reports it, and goes on', async () => {
    const p = await person();
    const { undo } = await changed(p, 'stolen2@example.net');
    const squatter = await signUp(db, p.email);
    const { ports: pp, rec } = ports();
    expect(await undoEmailChange(pp, { token: undo })).toEqual({ ok: true });
    expect(rec.auth).toEqual([`delete ${squatter}`, `update ${p.userId} ${p.email}`]);
    expect(rec.reports).toEqual([
      ['account.email_undo.squatter_removed', { userId: p.userId, squatter }],
    ]);
    expect(await emailOf(p.userId)).toBe(p.email);
  });

  it('answers 409 and reports when the old address is held by someone who holds something', async () => {
    const p = await person();
    const { undo } = await changed(p, 'stolen3@example.net');
    const squatter = await signUp(db, p.email);
    const { accountId } = await personalAccount(db, squatter);
    await db.query(`insert into public.sites (account_id, host) values ($1, 'mine.example')`, [
      accountId,
    ]);
    const { ports: pp, rec } = ports();
    expect(await undoEmailChange(pp, { token: undo })).toEqual({
      ok: false,
      status: 409,
      code: 'address_taken',
    });
    expect(rec.auth).toEqual([]);
    expect(rec.reports).toEqual([
      ['account.email_undo.address_taken', { userId: p.userId, holder: squatter }],
    ]);
  });

  it('leaves the link usable when Auth refuses, so the page can be posted again', async () => {
    const p = await person();
    const { undo } = await changed(p, 'retry@example.net');
    const down = ports({
      auth: {
        updateEmail: async () => {
          throw new Error('auth down');
        },
        deleteUser: async () => {},
      },
    });
    expect(await undoEmailChange(down.ports, { token: undo })).toEqual({
      ok: false,
      status: 502,
      code: 'auth_failed',
    });
    expect(await undoEmailChange(ports().ports, { token: undo })).toEqual({ ok: true });
    expect(await emailOf(p.userId)).toBe(p.email);
  });

  it('refuses a confirmation link, and a used undo link', async () => {
    const p = await person();
    const { confirm, undo } = await changed(p, 'kinds@example.net');
    expect(await undoEmailChange(ports().ports, { token: confirm })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });
    await undoEmailChange(ports().ports, { token: undo });
    expect(await undoEmailChange(ports().ports, { token: undo })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });
  });

  it('refuses a value that is not a token without asking the database', async () => {
    const calls: string[] = [];
    const { ports: pp } = ports({
      rpc: async (fn) => {
        calls.push(fn);
        return { data: null, error: null };
      },
    });
    expect(await undoEmailChange(pp, { token: 'nope' })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });
    expect(await confirmEmailChange(pp, { token: hashToken(newToken()), caller: null })).toEqual({
      ok: false,
      status: 410,
      code: 'link_unusable',
    });
    expect(calls).toEqual([]);
  });
});
