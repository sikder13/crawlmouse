import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedWorld } from '../../apps/web/__tests__/helpers/v2-check-tables';
import { migratedDb, pgliteDb } from '../db/test-support';
import {
  REDACTED_EMAIL,
  adminApiDelete,
  executeErasure,
  planErasure,
  type DeleteAuthUser,
} from './erase-account';

// B-F2 on PGlite with every migration: what the dry run reports is what --yes changes, nothing
// outside the person's data moves, and the refusals hold. Each test builds its own people, so the
// shared database never needs resetting.

let pglite: PGlite;
const db = () => pgliteDb(pglite);
const sqlDelete: DeleteAuthUser = async (id) => {
  await pglite.query(`delete from auth.users where id = $1`, [id]);
};

beforeAll(async () => {
  pglite = await migratedDb();
}, 300_000);
afterAll(async () => {
  await pglite.close();
});

/** The single value a count query returns. */
const n = async (sql: string, params: unknown[] = []) =>
  Number(Object.values((await pglite.query<Record<string, unknown>>(sql, params)).rows[0]!)[0]);

/** Every row of every public, auth and storage table, as one comparable string. */
async function everything(): Promise<string> {
  const { rows } = await pglite.query<{ t: string }>(
    `select format('%I.%I', n.nspname, c.relname) as t from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'p')
        and not c.relispartition
      order by 1`,
  );
  const out: string[] = [];
  for (const { t } of rows) {
    const r = await pglite.query<{ j: string }>(
      `select coalesce(string_agg(x::text, E'\\n' order by x::text), '') as j from ${t} x`,
    );
    out.push(`${t}\n${r.rows[0]!.j}`);
  }
  return out.join('\n');
}

let serial = 0;

/**
 * A person alone on their account (seedWorld's account, with its scoped member removed), the rows
 * elsewhere that hold their address or id, and a bystander with rows of the same shapes.
 */
async function person() {
  const tag = `p${++serial}`;
  const world = await seedWorld(pglite, tag);
  await pglite.query(`delete from public.seats where id = $1`, [world.scopedSeatId]);
  const id = world.ownerId;
  const email = (
    await pglite.query<{ email: string }>(`select email from auth.users where id = $1`, [id])
  ).rows[0]!.email;
  const bystander = await seedWorld(pglite, `${tag}b`);
  const other = (
    await pglite.query<{ email: string }>(`select email from auth.users where id = $1`, [
      bystander.ownerId,
    ])
  ).rows[0]!.email;
  // An address that ends with this person's, which a suffix match without the ':' would catch.
  const lookalike = `x-${email}`;

  // Theirs (cascades with the user); the bystander's, notifying this person (in another case);
  // anonymous, notifying this person; the bystander's own address; the lookalike's.
  await pglite.query(
    `insert into public.audits (url, user_id, notify_email) values
       ('https://a.example/', $1, $3), ('https://b.example/', $2, $4),
       ('https://c.example/', null, $3), ('https://d.example/', $2, $5),
       ('https://e.example/', null, $6)`,
    [id, bystander.ownerId, email, email.toUpperCase(), other, lookalike],
  );
  await pglite.query(
    `insert into public.email_events (email_address, event_type)
     values ($1, 'bounced'), ($2, 'bounced'), ($3, 'bounced')`,
    [email.toUpperCase(), other, lookalike],
  );
  await pglite.query(
    `insert into public.waitlist (email, source) values ($1, 'developers'), ($2, 'developers')`,
    [email, other],
  );
  await pglite.query(
    `insert into public.rate_limits (bucket_key, window_start, request_count) values
       ('magic:email:' || $1, now(), 1), ('notify:email:' || $1, now(), 1),
       ('verify:' || $2, now(), 1), ('claim:' || $2, now(), 1),
       ('magic:email:' || $3, now(), 1), ('verify:' || $4, now(), 1),
       ('magic:email:' || $5, now(), 1), ('global:audits:day:' || $6, now(), 1)`,
    [email, id, other, bystander.ownerId, lookalike, tag],
  );
  // An invitation to this person on the bystander's account, and one to the lookalike.
  await pglite.query(
    `insert into public.seats (account_id, invited_email, role, status) values
       ($1, $2, 'developer', 'invited'), ($1, $3, 'developer', 'invited')`,
    [bystander.accountId, email.toUpperCase(), lookalike],
  );
  const slug = `r-${tag}`;
  await pglite.query(
    `insert into public.public_reports (slug, domain, minted_by) values ($1, 'a.example', $2)`,
    [slug, id],
  );
  await pglite.query(
    `insert into public.takedown_requests (domain, requester_email, reason, status, public_report_slug)
     values ('a.example', $1, 'mine', 'removed', $2), ('a.example', $1, 'mine', 'pending', $2),
            ('a.example', $3, 'mine', 'removed', $2)`,
    [email, slug, other],
  );
  await pglite.query(
    `insert into public.trial_ledger (kind, value_hash, trial_kind, account_id)
     values ('email', encode(digest($1, 'sha256'), 'hex'), 'pro', $2)`,
    [email, world.accountId],
  );
  // Storage: one object this person uploaded, the objects their account's rows name, and the
  // bystander's, which must not be listed.
  const evidence = async (accountId: string) =>
    (
      await pglite.query<{ name: string }>(
        `select e.storage_path as name from public.evidence_blobs e
           join public.checks c on c.id = e.check_id join public.sites s on s.id = c.site_id
          where s.account_id = $1`,
        [accountId],
      )
    ).rows.map((r) => r.name);
  const named = await evidence(world.accountId);
  for (const name of [...named, ...(await evidence(bystander.accountId))]) {
    await pglite.query(
      `insert into storage.objects (bucket_id, name) values ('evidence', $1) on conflict do nothing`,
      [name],
    );
  }
  await pglite.query(
    `insert into storage.objects (bucket_id, name, owner)
     values ('report-logos', $1, $2), ('report-logos', $3, $4)`,
    [`${slug}/own.png`, id, `${slug}/other.png`, bystander.ownerId],
  );
  return {
    id,
    email,
    world,
    bystander,
    slug,
    lookalike,
    tag,
    storage: [
      ...named.map((name) => ({ bucket: 'evidence', name })),
      { bucket: 'report-logos', name: `${slug}/own.png` },
    ].sort((a, b) => `${a.bucket}/${a.name}`.localeCompare(`${b.bucket}/${b.name}`)),
  };
}

