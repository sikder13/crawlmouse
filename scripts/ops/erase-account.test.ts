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
  sameProject,
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
  // Supabase Auth's audit log, with its columns (auth schema, GoTrue's migrations). The shared shim
  // does not model it; production has the table, empty when measured on 2026-11-09.
  await pglite.exec(`create table auth.audit_log_entries (
    instance_id uuid, id uuid primary key, payload json, created_at timestamptz,
    ip_address varchar(64) not null default '')`);
}, 300_000);

/** The Storage API's delete, as the runbook does it (§4): the objects the plan lists. */
async function removeObjects(objects: readonly { bucket: string; name: string }[]) {
  await pglite.transaction(async (tx) => {
    await tx.query(`select set_config('storage.allow_delete_query', 'true', true)`);
    for (const o of objects) {
      await tx.query(`delete from storage.objects where bucket_id = $1 and name = $2`, [
        o.bucket,
        o.name,
      ]);
    }
  });
}
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
  // The address as a pending invitation, a report recipient and a client contact: once inside this
  // person's own account (deleted with it) and once on the bystander's (where it is removed).
  for (const accountId of [world.accountId, bystander.accountId]) {
    await pglite.query(
      `insert into public.seats (account_id, invited_email, role, status)
       values ($1, $2, 'developer', 'invited') on conflict do nothing`,
      [accountId, email],
    );
    await pglite.query(
      `update public.sites set client_contact_email = $2
        where id = (select id from public.sites where account_id = $1 order by id limit 1)`,
      [accountId, email.toUpperCase()],
    );
    await pglite.query(
      `update public.reports set recipient_email = $2
        where id = (select id from public.reports where account_id = $1 order by id limit 1)`,
      [accountId, email],
    );
  }
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
  // The other four path columns, for this person's account and the bystander's: an agency logo, a
  // report file, a crawl batch's result and a check's map, each with its object in its bucket.
  const pathsOf = async (accountId: string, who: string) => {
    const at = (kind: string) => `${who}/${kind}-${tag}`;
    await pglite.query(
      `insert into public.agency_brands (account_id, agency_name, logo_path) values ($1, 'Agency', $2)`,
      [accountId, at('logo.png')],
    );
    await pglite.query(
      `update public.reports set storage_path = $2
        where id = (select id from public.reports where account_id = $1 order by id limit 1)`,
      [accountId, at('report.pdf')],
    );
    const check = (
      await pglite.query<{ id: string }>(
        `select c.id from public.checks c join public.sites s on s.id = c.site_id
          where s.account_id = $1 order by c.id limit 1`,
        [accountId],
      )
    ).rows[0]!.id;
    await pglite.query(`update public.checks set map_path = $2 where id = $1`, [
      check,
      at('map.json'),
    ]);
    await pglite.query(
      `update public.crawl_batches set result_path = $2
        where check_id = (select b.check_id from public.crawl_batches b join public.checks c on c.id = b.check_id
                            join public.sites s on s.id = c.site_id where s.account_id = $1
                           order by b.check_id limit 1)`,
      [accountId, at('batch.json')],
    );
    const objects = [
      { bucket: 'report-logos', name: at('logo.png') },
      { bucket: 'reports', name: at('report.pdf') },
      { bucket: 'evidence', name: at('map.json') },
      { bucket: 'evidence', name: at('batch.json') },
    ];
    for (const o of objects) {
      await pglite.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
        o.bucket,
        o.name,
      ]);
    }
    return objects;
  };
  const pathObjects = await pathsOf(world.accountId, 'own');
  await pathsOf(bystander.accountId, 'theirs');
  await pglite.query(
    `insert into public.sessions (user_id, expires_at) values ($1, now() + interval '1 day')`,
    [id],
  );
  await pglite.query(
    `insert into auth.audit_log_entries (id, payload, created_at) values
       (gen_random_uuid(), json_build_object('actor_id', $1::text, 'actor_username', $2::text, 'action', 'login'), now()),
       (gen_random_uuid(), json_build_object('actor_id', $3::text, 'actor_username', $4::text, 'action', 'user_signedup',
          'traits', json_build_object('user_email', $2::text)), now()),
       (gen_random_uuid(), json_build_object('actor_id', $3::text, 'actor_username', $4::text, 'action', 'login'), now()),
       -- one naming them by id alone, one by address alone
       (gen_random_uuid(), json_build_object('actor_id', $1::text, 'action', 'token_refreshed'), now()),
       (gen_random_uuid(), json_build_object('actor_username', $2::text, 'action', 'login_failed'), now()),
       (gen_random_uuid(), json_build_object('action', 'user_modified', 'traits', json_build_object('user_id', $1::text)), now())`,
    [id, email.toUpperCase(), bystander.ownerId, other],
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
      ...pathObjects,
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
    // It sent no write: no delete, update or insert, and no row lock; and the plan function it calls
    // is stable, so Postgres refuses a write inside it.
    expect(recording.executed).toEqual([expect.stringMatching(/public\.erase_person_plan\(/)]);
    expect(
      await n(
        `select count(*) from pg_proc where proname = 'erase_person_plan' and provolatile = 's'`,
      ),
    ).toBe(1);
    for (const sql of recording.executed) {
      expect(sql).not.toMatch(/\b(delete\s+from|update\s+public\.|insert\s+into|for\s+update)\b/i);
    }

    expect(plan.userId).toBe(p.id);
    expect(plan.accounts).toEqual([p.world.accountId]);
    // The listed objects must go through the Storage API before --yes removes the rows naming them.
    expect(plan.refusals).toEqual([
      `${p.storage.length} storage objects are still stored; delete them through the Storage API first (docs/ops/erasure.md §4)`,
    ]);
    expect(plan.refusalCodes).toEqual(['storage']);
    // Every count, each from the fixture: none of domain_verifications, embed_badges, or a
    // share link or API key this person created; seedWorld gives the account two sites, each with a
    // check and a report.
    expect(plan.counts).toEqual({
      // their login, the bystander's entry naming them, one by actor id alone, one by address
      // alone, one by traits.user_id alone
      'auth.audit_log_entries deleted': 5,
      'auth.users deleted': 1,
      'users deleted': 1,
      'audits deleted': 1,
      'sessions deleted': 1,
      'domain_verifications deleted': 0,
      'embed_badges deleted': 0,
      'seats deleted (own)': 1,
      'public_reports.minted_by nulled': 1,
      'share_links.created_by nulled': 0,
      'api_keys.created_by nulled': 0,
      'audits.notify_email nulled': 2,
      'checks.notify_email nulled': 0,
      'email_events deleted': 1,
      'waitlist deleted': 1,
      'takedown_requests redacted (closed)': 1,
      'rate_limits deleted': 4,
      'users.previous_emails pruned': 0,
      'seats deleted (invitations in other accounts)': 1,
      'reports.recipient_email nulled': 1,
      'sites.client_contact_email nulled': 1,
      'fix_email_requests deleted': 0,
      'accounts deleted': 1,
      'sites deleted': 2,
      'checks deleted': 2,
      'reports deleted': 2,
    });
    expect(plan.kept).toEqual({
      'trial_ledger (peppered hashes; account reference set null)': 1,
      'takedown_requests (open; the address stays until closed)': 1,
      'previous address now held by another person': 0,
    });
    expect(plan.mintedReports).toEqual([p.slug]);
    expect(plan.storage).toEqual(p.storage);
  }, 120_000);

  it('--yes changes what the dry run counted, and nothing of anyone else', async () => {
    const p = await person();
    const bystanderSites = await n(`select count(*) from public.sites where account_id = $1`, [
      p.bystander.accountId,
    ]);
    const listed = await planErasure(db(), { email: p.email });
    const withObjects = await everything();
    await expect(executeErasure(db(), { email: p.email }, sqlDelete)).rejects.toThrow(
      /storage objects are still stored/,
    );
    expect(await everything()).toBe(withObjects);
    await removeObjects(listed.storage);
    const dry = await planErasure(db(), { email: p.email });
    expect(dry.refusals).toEqual([]);
    // Supabase Auth logs the deletion itself, naming the address, after the transaction.
    const authLogsIt: DeleteAuthUser = async (userId) => {
      await pglite.query(
        `insert into auth.audit_log_entries (id, payload, created_at) values (gen_random_uuid(),
           json_build_object('action', 'user_deleted', 'traits',
             json_build_object('user_id', $1::text, 'user_email', $2::text)), now())`,
        [userId, p.email],
      );
      await sqlDelete(userId);
    };
    const { before, after } = await executeErasure(db(), { email: p.email }, authLogsIt);
    expect(before.counts).toEqual(dry.counts);
    // Read again with the user id, addresses and accounts erased, not re-planned from the address.
    expect(Object.keys(after.counts)).toEqual(Object.keys(before.counts));
    expect(Object.keys(after.counts)).toContain('users deleted');
    for (const [key, value] of Object.entries(after.counts)) {
      expect(`${key}=${value}`).toBe(`${key}=0`);
    }
    expect(after.storage).toEqual([]);
    expect(
      await n(`select count(*) from auth.audit_log_entries where payload->>'actor_id' = $1`, [
        p.bystander.ownerId,
      ]),
    ).toBe(1);

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
    await removeObjects(byId.storage);
    await executeErasure(db(), { userId: p.id }, sqlDelete);
    const snapshot = await everything();
    const again = await executeErasure(db(), { email: p.email }, sqlDelete);
    expect(again.before.userId).toBeNull();
    for (const [key, value] of Object.entries(again.before.counts)) {
      expect(`${key}=${value}`).toBe(`${key}=0`);
    }
    expect(await everything()).toBe(snapshot);
  }, 120_000);

  it('rolls everything back when an apply changes other than it counted', async () => {
    const p = await person();
    await removeObjects((await planErasure(db(), { userId: p.id })).storage);
    const before = await everything();
    // A row that starts to hold the address between the plan's count and the apply.
    await pglite.exec(`create function pg_temp.late() returns trigger language plpgsql as $$
      begin insert into public.waitlist (email, source) values ('${p.email}', 'late'); return null; end $$`);
    await pglite.exec(`create trigger late after update on public.audits
      for each statement execute function pg_temp.late()`);
    try {
      await expect(executeErasure(db(), { userId: p.id }, sqlDelete)).rejects.toThrow(
        /waitlist deleted: counted 1, changed 2; nothing was committed/,
      );
    } finally {
      await pglite.exec(`drop trigger late on public.audits`);
    }
    expect(await everything()).toBe(before);
  }, 120_000);

  it('the after-check reads the erased accounts by id', async () => {
    const p = await person();
    await removeObjects((await planErasure(db(), { userId: p.id })).storage);
    // An account row with the erased id turning up again is what the after-check must report.
    const { after } = await executeErasure(db(), { userId: p.id }, async (userId) => {
      await sqlDelete(userId);
      await pglite.query(
        `insert into public.accounts (id, kind, state, tier, seat_limit, site_limit, state_history)
         values ($1, 'personal', 'free', 'free', 1, 1, '[{"state":"free","since":"2026-01-01T00:00:00.000Z"}]')`,
        [p.world.accountId],
      );
    });
    expect(after.counts['accounts deleted']).toBe(1);
    await pglite.query(`delete from public.accounts where id = $1`, [p.world.accountId]);
  }, 120_000);

  it('a failed Auth call leaves the user, and running it again finishes', async () => {
    const p = await person();
    await removeObjects((await planErasure(db(), { userId: p.id })).storage);
    await expect(
      executeErasure(db(), { userId: p.id }, async () => {
        throw new Error('Auth admin delete failed: HTTP 503');
      }),
    ).rejects.toThrow(/HTTP 503/);
    expect(await n(`select count(*) from auth.users where id = $1`, [p.id])).toBe(1);
    // The transaction already cleared the Auth audit log, before the Auth call that failed.
    expect(
      await n(`select count(*) from auth.audit_log_entries where payload->>'actor_id' = $1`, [
        p.id,
      ]),
    ).toBe(0);
    expect(await n(`select count(*) from public.accounts where id = $1`, [p.world.accountId])).toBe(
      0,
    );
    const { after } = await executeErasure(db(), { userId: p.id }, sqlDelete);
    for (const [key, value] of Object.entries(after.counts)) {
      expect(`${key}=${value}`).toBe(`${key}=0`);
    }
    expect(await n(`select count(*) from public.users where id = $1`, [p.id])).toBe(0);
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
    await removeObjects((await planErasure(db(), { userId: p.id })).storage);
    await pglite.query(
      `update public.users set pro_until = now() + interval '1 day' where id = $1`,
      [p.id],
    );
    const withV1 = await planErasure(db(), { userId: p.id });
    expect(withV1.refusals).toEqual([
      'users.pro_until is in the future; cancel the subscription in Stripe first',
    ]);
    expect(withV1.refusalCodes).toEqual(['v1_subscription']);
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

  it('counts an account as theirs alone only through an active seat', async () => {
    const p = await person();
    // An account where this person's seat was removed and no one is active any more.
    const { rows } = await pglite.query<{ id: string }>(
      `insert into public.accounts (kind, state, tier, seat_limit, site_limit, state_history)
       values ('agency', 'free', 'free', 1, 1, '[{"state":"free","since":"2026-01-01T00:00:00.000Z"}]')
       returning id`,
    );
    const abandoned = rows[0]!.id;
    await pglite.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, removed_at)
       values ($1, $2, $3, 'developer', 'removed', now())`,
      [abandoned, p.id, p.email],
    );
    const plan = await planErasure(db(), { userId: p.id });
    expect(plan.accounts).toEqual([p.world.accountId]);
    expect(plan.accounts).not.toContain(abandoned);
  }, 120_000);

  it('with no account, erases the rows that hold the address only', async () => {
    const email = `nobody-${++serial}@example.com`;
    await pglite.query(`insert into public.waitlist (email, source) values ($1, 'developers')`, [
      email,
    ]);
    await pglite.query(`insert into public.rate_limits values ('magic:email:' || $1, now(), 1)`, [
      email,
    ]);
    // An anonymous audit that asked to notify this address: no user on either side.
    await pglite.query(
      `insert into public.audits (url, user_id, notify_email) values ('https://n.example/', null, $1)`,
      [email.toUpperCase()],
    );
    const plan = await planErasure(db(), { email });
    expect(plan.userId).toBeNull();
    expect(plan.counts).toMatchObject({
      'waitlist deleted': 1,
      'rate_limits deleted': 1,
      'audits.notify_email nulled': 1,
    });
    expect(plan.counts).not.toHaveProperty('auth.users deleted');
    let called = false;
    await executeErasure(db(), { email }, async () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(await n(`select count(*) from public.waitlist where email = $1`, [email])).toBe(0);
    expect(
      await n(`select count(*) from public.audits where lower(notify_email) = $1`, [email]),
    ).toBe(0);
  });

  it('works where Supabase Auth keeps no audit log table', async () => {
    const bare = await migratedDb();
    const email = `bare-${++serial}@example.com`;
    await bare.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1)`, [email]);
    const plan = await planErasure(pgliteDb(bare), { email });
    expect(plan.counts).not.toHaveProperty('auth.audit_log_entries deleted');
    expect(plan.counts).toMatchObject({ 'users deleted': 1 });
    await bare.close();
  }, 300_000);

  it('redacts a rejected takedown request as it does a removed one (T8)', async () => {
    const p = await person();
    await pglite.query(
      `insert into public.takedown_requests (domain, requester_email, reason, status, public_report_slug)
       values ('a.example', $1, 'mine', 'rejected', $2)`,
      [p.email.toUpperCase(), p.slug],
    );
    const plan = await planErasure(db(), { userId: p.id });
    expect(plan.counts['takedown_requests redacted (closed)']).toBe(2);
    await removeObjects(plan.storage);
    await executeErasure(db(), { userId: p.id }, sqlDelete);
    expect(
      await n(
        `select count(*) from public.takedown_requests where status = 'rejected' and public_report_slug = $1
            and requester_email = $2`,
        [p.slug, REDACTED_EMAIL],
      ),
    ).toBe(1);
  }, 120_000);

  it('takes the address from auth.users and from public.users when the two differ (T10)', async () => {
    const p = await person();
    const auth = `auth-only-${p.email}`;
    await pglite.query(`update auth.users set email = $2 where id = $1`, [p.id, auth]);
    await pglite.query(`insert into public.waitlist (email, source) values ($1, 'developers')`, [
      auth,
    ]);
    const plan = await planErasure(db(), { userId: p.id });
    expect([...plan.emails].sort()).toEqual([auth, p.email].sort());
    // A row under each address is counted.
    expect(plan.counts['waitlist deleted']).toBe(2);
  }, 120_000);

  it('refuses an address that names more than one user, and changes nothing', async () => {
    const tag = `twice-${++serial}@example.com`;
    await pglite.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1)`, [tag]);
    await pglite.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1)`, [
      tag.toUpperCase(),
    ]);
    const before = await everything();
    await expect(planErasure(db(), { email: tag })).rejects.toThrow(
      /the address names 2 users; erase by user id/,
    );
    await expect(executeErasure(db(), { email: tag }, sqlDelete)).rejects.toThrow(/names 2 users/);
    expect(await everything()).toBe(before);
  }, 120_000);

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

