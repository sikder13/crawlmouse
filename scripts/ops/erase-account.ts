import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { connect, type Db } from '../db/db';
import { assertAllowed, refOfUrl } from '../db/target';

/**
 * B-F2: erase one person's data on request. The runbook is docs/ops/erasure.md.
 *
 *   tsx scripts/ops/erase-account.ts --db-url-env DB_URL --email <address> | --user-id <uuid>
 *       [--yes] [--yes-production]
 *
 * A dry run by default: it prints, per table, how many rows `--yes` would delete or change, the
 * storage objects to delete through the Storage API (SQL cannot delete them), and the reasons it
 * would refuse. `--yes` refuses on any of those reasons, and otherwise, in one transaction, deletes
 * or redacts the rows that hold the address, deletes the accounts the person alone is seated on
 * (their sites, checks and reports cascade), then deletes the auth user through the Auth admin
 * API, which cascades through public.users (users_id_auth_fkey). It prints the counts again after.
 *
 * Kept, as the owner ruled (CC-V1FIX Q5): trial_ledger's peppered hashes (anti-abuse; the account
 * reference is set null), takedown requests (the address is redacted only on a closed one), and
 * public reports the person minted (minted_by is set null; a report is about a domain, and its
 * removal is the takedown flow's).
 */

export interface ErasureTarget {
  email?: string;
  userId?: string;
}

export interface StorageObject {
  bucket: string;
  name: string;
}

export interface ErasurePlan {
  userId: string | null;
  /** Lower-cased addresses: the one given and those on the user's rows. */
  emails: string[];
  /** Accounts the person alone is seated on; deleted with everything that cascades from them. */
  accounts: string[];
  refusals: string[];
  /** Rows `--yes` deletes or changes, by `table.action`. */
  counts: Record<string, number>;
  /** Rows deliberately kept, by `table.reason`. */
  kept: Record<string, number>;
  storage: StorageObject[];
  /** Public reports the person minted, which stay (minted_by is set null). */
  mintedReports: string[];
}

/** A redacted takedown requester. The column is NOT NULL, so the address is replaced, not nulled. */
export const REDACTED_EMAIL = 'redacted@erased.invalid';

const LIVE_SUBSCRIPTION = `status not in ('canceled', 'incomplete_expired')`;

type Change = { key: string; count: string; apply: string };

/**
 * Each change `--yes` makes, as the rows it touches. $1 user id (null when no user), $2 lower-cased
 * addresses, $3 accounts to delete. `count` counts the rows `apply` changes: executeErasure runs
 * each `apply` with `returning 1`, counts what it changed, and rolls the whole transaction back
 * unless that equals the count the plan read in the same transaction.
 */
