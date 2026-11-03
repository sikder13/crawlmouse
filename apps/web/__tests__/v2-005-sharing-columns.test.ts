import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import {
  MIGRATION_005,
  before,
  personalAccount,
  revertFile,
  signUp,
  through,
} from './helpers/v2-check-tables';

/**
 * Migration 005 of the v2 build: columns added to five v1 tables. Nothing is dropped, renamed or
 * re-granted, and v1 reads none of the new columns. The test runs v1's own queries (the PostgREST
 * calls in apps/web, written as the SQL PostgREST sends, under the role each one uses) on the same
 * rows before and after 005 and requires the same answers, writes included.
 */

const ROLLBACK = revertFile(MIGRATION_005);

interface Ids {
  userId: string;
  otherUserId: string;
  accountId: string;
  auditId: string;
  verificationId: string;
}

/** v1 rows, written the way v1 writes them, before 005 exists. */
async function seedV1(db: PGlite): Promise<Ids> {
  const userId = await signUp(db, `v1-${randomUUID()}@example.com`);
  const otherUserId = await signUp(db, `v1o-${randomUUID()}@example.com`);
  const { accountId } = await personalAccount(db, userId);
  const auditId = randomUUID();
  await db.query(
    `insert into public.audits (id, user_id, url, status, score, grade, cms_detected)
     values ($1, $2, 'https://shop.example/', 'completed', 81.5, 'B', 'shopify')`,
    [auditId, userId],
  );
  await db.query(
    `insert into public.public_reports (slug, audit_id, domain, claimed_at, listed, indexable, report_snapshot)
     values ('shop-example', $1, 'shop.example', now(), true, true, '{"grade":"B"}')`,
    [auditId],
  );
  const verificationId = randomUUID();
  await db.query(
    `insert into public.domain_verifications (id, user_id, domain, method, verification_token, verified_at)
     values ($1, $2, 'shop.example', 'dns_txt', 'tok', now())`,
    [verificationId, userId],
  );
  await db.query(`insert into public.embed_badges (user_id, domain) values ($1, 'shop.example')`, [
    userId,
  ]);
  await db.query(`insert into public.stripe_events (id, type) values ('evt_1', 'invoice.paid')`);
  await db.query(
    `insert into public.email_events (resend_event_id, email_address, event_type, bounce_type)
     values ('svix_1', 'bounce@example.com', 'email.bounced', 'permanent')`,
  );
  return { userId, otherUserId, accountId, auditId, verificationId };
}

type Role = 'anon' | 'authenticated' | 'service_role';
interface V1Query {
  where: string;
  role: Role;
  sql: string;
  args: (ids: Ids) => unknown[];
  asUser?: boolean;
}

/** v1's reads of these tables, from the files named, as the role each runs as. */
const V1_READS: V1Query[] = [
  {
    where: 'lib/reports.ts EXTENDED_REPORT_COLS (service role)',
    role: 'service_role',
    sql: `select domain, grade, score, cms_detected, orphan_count, avg_depth, takedown_requested_at, created_at,
                 report_snapshot, claimed_at, listed, indexable, hidden_at, white_label
            from public.public_reports where slug = 'shop-example'`,
    args: () => [],
  },
  {
    where: 'lib/leaderboard.ts and lib/badge-report.ts (public reads)',
    role: 'anon',
    sql: `select slug, domain, grade, score from public.public_reports where domain = 'shop.example'`,
    args: () => [],
  },
  {
    where: 'lib/leaderboard.ts count (head: true)',
    role: 'anon',
    sql: `select count(*) from public.public_reports`,
    args: () => [],
  },
  {
    where: 'lib/sitemap-reports.ts',
    role: 'anon',
    sql: `select slug, created_at from public.public_reports
           where indexable = true and claimed_at is not null and hidden_at is null and takedown_requested_at is null
           order by created_at desc`,
    args: () => [],
  },
  {
    where: 'lib/dashboard-report-settings.ts',
    role: 'service_role',
    sql: `select domain from public.domain_verifications where user_id = $1 and verified_at is not null`,
    args: (i) => [i.userId],
  },
  {
    where: 'lib/report-ownership.ts',
    role: 'service_role',
    sql: `select id from public.domain_verifications where user_id = $1 and domain = 'shop.example' and verified_at is not null`,
    args: (i) => [i.userId],
  },
  {
    where: 'app/verify/[id]/page.tsx (the signed-in user)',
    role: 'authenticated',
    asUser: true,
    sql: `select id, domain, method, verification_token, verified_at from public.domain_verifications where id = $1`,
    args: (i) => [i.verificationId],
  },
  {
    where: 'lib/billing/apply-stripe-event.ts',
    role: 'service_role',
    sql: `select processed_at from public.stripe_events where id = 'evt_1'`,
    args: () => [],
  },
  {
    where: 'lib/billing/resend-event.ts',
    role: 'service_role',
    sql: `select id from public.email_events where email_address = 'bounce@example.com' and bounce_type = 'permanent' limit 1`,
    args: () => [],
  },
  {
    where: 'app/embed/[domain]/route.ts increment_embed_view (service role)',
    role: 'service_role',
    sql: `select public.increment_embed_view('shop.example')`,
    args: () => [],
  },
];

