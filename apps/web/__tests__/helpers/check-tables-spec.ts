import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { ENTITIES } from '@crawlmouse/types/v2';
import { format, resolveConfig } from 'prettier';
import { REPO_ROOT } from './accounts-spec-catalog';
import { MIGRATIONS_DIR, ROLLBACKS_DIR, applyAllMigrations, freshDb } from './pglite-migrations';
import {
  MIGRATION_003,
  MIGRATION_005,
  MIGRATION_007,
  before,
  revertFile,
  through,
} from './v2-check-tables';
import {
  FLATTENED,
  NESTED,
  RELOCATED,
  RULE_CHECKS,
  RULES_AT_WRITE,
  SHAPE_CHECKS,
  TABLE_OF,
} from './v2-contract-storage';

/**
 * Renders docs/specs/v2/06-check-tables.md. Everything in it that names the schema (tables, columns,
 * constraints, indexes, policies, grants, functions, the columns the contract does not name, the SQL
 * and its hashes) is read from a migrated PGlite database and the migration files. The prose sections
 * hold decisions, not facts about the schema.
 */

export const SPEC_06_PATH = resolve(REPO_ROOT, 'docs/specs/v2/06-check-tables.md');
const MIGRATIONS = [MIGRATION_003, MIGRATION_005, MIGRATION_007];
const CLIENT_ROLES = ['anon', 'authenticated', 'crawl_worker'] as const;

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
export const code = (text: string): string => `\`${text}\``;
export const table = (head: string[], rows: string[][]): string =>
  [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
export const sha256 = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

async function names(db: PGlite, sql: string, args: unknown[] = []): Promise<string[]> {
  return (await db.query<{ n: string }>(sql, args)).rows.map((r) => r.n);
}

interface Catalog {
  newTables: string[];
  addedColumns: {
    table: string;
    column: string;
    type: string;
    nullable: boolean;
    default: string | null;
  }[];
  anonTruncate: string[];
}

async function readCatalog(pre: PGlite, db: PGlite): Promise<Catalog> {
  const tablesSql = `select tablename as n from pg_tables where schemaname = 'public' order by 1`;
  const preTables = new Set(await names(pre, tablesSql));
  const newTables = (await names(db, tablesSql)).filter((t) => !preTables.has(t));
  const colSql = `select c.relname as t, a.attname as c, format_type(a.atttypid, a.atttypmod) as type,
                         not a.attnotnull as nullable, pg_get_expr(d.adbin, d.adrelid) as def
                    from pg_attribute a join pg_class c on c.oid = a.attrelid
                    join pg_namespace n on n.oid = c.relnamespace
                    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
                   order by c.relname, a.attnum`;
  type Col = { t: string; c: string; type: string; nullable: boolean; def: string | null };
  const preCols = new Set((await pre.query<Col>(colSql)).rows.map((r) => `${r.t}.${r.c}`));
  const addedColumns = (await db.query<Col>(colSql)).rows
    .filter((r) => preTables.has(r.t) && !preCols.has(`${r.t}.${r.c}`))
    .map((r) => ({ table: r.t, column: r.c, type: r.type, nullable: r.nullable, default: r.def }));
  const anonTruncate = await names(
    pre,
    `select c.relname as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'TRUNCATE')
      order by 1`,
  );
  return { newTables, addedColumns, anonTruncate };
}

/** One table's columns, keys, CHECKs, indexes, policies and client privileges, from the catalog. */
export async function tableSection(db: PGlite, t: string, schema = 'public'): Promise<string> {
  const rel = `${schema}.${t}`;
  const cols = await db.query<{
    c: string;
    type: string;
    nullable: boolean;
    def: string | null;
    generated: string;
    authed: string;
  }>(
    `select a.attname as c, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
            pg_get_expr(d.adbin, d.adrelid) as def, a.attgenerated as generated,
            concat_ws(', ',
              case when has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') then 'SELECT' end,
              case when has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') then 'INSERT' end,
              case when has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') then 'UPDATE' end) as authed
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [rel],
  );
  const cons = await db.query<{ name: string; type: string; def: string }>(
    `select conname as name, contype as type, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = $1::regclass and conparentid = 0 order by contype, conname`,
    [rel],
  );
  const idx = await names(
    db,
    `select indexdef as n from pg_indexes where schemaname = $2 and tablename = $1 order by indexname`,
    [t, schema],
  );
  const pols = await db.query<{
    name: string;
    cmd: string;
    roles: string;
    qual: string | null;
    chk: string | null;
  }>(
    `select policyname as name, cmd, array_to_string(roles, ', ') as roles, qual, with_check as chk
       from pg_policies where schemaname = $2 and tablename = $1 order by policyname`,
    [t, schema],
  );
  const tablePrivs = await db.query<{ role: string; privs: string }>(
    `select r.role, concat_ws(', ',
              case when has_table_privilege(r.role, $1::regclass, 'INSERT') then 'INSERT' end,
              case when has_table_privilege(r.role, $1::regclass, 'DELETE') then 'DELETE' end,
              case when has_table_privilege(r.role, $1::regclass, 'TRUNCATE') then 'TRUNCATE' end) as privs
       from unnest($2::text[]) r(role)`,
    [rel, CLIENT_ROLES],
  );
  const parts = [`### \`${schema === 'public' ? t : rel}\``, ''];
  const { rows: key } = await db.query<{ k: string | null }>(
    `select pg_get_partkeydef($1::regclass) as k`,
    [rel],
  );
  if (key[0]!.k)
    parts.push(
      `Partitioned by ${code(key[0]!.k)}, one partition a month in the schema ${code('partitions')} (06b).`,
      '',
    );
  parts.push(
    table(
      ['Column', 'Type', 'Null', 'Default', '`authenticated`'],
      cols.rows.map((c) => [
        code(c.c),
        c.type,
        c.nullable ? 'yes' : 'no',
        c.generated === 's' ? `generated: ${code(c.def ?? '')}` : c.def === null ? '' : code(c.def),
        c.authed,
      ]),
    ),
    '',
  );
  const kinds: Record<string, string> = {
    p: 'Primary key',
    u: 'Unique',
    f: 'Foreign keys',
    c: 'CHECKs',
  };
  for (const [k, label] of Object.entries(kinds)) {
    const list = cons.rows.filter((c) => c.type === k);
    if (list.length === 0) continue;
    parts.push(`${label}:`, '', ...list.map((c) => `- ${code(c.name)}: ${code(c.def)}`), '');
  }
  parts.push('Indexes:', '', ...idx.map((i) => `- ${code(i)}`), '');
  parts.push(
    'Policies:',
    '',
    ...(pols.rows.length === 0
      ? ['- none (RLS on, so no client role reads or writes a row)']
      : pols.rows.map(
          (p) =>
            `- ${code(p.name)}: ${p.cmd} to ${p.roles}` +
            (p.qual ? `, using ${code(p.qual)}` : '') +
            (p.chk ? `, with check ${code(p.chk)}` : ''),
        )),
    '',
  );
  const writes = tablePrivs.rows.filter((r) => r.privs !== '');
  parts.push(
    'Table-level client privileges (INSERT, DELETE, TRUNCATE): ' +
      (writes.length === 0
        ? 'none.'
        : writes.map((r) => `${code(r.role)} ${r.privs}`).join('; ') + '.'),
    '',
  );
  return parts.join('\n');
}

/**
 * Columns of the tables that hold contract entities (TABLE_OF, plus the relocated objects' tables)
 * that are not one of the contract's fields.
 */
async function databaseOnlyColumns(db: PGlite): Promise<string[][]> {
  type Def = {
    type: string;
    shape?: Record<string, unknown>;
    options?: unknown[];
    innerType?: unknown;
  };
  const def = (x: unknown): Def => (x as { _zod: { def: Def } })._zod.def;
  const unwrap = (x: unknown): unknown =>
    ['nullable', 'optional'].includes(def(x).type) ? unwrap(def(x).innerType) : x;
  const keys = (x: unknown): string[] => {
    const d = def(unwrap(x));
    if (d.type === 'object') return Object.keys(d.shape!);
    if (d.type === 'union') return [...new Set(d.options!.flatMap(keys))];
    return [];
  };
  const covered = new Map<string, { entity: string; fields: Set<string> }>();
  const cover = (table: string, entity: string, field: string) => {
    if (!covered.has(table)) covered.set(table, { entity, fields: new Set() });
    covered.get(table)!.fields.add(field);
  };
  for (const e of ENTITIES) {
    const table = TABLE_OF[e.name];
    if (!table) continue;
    const shape = def(e.schema).shape;
    for (const field of keys(e.schema)) {
      const at = `${e.name}.${field}`;
      if (FLATTENED[at]) for (const k of keys(shape![field])) cover(table, e.name, `${field}_${k}`);
      else if (RELOCATED[at]) for (const k of keys(shape![field])) cover(RELOCATED[at]!, at, k);
      else cover(table, e.name, field);
    }
  }
  const rows: string[][] = [];
  for (const [table, { entity, fields }] of covered) {
    // A table a later migration creates (006b's usage_events) is 06b's to list.
    const { rows: exists } = await db.query<{ t: string | null }>(
      `select to_regclass('public.' || $1)::text as t`,
      [table],
    );
    if (exists[0]!.t === null) continue;
    const cols = await names(
      db,
      `select attname as n from pg_attribute where attrelid = ('public.' || $1)::regclass and attnum > 0
          and not attisdropped order by attnum`,
      [table],
    );
    const extra = cols.filter((c) => !fields.has(c));
    if (extra.length > 0) rows.push([code(table), entity, extra.map(code).join(', ')]);
  }
  return rows.sort((x, y) => x[0]!.localeCompare(y[0]!));
}

/** The storage declarations the contract guard verifies, as lists. */
function contractLists(): string {
  return [
    '### Contract rules held as CHECKs',
    '',
    table(
      ['Rule', 'Constraint'],
      Object.entries(RULE_CHECKS).map(([r, c]) => [
        code(r),
        `${code(c.table)}.${code(c.constraint)}`,
      ]),
    ),
    '',
    '### Field bounds of `PageResult` held as CHECKs (owner ruling 1)',
    '',
    '`crawl_worker` writes `page_results` straight from the worker, so the database holds the bounds the contract states for these fields and the column type does not. Verify: ' +
      V('v2-003-rule-agreement.test.ts', 'shape') +
      '.',
    '',
    table(
      ['Constraint', 'Field', 'Agreement with the contract'],
      Object.entries(SHAPE_CHECKS).map(([c, x]) => [
        `${code(x.table)}.${code(c)}`,
        x.shapeOf ? `${code(x.field)} (database only; the shape of ${x.shapeOf}’s)` : code(x.field),
        x.exact === true ? 'exact' : x.exact,
      ]),
    ),
    '',
    '### Contract rules the database does not check',
    '',
    'Where a rule reads inside jsonb on a table only the server writes, it is the writer’s (owner ruling 1); `site_fixes_packet_framework` and `site_fixes_effect_pending` also read jsonb on such a table, but were CHECKs before the ruling and stay. The table gives the reason for each rule here. The writer must parse the row with the contract schema before inserting it; nothing in this step does, because nothing writes these tables yet (follow-up below).',
    '',
    table(
      ['Rule', 'Why not a CHECK'],
      Object.entries(RULES_AT_WRITE).map(([r, why]) => [code(r), why]),
    ),
    '',
    '### Contract enums inside jsonb columns',
    '',
    'The writer parses these with the contract schema (owner default 1). A column a field-bound CHECK above covers is marked with that CHECK.',
    '',
    table(
      ['Enum', 'Columns'],
      Object.entries(NESTED).map(([id, at]) => [
        code(id),
        at
          .map((col) => {
            const shape = Object.entries(SHAPE_CHECKS).find(
              ([, x]) => `${x.table}.${x.field}` === col,
            );
            return shape ? `${code(col)} (CHECK ${code(shape[0])})` : code(col);
          })
          .join(', '),
      ]),
    ),
    '',
  ].join('\n');
}

async function functionsSection(pre: PGlite, db: PGlite): Promise<string> {
  const fnSql = `select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as n, p.prosrc as src
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;
  const preSrc = new Map(
    (await pre.query<{ n: string; src: string }>(fnSql)).rows.map((r) => [r.n, r.src]),
  );
  const changed = (await db.query<{ n: string; src: string }>(fnSql)).rows
    .filter((r) => preSrc.get(r.n) !== r.src)
    .map((r) => r.n)
    .sort();
  const rows: string[][] = [];
  for (const sig of changed) {
    const { rows: r } = await db.query<{ definer: boolean; holders: string }>(
      `select p.prosecdef as definer,
              concat_ws(', ', variadic array(select r.role from unnest(array['anon','authenticated','service_role','crawl_worker']) r(role)
                                              where has_function_privilege(r.role, p.oid, 'EXECUTE'))) as holders
         from pg_proc p where p.oid = $1::regprocedure`,
      [`public.${sig}`],
    );
    rows.push([
      code(sig),
      preSrc.has(sig) ? 'replaced' : 'new',
      r[0]!.definer ? 'definer' : 'invoker',
      r[0]!.holders || 'none of these roles',
    ]);
  }
  return table(
    ['Function', 'Status', 'Security', 'EXECUTE (anon, authenticated, service_role, crawl_worker)'],
    rows,
  );
}

async function workerSection(db: PGlite): Promise<string> {
  const privs = await db.query<{ t: string; p: string }>(
    `select n.nspname || '.' || c.relname as t, p.p from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(p)
      where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p') and has_table_privilege('crawl_worker', c.oid, p.p)
      order by 1, 2`,
  );
  const storagePols = await db.query<{
    name: string;
    cmd: string;
    roles: string;
    chk: string | null;
  }>(
    `select policyname as name, cmd, array_to_string(roles, ', ') as roles, with_check as chk
       from pg_policies where schemaname = 'storage' order by policyname`,
  );
  const buckets = await db.query<{ id: string; public: boolean }>(
    `select id, public from storage.buckets order by id`,
  );
  return [
    'Table privileges `crawl_worker` holds, read from the catalog:',
    '',
    ...privs.rows.map((r) => `- ${code(r.t)}: ${r.p}`),
    '',
    'Policies on `storage.objects`:',
    '',
    ...storagePols.rows.map(
      (p) => `- ${code(p.name)}: ${p.cmd} to ${p.roles}, with check ${code(p.chk ?? '')}`,
    ),
    '',
    'Buckets:',
    '',
    table(
      ['Bucket', 'Public'],
      buckets.rows.map((b) => [code(b.id), b.public ? 'yes' : 'no']),
    ),
  ].join('\n');
}

function sqlSection(): string {
  const parts: string[] = [];
  for (const m of MIGRATIONS) {
    const mig = resolve(MIGRATIONS_DIR, m);
    const rev = resolve(ROLLBACKS_DIR, revertFile(m));
    parts.push(
      `### \`${m}\``,
      '',
      table(
        ['File', 'sha256'],
        [
          [code(`infra/supabase/migrations/${m}`), code(sha256(mig))],
          [code(`infra/supabase/rollbacks/${revertFile(m)}`), code(sha256(rev))],
        ],
      ),
      '',
      '<details><summary>Migration SQL</summary>',
      '',
      '````sql',
      readFileSync(mig, 'utf8').trimEnd(),
      '````',
      '',
      '</details>',
      '',
      '<details><summary>Revert SQL</summary>',
      '',
      '````sql',
      readFileSync(rev, 'utf8').trimEnd(),
      '````',
      '',
      '</details>',
      '',
    );
  }
  return parts.join('\n');
}

