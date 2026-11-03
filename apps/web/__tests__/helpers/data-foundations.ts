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
/** The only functions in `research`. */
export const LEDGER_FUNCTIONS = [
  'research.check_runs_supersedes_same_site()',
  'research.ledger_append_only()',
  'research.text_array_distinct(text[])',
];
/** The only triggers on a ledger table or partition, by name, with the function each runs. */
export const LEDGER_TRIGGERS: Record<string, string> = {
  check_runs_append_only: 'research.ledger_append_only',
  check_runs_no_truncate: 'research.ledger_append_only',
  check_runs_supersedes_same_site: 'research.check_runs_supersedes_same_site',
  crawler_observations_append_only: 'research.ledger_append_only',
  crawler_observations_no_truncate: 'research.ledger_append_only',
};

/**
 * The ledger's relations: every relation in `research`, and every partition (in `partitions`) of one.
 * A relation in `partitions` that is no partition of a month-partitioned table is reported too, so the
 * schema cannot hold a side table out of the guard's sight.
 */
const LEDGER_RELATIONS = `
  with recursive ledger(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'research'
    union
    select i.inhrelid from pg_inherits i join ledger l on l.oid = i.inhparent
  )
  select oid from ledger`;

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

  // Foreign keys declared on a ledger relation or one of its partitions (a clone the parent's key
  // made has conparentid set), named by the parents of both ends.
  const { rows: refs } = await d.query<{ r: string; internal: boolean }>(
    `with ledger as (${LEDGER_RELATIONS}),
          root as (
            select c.oid, coalesce((select p.oid from pg_inherits i join pg_class p on p.oid = i.inhparent
                                     where i.inhrelid = c.oid), c.oid) as root
              from pg_class c)
     select rn.nspname || '.' || rc.relname || ' → ' || fn.nspname || '.' || fc.relname as r,
            f.root in (select oid from ledger) as internal
       from pg_constraint k
       join root r on r.oid = k.conrelid join pg_class rc on rc.oid = r.root
       join pg_namespace rn on rn.oid = rc.relnamespace
       join root f on f.oid = k.confrelid join pg_class fc on fc.oid = f.root
       join pg_namespace fn on fn.oid = fc.relnamespace
      where k.contype = 'f' and k.conparentid = 0 and k.conrelid in (select oid from ledger)`,
  );
  for (const { r, internal } of refs)
    if (!internal && !LEDGER_REFERENCES.includes(r))
      bad.push(`${r}: the ledger may not reference a customer table`);

  const { rows: strays } = await d.query<{ r: string }>(
    `select n.nspname || '.' || c.relname as r from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'partitions' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_inherits i join pg_partitioned_table pt on pt.partrelid = i.inhparent
                         where i.inhrelid = c.oid)
      order by 1`,
  );
  for (const { r } of strays) bad.push(`${r}: \`partitions\` holds only partitions`);

  const { rows: fns } = await d.query<{ f: string }>(
    `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'research' order by 1`,
  );
  for (const { f } of fns)
    if (!LEDGER_FUNCTIONS.includes(f)) bad.push(`${f}: not an allowed ledger function`);

  const { rows: triggers } = await d.query<{ t: string; rel: string; fn: string }>(
    `select t.tgname as t, t.tgrelid::regclass::text as rel, t.tgfoid::regproc::text as fn
       from pg_trigger t where not t.tgisinternal and t.tgrelid in (${LEDGER_RELATIONS}) order by 2, 1`,
  );
  for (const { t, rel, fn } of triggers)
    if (LEDGER_TRIGGERS[t] !== fn)
      bad.push(`${rel}: trigger ${t} (${fn}) is not an allowed ledger trigger`);

  // A rule is a side effect attached to the table, like a trigger; the ledger has none.
  const { rows: ruled } = await d.query<{ rel: string; rule: string }>(
    `select r.ev_class::regclass::text as rel, r.rulename as rule from pg_rewrite r
      where r.ev_class in (${LEDGER_RELATIONS}) and r.rulename <> '_RETURN' order by 1, 2`,
  );
  for (const { rel, rule } of ruled) bad.push(`${rel}: rule ${rule} is not allowed on the ledger`);

  // A function a CHECK, a policy or a default on the ledger calls runs on every write or read.
  const { rows: called } = await d.query<{ rel: string; f: string }>(
    `with ledger as (${LEDGER_RELATIONS}),
          owned as (
            select 'pg_constraint'::regclass as classid, oid, conrelid as rel from pg_constraint
            union all select 'pg_policy'::regclass, oid, polrelid from pg_policy
            union all select 'pg_attrdef'::regclass, oid, adrelid from pg_attrdef)
     select distinct o.rel::regclass::text as rel, d.refobjid::regprocedure::text as f
       from pg_depend d join owned o on o.classid = d.classid and o.oid = d.objid
      where d.refclassid = 'pg_proc'::regclass and o.rel in (select oid from ledger)
      order by 1, 2`,
  );
  for (const { rel, f } of called)
    if (!LEDGER_FUNCTIONS.includes(f))
      bad.push(`${rel}: calls ${f}, which is not an allowed ledger function`);
  return bad;
}
