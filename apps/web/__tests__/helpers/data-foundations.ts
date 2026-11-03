import type { PGlite, Transaction } from '@electric-sql/pglite';

/**
 * CC-06b's guards, shared by v2-006b-data-foundations.test.ts (which enforces them) and
 * data-foundations-spec.ts (which renders them into docs/specs/v2/06b-data-foundations.md).
 */

type Db = PGlite | Transaction;

/**
 * Every table in `public` with a check_id column, classified. A measurement table names the lineage
 * that produced each row; a derived table records something about a check without being a
 * measurement of the site. A table added later with a check_id is unclassified and fails.
 */
export const MEASUREMENT_TABLES = ['access_tests', 'link_edges', 'page_results'];
export const DERIVED_TABLES = [
  'alert_events',
  'changes',
  'check_ledger_links',
  'evidence_blobs',
  'fix_events',
  'frontier',
  'frontier_politeness',
  'public_reports',
  'usage_events',
];

/** What breaks the lineage rule in `d`, as readable strings. */
export async function lineageViolations(d: Db): Promise<string[]> {
  const bad: string[] = [];
  const { rows: withCheck } = await d.query<{ t: string }>(
    `select c.relname as t from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attname = 'check_id'
        and not a.attisdropped order by 1`,
  );
  for (const { t } of withCheck)
    if (!MEASUREMENT_TABLES.includes(t) && !DERIVED_TABLES.includes(t))
      bad.push(`${t}: has check_id but is neither a measurement nor a derived table`);
  const lineageFk = async (schema: string, table: string) =>
    (
      await d.query<{ notnull: boolean }>(
        `select a.attnotnull as notnull from pg_constraint k
           join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
          where k.conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
            and k.contype = 'f' and k.confrelid = 'public.measurement_lineages'::regclass
            and a.attname = 'lineage_id' and cardinality(k.conkey) = 1`,
        [schema, table],
      )
    ).rows[0];
  for (const t of MEASUREMENT_TABLES) {
    const fk = await lineageFk('public', t);
    if (!fk) bad.push(`${t}: no lineage_id foreign key to measurement_lineages`);
    else if (!fk.notnull) bad.push(`${t}: lineage_id is nullable`);
  }
  // A check's lineage is set exactly when it has results (checks_lineage, in v2-003-check-tables).
  if (!(await lineageFk('public', 'checks'))) bad.push('checks: no lineage_id foreign key');
  const run = await lineageFk('research', 'check_runs');
  if (!run?.notnull) bad.push('research.check_runs: no required lineage_id foreign key');
  return bad;
}

/**
 * Every column the ledger may hold, with its type. The de-identification guard: a column not listed
 * here (an account_id, a seat, an email, a URL, a check id under any name) fails, and so does any
 * reference from the ledger into a customer table.
 */
export const LEDGER_COLUMNS: Record<string, string> = {
  'check_runs.id': 'uuid',
  'check_runs.observed_month': 'date',
  'check_runs.site_key': 'text',
  'check_runs.site_key_version': 'smallint',
  'check_runs.lineage_id': 'uuid',
  'check_runs.supersedes_id': 'uuid',
  'check_runs.supersedes_month': 'date',
  'check_runs.cms': 'text',
  'check_runs.frontend_framework': 'text',
  'check_runs.edge_vendor': 'text',
  'check_runs.without_js_state': 'text',
  'check_runs.share_2xx': 'numeric(3,2)',
  'check_runs.share_3xx': 'numeric(3,2)',
  'check_runs.share_4xx': 'numeric(3,2)',
  'check_runs.share_5xx': 'numeric(3,2)',
  'check_runs.share_unanswered': 'numeric(3,2)',
  'check_runs.signals_detected': 'text[]',
  'check_runs.signals_indeterminate': 'text[]',
  'crawler_observations.run_id': 'uuid',
  'crawler_observations.observed_month': 'date',
  'crawler_observations.crawler': 'text',
  'crawler_observations.verdict': 'text',
  'crawler_observations.measurement_status': 'text',
  'crawler_observations.cause': 'text',
  'crawler_observations.robots_rule': 'text',
};
/** The only references the ledger may make outside itself. */
export const LEDGER_REFERENCES = ['research.check_runs → public.measurement_lineages'];
const qualified = `n.nspname || '.' || c.relname`;

export async function deidentificationViolations(d: Db): Promise<string[]> {
  const bad: string[] = [];
  const { rows: cols } = await d.query<{ col: string; type: string }>(
    `select c.relname || '.' || a.attname as col, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'research' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and a.attnum > 0 and not a.attisdropped order by 1`,
  );
  const seen = new Set<string>();
  for (const { col, type } of cols) {
    seen.add(col);
    if (!(col in LEDGER_COLUMNS)) bad.push(`research.${col}: not an allowed ledger column`);
    else if (LEDGER_COLUMNS[col] !== type)
      bad.push(`research.${col}: is ${type}, allowed ${LEDGER_COLUMNS[col]}`);
  }
  for (const col of Object.keys(LEDGER_COLUMNS))
    if (!seen.has(col)) bad.push(`research.${col}: allowed but missing`);
  const { rows: refs } = await d.query<{ r: string }>(
    `select ${qualified} || ' → ' || fn.nspname || '.' || f.relname as r
       from pg_constraint k join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace join pg_class f on f.oid = k.confrelid
       join pg_namespace fn on fn.oid = f.relnamespace
      where n.nspname = 'research' and k.contype = 'f' and fn.nspname <> 'research'
        and k.conparentid = 0`,
  );
  for (const { r } of refs)
    if (!LEDGER_REFERENCES.includes(r)) bad.push(`${r}: the ledger may not reference a customer table`);
  return bad;
}