// ─── Prose: decisions, not schema facts ───────────────────────────────────────────────────────────

export const V = (file: string, t = '') =>
  `\`pnpm --filter @crawlmouse/web exec vitest run __tests__/${file}${t ? ` -t "${t}"` : ''}\``;

const intro = (tables: string[]) => `# SPEC 06: the check-data tables (CC-06)

> Generated by \`pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-06-check-tables-spec.ts\`. Do not edit it by hand: \`apps/web/__tests__/v2-06-check-tables-spec.test.ts\` fails when this file differs from what the generator writes. The schema sections are read from a PGlite database migrated through 007.

Three migrations, applied by the owner (OPERATING-RULES §7), in this order:

- **003 \`v2_sites_checks\`**: the tables that hold what a check measures, the client scope of a seat, \`is_member_for_site()\`, and the site effects of \`apply_entitlement_transition\`.
- **005 \`v2_sharing_columns\`**: nullable columns on v1's sharing and ledger tables (listed under "Columns added to existing tables"). Nothing dropped, renamed or re-granted.
- **007 \`v2_storage\`**: the private \`evidence\` and \`reports\` buckets and the \`crawl_worker\` role.

CC-06b changed 003 and 007 before either was applied: every measurement row names its lineage (\`measurement_lineages\`), \`checks\` and \`access_tests\` carry their measurement status as generated columns, \`page_results\`, \`link_edges\` and \`access_tests\` are partitioned by the month their check was queued, and \`page_results\` records the vantage of its fetch. Those decisions, and 006b (the research ledger and usage metering, applied after 007), are \`docs/specs/v2/06b-data-foundations.md\`.

Nothing in \`apps/web\`, \`inngest\` or \`packages\` reads or writes the new tables through a Supabase client yet: \`grep -rnE 'from\\(.(${tables.join('|')})\\b' apps/web/app apps/web/lib inngest packages\` finds none. Backfills are later steps (004, and the 005 columns' values).

## How access works

- RLS is on for each table 003 creates, and each starts with \`revoke all … from public, anon, authenticated\`: production's default privileges would otherwise give \`anon\` every privilege on a new table, TRUNCATE included. Verify: ${V('v2-003-check-tables.test.ts', 'posture')}.
- \`authenticated\` reads site data through \`is_member_for_site(site_id)\`, directly or through the row's check, and account data (\`api_keys\`, \`seat_sites\`) through \`is_member()\` / \`member_role()\`. SELECT is granted per column. Verify: ${V('v2-003-cross-account.test.ts')}.
- **Client scope.** \`is_member_for_site\` is true when the caller has an active seat on the site's live (not soft-deleted) account and that seat covers the site. A seat covers a site when \`seats.client_scope_all\` is true (the contract's \`client_scope: 'all'\`; the default, so the seats 001 created keep full access) or when \`seat_sites\` pairs the seat with the site or with the production site it stages. An owner seat cannot be scoped (\`seats_owner_unscoped\`).
- \`site_fixes\` (the packet is Pro content), \`fix_events\` and \`share_links\` have no client grant: reading \`site_fixes.packet\` as \`authenticated\` is a permission error, not an empty result. Verify: ${V('v2-003-cross-account.test.ts', 'packet')}.
- \`alert_rules\` is the one client-written table: a site rule by the seats that cover the site, an account-wide rule by the owner. The trigger \`alert_rules_entitlement_check\` refuses a write that adds Slack while the account's effective tier is Free; it runs after the row's RLS check and for the service role too. Verify: ${V('v2-003-check-tables.test.ts', 'alert_rules')}.
- \`measurement_lineages\` is readable by every signed-in user: it names Crawlmouse's own builds, nothing of an account's. Verify: ${V('v2-003-cross-account.test.ts', 'measurement_lineages')}.
- A partition is reached only through its parent: partitions live in the schema \`partitions\`, which no client role may use, with RLS on and every role's privileges revoked. Verify: ${V('v2-006b-data-foundations.test.ts', 'monthly partitions')}.
- An anonymous site (\`account_id is null\`) is not readable through RLS (\`is_member_for_site\` joins the site's account); \`/audit/[id]\` reads it with the service role, as v1 does. Verify: ${V('v2-003-cross-account.test.ts', 'anonymous sites')}.
`;

