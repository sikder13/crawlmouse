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
  -- On Supabase the service role bypasses RLS; without this the sandbox would filter its writes.
  create role service_role bypassrls;
  create schema if not exists auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $shim$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $shim$;
  create or replace function auth.role() returns text language sql stable as $shim$ select null::text $shim$;
  -- Supabase's own definition: the verified JWT's claims, which PostgREST and Storage put in
  -- request.jwt.claims. asWorker below sets it. Migration 007's crawl_worker policies read it.
  create or replace function auth.jwt() returns jsonb language sql stable as $shim$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
  $shim$;
  -- The role PostgREST and Storage log in as and switch from. Migration 007 grants crawl_worker to it.
  create role authenticator noinherit;

  -- STORAGE STAND-INS. Supabase Storage keeps its metadata in storage.buckets and storage.objects;
  -- an upload is an INSERT into storage.objects under the uploader's role, with RLS deciding it.
  -- Only the columns migration 007 and its tests touch are modelled, with Supabase's grants (anon,
  -- authenticated and service_role hold every privilege; RLS is on). What this cannot show: that
  -- the real schema accepts 007's statements, and that a real upload through the Storage API takes
  -- the same path. Both are the Supabase-branch dry run's (docs/specs/v2/06-check-tables.md).
  create schema if not exists storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key,
    name text not null unique,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid,
    created_at timestamptz default now(),
    unique (bucket_id, name)
  );
  alter table storage.buckets enable row level security;
  alter table storage.objects enable row level security;
  grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
  -- Supabase refuses a direct DELETE on either table unless the transaction sets
  -- storage.allow_delete_query. Function and triggers as read from ezspnfeyzwsisymytssm on 2026-11-05.
  create function storage.protect_delete() returns trigger language plpgsql as $shim$
  begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
      raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
        using hint = 'This prevents accidental data loss from orphaned objects.', errcode = '42501';
    end if;
    return null;
  end;
  $shim$;
  create trigger protect_buckets_delete before delete on storage.buckets
    for each statement execute function storage.protect_delete();
  create trigger protect_objects_delete before delete on storage.objects
    for each statement execute function storage.protect_delete();

  -- SUPABASE VAULT AND AUTH SESSION STAND-INS (027b). Vault is installed on ezspnfeyzwsisymytssm
  -- (supabase_vault 0.3.1, measured 2026-11-10); 027b keeps the account's Slack webhook URL in
  -- it. Modelled: vault.secrets, vault.create_secret, vault.update_secret and the
  -- decrypted_secrets view, with no client role holding anything on them. The secret is stored as
  -- given (no encryption): the tests read what 027b writes and who may read it, not the cipher.
  -- auth.sessions and auth.refresh_tokens carry only the columns end_user_sessions touches. What this
  -- cannot show: that the real objects accept 027b's statements under postgres's grants. That is the
  -- dry-run branch's (docs/specs/v2/27b-account-wiring.md).
  create schema if not exists vault;
  create table vault.secrets (
    id uuid primary key default gen_random_uuid(),
    name text unique,
    description text not null default '',
    secret text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create view vault.decrypted_secrets as
    select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
    returns uuid language sql as $shim$
    insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
  $shim$;
  create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                      new_description text default null)
    returns void language sql as $shim$
    update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
           description = coalesce(new_description, description), updated_at = now()
     where id = secret_id
  $shim$;
  revoke all on schema vault from public;
  revoke all on all tables in schema vault from public;
  revoke all on all functions in schema vault from public;
  create table auth.sessions (id uuid primary key, user_id uuid not null);
  create table auth.refresh_tokens (
    id bigserial primary key,
    user_id varchar(255),
    session_id uuid references auth.sessions (id) on delete cascade
  );

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

/**
 * Run `fn` as the crawl worker: `set local role crawl_worker` with `claims` as the verified JWT's
 * claims, the way PostgREST and Storage present a token whose `role` claim is `crawl_worker`.
 */
export async function asWorker<T>(
  db: PGlite,
  claims: Record<string, unknown>,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role crawl_worker`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    return fn(tx);
  });
}
