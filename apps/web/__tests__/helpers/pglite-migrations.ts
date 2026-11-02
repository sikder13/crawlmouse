import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/**
 * The PGlite migration harness: a stock Postgres with the Supabase platform objects the migrations
 * assume, and every file in `infra/supabase/migrations` applied in order.
 *
 * Shared by the catalog tests (`spec51a-frontier-privilege-catalog.test.ts`,
 * `v2-001-entitlement-tables.test.ts`), so every one of them runs against the same shim.
 */

export const MIGRATIONS_DIR = resolve(HERE, '../../../../infra/supabase/migrations');
export const ROLLBACKS_DIR = resolve(HERE, '../../../../infra/supabase/rollbacks');

/**
 * The Supabase platform objects a migration assumes but never creates. Declared here so the shim is
 * auditable: if this list grows, someone has to justify the addition.
 *
 * `auth.uid()` reads the `request.jwt.claim.sub` setting, which is how Supabase defines it. With the
 * setting absent it returns null, as the previous `select null::uuid` shim did. `asRole` below sets it.
 * The client roles hold USAGE on `auth`, as on Supabase, so a policy that calls `auth.uid()` can run
 * as them.
 */
export const PLATFORM_SHIM = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema if not exists auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $shim$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $shim$;
  create or replace function auth.role() returns text language sql stable as $shim$ select null::text $shim$;

  -- ⚠ PRODUCTION'S DEFAULT PRIVILEGES. Without these the sandbox is STRICTLY SAFER than production,
  -- which is the one direction that manufactures false greens on a security control (gate 7 / B3).
  --
  -- Read live from pg_default_acl on ezspnfeyzwsisymytssm:
  --   objtype=f  {postgres=X, anon=X, authenticated=X, service_role=X}   ← and NO public (=X) entry
  --   objtype=r  {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
  --
  -- Migrations run as postgres, so on production EVERY new function in public is created with an
  -- explicit anon/authenticated EXECUTE entry and every new table with full DML for both. Stock
  -- Postgres grants neither. Measured consequence without this block: narrowing both revokes to
  -- from public — the spelling the migration's own header emphasises — passed GREEN while leaving
  -- anon holding EXECUTE on the row-claiming and row-deleting RPCs live. The revoke from public case
  -- in the frontier catalog test is the permanent regression test.
  --
  -- ⚠ THE NEXT LINE IS A NO-OP UNDER PGlite, MEASURED. It records nothing in pg_default_acl and a
  -- new function still comes out holding =X (PUBLIC). PUBLIC therefore holds EXECUTE by default in
  -- the sandbox — production's pg_default_acl has no PUBLIC entry either way, so the sandbox is at
  -- worst MORE permissive here, which for a guard can only add violations and never mask one. It is
  -- kept, not deleted, because it states the intent; but if PGlite ever implements it the sandbox
  -- becomes SAFER than production on the PUBLIC axis — the exact direction B3 failed in — and this
  -- block must be re-measured against production that day.
  alter default privileges in schema public revoke execute on functions from public;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PLATFORM_SHIM);
  return db;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * @param edit optional transform applied to each migration's TEXT before it executes. Appending SQL
 *             cannot model a migration MISTAKE — the correct statements have already run — so a case
 *             like "the revoke was written too narrowly" has to change the file's content.
 * @param include optional filter on file names; every file runs when it is omitted.
 */
export async function applyAllMigrations(
  db: PGlite,
  edit?: (sql: string) => string,
  include?: (file: string) => boolean,
): Promise<string[]> {
  const files = migrationFiles().filter((f) => (include ? include(f) : true));
  for (const f of files) {
    const raw = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    await db.exec(edit ? edit(raw) : raw);
  }
  return files;
}

export function readMigration(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

export function readRollback(file: string): string {
  return readFileSync(join(ROLLBACKS_DIR, file), 'utf8');
}

/**
 * Run `fn` inside a transaction as a Supabase client role, the way PostgREST does: `set local role`,
 * and for a signed-in caller the JWT subject that `auth.uid()` reads. The transaction is rolled back
 * when `fn` throws, so a denied statement leaves nothing behind.
 */
export async function asRole<T>(
  db: PGlite,
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (userId !== null) {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    }
    return fn(tx);
  });
}