const TOKEN = `## The \`crawl_worker\` token

The Fly worker is meant to reach Supabase with this token and nothing else. It never holds the project's JWT signing key: whoever holds a signing key can mint a \`service_role\` token too.

- **Who mints it.** The server, in the Inngest step that posts a batch to the worker, one token per check (or per batch). It is signed with a project JWT signing key the server holds: the legacy JWT secret, or a key imported into the project's JWT signing keys (Supabase supports importing a private key or setting a shared secret for this). That key is server-side, at the same tier as the service-role key.
- **Claims.** \`role: "crawl_worker"\`, \`check_id\` (a lowercase uuid), \`lineage_id\` (the lowercase uuid of the \`measurement_lineages\` row the server registered for the batch), \`iat\` and \`exp\` as numbers, \`exp − iat\` at most 900 seconds. No \`sub\`: the token is not a user.
- **What the database checks.** \`crawl_worker_check_id()\` reads the verified claims (\`auth.jwt()\`) and returns the check only when the role claim is \`crawl_worker\`, \`check_id\` is a well-formed uuid naming a check in status \`running\`, \`exp\` has not passed, \`iat\` is at most 60 seconds ahead of the database clock, and the lifetime is at most 900 seconds. Both policies hold only for that check, so a token minted with a longer life, for another check, or for a finished one is refused by the database, not only by the minter. Verify: ${V('v2-007-storage.test.ts')}.
- **Lineage and month.** A \`page_results\` row must name the token's \`lineage_id\`. A row that leaves out \`check_month\` or \`lineage_id\` takes them from the token (column defaults that call \`crawl_worker_check_month()\` and \`crawl_worker_lineage_id()\`), so the worker's row needs no partition key of its own. Verify: ${V('v2-007-storage.test.ts', 'from the token')}.
- **What it may do.** Insert \`page_results\` rows for its check, without RETURNING (\`Prefer: return=minimal\`), and upload \`evidence\` parts under \`{account_id | anon}/{site_id}/{check_id}.part{n}.json.gz\`. It cannot read, update or delete either, and holds no grant on \`frontier\` until \`frontier.audit_id\` stops being NOT NULL. A leaked token can still write any number of rows and parts for its check within its 15 minutes; nothing in the database caps volume.
- **For the step that wires the worker.** Whether the server can mint today depends on the project's key setup, which this step does not read. If the project signs only with Supabase-managed asymmetric keys, the server has no private key to sign with, and a key must be imported (or a shared secret set) before the worker can run. That is a blocker for the wiring step, not for these migrations.
`;