/** v1's writes to these tables. Each must still succeed after 005. */
const V1_WRITES: V1Query[] = [
  {
    where: 'lib/billing/apply-stripe-event.ts insert + stamp',
    role: 'service_role',
    sql: `with i as (insert into public.stripe_events (id, type) values ('evt_' || gen_random_uuid(), 'invoice.paid') returning id)
          update public.stripe_events set processed_at = now() where id in (select id from i)`,
    args: () => [],
  },
  {
    where: 'app/api/webhooks/resend/route.ts upsert, ignoring duplicates',
    role: 'service_role',
    sql: `insert into public.email_events (resend_event_id, email_address, event_type, bounce_type, payload)
          values ('svix_1', 'bounce@example.com', 'email.bounced', 'permanent', '{}') on conflict (resend_event_id) do nothing`,
    args: () => [],
  },
  {
    where: 'app/api/reports/[slug]/claim/route.ts embed_badges upsert',
    role: 'service_role',
    sql: `insert into public.embed_badges (user_id, domain) values ($1, 'shop.example')
          on conflict (user_id, domain) do update set user_id = excluded.user_id`,
    args: (i) => [i.userId],
  },
  {
    where: 'app/api/verify/check/[id]/route.ts',
    role: 'service_role',
    sql: `update public.domain_verifications set verified_at = now() where id = $1`,
    args: (i) => [i.verificationId],
  },
  {
    where: 'lib/takedown.ts',
    role: 'service_role',
    sql: `update public.public_reports set takedown_requested_at = takedown_requested_at where slug = 'shop-example'`,
    args: () => [],
  },
];

async function run(db: PGlite, q: V1Query, ids: Ids): Promise<unknown[]> {
  return asRole(
    db,
    q.role,
    q.asUser ? ids.userId : null,
    async (tx) => (await tx.query(q.sql, q.args(ids))).rows,
  );
}

/** Volatile values (view counts, now()) are not part of the comparison; the row shape is. */
const stable = (rows: unknown[]) =>
  JSON.parse(JSON.stringify(rows, (k, v) => (k === 'increment_embed_view' ? typeof v : v)));

