import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Db, Row } from './db';

/**
 * Test support only: a PGlite database behind the scripts' `Db` interface. `executed` records every
 * text sent to the database, so a test can assert what a script ran.
 */
export interface RecordingDb extends Db {
  executed: string[];
  pglite: PGlite;
}

type Target = PGlite | Transaction;

function adapter(target: Target, executed: string[], root: PGlite): RecordingDb {
  return {
    executed,
    pglite: root,
    async query<T extends Row>(text: string, params: readonly unknown[] = []) {
      executed.push(text);
      return (await target.query<T>(text, [...params])).rows;
    },
    async exec(text: string) {
      executed.push(text);
      await target.exec(text);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!('transaction' in target)) throw new Error('nested transactions are not used');
      return target.transaction((tx) => fn(adapter(tx, executed, root)));
    },
    close: async () => {},
  };
}

export function pgliteDb(pglite: PGlite): RecordingDb {
  return adapter(pglite, [], pglite);
}

/** Runs `fn` inside a transaction that is always rolled back, so a mutation never outlives a test. */
export async function withRollback<T>(pglite: PGlite, fn: (db: Db) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await pglite.transaction(async (tx) => {
    result = await fn(adapter(tx, [], pglite));
    await tx.rollback();
  });
  return result as T;
}

/** A PGlite database with the Supabase stand-ins and the repository's migrations applied. */
export async function migratedDb(include?: (file: string) => boolean): Promise<PGlite> {
  const { applyAllMigrations, freshDb } =
    await import('../../apps/web/__tests__/helpers/pglite-migrations');
  const pglite = await freshDb();
  await applyAllMigrations(pglite, undefined, include);
  return pglite;
}

/** The history table as production has it (columns read from ezspnfeyzwsisymytssm on 2026-11-05). */
export const HISTORY_TABLE = `
  create schema if not exists supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text,
    created_by text,
    idempotency_key text,
    rollback text[]
  );
`;

/**
 * The name of one existing partition of a table (`public_page_results`, `research_check_runs`, ...).
 * Partitions are created for the months around now(), so a test names none of them literally.
 */
export async function partitionOf(pglite: PGlite, parent: string): Promise<string> {
  const { rows } = await pglite.query<{ relname: string }>(
    `select relname from pg_class
      where relnamespace = 'partitions'::regnamespace and relname ~ $1
      order by relname limit 1`,
    [`^${parent}_[0-9]{4}_[0-9]{2}$`],
  );
  if (!rows[0]) throw new Error(`no partition of ${parent}`);
  return rows[0].relname;
}

/** SQL that grants each fingerprint line, built from the line itself. */
export function grantSql(lines: string[]): string {
  const names: Record<string, string> = { r: 'tables', S: 'sequences', f: 'functions' };
  return lines
    .map((l) => {
      let m = /^relation (\S+) (\w+) ([A-Z]+)$/.exec(l);
      if (m) return `grant ${m[3]} on table ${m[1]} to ${m[2]};`;
      m = /^column (public\.\w+)\.(\w+) (\w+) ([A-Z]+)$/.exec(l);
      if (m) return `grant ${m[4]} (${m[2]}) on table ${m[1]} to ${m[3]};`;
      m = /^function (.+\)) (\w+) ([A-Z]+)$/.exec(l);
      if (m) return `grant ${m[3]} on function ${m[1]} to ${m[2]};`;
      m = /^postgres in public on (\w): (\w+) ([A-Z]+)$/.exec(l);
      if (m)
        return `alter default privileges for role postgres in schema public grant ${m[3]} on ${names[m[1]!]} to ${m[2]};`;
      throw new Error(`no grant for: ${l}`);
    })
    .join('\n');
}

/**
 * The tables and functions the v1 migrations created, as 20261106000002 names them; check.test.ts
 * compares these with P2's revokes and with check 08's lists.
 */
export const V1_TABLES = [
  'audits',
  'benchmark_cohorts',
  'domain_verifications',
  'email_events',
  'embed_badges',
  'findings',
  'fixes',
  'frontier',
  'frontier_politeness',
  'links',
  'pages',
  'public_reports',
  'rate_limits',
  'sessions',
  'stripe_events',
  'takedown_requests',
  'users',
  'waitlist',
];
export const V1_FUNCTIONS = [
  'public.handle_new_user()',
  'public.increment_rate_limit(p_bucket_key text, p_window_start timestamp with time zone)',
];

/** The last migration production recorded before P1 (20261106000001) and P2 (20261106000002). */
export const BEFORE_P1 = '20261103000001';

/**
 * Production as it stood before P1 and P2, for the dry run: migrated through 006b with each file
 * recorded under its version, plus what production held then that a replay of the migrations does
 * not give. The added lines are built from measured fixtures, not written here:
 *   - the client roles' privileges on the v1 tables and functions, and the default privileges naming
 *     them: 20261106000002-expected-change.json, `before`. The revokes first make this hold whatever
 *     the stand-ins grant; with today's stand-ins the migrations already give the same acls lines;
 *   - service_role's default privileges on sequences, and the report-logos bucket made by hand:
 *     2026-11-06-settled-branch-vs-production.json, the lines only production held. (Its table and
 *     function defaults for service_role come from the stand-ins.)
 * Every file after 006b is pending against it. The dry-run harness clones this database as the
 * branch, so it does not model what a real branch lacks (Supabase creates a branch without default
 * privileges on public); the live dry run does.
 */
export async function productionBeforeP1(): Promise<PGlite> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { listMigrations } = await import('./files');
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as Record<
      string,
      Record<string, string[]>
    >;
  const before = fixture('20261106000002-expected-change.json').before!;
  const settled = fixture('2026-11-06-settled-branch-vs-production.json').only_on_production!;
  const sequenceDefaults = settled.default_acls!.filter((l) =>
    l.startsWith('postgres in public on S: service_role '),
  );
  const [bucket] = settled.buckets!;
  const b = /^(\S+) name=(\S+) public=(t|f) file_size_limit=(\d+) allowed_mime_types=(.+)$/.exec(
    bucket!,
  );
  if (!b || sequenceDefaults.length === 0) throw new Error('the settled fixture changed shape');
  const mimes = JSON.parse(b[5]!) as string[];
  const pg = await migratedDb((f) => f.slice(0, 14) <= BEFORE_P1);
  await pg.exec(HISTORY_TABLE);
  for (const m of listMigrations().filter((f) => f.version <= BEFORE_P1)) {
    await pg.query(
      'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
      [m.version, m.name, [m.sql]],
    );
  }
  await pg.exec(`
    revoke all on table ${V1_TABLES.map((t) => `public.${t}`).join(', ')} from anon, authenticated;
    revoke all on function ${V1_FUNCTIONS.join(', ')} from anon, authenticated;
    alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
    alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
    alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;`);
  await pg.query(
    'insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ($1, $2, $3, $4, $5)',
    [b[1], b[2], b[3] === 't', Number(b[4]), mimes],
  );
  await pg.exec(grantSql([...before.acls!, ...before.default_acls!, ...sequenceDefaults]));
  return pg;
}