describe('erase-account (B-F2)', () => {
  it('a dry run changes nothing and reports what --yes would change', async () => {
    const p = await person();
    const before = await everything();
    const recording = db();
    const plan = await planErasure(recording, { email: `  ${p.email.toUpperCase()} ` });
    expect(await everything()).toBe(before);
    // It sent no write: no delete, update or insert, and no row lock.
    expect(recording.executed.length).toBeGreaterThan(10);
    for (const sql of recording.executed) {
      expect(sql).not.toMatch(/\b(delete\s+from|update\s+public\.|insert\s+into|for\s+update)\b/i);
    }

    expect(plan.userId).toBe(p.id);
    expect(plan.accounts).toEqual([p.world.accountId]);
    expect(plan.refusals).toEqual([]);
    expect(plan.counts).toMatchObject({
      'auth.users deleted': 1,
      'users deleted': 1,
      'audits deleted': 1,
      'audits.notify_email nulled': 2,
      'email_events deleted': 1,
      'waitlist deleted': 1,
      'takedown_requests redacted (closed)': 1,
      'rate_limits deleted': 4,
      'seats deleted (invitations in other accounts)': 1,
      'seats deleted (own)': 1,
      'public_reports.minted_by nulled': 1,
      'accounts deleted': 1,
      'sites deleted': 2,
      'checks deleted': 2,
    });
    expect(plan.kept).toEqual({
      'trial_ledger (peppered hashes; account reference set null)': 1,
      'takedown_requests (open; the address stays until closed)': 1,
    });
    expect(plan.mintedReports).toEqual([p.slug]);
    expect(plan.storage).toEqual(p.storage);
  }, 120_000);

  it('--yes changes what the dry run counted, and nothing of anyone else', async () => {
    const p = await person();
    const bystanderSites = await n(`select count(*) from public.sites where account_id = $1`, [
      p.bystander.accountId,
    ]);
    const dry = await planErasure(db(), { email: p.email });
    const { before, after } = await executeErasure(db(), { email: p.email }, sqlDelete);
    expect(before.counts).toEqual(dry.counts);
    expect(after).not.toBeNull();
    for (const [key, value] of Object.entries(after!.counts)) {
      expect(`${key}=${value}`).toBe(`${key}=0`);
    }

    // The person and their account are gone, with what hangs from them.
    expect(await n(`select count(*) from auth.users where id = $1`, [p.id])).toBe(0);
    expect(await n(`select count(*) from public.users where id = $1`, [p.id])).toBe(0);
    expect(await n(`select count(*) from public.accounts where id = $1`, [p.world.accountId])).toBe(
      0,
    );
    expect(await n(`select count(*) from public.audits where user_id = $1`, [p.id])).toBe(0);
    // No row still holds the address or the id, apart from the open takedown request.
    expect(
      await n(`select count(*) from public.audits where lower(notify_email) = $1`, [p.email]),
    ).toBe(0);
    expect(
      await n(`select count(*) from public.email_events where lower(email_address) = $1`, [
        p.email,
      ]),
    ).toBe(0);
    expect(
      await n(`select count(*) from public.seats where lower(invited_email) = $1`, [p.email]),
    ).toBe(0);
    expect(
      await n(
        `select count(*) from public.rate_limits where bucket_key = any(array[
           'magic:email:' || $1, 'notify:email:' || $1, 'verify:' || $2, 'claim:' || $2])`,
        [p.email, p.id],
      ),
    ).toBe(0);
    expect(
      await n(`select count(*) from public.takedown_requests where requester_email = $1`, [
        p.email,
      ]),
    ).toBe(1);
    expect(
      await n(
        `select count(*) from public.takedown_requests
          where requester_email = $1 and public_report_slug = $2`,
        [REDACTED_EMAIL, p.slug],
      ),
    ).toBe(1);

    // Kept: the ledger hash (unlinked), the public report (unattributed).
    expect(
      await n(
        `select count(*) from public.trial_ledger
          where value_hash = encode(digest($1, 'sha256'), 'hex') and account_id is null`,
        [p.email],
      ),
    ).toBe(1);
    expect(
      await n(`select count(*) from public.public_reports where slug = $1 and minted_by is null`, [
        p.slug,
      ]),
    ).toBe(1);

    // The bystander and the lookalike address keep everything.
    expect(
      await n(`select count(*) from public.sites where account_id = $1`, [p.bystander.accountId]),
    ).toBe(bystanderSites);
    expect(await n(`select count(*) from public.users where id = $1`, [p.bystander.ownerId])).toBe(
      1,
    );
    expect(
      await n(`select count(*) from public.rate_limits where bucket_key = 'verify:' || $1`, [
        p.bystander.ownerId,
      ]),
    ).toBe(1);
    expect(
      await n(
        `select count(*) from public.rate_limits where bucket_key = 'global:audits:day:' || $1`,
        [p.tag],
      ),
    ).toBe(1);
    for (const sql of [
      `select count(*) from public.seats where invited_email = $1`,
      `select count(*) from public.email_events where email_address = $1`,
      `select count(*) from public.audits where notify_email = $1`,
      `select count(*) from public.rate_limits where bucket_key = 'magic:email:' || $1`,
    ]) {
      expect(await n(sql, [p.lookalike]), sql).toBe(1);
    }
  }, 120_000);

  it('finds the same person by id as by address, and a second run changes nothing', async () => {
    const p = await person();
    const byId = await planErasure(db(), { userId: p.id });
    const byEmail = await planErasure(db(), { email: p.email });
    expect(byId).toEqual(byEmail);
    await executeErasure(db(), { userId: p.id }, sqlDelete);
    const snapshot = await everything();
    const again = await executeErasure(db(), { email: p.email }, sqlDelete);
    expect(again.before.userId).toBeNull();
    for (const [key, value] of Object.entries(again.before.counts)) {
      expect(`${key}=${value}`).toBe(`${key}=0`);
    }
    expect(await everything()).toBe(snapshot);
  }, 120_000);

  it('refuses while other people are seated on an account the person owns, and changes nothing', async () => {
    const world = await seedWorld(pglite, `crowded${++serial}`);
    const before = await everything();
    await expect(executeErasure(db(), { userId: world.ownerId }, sqlDelete)).rejects.toThrow(
      /other people are seated on it; transfer ownership first/,
    );
    expect(await everything()).toBe(before);
    // The scoped member, who owns nothing there, can be erased; the owner's account stays.
    const plan = await planErasure(db(), { userId: world.scopedUserId });
    expect(plan.refusals).toEqual([]);
    expect(plan.accounts).not.toContain(world.accountId);
  }, 120_000);

  it('refuses while pro_until is in the future or a subscription is live; a canceled one does not stop it', async () => {
    const p = await person();
    await pglite.query(
      `update public.users set pro_until = now() + interval '1 day' where id = $1`,
      [p.id],
    );
    expect((await planErasure(db(), { userId: p.id })).refusals).toEqual([
      'users.pro_until is in the future; cancel the subscription in Stripe first',
    ]);
    const withPro = await everything();
    await expect(executeErasure(db(), { userId: p.id }, sqlDelete)).rejects.toThrow(
      /refusing to erase/,
    );
    expect(await everything()).toBe(withPro);
    await pglite.query(
      `update public.users set pro_until = now() - interval '1 day' where id = $1`,
      [p.id],
    );
    for (const [status, refused] of [
      ['active', true],
      ['trialing', true],
      ['past_due', true],
      ['unpaid', true],
      ['paused', true],
      ['canceled', false],
      ['incomplete_expired', false],
    ] as const) {
      const sub = `sub_${randomUUID().replace(/-/g, '')}`;
      await pglite.query(
        `insert into public.subscriptions (id, account_id, status, plan, interval)
         values ($1, $2, $3, 'pro', 'month')`,
        [sub, p.world.accountId, status],
      );
      const { refusals } = await planErasure(db(), { userId: p.id });
      expect(refusals, status).toEqual(
        refused ? [`subscription ${sub} is live; cancel it in Stripe first`] : [],
      );
      await pglite.query(`delete from public.subscriptions where id = $1`, [sub]);
    }
  }, 120_000);

  it('with no account, erases the rows that hold the address only', async () => {
    const email = `nobody-${++serial}@example.com`;
    await pglite.query(`insert into public.waitlist (email, source) values ($1, 'developers')`, [
      email,
    ]);
    await pglite.query(`insert into public.rate_limits values ('magic:email:' || $1, now(), 1)`, [
      email,
    ]);
    const plan = await planErasure(db(), { email });
    expect(plan.userId).toBeNull();
    expect(plan.counts).toMatchObject({ 'waitlist deleted': 1, 'rate_limits deleted': 1 });
    expect(plan.counts).not.toHaveProperty('auth.users deleted');
    let called = false;
    await executeErasure(db(), { email }, async () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(await n(`select count(*) from public.waitlist where email = $1`, [email])).toBe(0);
  });

  it('takes exactly one of --email and --user-id, and an id that names a user', async () => {
    await expect(planErasure(db(), {})).rejects.toThrow(/exactly one/);
    await expect(planErasure(db(), { email: 'a@b.c', userId: randomUUID() })).rejects.toThrow(
      /exactly one/,
    );
    await expect(planErasure(db(), { userId: randomUUID() })).rejects.toThrow(
      /no user has that id/,
    );
  });
});

describe('adminApiDelete', () => {
  it('sends DELETE to the Auth admin endpoint with the service key, and accepts a 404 as done', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const answer = (status: number) =>
      (async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return new Response(null, { status });
      }) as unknown as typeof fetch;
    await adminApiDelete('https://abcdefghijklmnopqrst.supabase.co/', 'key', answer(200))('u1');
    expect(calls[0]).toEqual([
      'https://abcdefghijklmnopqrst.supabase.co/auth/v1/admin/users/u1',
      { method: 'DELETE', headers: { apikey: 'key', Authorization: 'Bearer key' } },
    ]);
    await expect(
      adminApiDelete('https://x.supabase.co', 'k', answer(404))('u1'),
    ).resolves.toBeUndefined();
    await expect(adminApiDelete('https://x.supabase.co', 'k', answer(500))('u1')).rejects.toThrow(
      /HTTP 500/,
    );
  });
});