const DIFFERENCES = `## Where this differs from the design documents

The merged contract (\`packages/types/src/v2\`) wins where it and ARCH-2 disagree; the owner's rulings of 2026-11-02 settle the rest. The contract guard compares the columns and value sets with the contract: ${V('v2-contract-guard.test.ts')}.

- **Columns and enums follow the contract.** \`checks.status\` is the contract's \`CheckStatus\` (ARCH-2 has \`canceled\` and \`refused\`, the contract has \`partial\`); \`checks.trigger\` is \`CheckTrigger\` (\`first_audit\`, \`fix_recheck\`); \`grade_version\` is a semver string, not a smallint; \`sites.host\`, not \`hostname\`; a staging site points at its production site through \`staging_of_site_id\` (ARCH-2: \`kind\` and \`parent_site_id\`), and competitors are \`sites.competitor_hosts\`, not rows. Fix types and statuses, change kinds and subjects, alert-rule kinds and fields, report kinds and formats, and \`page_results.kind\` (v1's \`PageKind\`) are the contract's lists. \`link_edges.js_only\` replaces ARCH-2's \`via\`. The contract's \`Fix\` is the table \`site_fixes\`, as ARCH-2 §2.1 (not §2.8's \`fixes\`).
- **Where the contract's objects are stored.** \`Site.schedule\` is the \`schedule_*\` columns (weekday ISO 1–7; ARCH-2's \`schedule_dow\` is 0–6); \`Site.client_report\` is \`report_schedules\`, one row per site keyed by \`site_id\` (ARCH-2: an \`id\` key, \`recipients\`, \`send_hour\`, \`reply_to\`, \`kind\`, \`enabled\` and a \`monthly_first_monday\` cadence); \`Seat.client_scope\` is \`seats.client_scope_all\` with \`seat_sites\` (created here, not in 001, because it references \`sites\`); \`Site.paused\` is generated from \`paused_reason\`.
- **Access rules ship with the tables (003), not in a later 006.** A table without them would be open to \`anon\` from the moment it exists.
- **Per-seat client scoping is in the database** (\`is_member_for_site\`), not only in route handlers: a signed-in user can call PostgREST directly.
- **No client write on \`sites\`.** ARCH-2 §2.2 rule 3 grants a client update on the schedule columns behind an entitlement trigger; the brief keeps \`alert_rules\` the only client-written table, so schedule changes go through a route.
- **\`checks\` has no \`account_id\`.** ARCH-2 copies it for RLS speed; here a check reaches its account through \`sites\`, so no copy can drift from the site's. Its listing index is \`(site_id, queued_at desc)\` (ARCH-2: \`finished_at\`), because a queued or running check has no \`finished_at\`. ARCH-2 says a check is immutable once finished; nothing enforces it here (the contract clears \`expires_at\` when an account keeps a finished check).
- **\`page_results\` and \`link_edges\` are keyed by URL hashes** (sha256 of the UTF-8 URL, as \`frontier.url_hash\`), set by a trigger: the contract identifies them by URL, and a URL can exceed a btree key. Their keys, and \`access_tests\`', also hold \`check_month\`, because a partitioned table's unique keys must include its partition key; a writer's \`on conflict\` target names it too.
- **The \`changes\` idempotency index** is \`(check_id, kind, subject, "where", ua, fix_id)\` with \`nulls not distinct\`. ARCH-2's \`(check_id, kind, subject)\` assumed a fine-grained subject (\`crawler:claude-searchbot\`); the contract's is a category (\`ChangeSubject\`). The owner approved the key without \`fix_id\`; review showed two fixes opened in one check can share subject, place and crawler, so \`fix_id\` is part of it (owner ruling 4: confirmed).
- **\`alert_events\`** is unique on \`(rule_id, check_id, channel)\`: one rule sends on each of its channels. ARCH-2 says \`(rule_id, check_id)\`.
- **\`alert_rules_entitlement_check\`** (ARCH-2's name) refuses only a write that adds Slack, and runs after RLS. A rule that already sends to Slack stays updatable after a downgrade, so the owner can switch it off and alertFn can stamp \`last_fired_*\`; alertFn decides at send time whether the plan still includes Slack.
- **References between check rows are checked.** Composite foreign keys keep a report, rule, schedule, seat pairing and owner seat inside one account, and a check, change, fix or alert event inside one site. Triggers check what a foreign key cannot: a fix event's check and seat (\`fix_events_references\`), a rule's last-fired check (\`alert_rules_fired_check_scope\`) and an alert event's rule (\`alert_events_rule_scope\`). \`fix_events.check_id\` is deferred, so deleting an account or a site takes its fixes' events in the same statement as its checks; deleting a check an event still cites fails at commit. Verify: ${V('v2-003-check-tables.test.ts', 'deleting')}. The triggers check a row when it is written; a later service-role change to a parent's site or account (a rule's \`site_id\`, a fix's \`site_id\`) is not re-checked against rows that already cite it. No client can make such a change: neither column is in a client grant.
- **\`share_links\`** stores the token's sha256, not the token. **\`fix_events\`** has no client grant, like \`site_fixes\`.
- **Pausing keeps the schedule.** A paused site keeps its cadence, weekday and hour and records \`paused_reason\`; CC-02's planner models the same pause as \`schedule = null\`. A site checked on deploy keeps that cadence, except that on a move to Free the oldest site, unless the user paused it, takes Free's monthly check, because Free has no deploy hooks (\`GATES.free.stagingAndDeployHooks\`; owner ruling 2: confirmed). A site given a timed cadence without a weekday or hour gets its creation weekday, in the account's time zone (UTC when Postgres does not know the zone), at 06:00 (ARCH-2's defaults). A staging site follows the new tier's gates on every transition (owner ruling 3, \`planStagingSites\`): on a tier without staging (Free) a running staging site pauses as \`staging_not_in_plan\`, keeping its schedule, and on a tier with staging it runs again; a staging site paused for another reason is not changed. \`sites_staging_pause\` allows that reason on staging sites only. Verify: ${V('v2-003-site-effects.test.ts', 'staging')}.
- **Counts** are \`integer\` columns, \`bigint\` for byte counts: the contract's counts are unbounded safe integers, and \`integer\` caps them at 2,147,483,647. **Text** columns refuse a NUL character, which the contract's strings accept, and so does jsonb inside a string (\`page_results\`' \`hreflang\`, \`canonical_declared.href\` and \`robots_search[].ua\` among them); the engine strips NUL before persisting. **Dates** have no year 0 in Postgres; the contract's \`YYYY-MM-DD\` accepts \`0000\`, so a writer must not pass one (follow-up below).
- **\`reports.site_id\` is required** (the contract); ARCH-2 allows null for an agency-wide export. ARCH-2's \`reports.check_id\`, \`brand_id\` and \`schedule_id\` are not built.
- **\`api_keys.scopes\`** are ARCH-2's \`read:checks\`, \`read:fixes\`, \`read:changes\`; SECURITY-DESIGN §3.6 says \`['read']\`.
- **The evidence path** is ARCH-2 §2.10's \`{account_id | anon}/{site_id}/{check_id}…\`; SECURITY-DESIGN §7.1 shows \`account/<id>/site/<id>/check/<id>\`.
- **Not built here:** ARCH-2's \`sites.root_url\`, \`etld1\`, \`verified_at\`, \`verification_method\`, \`public_slug\`, \`schedule_offset_min\`, \`next_check_at\`, \`page_cap\`, \`latest_check_id\` / \`previous_check_id\`, \`trial_protected_until\`; the \`checks\` pipeline columns and the J7 token hash. The contract does not name them, and a column added later is hidden from clients until it is granted. ARCH-2 §2.15's tables (\`crawl_batches\`, \`recipient_confirmations\` for J10's double opt-in, \`integrations\` and the rest) are their own steps, as are SECURITY-DESIGN §10 #8's share and portal RPCs and #12's redaction of stored request headers (the writer's job).
`;