const CHANGES: ReadonlyArray<Change> = [
  {
    // Not the user's own audits, which go with the user; with no user, every audit holding it.
    key: 'audits.notify_email nulled',
    count: `select count(*) from public.audits where lower(notify_email) = any($2::text[])
              and ($1::uuid is null or user_id is distinct from $1::uuid)`,
    apply: `update public.audits set notify_email = null where lower(notify_email) = any($2::text[])
              and ($1::uuid is null or user_id is distinct from $1::uuid)`,
  },
  {
    key: 'email_events deleted',
    count: `select count(*) from public.email_events where lower(email_address) = any($2::text[])`,
    apply: `delete from public.email_events where lower(email_address) = any($2::text[])`,
  },
  {
    key: 'waitlist deleted',
    count: `select count(*) from public.waitlist where lower(email) = any($2::text[])`,
    apply: `delete from public.waitlist where lower(email) = any($2::text[])`,
  },
  {
    key: 'takedown_requests redacted (closed)',
    count: `select count(*) from public.takedown_requests
             where lower(requester_email) = any($2::text[]) and status in ('removed', 'rejected')`,
    apply: `update public.takedown_requests set requester_email = '${REDACTED_EMAIL}'
             where lower(requester_email) = any($2::text[]) and status in ('removed', 'rejected')`,
  },
  {
    key: 'rate_limits deleted',
    count: `select count(*) from public.rate_limits
             where ($1::uuid is not null and right(bucket_key, 37) = ':' || $1::text)
                or exists (select 1 from unnest($2::text[]) e
                            where right(bucket_key, length(e) + 1) = ':' || e)`,
    apply: `delete from public.rate_limits
             where ($1::uuid is not null and right(bucket_key, 37) = ':' || $1::text)
                or exists (select 1 from unnest($2::text[]) e
                            where right(bucket_key, length(e) + 1) = ':' || e)`,
  },
  {
    key: 'seats deleted (invitations in other accounts)',
    count: `select count(*) from public.seats where lower(invited_email) = any($2::text[])
              and user_id is null and not (account_id = any($3::uuid[]))`,
    apply: `delete from public.seats where lower(invited_email) = any($2::text[])
              and user_id is null and not (account_id = any($3::uuid[]))`,
  },
  {
    key: 'reports.recipient_email nulled',
    count: `select count(*) from public.reports where lower(recipient_email) = any($2::text[])
              and not (account_id = any($3::uuid[]))`,
    apply: `update public.reports set recipient_email = null where lower(recipient_email) = any($2::text[])
              and not (account_id = any($3::uuid[]))`,
  },
  {
    key: 'sites.client_contact_email nulled',
    count: `select count(*) from public.sites where lower(client_contact_email) = any($2::text[])
              and not (account_id = any($3::uuid[]))`,
    apply: `update public.sites set client_contact_email = null
             where lower(client_contact_email) = any($2::text[]) and not (account_id = any($3::uuid[]))`,
  },
  {
    key: 'accounts deleted',
    count: `select count(*) from public.accounts where id = any($3::uuid[])`,
    apply: `delete from public.accounts where id = any($3::uuid[])`,
  },
];

/**
 * Supabase Auth's audit log, where the project keeps one (production has the table; it held no row
 * on 2026-11-09). An entry names the user by id and address in its JSON payload.
 */
const AUDIT_LOG: Change = {
  key: 'auth.audit_log_entries deleted',
  count: `select count(*) from auth.audit_log_entries
           where ($1::uuid is not null and payload->>'actor_id' = $1::text)
              or ($1::uuid is not null and payload->'traits'->>'user_id' = $1::text)
              or lower(payload->>'actor_username') = any($2::text[])
              or lower(payload->'traits'->>'user_email') = any($2::text[])`,
  apply: `delete from auth.audit_log_entries
           where ($1::uuid is not null and payload->>'actor_id' = $1::text)
              or ($1::uuid is not null and payload->'traits'->>'user_id' = $1::text)
              or lower(payload->>'actor_username') = any($2::text[])
              or lower(payload->'traits'->>'user_email') = any($2::text[])`,
};

async function changesFor(db: Db): Promise<Change[]> {
  const [row] = await db.query<{ t: string | null }>(
    `select to_regclass('auth.audit_log_entries')::text as t`,
  );
  return row!.t === null ? [...CHANGES] : [AUDIT_LOG, ...CHANGES];
}

/** What goes with the auth user, through public.users's cascades. Counted only; the delete is one. */
const WITH_USER: ReadonlyArray<{ key: string; count: string }> = [
  { key: 'auth.users deleted', count: `select count(*) from auth.users where id = $1::uuid` },
  { key: 'users deleted', count: `select count(*) from public.users where id = $1::uuid` },
  { key: 'audits deleted', count: `select count(*) from public.audits where user_id = $1::uuid` },
  {
    key: 'sessions deleted',
    count: `select count(*) from public.sessions where user_id = $1::uuid`,
  },
  {
    key: 'domain_verifications deleted',
    count: `select count(*) from public.domain_verifications where user_id = $1::uuid`,
  },
  {
    key: 'embed_badges deleted',
    count: `select count(*) from public.embed_badges where user_id = $1::uuid`,
  },
  {
    key: 'seats deleted (own)',
    count: `select count(*) from public.seats where user_id = $1::uuid`,
  },
  {
    key: 'public_reports.minted_by nulled',
    count: `select count(*) from public.public_reports where minted_by = $1::uuid`,
  },
  {
    key: 'share_links.created_by nulled',
    count: `select count(*) from public.share_links where created_by = $1::uuid`,
  },
  {
    key: 'api_keys.created_by nulled',
    count: `select count(*) from public.api_keys where created_by = $1::uuid`,
  },
];