describe('migration 005: v1 queries return the same rows', () => {
  let db: PGlite;
  let ids: Ids;
  const beforeRows: Record<string, unknown> = {};

  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db, undefined, before(MIGRATION_005));
    ids = await seedV1(db);
    for (const q of V1_READS) beforeRows[q.where] = stable(await run(db, q, ids));
    await db.exec(readMigration(MIGRATION_005));
  }, 120_000);

  it.each(V1_READS.map((q) => [q.where, q] as const))('read: %s', async (_w, q) => {
    expect(stable(await run(db, q, ids))).toEqual(beforeRows[q.where]);
  });

  it.each(V1_WRITES.map((q) => [q.where, q] as const))('write: %s', async (_w, q) => {
    await run(db, q, ids);
  });

  it('the existing rows hold null in every new column', async () => {
    const { rows } = await db.query(
      `select (select row(check_id, site_id, account_id)::text from public.public_reports where slug = 'shop-example') as pr,
              (select account_id::text from public.domain_verifications where id = $1) as dv,
              (select account_id::text from public.embed_badges where user_id = $2) as eb,
              (select row(account_id, livemode, payload_hash)::text from public.stripe_events where id = 'evt_1') as se,
              (select row(account_id, kind)::text from public.email_events where resend_event_id = 'svix_1') as ee`,
      [ids.verificationId, ids.userId],
    );
    expect(rows[0]).toEqual({ pr: '(,,)', dv: null, eb: null, se: '(,,)', ee: '(,)' });
  });

  it('anon and authenticated cannot read the new public_reports columns', async () => {
    for (const col of ['check_id', 'site_id', 'account_id']) {
      await expect(
        asRole(db, 'anon', null, (tx) => tx.query(`select ${col} from public.public_reports`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRole(db, 'authenticated', ids.userId, (tx) =>
          tx.query(`select ${col} from public.public_reports`),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('migration 005: the new columns', () => {
  let db: PGlite;
  let ids: Ids;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
    ids = await seedV1(db);
  }, 120_000);

  it('email_events.kind takes exactly the six kinds', async () => {
    for (const kind of ['signin', 'change', 'reminder', 'report', 'invite', 'other'])
      await db.query(`update public.email_events set kind = $1 where resend_event_id = 'svix_1'`, [
        kind,
      ]);
    await expect(
      db.query(`update public.email_events set kind = 'receipt' where resend_event_id = 'svix_1'`),
    ).rejects.toThrow(/email_events_kind_check/);
  });

  it('stripe_events.payload_hash is a sha256 hex digest', async () => {
    await db.query(`update public.stripe_events set payload_hash = $1 where id = 'evt_1'`, [
      'a'.repeat(64),
    ]);
    await expect(
      db.query(`update public.stripe_events set payload_hash = 'not-a-hash' where id = 'evt_1'`),
    ).rejects.toThrow(/stripe_events_payload_hash_check/);
  });

  it('deleting the account clears the references and keeps the v1 rows', async () => {
    const { accountId } = await personalAccount(
      db,
      await signUp(db, `gone-${randomUUID()}@example.com`),
    );
    await db.query(`update public.domain_verifications set account_id = $1 where id = $2`, [
      accountId,
      ids.verificationId,
    ]);
    await db.query(`delete from public.accounts where id = $1`, [accountId]);
    const { rows } = await db.query(
      `select account_id from public.domain_verifications where id = $1`,
      [ids.verificationId],
    );
    expect(rows).toEqual([{ account_id: null }]);
  });
});

describe('embed_badges.account_id: a client may set only an account it is a member of', () => {
  let db: PGlite;
  let ids: Ids;
  let foreign: string;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
    ids = await seedV1(db);
    foreign = (await personalAccount(db, ids.otherUserId)).accountId;
  }, 120_000);

  const asOwner = (sql: string, args: unknown[]) =>
    asRole(db, 'authenticated', ids.userId, (tx) => tx.query(sql, args));

  it('refuses an insert naming another account', async () => {
    await expect(
      asOwner(
        `insert into public.embed_badges (user_id, domain, account_id) values ($1, 'other.example', $2)`,
        [ids.userId, foreign],
      ),
    ).rejects.toThrow(/embed_badges: account_id must be an account you are a member of/);
  });

  it('refuses an update moving the badge to another account', async () => {
    await expect(
      asOwner(`update public.embed_badges set account_id = $2 where user_id = $1`, [
        ids.userId,
        foreign,
      ]),
    ).rejects.toThrow(/embed_badges: account_id must be an account you are a member of/);
  });

  it('allows the caller’s own account, and v1’s writes that do not name it', async () => {
    await asOwner(`update public.embed_badges set account_id = $2 where user_id = $1`, [
      ids.userId,
      ids.accountId,
    ]);
    await asOwner(`update public.embed_badges set style = '{"theme":"dark"}' where user_id = $1`, [
      ids.userId,
    ]);
    await asOwner(
      `insert into public.embed_badges (user_id, domain) values ($1, 'second.example')`,
      [ids.userId],
    );
  });

  it('the service role may set any account (the 006 backfill)', async () => {
    await asRole(db, 'service_role', null, (tx) =>
      tx.query(`update public.embed_badges set account_id = $2 where user_id = $1`, [
        ids.userId,
        foreign,
      ]),
    );
  });
});

describe('migration 005 applies, re-applies and reverts', () => {
  it('re-applying it changes nothing in the catalog', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, through(MIGRATION_005));
    const once = await catalogSnapshot(db);
    await db.exec(readMigration(MIGRATION_005));
    expect(await catalogSnapshot(db)).toEqual(once);
  }, 120_000);

  it('the revert returns the catalog to the state before 005', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, before(MIGRATION_005));
    const pre = await catalogSnapshot(db);
    await db.exec(readMigration(MIGRATION_005));
    expect(await catalogSnapshot(db)).not.toEqual(pre);
    await db.exec(readRollback(ROLLBACK));
    await db.exec(readRollback(ROLLBACK));
    const post = await catalogSnapshot(db);
    for (const section of Object.keys(pre)) expect(post[section], section).toEqual(pre[section]);
  }, 120_000);
});