/** page_results' contract rules held as CHECKs, rendered from RULE_CHECKS. */
const PAGE_RESULT_RULES = Object.entries(RULE_CHECKS)
  .filter(([, c]) => c.table === 'page_results')
  .map(([r]) => `\`${r}\``)
  .join(', ');

const OPEN_QUESTIONS = `## Owner rulings (2026-11-02)

1. **Contract rules inside jsonb.** **Applied to \`page_results\`, the one table a less-trusted writer reaches.** None of the five rules named (\`coverage_crawled\`, \`coverage_sampled\`, \`refusal_score\`, \`score_grade_pair\`, \`access_range_order\`) reads \`page_results\`: each reads \`checks\` jsonb, which only the server writes, so they stay at the writer. The ruling's reason (\`crawl_worker\` writes \`page_results\` directly) was applied to that table's own fields instead: the bounds the contract's \`PageResult\` states and the column types do not hold are CHECKs, listed under "Field bounds of \`PageResult\` held as CHECKs", and so are its rules, inside jsonb included: ${PAGE_RESULT_RULES}. URLs are checked by scheme only, allowing the leading whitespace the contract trims. Verify: ${V('v2-003-rule-agreement.test.ts', 'shape')}.
2. **\`on_deploy\` primary sites: confirmed as built.** On a move to Free the oldest primary site, unless the user paused it, takes Free's monthly check even if it was checked on deploy, because Free has no deploy hooks; otherwise the effects keep a deploy-triggered cadence and only pause or resume it (planSites does not model one). A Free account can therefore still hold a primary site checked on deploy: one the user paused, or one paused as \`trial_ended\`.
3. **Staging sites pause on a move to Free** and run again on the move back to a tier whose gates include staging, with their own \`paused_reason\`, \`staging_not_in_plan\`. The planner (\`planStagingSites\` in \`apps/web/lib/billing/state-machine-sites.ts\`) and the RPC agree over generated sites. Verify: ${V('v2-003-site-effects.test.ts', 'staging')} and \`pnpm --filter @crawlmouse/web exec vitest run lib/billing/state-machine.property.test.ts -t staging\`.
4. **The \`changes\` key includes \`fix_id\`: confirmed.**
`;