describe('the command line', () => {
  const run = promisify(execFile);
  const cli = (env: Record<string, string>, args: string[]) =>
    run('pnpm', ['exec', 'tsx', 'ops/erase-account.ts', ...args], {
      cwd: `${__dirname}/..`,
      env: { ...process.env, ...env },
    }).then(
      (r) => ({ code: 0, err: r.stderr }),
      (e: { code: number; stderr: string }) => ({ code: e.code, err: e.stderr }),
    );

  it('refuses production without --yes-production, before connecting', async () => {
    const r = await cli(
      { ERASE_DB: 'postgres://postgres.ezspnfeyzwsisymytssm:x@127.0.0.1:1/postgres' },
      ['--db-url-env', 'ERASE_DB', '--email', 'a@b.c'],
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(
      /refusing to run against production \(ezspnfeyzwsisymytssm\) without --yes-production/,
    );
  }, 60_000);

  it('refuses --yes when the API URL names another project than the database, before any change', async () => {
    const r = await cli(
      {
        ERASE_DB: 'postgres://postgres.abcdefghijklmnopqrst:x@127.0.0.1:1/postgres',
        NEXT_PUBLIC_SUPABASE_URL: 'https://tsrqponmlkjihgfedcba.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
      },
      ['--db-url-env', 'ERASE_DB', '--email', 'a@b.c', '--yes'],
    );
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/names a different project than the database URL/);
  }, 60_000);
});
