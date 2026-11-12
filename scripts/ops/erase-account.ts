import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { connect, type Db } from '../db/db';
import { assertAllowed, refOfUrl } from '../db/target';
import {
  REDACTED_EMAIL,
  erasePerson,
  planWithMail,
  type AfterCounts,
  type ErasurePlan,
  type ErasurePorts,
  type ErasureTarget,
  type MailRecordCounts,
  type StorageObject,
} from '../../apps/web/lib/v2/account/erase';
import { mailPepper } from '../../apps/web/lib/v2/mail/address-hash';

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
 * The rules are the SQL functions of migration 20261112000002 section B, and the sequence is
 * apps/web/lib/v2/account/erase.ts, which the in-app purge runs too.
 *
 * Kept, as the owner ruled (CC-V1FIX Q5): trial_ledger's peppered hashes (anti-abuse; the account
 * reference is set null), takedown requests (the address is redacted only on a closed one), and
 * public reports the person minted (minted_by is set null; a report is about a domain, and its
 * removal is the takedown flow's).
 *
 * The mail the product sent names its recipient by a peppered hash only (CC-28), so the script needs
 * the app's `TRIAL_LEDGER_PEPPER` in its environment to find it; without it the plan refuses. The
 * suppressions on those hashes are kept (CC-28 Q2).
 */

export type { AfterCounts, ErasurePlan, ErasureTarget, StorageObject };
export { REDACTED_EMAIL };

/**
 * The plan, through the shared SQL (`erase_person_plan`). Changes nothing: the function is stable, so
 * Postgres refuses any write in it.
 */
export async function planErasure(db: Db, target: ErasureTarget): Promise<ErasurePlan> {
  if (Boolean(target.email) === Boolean(target.userId)) {
    throw new Error('name exactly one of --email and --user-id');
  }
  const [row] = await db.query<{ plan: ErasurePlan }>(
    `select public.erase_person_plan($1::uuid, $2::text) as plan`,
    [target.userId ?? null, target.email ?? null],
  );
  return row!.plan;
}

/** Deletes the auth user. Production: the Auth admin API. Tests: SQL on PGlite. */
export type DeleteAuthUser = (userId: string) => Promise<void>;

/**
 * The erasure's ports over a direct connection. The script has no Storage API client, so it removes
 * no objects: while the plan lists any, it refuses, and the runbook deletes them by hand (§4).
 */
export function scriptPorts(
  db: Db,
  deleteAuthUser: DeleteAuthUser,
  pepper: string | null,
): ErasurePorts {
  return {
    plan: (target) => planErasure(db, target),
    async apply(target, expected) {
      await db.query(`select public.erase_person_apply($1::uuid, $2::text, $3::jsonb, false)`, [
        target.userId ?? null,
        target.email ?? null,
        JSON.stringify(expected),
      ]);
    },
    async removeStorage(objects) {
      throw new Error(
        `refusing to erase:\n- ${objects.length} storage objects are still stored; delete them through the Storage API first (docs/ops/erasure.md §4)`,
      );
    },
    deleteAuthUser,
    async sweepAuditLog(plan) {
      await db.query(`select public.erase_auth_audit_log($1::uuid, $2::text[])`, [
        plan.userId,
        plan.emails,
      ]);
    },
    async recount(plan) {
      const [row] = await db.query<{ after: AfterCounts }>(
        `select public.erase_person_counts($1::uuid, $2::text[], $3::uuid[]) as after`,
        [plan.userId, plan.emails, plan.accounts],
      );
      return { counts: row!.after.counts, storage: row!.after.storage };
    },
    mailPepper: pepper,
    async mailRecords(hashes, apply) {
      const [row] = await db.query<{ r: MailRecordCounts }>(
        `select public.erase_mail_records($1::text[], $2) as r`,
        [[...hashes], apply],
      );
      return row!.r;
    },
  };
}

/**
 * Carries out an erasure (apps/web/lib/v2/account/erase.ts). Refuses on any refusal. The apply plans
 * again inside its transaction and rolls back unless the rows each change touched equal the rows that
 * plan counted. Then deletes the auth user. `after` reads every count again with the same user id,
 * addresses and accounts; each is zero when the erasure is complete. A failure after the commit (the
 * Auth call) leaves the user, and running it again finishes the job.
 */
export async function executeErasure(
  db: Db,
  target: ErasureTarget,
  deleteAuthUser: DeleteAuthUser,
  pepper: string | null,
): Promise<{ before: ErasurePlan; after: AfterCounts }> {
  const result = await erasePerson(scriptPorts(db, deleteAuthUser, pepper), target);
  if (!result.ok) throw new Error(`refusing to erase:\n- ${result.refusals.join('\n- ')}`);
  return { before: result.before, after: result.after };
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
  const pepper = mailPepper(process.env);
  const db = connect(url);
  try {
    if (!values.yes) {
      const dryRun = scriptPorts(
        db,
        async () => {
          throw new Error('a dry run deletes no Auth user');
        },
        pepper,
      );
      console.log(render(await planWithMail(dryRun, target)));
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
    const { before, after } = await executeErasure(db, target, adminApiDelete(apiUrl, key), pepper);
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