const FOLLOW_UPS_HEAD = `## Follow-ups

- **Ruled for 004:** v1 audits with status \`canceled\` have no v2 status; the backfill rules on them.
- **The deploy-hook receiver and the route that unpauses a site check the plan.** A Free account can hold a site whose cadence is \`on_deploy\` (owner ruling 2), so the receiver checks \`GATES[tier].stagingAndDeployHooks\` before it starts a check, and unpausing a site on a tier without deploy hooks gives it that tier's cadence.
- **alertFn checks Slack at send time.** A rule that already sends to Slack stays enabled-able after a downgrade (the trigger refuses only adding Slack), so the step that builds alertFn checks the account's effective tier before each Slack send.
- **The writer validates.** The rules and enums listed above as not checked by the database are the writer's: CC-20's insert path parses each row with the contract schema before it writes.
- **The contract does not name** the database-only columns in the table below.
- **A \`sitemap_lastmod\` in year 0** passes the contract and is refused by the \`date\` type, so the step that writes it from a crawled sitemap drops or refuses such a date. Verify: ${V('v2-003-rule-agreement.test.ts', 'year 0')}.
- **No 2,048-character URL cap.** The worker cuts URLs to 2,048 characters (\`packages/worker/src/rows/bounded.ts\`), but the contract's \`HttpUrl\` states no length, so no CHECK holds one; the bound the contract does state, a declared canonical \`href\` of at most 8,192 UTF-8 bytes, is one (\`v2_canonical_shape_ok\`). A cap on every URL column needs the contract to state it first.
- A scoped seat (\`client_scope_all = false\`) with no \`seat_sites\` row sees no site; the contract requires at least one, which spans rows, so the route that scopes a seat enforces it. \`client_scope_all\` defaults to true (owner ruling): an invite that forgets it grants full scope, so the invite route always sets it. A default of false would refuse every sign-up, because 001's \`handle_new_user\` creates owner seats without naming the column.
- Hard-deleting one kept site fails while an account-wide alert rule last fired on one of its checks. Removing a site is a soft delete (\`removed_at\`), and deleting the account takes the rule too. Verify: ${V('v2-003-check-tables.test.ts', 'deleting')}.
- \`reports.covers_check_ids\` elements are not foreign keys; the writer checks they are the report's site's checks.
- Whoever writes \`accounts.timezone\` validates it against Postgres's zone names; the site effects fall back to UTC for a zone Postgres does not know.
- \`apps/web/lib/billing/state-machine-apply.ts\` still returns \`siteEffects\` for the caller to apply, and its comment says the RPC does not. After 003 the RPC applies them, and the staging changes \`planStagingSites\` plans; the caller must not apply either again (\`planSites\` given the database's kept schedule would plan a change). Update that file with the step that first calls it.
- \`docs/deploy/spec51a-stage6-frontier-functions-runbook.md\`'s routine check now returns \`is_member\`, \`is_member_for_site\` and \`member_role\`.
- **Re-applying 001 after 003 would put back 001's \`apply_entitlement_transition\`,** without the site effects. Do not re-run 001 once 003 is applied.
- **v1 hardening (owner sign-off, separate ticket):** under production's default privileges \`anon\` holds TRUNCATE on the v1 tables listed after the next table, as the PGlite model of those privileges shows; confirm on production with \`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and has_table_privilege('anon', oid, 'TRUNCATE')\`. PostgREST has no TRUNCATE request. v1 is frozen in this step.
`;