/** What cascades from the deleted accounts, shown so the dry run says what goes with them. */
const WITH_ACCOUNTS: ReadonlyArray<{ key: string; count: string }> = [
  {
    key: 'sites deleted',
    count: `select count(*) from public.sites where account_id = any($3::uuid[])`,
  },
  {
    key: 'checks deleted',
    count: `select count(*) from public.checks c join public.sites s on s.id = c.site_id
             where s.account_id = any($3::uuid[])`,
  },
  {
    key: 'reports deleted',
    count: `select count(*) from public.reports where account_id = any($3::uuid[])`,
  },
];

const KEPT: ReadonlyArray<{ key: string; count: string }> = [
  {
    key: 'trial_ledger (peppered hashes; account reference set null)',
    count: `select count(*) from public.trial_ledger where account_id = any($3::uuid[])`,
  },
  {
    key: 'takedown_requests (open; the address stays until closed)',
    count: `select count(*) from public.takedown_requests
             where lower(requester_email) = any($2::text[]) and status not in ('removed', 'rejected')`,
  },
];

/**
 * The objects to delete through the Storage API, listed before any row that names them is gone:
 * those the person uploaded (storage.objects.owner), and those the deleted accounts' rows name.
 */
const STORAGE = `
  with paths(bucket, name) as (
    select 'report-logos', logo_path from public.agency_brands
     where account_id = any($3::uuid[]) and logo_path is not null
    union all
    select 'reports', storage_path from public.reports
     where account_id = any($3::uuid[]) and storage_path is not null
    union all
    select 'evidence', e.storage_path from public.evidence_blobs e
      join public.checks c on c.id = e.check_id join public.sites s on s.id = c.site_id
     where s.account_id = any($3::uuid[])
    union all
    select 'evidence', c.map_path from public.checks c join public.sites s on s.id = c.site_id
     where s.account_id = any($3::uuid[]) and c.map_path is not null
    union all
    select 'evidence', b.result_path from public.crawl_batches b
      join public.checks c on c.id = b.check_id join public.sites s on s.id = c.site_id
     where s.account_id = any($3::uuid[]) and b.result_path is not null
  )
  select o.bucket_id as bucket, o.name from storage.objects o
   where o.owner = $1::uuid or (o.bucket_id, o.name) in (select bucket, name from paths)
  order by 1, 2`;

/**
 * Every query here is sent the same three parameters ($1 user id, $2 addresses, $3 accounts), and
 * Postgres refuses a parameter a statement does not use. This header names all three, with their
 * types, ahead of the statement.
 */
const PARAMS = `_params as (select $1::uuid as uid, $2::text[] as emails, $3::uuid[] as accounts)`;
export function typed(sql: string): string {
  const body = sql.trim();
  return /^with\b/i.test(body)
    ? body.replace(/^with\b/i, `with ${PARAMS},`)
    : `with ${PARAMS} ${body}`;
}

const count = async (db: Db, sql: string, params: unknown[]) =>
  Number((await db.query<{ count: string | number }>(typed(sql), params))[0]!.count);

/** Every count `--yes` reports, for these parameters: [user id, addresses, accounts]. */
async function readCounts(db: Db, params: unknown[], changes: readonly Change[]) {
  const counts: Record<string, number> = {};
  if (params[0] !== null) {
    for (const c of WITH_USER) counts[c.key] = await count(db, c.count, params);
  }
  for (const c of [...changes, ...WITH_ACCOUNTS]) counts[c.key] = await count(db, c.count, params);
  return counts;
}

