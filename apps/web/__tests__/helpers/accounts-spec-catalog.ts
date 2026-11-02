import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import type { SpecCatalog, SpecTable } from '../../lib/entitlement-spec';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/**
 * Reads what docs/specs/v2/01-accounts.md states about the schema from the catalog of a database
 * with every migration applied, and the v1 billing readers from the repository's tracked files.
 */

export const ACCOUNT_TABLES = [
  'accounts',
  'subscriptions',
  'seats',
  'agency_brands',
  'trial_ledger',
] as const;
export const NEW_USERS_COLUMNS = ['email_normalized', 'default_account_id'] as const;
export const ACCOUNT_FUNCTIONS = [
  'is_member',
  'member_role',
  'apply_entitlement_transition',
  'assert_entitlement_version',
  'accounts_keep_first_history_entry',
  'handle_new_user',
] as const;

const PRIVILEGES: Record<string, string> = {
  r: 'SELECT',
  a: 'INSERT',
  w: 'UPDATE',
  d: 'DELETE',
  D: 'TRUNCATE',
  x: 'REFERENCES',
  t: 'TRIGGER',
  m: 'MAINTAIN',
  X: 'EXECUTE',
};

function aclFor(acl: string | null, grantee: string): string[] {
  const item = (acl ?? '')
    .replace(/^\{|\}$/g, '')
    .split(',')
    .find((i) => i.split('=')[0] === grantee);
  if (!item) return [];
  const letters = (item.split('=')[1] ?? '').split('/')[0] ?? '';
  return [...letters].map((l) => PRIVILEGES[l] ?? l);
}

async function columns(db: PGlite, table: string, only?: readonly string[]) {
  const { rows } = await db.query<{
    name: string;
    type: string;
    notnull: boolean;
    def: string | null;
    acl: string | null;
  }>(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
            pg_get_expr(d.adbin, d.adrelid) as def, a.attacl::text as acl
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [table],
  );
  return rows.filter((r) => !only || only.includes(r.name));
}

export async function readSpecCatalog(db: PGlite): Promise<SpecCatalog> {
  const tables: SpecTable[] = [];
  for (const name of ACCOUNT_TABLES) {
    const rel = (
      await db.query<{ rls: boolean; acl: string | null }>(
        `select c.relrowsecurity as rls, c.relacl::text as acl from pg_class c
           join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`,
        [name],
      )
    ).rows[0]!;
    const cols = await columns(db, name);
    const constraints = (
      await db.query<{ name: string; def: string }>(
        `select k.conname as name, pg_get_constraintdef(k.oid) as def from pg_constraint k
           join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1 and k.contype in ('c', 'f', 'u', 'p') order by k.conname`,
        [name],
      )
    ).rows;
    const indexes = (
      await db.query<{ name: string; def: string }>(
        `select indexname as name, indexdef as def from pg_indexes
          where schemaname = 'public' and tablename = $1 order by indexname`,
        [name],
      )
    ).rows;
    const policies = (
      await db.query<{ name: string; cmd: string; roles: string; qual: string | null }>(
        `select policyname as name, cmd, roles::text as roles, qual from pg_policies
          where schemaname = 'public' and tablename = $1 order by policyname`,
        [name],
      )
    ).rows;
    const columnReaders = cols
      .filter((c) => aclFor(c.acl, 'authenticated').includes('SELECT'))
      .map((c) => c.name);
    tables.push({
      name,
      rls: rel.rls,
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: !c.notnull,
        default: c.def,
      })),
      constraints,
      indexes,
      policies: policies.map((p) => ({
        name: p.name,
        command: p.cmd,
        roles: p.roles.replace(/^\{|\}$/g, ''),
        using: p.qual,
      })),
      grants: {
        anon: aclFor(rel.acl, 'anon'),
        authenticated: aclFor(rel.acl, 'authenticated'),
        authenticatedColumns: columnReaders.length > 0 ? columnReaders : null,
        hiddenColumns:
          columnReaders.length > 0
            ? cols.map((c) => c.name).filter((c) => !columnReaders.includes(c))
            : [],
        serviceRole: aclFor(rel.acl, 'service_role'),
        public: aclFor(rel.acl, ''),
      },
    });
  }
  const usersColumns = (await columns(db, 'users', NEW_USERS_COLUMNS)).map((c) => ({
    name: c.name,
    type: c.type,
    nullable: !c.notnull,
    default: c.def,
  }));
  const functions = (
    await db.query<{
      name: string;
      args: string;
      definer: boolean;
      config: string[] | null;
      acl: string | null;
    }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
              p.proconfig as config, p.proacl::text as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1) order by p.proname`,
      [[...ACCOUNT_FUNCTIONS]],
    )
  ).rows.map((f) => ({
    name: f.name,
    args: f.args,
    definer: f.definer,
    searchPath:
      (f.config ?? []).find((c) => c.startsWith('search_path='))?.slice('search_path='.length) ??
      null,
    execute: ['anon', 'authenticated', 'service_role'].filter((g) =>
      aclFor(f.acl, g).includes('EXECUTE'),
    ),
  }));
  return { tables, usersColumns, functions };
}

export const REPO_ROOT = resolve(HERE, '../../../..');

/**
 * Tracked, non-test source files that read or write v1 entitlement: `pro_until`/`proUntil`,
 * `lib/pro.ts`, or `deriveTier`. The pattern is the one docs/specs/v2/01-accounts.md states.
 */
export const V1_ENTITLEMENT_PATTERN =
  "pro_until|proUntil|isProActive|userIsPro|deriveTier|from '[./@/a-z-]*lib/pro'|from '\\./pro'|from '\\.\\./pro'";

export function v1EntitlementReaders(): string[] {
  const out = execFileSync(
    'git',
    [
      'grep',
      '-l',
      '-E',
      V1_ENTITLEMENT_PATTERN,
      '--',
      '*.ts',
      '*.tsx',
      ':!*.test.ts',
      ':!*.test.tsx',
      ':!*.spec.ts',
      ':!**/__tests__/**',
      ':!**/tests/**',
      // The spec renderer names these identifiers in the doc's own text.
      ':!apps/web/lib/entitlement-spec.ts',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean).sort();
}