const RUNBOOK = `## Runbook (OPERATING-RULES §7)

The owner applied 003, 005 and 007 to production on 2026-11-05, with 006b after them (06b's runbook). A later change to these tables goes through the migration workflows in \`docs/ops/db-migrations.md\`: the pull request's dry run on a Supabase branch made from production, then \`supabase db push\` after the owner approves it. A rollback is a separate workflow run behind the same approval. The revert order is 006b, 007, 005, 003. 003's revert drops its tables with their rows, so take a \`pg_dump\` of \`public\` first.

1. **Checks.** The dry run runs these on the branch, and the apply runs them on production afterwards. They live in \`infra/supabase/checks\`, and \`docs/ops/db-migrations.md\` lists them with their meaning. \`pnpm --filter @crawlmouse/scripts exec vitest run db/check.test.ts\` shows each one failing on what it guards.
   - \`01-client-table-privileges.sql\`: the grants shown above, compared with the catalog. \`anon\` holds nothing on these tables; \`authenticated\` and \`crawl_worker\` hold what the tables above show.
   - \`05-private-buckets.sql\`: \`evidence\` and \`reports\` are private.
   - \`03-worker-roles-no-login.sql\`: \`crawl_worker\` cannot log in or bypass RLS.
   - \`06-client-functions.sql\`: in \`public\`, \`research\` and \`partitions\`, \`authenticated\` may execute \`is_member\`, \`is_member_for_site\`, \`member_role\` and \`usage_counts\`, and \`anon\` may execute none of the functions.
2. **By hand on a Supabase branch, for a change that touches Storage or \`crawl_worker\`.** The dry run does not cover these:
   - \`select policyname, cmd, roles, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects'\`: no INSERT policy may apply to \`public\` (or name no role), because policies are OR'd and such a policy would let \`crawl_worker\` past the path check. Also list \`crawl_worker\`'s privileges across \`storage\` (\`has_table_privilege\` / \`has_function_privilege\` over its tables and functions): INSERT on \`objects\` and nothing else.
   - Mint a \`crawl_worker\` token on the branch (section "The \`crawl_worker\` token") for a check set to \`running\`, and through the Storage API upload \`{account}/{site}/{check}.part1.json.gz\` to \`evidence\`: it succeeds. A \`.v1.json.gz\` name, another check's path, the \`reports\` bucket and an expired token are refused. Through PostgREST, insert a \`page_results\` row with \`Prefer: return=minimal\`: it succeeds; a row for another check is refused. If the upload is refused for want of SELECT (an upload that reads its row back), stop and report it. Do not widen the grant without review.
   - \`select r, has_schema_privilege(r, 'public', 'CREATE') from unnest(array['anon', 'authenticated', 'service_role', 'crawl_worker']) r\`: false for each. The SECURITY DEFINER functions resolve names through \`public\` before \`pg_catalog\`, so no client role may create objects in \`public\`.
3. **On production, after an apply.** \`get_advisors\` (security): no new finding on the tables or functions the change creates or alters.
4. **007's revert** refuses while either bucket holds objects, and gives the count per bucket: empty them through the Storage API first (Supabase refuses a direct delete of storage rows). It sets \`storage.allow_delete_query\` for its own transaction, which \`storage.protect_delete()\` requires before a bucket row can be deleted (${V('v2-007-storage.test.ts', 'allow_delete_query')}).
`;