/** Reads what an erasure would do. Changes nothing. */
export async function planErasure(db: Db, target: ErasureTarget): Promise<ErasurePlan> {
  if (Boolean(target.email) === Boolean(target.userId)) {
    throw new Error('name exactly one of --email and --user-id');
  }
  const given = target.email?.trim().toLowerCase();
  const users = await db.query<{ id: string; email: string | null }>(
    `select id::text, email from auth.users
      where ($1::uuid is not null and id = $1::uuid) or ($2::text is not null and lower(email) = $2)
     union
     select id::text, email from public.users
      where ($1::uuid is not null and id = $1::uuid) or ($2::text is not null and lower(email) = $2)`,
    [target.userId ?? null, given ?? null],
  );
  const ids = [...new Set(users.map((u) => u.id))];
  if (ids.length > 1) throw new Error(`the address names ${ids.length} users; erase by --user-id`);
  const userId = ids[0] ?? null;
  if (target.userId && userId === null) throw new Error('no user has that id');
  const emails = [
    ...new Set([given, ...users.map((u) => u.email?.trim().toLowerCase())].filter(Boolean)),
  ] as string[];

  const refusals: string[] = [];
  let accounts: string[] = [];
  if (userId !== null) {
    accounts = (
      await db.query<{ id: string }>(
        `select distinct s.account_id::text as id from public.seats s
          where s.user_id = $1::uuid and s.status = 'active'
            and not exists (select 1 from public.seats o where o.account_id = s.account_id
                             and o.status = 'active' and o.user_id is distinct from $1::uuid)
          order by 1`,
        [userId],
      )
    ).map((r) => r.id);
    const crowded = await db.query<{ id: string }>(
      `select distinct s.account_id::text as id from public.seats s
        where s.user_id = $1::uuid and s.role = 'owner'
          and exists (select 1 from public.seats o where o.account_id = s.account_id
                       and o.status = 'active' and o.user_id is distinct from $1::uuid)`,
      [userId],
    );
    for (const { id } of crowded) {
      refusals.push(`account ${id}: other people are seated on it; transfer ownership first`);
    }
    const pro = await db.query(
      `select 1 from public.users where id = $1::uuid and pro_until > now()`,
      [userId],
    );
    if (pro.length > 0) {
      refusals.push('users.pro_until is in the future; cancel the subscription in Stripe first');
    }
    const live = await db.query<{ id: string }>(
      `select id from public.subscriptions where account_id = any($1::uuid[]) and ${LIVE_SUBSCRIPTION}`,
      [accounts],
    );
    for (const { id } of live) {
      refusals.push(`subscription ${id} is live; cancel it in Stripe first`);
    }
  }

  const params = [userId, emails, accounts];
  const counts = await readCounts(db, params, await changesFor(db));
  const kept: Record<string, number> = {};
  for (const c of KEPT) kept[c.key] = await count(db, c.count, params);
  const storage = await db.query<{ bucket: string; name: string }>(typed(STORAGE), params);
  if (storage.length > 0) {
    // The rows that name them go with --yes, after which nothing can list them.
    refusals.push(
      `${storage.length} storage objects are still stored; delete them through the Storage API first (docs/ops/erasure.md §4)`,
    );
  }
  const mintedReports =
    userId === null
      ? []
      : (
          await db.query<{ slug: string }>(
            `select slug from public.public_reports where minted_by = $1::uuid order by slug`,
            [userId],
          )
        ).map((r) => r.slug);
  return {
    userId,
    emails,
    accounts,
    refusals,
    counts,
    kept,
    storage: storage.map((o) => ({ bucket: o.bucket, name: o.name })),
    mintedReports,
  };
}

/** Deletes the auth user. Production: the Auth admin API. Tests: SQL on PGlite. */
export type DeleteAuthUser = (userId: string) => Promise<void>;

export interface AfterCounts {
  counts: Record<string, number>;
  storage: StorageObject[];
}

/**
 * Carries out an erasure. Plans again inside the transaction and refuses on any refusal. Applies
 * each change and rolls everything back unless the rows it changed equal the rows the plan counted,
 * so a row that changed in between, or a change that touches more than its count, commits nothing.
 * Then deletes the auth user. `after` reads every count again with the same user id, addresses and
 * accounts; each is zero when the erasure is complete. A failure after the commit (the Auth call)
 * leaves the user, and running it again finishes the job.
 */
