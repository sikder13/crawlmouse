import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { ENTITIES } from '@crawlmouse/types/v2';
import { format, resolveConfig } from 'prettier';
import { REPO_ROOT } from './accounts-spec-catalog';
import { MIGRATIONS_DIR, ROLLBACKS_DIR, applyAllMigrations, freshDb } from './pglite-migrations';
import { MIGRATION_003, MIGRATION_005, MIGRATION_007, before, revertFile } from './v2-check-tables';

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
const code = (text: string): string => `\`${text}\``;
const table = (head: string[], rows: string[][]): string =>
  [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

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

async function tableSection(db: PGlite, t: string): Promise<string> {
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
      where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [t],
  );
  const cons = await db.query<{ name: string; type: string; def: string }>(
    `select conname as name, contype as type, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = ('public.' || $1)::regclass order by contype, conname`,
    [t],
  );
  const idx = await names(
    db,
    `select indexdef as n from pg_indexes where schemaname = 'public' and tablename = $1 order by indexname`,
    [t],
  );
  const pols = await db.query<{
    name: string;
    cmd: string;
    roles: string;
    qual: string | null;
    chk: string | null;
  }>(
    `select policyname as name, cmd, array_to_string(roles, ', ') as roles, qual, with_check as chk
       from pg_policies where schemaname = 'public' and tablename = $1 order by policyname`,
    [t],
  );
  const tablePrivs = await db.query<{ role: string; privs: string }>(
    `select r.role, concat_ws(', ',
              case when has_table_privilege(r.role, ('public.' || $1)::regclass, 'INSERT') then 'INSERT' end,
              case when has_table_privilege(r.role, ('public.' || $1)::regclass, 'DELETE') then 'DELETE' end,
              case when has_table_privilege(r.role, ('public.' || $1)::regclass, 'TRUNCATE') then 'TRUNCATE' end) as privs
       from unnest($2::text[]) r(role)`,
    [t, CLIENT_ROLES],
  );
  const parts = [`### \`${t}\``, ''];
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

/** Columns of a table that hold a contract entity but are not one of the entity's fields. */
async function databaseOnlyColumns(db: PGlite): Promise<string[][]> {
  const entityTable: Record<string, string> = {
    Site: 'sites',
    Check: 'checks',
    PageResult: 'page_results',
    LinkEdge: 'link_edges',
    AccessTest: 'access_tests',
    Fix: 'site_fixes',
    FixEvent: 'fix_events',
    Change: 'changes',
    AlertRule: 'alert_rules',
    Report: 'reports',
  };
  type Def = {
    type: string;
    shape?: Record<string, unknown>;
    options?: unknown[];
    innerType?: unknown;
  };
  const def = (s: unknown): Def => (s as { _zod: { def: Def } })._zod.def;
  const keys = (s: unknown): string[] => {
    const d = def(s);
    if (d.type === 'object') return Object.keys(d.shape!);
    if (d.type === 'union') return [...new Set(d.options!.flatMap(keys))];
    return [];
  };
  const unwrap = (s: unknown): unknown =>
    ['nullable', 'optional'].includes(def(s).type) ? unwrap(def(s).innerType) : s;
  const rows: string[][] = [];
  for (const e of ENTITIES) {
    const t = entityTable[e.name];
    if (!t) continue;
    const fields = keys(e.schema);
    const covered = new Set(fields);
    if (e.name === 'Site') {
      const shape = def(e.schema).shape!;
      for (const k of keys(unwrap(shape.schedule))) covered.add(`schedule_${k}`);
    }
    const cols = await names(
      db,
      `select attname as n from pg_attribute where attrelid = ('public.' || $1)::regclass and attnum > 0
          and not attisdropped order by attnum`,
      [t],
    );
    const extra = cols.filter((c) => !covered.has(c));
    if (extra.length > 0) rows.push([code(t), `${e.name}`, extra.map(code).join(', ')]);
  }
  return rows;
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
      where n.nspname in ('public', 'storage') and c.relkind = 'r' and has_table_privilege('crawl_worker', c.oid, p.p)
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

const INTRO = `# SPEC 06: the check-data tables (CC-06)

> Generated by \`pnpm --filter @crawlmouse/web exec tsx __tests__/helpers/write-06-check-tables-spec.ts\`. Do not edit it by hand: \`apps/web/__tests__/v2-06-check-tables-spec.test.ts\` fails when this file differs from what the generator writes. The schema sections are read from a PGlite database migrated through 007.

Three migrations, applied by the owner (OPERATING-RULES §7), in this order:

- **003 \`v2_sites_checks\`**: the tables that hold what a check measures, the client scope of a seat, \`is_member_for_site()\`, and the site effects of \`apply_entitlement_transition\`.
- **005 \`v2_sharing_columns\`**: nullable columns on v1's sharing and ledger tables (listed under \"Columns added to existing tables\"). Nothing dropped, renamed or re-granted.
- **007 \`v2_storage\`**: the private \`evidence\` and \`reports\` buckets and the \`crawl_worker\` role.

None of it is read by a live route yet. Backfills are later steps (004, and the 005 columns' values).

## How access works

- RLS is on for each table 003 creates, and each starts with \`revoke all … from public, anon, authenticated\`: production's default privileges would otherwise give \`anon\` every privilege on a new table, TRUNCATE included. Verify: \`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-003-check-tables.test.ts -t posture\`.
- \`authenticated\` reads site data through \`is_member_for_site(site_id)\`, directly or through the row's check, and account data (\`api_keys\`, \`seat_sites\`) through \`is_member()\` / \`member_role()\`. SELECT is granted per column.
- **Client scope.** \`is_member_for_site\` is true when the caller has an active seat on the site's live account and that seat covers the site. A seat covers a site when \`seats.client_scope_all\` is true (the contract's \`client_scope: 'all'\`; the default, so the seats 001 created keep full access) or when \`seat_sites\` pairs the seat with the site or with the production site it stages. An owner seat cannot be scoped (\`seats_owner_unscoped\`). Verify: \`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-003-cross-account.test.ts\`.
- \`site_fixes\` (the packet is Pro content), \`fix_events\` and \`share_links\` have no client grant: reading \`site_fixes.packet\` as \`authenticated\` is a permission error, not an empty result.
- \`alert_rules\` is the one client-written table: a site rule by the seats that cover the site, an account-wide rule by the owner. The trigger \`alert_rules_entitlement_check\` refuses Slack on an account whose effective tier is Free, for every writer the service role included.
- No anonymous site (\`account_id is null\`) is readable through RLS; \`/audit/[id]\` reads it with the service role, as v1 does.
`;

const TOKEN = `## The \`crawl_worker\` token

The Fly worker reaches Supabase only with this token. It never holds the project's JWT signing key: whoever holds a signing key can mint a \`service_role\` token too.

- **Who mints it.** The server, in the Inngest step that posts a batch to the worker, one token per check (or per batch). It is signed with a project JWT signing key the server holds: the legacy JWT secret, or a key imported into the project's JWT signing keys (Supabase supports importing a private key or setting a shared secret for exactly this). That key is server-side, at the same tier as the service-role key.
- **Claims.** \`role: "crawl_worker"\`, \`check_id\` (a lowercase uuid), \`iat\` and \`exp\` as numbers, \`exp − iat\` at most 900 seconds. No \`sub\`: the token is not a user.
- **What the database checks.** \`crawl_worker_check_id()\` reads the verified claims (\`auth.jwt()\`) and returns the check only when the role claim is \`crawl_worker\`, \`check_id\` is a well-formed uuid naming a check in status \`running\`, \`exp\` has not passed, \`iat\` is at most 60 seconds ahead of the database clock, and the lifetime is at most 900 seconds. Both policies hold only for that check, so a token minted with a longer life, for another check, or for a finished one is refused by the database, not only by the minter. Verify: \`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-007-storage.test.ts\`.
- **What it may do.** Insert \`page_results\` rows for its check, without RETURNING (\`Prefer: return=minimal\`), and upload \`evidence\` parts under \`{account_id | anon}/{site_id}/{check_id}.part{n}.json.gz\`. It cannot read, update or delete either, and holds no grant on \`frontier\` until \`frontier.audit_id\` stops being NOT NULL.
- **For the step that wires the worker.** Whether the server can mint today depends on the project's key setup, which this step does not read. If the project signs only with Supabase-managed asymmetric keys, the server has no private key to sign with, and a key must be imported (or a shared secret set) before the worker can run. That is a blocker for the wiring step, not for these migrations.
`;

const DIFFERENCES = `## Where this differs from the design documents

The merged contract (\`packages/types/src/v2\`) wins where it and ARCH-2 disagree; the owner's rulings of 2026-11-02 settle the rest.

- **Columns and enums follow the contract.** \`checks.status\` is the contract's \`CheckStatus\` (ARCH-2 has \`canceled\` and \`refused\`, the contract has \`partial\`); \`checks.trigger\` is \`CheckTrigger\` (\`first_audit\`, \`fix_recheck\`); \`grade_version\` is a semver string, not a smallint; \`sites.host\`, not \`hostname\`; a staging site points at its production site through \`staging_of_site_id\`, and competitors are \`sites.competitor_hosts\`, not rows. Fix types and statuses, change kinds and subjects, alert-rule kinds and fields, report kinds and formats, and \`page_results.kind\` (v1's \`PageKind\`) are the contract's lists. \`link_edges.js_only\` replaces ARCH-2's \`via\`. The contract guard compares each with the contract: \`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-contract-guard.test.ts\`.
- **Where the contract's objects are stored.** \`Site.schedule\` is the \`schedule_*\` columns; \`Site.client_report\` is \`report_schedules\` (one row per site), which replaces ARCH-2's schedule fields; \`Seat.client_scope\` is \`seats.client_scope_all\` with \`seat_sites\`; \`Site.paused\` is generated from \`paused_reason\`.
- **Access rules ship with the tables (003), not in a later 006.** A table without them would be open to \`anon\` from the moment it exists.
- **Per-seat client scoping is in the database** (\`is_member_for_site\`), not only in route handlers: a signed-in user can call PostgREST directly.
- **\`checks\` has no \`account_id\`.** ARCH-2 copies it for RLS speed; here a check reaches its account through \`sites\`, so no copy can drift from the site's.
- **\`page_results\` and \`link_edges\` are keyed by URL hashes** (sha256 of the UTF-8 URL, as \`frontier.url_hash\`), set by a trigger: the contract identifies them by URL, and a URL can exceed a btree key.
- **The \`changes\` idempotency index** is \`(check_id, kind, subject, "where", ua)\` with \`nulls not distinct\`. ARCH-2's \`(check_id, kind, subject)\` assumed a fine-grained subject (\`crawler:claude-searchbot\`); the contract's is a category (\`ChangeSubject\`), so two crawlers blocked in one check would collide.
- **\`alert_events\`** is unique on \`(rule_id, check_id, channel)\`: one rule sends on each of its channels. ARCH-2 says \`(rule_id, check_id)\`.
- **\`share_links\`** stores the token's sha256, not the token. **\`fix_events\`** has no client grant, like \`site_fixes\`.
- **Pausing keeps the schedule.** A paused site keeps its cadence, weekday and hour and records \`paused_reason\`; CC-02's planner models the same pause as \`schedule = null\`. A site given a cadence without a weekday or hour gets its creation weekday, in the account's time zone, at 06:00 (ARCH-2's defaults).
- **\`reports.site_id\` is required** (the contract); ARCH-2 allows null for an agency-wide export.
- **\`api_keys.scopes\`** are ARCH-2's \`read:checks\`, \`read:fixes\`, \`read:changes\`; SECURITY-DESIGN §3.6 says \`['read']\`.
- **The evidence path** is ARCH-2 §2.10's \`{account_id | anon}/{site_id}/{check_id}…\`; SECURITY-DESIGN §7.1 shows \`account/<id>/site/<id>/check/<id>\`.
- **Not built here:** ARCH-2's \`sites.page_cap\`, \`etld1\`, \`verified_at\`, \`latest_check_id\`, the \`checks\` pipeline columns and the J7 token hash. The contract does not name them, and a column added later is hidden from clients until it is granted. ARCH-2 §2.15's tables (\`crawl_batches\`, \`integrations\` and the rest) are their own steps.
`;

const FOLLOW_UPS_HEAD = `## Follow-ups

- **Ruled for 004:** v1 audits with status \`canceled\` have no v2 status; the backfill rules on them.
- **The contract does not name** the database-only columns in the table below. CC-12b adds \`Change.severity\`, which this branch takes when it lands.
- A scoped seat (\`client_scope_all = false\`) with no \`seat_sites\` row sees no site; the contract requires at least one, which spans rows, so the route that scopes a seat enforces it.
- \`reports.covers_check_ids\` elements are not foreign keys; the writer checks they are the report's site's checks.
- \`apps/web/lib/billing/state-machine-apply.ts\` still returns \`siteEffects\` for the caller to apply. After 003 the RPC applies them; applying them again is a no-op (\`planSites\` returns no change for a site already in its target state), and the comment there is out of date.
- \`docs/deploy/spec51a-stage6-frontier-functions-runbook.md\`'s routine check now returns \`is_member\`, \`is_member_for_site\` and \`member_role\`.
- **Re-applying 001 after 003 would put back 001's \`apply_entitlement_transition\`,** without the site effects. Do not re-run 001 once 003 is applied.
- **v1 hardening (owner sign-off, separate ticket):** under production's default privileges \`anon\` holds TRUNCATE on the v1 tables listed after the next table, as the PGlite model of those privileges shows; confirm on production with \`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and has_table_privilege('anon', oid, 'TRUNCATE')\`. PostgREST has no TRUNCATE request. v1 is frozen in this step.
`;

const RUNBOOK = `## Runbook (owner-applied, OPERATING-RULES §7)

1. **Dump.** \`pg_dump\` of \`public\` from \`ezspnfeyzwsisymytssm\`.
2. **Dry run on a fresh Supabase branch** (one no draft of these files was applied to: \`create table if not exists\` would skip a draft's table). Apply 003, 005 and 007 in order; apply each a second time (it must succeed and change nothing); run the checks of step 4. Then the part PGlite cannot model:
   - The bucket insert of 007 is accepted by the real \`storage.buckets\`.
   - \`grant usage on schema storage\` and \`grant insert on storage.objects\` to \`crawl_worker\` are accepted from the migration role, and \`create role\` is.
   - Mint a \`crawl_worker\` token on the branch (section "The \`crawl_worker\` token") for a check set to \`running\`, and through the Storage API upload \`{account}/{site}/{check}.part1.json.gz\` to \`evidence\`: it succeeds. A \`.v1.json.gz\` name, another check's path, the \`reports\` bucket and an expired token are refused. Through PostgREST, insert a \`page_results\` row with \`Prefer: return=minimal\`: it succeeds; a row for another check is refused.
   - If the Storage upload is refused for want of SELECT (an upload that reads its row back), stop and report it. Do not widen the grant without review.
   - Revert 007, 005 and 003 in that order, then apply all three again.
3. **Apply window.** One transaction per file, 003 then 005 then 007, at a quiet hour. Each \`alter table\` on an existing table (listed under \"Columns added to existing tables\") takes a brief exclusive lock on it.
4. **Verify on production.**
   - \`get_advisors\` (security): no new finding on the tables or functions these migrations create or change.
   - Grants, rendered above, against the catalog:
     \`\`\`sql
     select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('anon', 'authenticated', 'crawl_worker')
        and table_name in (TABLES) order by 1, 2, 3, 4;
     select c.relname, c.relrowsecurity, c.relacl::text from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (TABLES) order by 1;
     select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies
      where (schemaname = 'public' and tablename in (TABLES)) or schemaname = 'storage' order by 1, 2, 3;
     \`\`\`
     Expect no \`anon\` entry, and \`authenticated\` and \`crawl_worker\` holding what the tables above show.
   - The name-free routine check of \`docs/deploy/spec51a-stage6-frontier-functions-runbook.md\` returns \`is_member\`, \`is_member_for_site\` and \`member_role\`, each with \`anon = false\` and \`authed = true\` (PGlite: \`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-001-entitlement-tables.test.ts -t routines\`). Any other row is a finding.
   - \`select id, public from storage.buckets where id in ('evidence', 'reports');\`: two rows, \`public = false\`.
   - \`select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname = 'crawl_worker';\`: one row, \`false\`, \`false\`.
5. **Revert, if needed:** 007, then 005, then 003, each file twice-safe and tested on PGlite and in step 2. 003's revert drops its tables with their rows; take the dump first. 007's revert stops at a bucket that still holds objects: empty it through the Storage API first (Supabase refuses a direct delete of storage rows).
`;

export async function buildCheckTablesSpec(): Promise<string> {
  const pre = await freshDb();
  await applyAllMigrations(pre, undefined, before(MIGRATION_003));
  const db = await freshDb();
  await applyAllMigrations(db);
  const cat = await readCatalog(pre, db);

  const parts = [INTRO, '## Tables', ''];
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
    DIFFERENCES,
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