export async function buildCheckTablesSpec(): Promise<string> {
  const pre = await freshDb();
  await applyAllMigrations(pre, undefined, before(MIGRATION_003));
  const db = await freshDb();
  await applyAllMigrations(db, undefined, through(MIGRATION_007));
  const cat = await readCatalog(pre, db);

  const parts = [intro(cat.newTables), '## Tables', ''];
  for (const t of cat.newTables) parts.push(await tableSection(db, t));
  parts.push(
    '## Columns added to existing tables',
    '',
    table(
      ['Table', 'Column', 'Type', 'Null', 'Default'],
      cat.addedColumns.map((c) => [
        code(c.table),
        code(c.column),
        c.type,
        c.nullable ? 'yes' : 'no',
        c.default ? code(c.default) : '',
      ]),
    ),
    '',
    '## Functions created or replaced',
    '',
    await functionsSection(pre, db),
    '',
    '## Storage and `crawl_worker`',
    '',
    await workerSection(db),
    '',
    TOKEN,
    '## How the contract is stored',
    '',
    contractLists(),
    DIFFERENCES,
    OPEN_QUESTIONS,
    FOLLOW_UPS_HEAD,
    'Database-only columns (not a field of the contract entity the table holds):',
    '',
    table(['Table', 'Entity', 'Columns'], await databaseOnlyColumns(db)),
    '',
    `v1 tables where \`anon\` holds TRUNCATE (before 003): ${cat.anonTruncate.map(code).join(', ')}.`,
    '',
    RUNBOOK.replace(/\(TABLES\)/g, `(${cat.newTables.map((t) => `'${t}'`).join(', ')})`),
    '## The SQL for approval',
    '',
    sqlSection(),
  );
  const md = parts.join('\n');
  const config = (await resolveConfig(SPEC_06_PATH)) ?? {};
  return format(md, { ...config, filepath: SPEC_06_PATH });
}