export async function executeErasure(
  db: Db,
  target: ErasureTarget,
  deleteAuthUser: DeleteAuthUser,
): Promise<{ before: ErasurePlan; after: AfterCounts }> {
  const before = await db.transaction(async (tx) => {
    const plan = await planErasure(tx, target);
    if (plan.refusals.length > 0) {
      throw new Error(`refusing to erase:\n- ${plan.refusals.join('\n- ')}`);
    }
    const params = [plan.userId, plan.emails, plan.accounts];
    for (const c of await changesFor(tx)) {
      const changed = await count(
        tx,
        `with done as (${c.apply} returning 1) select count(*) from done`,
        params,
      );
      if (changed !== plan.counts[c.key]) {
        throw new Error(
          `${c.key}: counted ${plan.counts[c.key]}, changed ${changed}; nothing was committed`,
        );
      }
    }
    return plan;
  });
  const params = [before.userId, before.emails, before.accounts];
  if (before.userId !== null) {
    await deleteAuthUser(before.userId);
    // Supabase Auth may log the deletion, naming the address, after the transaction cleared the log.
    if ((await changesFor(db)).includes(AUDIT_LOG)) await db.query(typed(AUDIT_LOG.apply), params);
  }
  const counts = await readCounts(db, params, await changesFor(db));
  const storage = await db.query<{ bucket: string; name: string }>(typed(STORAGE), params);
  return {
    before,
    after: { counts, storage: storage.map((o) => ({ bucket: o.bucket, name: o.name })) },
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Whether the database URL and the Auth API URL name the same project: the same Supabase ref, or,
 * where the database names none (a local stack), both on this machine.
 */
export function sameProject(dbUrl: string, apiUrl: string): boolean {
  const ref = refOfUrl(dbUrl);
  if (ref !== null) return refOfApiUrl(apiUrl) === ref;
  return LOOPBACK.has(new URL(dbUrl).hostname) && LOOPBACK.has(new URL(apiUrl).hostname);
}

/** The Auth admin API's delete, for the project the database URL names. */
export function adminApiDelete(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): DeleteAuthUser {
  return async (userId) => {
    const res = await fetchImpl(
      `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Auth admin delete failed: HTTP ${res.status}`);
    }
  };
}

/** The project ref in a Supabase API URL (`https://<ref>.supabase.co`), or null. */
export function refOfApiUrl(url: string): string | null {
  return /^([a-z0-9]{20})\.supabase\.co$/.exec(new URL(url).hostname)?.[1] ?? null;
}

export function render(plan: ErasurePlan): string {
  const lines = [
    `user: ${plan.userId ?? 'none (only rows that hold the address)'}`,
    `accounts deleted with everything under them: ${plan.accounts.length}`,
    '',
    'deleted or changed:',
    ...Object.entries(plan.counts).map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
    '',
    'kept:',
    ...Object.entries(plan.kept).map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
    `  ${String(plan.mintedReports.length).padStart(6)}  public_reports minted (minted_by set null)${
      plan.mintedReports.length ? `: ${plan.mintedReports.join(', ')}` : ''
    }`,
    '',
    `storage objects to delete through the Storage API: ${plan.storage.length}`,
    ...plan.storage.map((o) => `  ${o.bucket}/${o.name}`),
  ];
  if (plan.refusals.length) lines.push('', 'refused:', ...plan.refusals.map((r) => `  - ${r}`));
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'db-url-env': { type: 'string' },
      email: { type: 'string' },
      'user-id': { type: 'string' },
      yes: { type: 'boolean', default: false },
      'yes-production': { type: 'boolean', default: false },
    },
  });
  const envName = values['db-url-env'];
  if (!envName) throw new Error('--db-url-env <VAR> is required');
  const url = process.env[envName];
  if (!url) throw new Error(`${envName} is not set`);
  const ref = refOfUrl(url);
  assertAllowed(ref, values['yes-production']);
  const target = { email: values.email, userId: values['user-id'] };
  const db = connect(url);
  try {
    if (!values.yes) {
      console.log(render(await planErasure(db, target)));
      console.log('\nDry run: nothing was changed. Run again with --yes to erase.');
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!apiUrl || !key) {
      throw new Error('--yes needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    if (!sameProject(url, apiUrl)) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL names a different project than the database URL');
    }
    const { before, after } = await executeErasure(db, target, adminApiDelete(apiUrl, key));
    console.log(render(before));
    console.log('\nErased. Counts read again afterwards (each should be 0):\n');
    for (const [k, n] of Object.entries(after.counts))
      console.log(`  ${String(n).padStart(6)}  ${k}`);
    console.log(`  ${String(after.storage.length).padStart(6)}  storage objects still listed`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