describe('the rules 027b adds (D5)', () => {
  /** A person alone on their account, with no Storage objects, and a bystander's account. */
  async function plain() {
    const tag = `n${++serial}`;
    const world = await seedWorld(pglite, tag);
    await pglite.query(`delete from public.seats where id = $1`, [world.scopedSeatId]);
    const bystander = await seedWorld(pglite, `${tag}b`);
    const email = (
      await pglite.query<{ email: string }>(`select email from auth.users where id = $1`, [
        world.ownerId,
      ])
    ).rows[0]!.email;
    const checkOf = async (accountId: string) =>
      (
        await pglite.query<{ id: string }>(
          `select c.id from public.checks c join public.sites s on s.id = c.site_id
            where s.account_id = $1 order by c.id limit 1`,
          [accountId],
        )
      ).rows[0]!.id;
    return { world, bystander, email, id: world.ownerId, checkOf };
  }
  const erase = async (target: { email?: string; userId?: string }) => {
    await removeObjects((await planErasure(db(), target)).storage);
    return executeErasure(db(), target, sqlDelete);
  };

  it('finds an address in users.previous_emails, and prunes it from anyone else who lists it', async () => {
    const p = await plain();
    const old = `old-${p.email}`;
    await pglite.query(`update public.users set previous_emails = array[$2] where id = $1`, [
      p.id,
      old.toUpperCase(),
    ]);
    await pglite.query(`insert into public.waitlist (email, source) values ($1, 'developers')`, [
      old,
    ]);
    const plan = await planErasure(db(), { userId: p.id });
    expect(plan.emails).toEqual([p.email, old]);
    expect(plan.counts['waitlist deleted']).toBe(1);
    await erase({ userId: p.id });
    expect(await n(`select count(*) from public.waitlist where email = $1`, [old])).toBe(0);

    // Erasing an address by itself removes it from the list of the user who once held it.
    const q = await plain();
    const other = await plain();
    const gone = `gone-${q.email}`;
    await pglite.query(
      `update public.users set previous_emails = array[$2, 'kept@example.com'] where id = $1`,
      [other.id, gone],
    );
    const byAddress = await planErasure(db(), { email: gone });
    expect(byAddress.userId).toBeNull();
    expect(byAddress.counts['users.previous_emails pruned']).toBe(1);
    await executeErasure(db(), { email: gone }, sqlDelete);
    expect(
      (
        await pglite.query<{ p: string[] }>(
          `select previous_emails p from public.users where id = $1`,
          [other.id],
        )
      ).rows[0]!.p,
    ).toEqual(['kept@example.com']);
  }, 120_000);

  it('leaves out a previous address another person now signs in with, and keeps what is theirs', async () => {
    const p = await plain();
    const old = `taken-${p.email}`;
    await pglite.query(`update public.users set previous_emails = array[$2] where id = $1`, [
      p.id,
      old,
    ]);
    // Someone else signs up with the address this person moved away from.
    const other = await plain();
    await pglite.query(`update auth.users set email = $2 where id = $1`, [other.id, old]);
    await pglite.query(`update public.users set email = $2 where id = $1`, [other.id, old]);
    await pglite.query(`insert into public.waitlist (email, source) values ($1, 'developers')`, [
      old,
    ]);
    await pglite.query(
      `insert into public.seats (account_id, invited_email, role, status) values ($1, $2, 'developer', 'invited')`,
      [p.bystander.accountId, old],
    );
    await pglite.query(
      `insert into auth.audit_log_entries (id, payload, created_at)
       values (gen_random_uuid(), json_build_object('actor_username', $1::text, 'action', 'login'), now())`,
      [old],
    );
    const plan = await planErasure(db(), { userId: p.id });
    expect(plan.emails).toEqual([p.email]);
    expect(plan.kept['previous address now held by another person']).toBe(1);
    await erase({ userId: p.id });
    expect(await n(`select count(*) from public.waitlist where email = $1`, [old])).toBe(1);
    expect(await n(`select count(*) from public.seats where invited_email = $1`, [old])).toBe(1);
    expect(
      await n(`select count(*) from auth.audit_log_entries where payload->>'actor_username' = $1`, [
        old,
      ]),
    ).toBe(1);
  }, 120_000);

  it('nulls checks.notify_email outside the person’s accounts, and every one with no user', async () => {
    const p = await plain();
    const theirs = await p.checkOf(p.world.accountId);
    const elsewhere = await p.checkOf(p.bystander.accountId);
    await pglite.query(`update public.checks set notify_email = $2 where id = $1`, [
      theirs,
      p.email,
    ]);
    await pglite.query(`update public.checks set notify_email = $2 where id = $1`, [
      elsewhere,
      p.email.toUpperCase(),
    ]);
    const plan = await planErasure(db(), { userId: p.id });
    // Their own check goes with their account; the other is nulled.
    expect(plan.counts['checks.notify_email nulled']).toBe(1);
    const { after } = await erase({ userId: p.id });
    expect(after.counts['checks.notify_email nulled']).toBe(0);
    expect(await n(`select count(*) from public.checks where id = $1`, [theirs])).toBe(0);
    expect(
      await n(`select count(*) from public.checks where id = $1 and notify_email is null`, [
        elsewhere,
      ]),
    ).toBe(1);

    // With no user, every check holding the address: an anonymous visitor's address on two accounts.
    const q = await plain();
    const visitor = `visitor-${++serial}@example.com`;
    for (const accountId of [q.world.accountId, q.bystander.accountId]) {
      await pglite.query(`update public.checks set notify_email = $2 where id = $1`, [
        await q.checkOf(accountId),
        visitor,
      ]);
    }
    expect((await planErasure(db(), { email: visitor })).counts['checks.notify_email nulled']).toBe(
      2,
    );
    await executeErasure(db(), { email: visitor }, sqlDelete);
    expect(await n(`select count(*) from public.checks where notify_email = $1`, [visitor])).toBe(
      0,
    );
  }, 120_000);

  it('deletes fix_email_requests the person asked for or that name them, outside their accounts', async () => {
    const p = await plain();
    // The person is a developer on the bystander's account too.
    const { rows } = await pglite.query<{ id: string }>(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'developer', 'active', now()) returning id`,
      [p.bystander.accountId, p.id, p.email],
    );
    const seat = rows[0]!.id;
    const fixOf = async (accountId: string) =>
      (
        await pglite.query<{ id: string }>(
          `select f.id from public.site_fixes f join public.sites s on s.id = f.site_id
            where s.account_id = $1 order by f.id limit 1`,
          [accountId],
        )
      ).rows[0]!.id;
    const request = async (accountId: string, by: string | null, to: string) =>
      (
        await pglite.query<{ id: string }>(
          `insert into public.fix_email_requests (fix_id, account_id, requested_by_seat_id, to_email)
           values ($1, $2, $3, $4) returning id`,
          [await fixOf(accountId), accountId, by, to],
        )
      ).rows[0]!.id;
    const asked = await request(p.bystander.accountId, seat, 'dev@agency.example');
    const named = await request(p.bystander.accountId, p.bystander.ownerSeatId, p.email);
    const unrelated = await request(
      p.bystander.accountId,
      p.bystander.ownerSeatId,
      'dev@agency.example',
    );
    const own = await request(p.world.accountId, p.world.ownerSeatId, 'dev@agency.example');

    const plan = await planErasure(db(), { userId: p.id });
    expect(plan.counts['fix_email_requests deleted']).toBe(2);
    const { after } = await erase({ userId: p.id });
    expect(after.counts['fix_email_requests deleted']).toBe(0);
    const left = async (id: string) =>
      n(`select count(*) from public.fix_email_requests where id = $1`, [id]);
    expect([await left(asked), await left(named), await left(unrelated), await left(own)]).toEqual([
      0, 0, 1, 0,
    ]);

    // By address alone, with no user: the request addressed to it.
    const visitor = `fixme-${++serial}@example.com`;
    const addressed = await request(p.bystander.accountId, null, visitor);
    expect((await planErasure(db(), { email: visitor })).counts['fix_email_requests deleted']).toBe(
      1,
    );
    await executeErasure(db(), { email: visitor }, sqlDelete);
    expect(await left(addressed)).toBe(0);
  }, 120_000);
});

describe('sameProject', () => {
  it('needs the same Supabase ref, or a database and API both on this machine', () => {
    const db = (host: string) =>
      `postgres://postgres.${host}:x@aws-0.pooler.supabase.com:6543/postgres`;
    expect(
      sameProject(db('abcdefghijklmnopqrst'), 'https://abcdefghijklmnopqrst.supabase.co'),
    ).toBe(true);
    expect(
      sameProject(db('abcdefghijklmnopqrst'), 'https://tsrqponmlkjihgfedcba.supabase.co'),
    ).toBe(false);
    expect(sameProject(db('abcdefghijklmnopqrst'), 'https://auth.example.com')).toBe(false);
    expect(sameProject('postgres://u:x@127.0.0.1:54322/postgres', 'http://localhost:54321')).toBe(
      true,
    );
    // Neither names a project, and neither is local: two unknowns are not a match.
    expect(sameProject('postgres://u:x@db.example.com/postgres', 'https://auth.example.com')).toBe(
      false,
    );
    expect(sameProject('postgres://u:x@127.0.0.1/postgres', 'https://auth.example.com')).toBe(
      false,
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
