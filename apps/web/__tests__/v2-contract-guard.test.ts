import type { PGlite } from '@electric-sql/pglite';
import { ALL_V2_ENUMS, ENTITIES, RULES, v2Registry } from '@crawlmouse/types/v2';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import { constraints, enumSetOf } from './helpers/v2-check-tables';

/**
 * The contract (packages/types/src/v2) against the migrated schema: every field of every entity this
 * step stores has a column, with the contract's nullability; every enum the contract places at a
 * column has a CHECK with exactly the enum's values; every enum and every rule is accounted for.
 *
 * Nothing here restates the contract. Fields, enums and rules are read from the zod schemas, the
 * `ENTITIES` list and the `RULES` registry, so a contract change (CC-12b's, say) turns this red
 * until the schema follows. What IS declared here is how this step stores the contract: which table
 * holds which entity, the one flattened and the one relocated object, where nested enums sit, and
 * which rules are CHECKs. Each declaration is compared with what the contract and catalog say.
 */

// ─── How the contract is stored (declared; every entry is verified below) ─────────────────────────

/** Entities this step stores, and their tables. */
const TABLE_OF: Record<string, string> = {
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

/** Entities stored elsewhere, and why this guard does not check them. */
const NOT_THIS_STEP: Record<string, string> = {
  Account: 'CC-01 (accounts); v2-001-entitlement-tables.test.ts',
  Seat: 'CC-01 (seats), except client_scope, which this step stores (checked below)',
  CrawlerRegistryEntry: 'registry seed data; no table',
};

/** A contract object stored as `<field>_<key>` columns of the same table. */
const FLATTENED: Record<string, string> = { 'Site.schedule': 'sites' };
/** A contract object stored as the columns of another table, one row per parent. */
const RELOCATED: Record<string, string> = { 'Site.client_report': 'report_schedules' };

/** Rules that are CHECK constraints, by constraint name. */
const RULE_CHECKS: Record<string, string> = {
  schedule_timed: 'sites_schedule_timed',
  schedule_pair: 'sites_schedule_pair',
  unkept_audit: 'sites_unkept_audit',
  client_report_cadence: 'report_schedules_client_report_cadence',
  check_progress: 'checks_progress',
  check_not_started: 'checks_not_started',
  check_started: 'checks_started',
  check_finished_at: 'checks_finished_at',
  check_deferred_until: 'checks_deferred_until',
  check_failure_reason: 'checks_failure_reason',
  check_coverage: 'checks_coverage',
  check_both_grades: 'checks_both_grades',
  check_grades_when_ended: 'checks_grades_when_ended',
  observed_owner_logs: 'access_tests_observed_owner_logs',
  fix_last_state: 'site_fixes_last_state',
  fix_rank: 'site_fixes_rank',
  packet_framework: 'site_fixes_packet_framework',
  effect_pending: 'site_fixes_effect_pending',
  alert_threshold: 'alert_rules_threshold',
  alert_fired_pair: 'alert_rules_fired_pair',
  report_sent: 'reports_sent',
  report_send_time: 'reports_send_time',
  report_slug: 'reports_slug',
  report_open_tracking: 'reports_open_tracking',
};

/** Rules the zod schema enforces when a row is written, and why they are not CHECKs. */
const RULES_AT_WRITE: Record<string, string> = {
  check_result_link: 'compares two timestamps inside checks.result_email (jsonb)',
  i4_withheld: 'counts measured crawlers inside checks.crawlers (jsonb)',
  i4_given: 'counts measured crawlers inside checks.crawlers (jsonb)',
  coverage_gradeable: 'sums inside checks.coverage (jsonb)',
  coverage_crawled: 'inside checks.coverage (jsonb)',
  coverage_sampled: 'inside checks.coverage (jsonb)',
  crawler_scored: 'per element of checks.crawlers (jsonb)',
  score_grade_pair: 'inside checks.technical_seo / ai_readability (jsonb)',
  refusal_score: 'inside checks.technical_seo (jsonb)',
  access_range_order: 'inside checks.ai_readability (jsonb)',
  total_sum: 'inside checks.ai_readability (jsonb)',
};

/** Rules of entities or primitives this step does not store. */
const RULES_NOT_THIS_STEP: Record<string, string> = {
  billing_period: 'Account (CC-01)',
  history_current: 'Account (CC-01)',
  history_forward: 'Account (CC-01)',
  trial_consent: 'Account (CC-01)',
  trial_ends: 'Account (CC-01)',
  branding_dns: 'Account branding (CC-01)',
  branding_email_auth: 'Account branding (CC-01)',
  branding_postal: 'Account branding (CC-01)',
  time_zone: 'a value shape, enforced at write',
  crawled_text_budget: 'a value shape, enforced at write',
  crawled_text_surrogate: 'a value shape, enforced at write',
  verification_alone: 'crawler registry (no table)',
  verification_unique: 'crawler registry (no table)',
  ip_list_url: 'crawler registry (no table)',
};

/** Enums that occur inside a jsonb column, by enum id: the columns, sorted. Enforced at write. */
const NESTED: Record<string, string[]> = {
  AccessCause: ['checks.crawlers'],
  CheckPhase: ['checks.progress'],
  Channel: ['changes.notified'],
  CmsName: ['checks.stack'],
  Confidence: ['checks.crawlers'],
  ContentCheck: ['checks.content'],
  CrawlerGroup: ['checks.crawlers'],
  DetectionState: ['checks.signals'],
  EstimateBound: ['site_fixes.before_after'],
  EvidenceClass: ['checks.crawlers'],
  FixMeasure: ['site_fixes.before_after'],
  GradeLetter: ['changes.grade_deltas', 'checks.ai_readability', 'checks.competitors', 'checks.technical_seo'],
  GradeName: ['changes.grade_deltas'],
  JsTextState: ['page_results.without_js'],
  PacketFramework: ['site_fixes.packet'],
  PageKind: ['checks.coverage'],
  RefusalTrigger: ['checks.technical_seo'],
  SampleMethod: ['checks.coverage'],
  SignalKind: ['checks.signals'],
  StepState: ['checks.progress'],
  Verdict: ['checks.crawlers'],
};

/** Enums no table of this step holds, and where they live. */
const NOT_STORED_HERE: Record<string, string> = {
  AccountState: 'accounts.state (CC-01)',
  SeatRole: 'seats.role (CC-01)',
  Theme: 'seats.theme (CC-01)',
  IntegrationKind: 'Account.integrations; the integrations table is a later step',
  VerificationMethod: 'crawler registry seed data',
  WithheldCollection: 'fixture metadata',
};

// ─── Reading the zod schemas ──────────────────────────────────────────────────────────────────────

type Schema = unknown;
interface Def {
  type: string;
  shape?: Record<string, Schema>;
  innerType?: Schema;
  element?: Schema;
  options?: Schema[];
  entries?: Record<string, string>;
}
const def = (s: Schema): Def => (s as { _zod: { def: Def } })._zod.def;
const enumId = (s: Schema): string | undefined => (v2Registry.get(s as never) as { id: string } | undefined)?.id;

function unwrapNullable(s: Schema): { schema: Schema; nullable: boolean } {
  let nullable = false;
  let cur = s;
  for (;;) {
    const d = def(cur);
    if (d.type === 'nullable') nullable = true;
    else if (d.type !== 'optional') return { schema: cur, nullable };
    cur = d.innerType!;
  }
}

/** The fields of an object schema, or of every option of a union of objects (FixEvent). */
function fieldsOf(s: Schema): Map<string, { schema: Schema; nullable: boolean }> {
  const d = def(s);
  if (d.type === 'object') {
    return new Map(Object.entries(d.shape!).map(([k, v]) => [k, unwrapNullable(v)]));
  }
  if (d.type === 'union') {
    const opts = d.options!.map(fieldsOf);
    const keys = new Set(opts.flatMap((o) => [...o.keys()]));
    return new Map(
      [...keys].map((k) => {
        const present = opts.map((o) => o.get(k)).filter((x) => x !== undefined);
        return [k, { schema: present[0]!.schema, nullable: present.length < opts.length || present.some((p) => p.nullable) }];
      }),
    );
  }
  throw new Error(`not an object or union of objects: ${d.type}`);
}

/** Every enum id reachable from `s`. */
function enumsBelow(s: Schema): Set<string> {
  const out = new Set<string>();
  const walk = (x: Schema) => {
    const d = def(x);
    const id = enumId(x);
    if (d.type === 'enum') {
      if (!id) throw new Error('an enum without a registry id');
      out.add(id);
      return;
    }
    if (d.type === 'nullable' || d.type === 'optional') return walk(d.innerType!);
    if (d.type === 'array') return walk(d.element!);
    if (d.type === 'object') return Object.values(d.shape!).forEach(walk);
    if (d.type === 'union') return d.options!.forEach(walk);
  };
  walk(s);
  return out;
}

/** A column the contract binds: table.column holds `schema`. */
interface Binding {
  table: string;
  column: string;
  schema: Schema;
  nullable: boolean;
  at: string;
}

function bindings(): Binding[] {
  const out: Binding[] = [];
  for (const entity of ENTITIES) {
    const table = TABLE_OF[entity.name];
    if (!table) continue;
    for (const [field, f] of fieldsOf(entity.schema)) {
      const at = `${entity.name}.${field}`;
      if (FLATTENED[at] || RELOCATED[at]) {
        const t = FLATTENED[at] ?? RELOCATED[at]!;
        for (const [sub, g] of fieldsOf(f.schema)) {
          out.push({
            table: t,
            column: FLATTENED[at] ? `${field}_${sub}` : sub,
            schema: g.schema,
            // A flattened nullable object makes every column of it nullable.
            nullable: g.nullable || (FLATTENED[at] !== undefined && f.nullable),
            at: `${at}.${sub}`,
          });
        }
      } else {
        out.push({ table, column: field, schema: f.schema, nullable: f.nullable, at });
      }
    }
  }
  return out;
}

// ─── The catalog ──────────────────────────────────────────────────────────────────────────────────

let db: PGlite;
const columns = new Map<string, { notnull: boolean; type: string }>();
const enumChecks = new Map<string, string[]>(); // 'table.column' → values

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  const { rows } = await db.query<{ t: string; c: string; notnull: boolean; type: string }>(
    `select c.relname as t, a.attname as c, a.attnotnull as notnull, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`,
  );
  for (const r of rows) columns.set(`${r.t}.${r.c}`, { notnull: r.notnull, type: r.type });
  const tables = new Set([...Object.values(TABLE_OF), ...Object.values(RELOCATED)]);
  for (const t of tables) {
    for (const k of await constraints(db, t)) {
      const set = enumSetOf(k.def);
      if (set && k.columns.length === 1) enumChecks.set(`${t}.${k.columns[0]}`, set);
    }
  }
}, 120_000);

describe('the declarations cover the contract', () => {
  it('every entity is stored here or named as stored elsewhere', () => {
    const named = new Set([...Object.keys(TABLE_OF), ...Object.keys(NOT_THIS_STEP)]);
    expect(ENTITIES.map((e) => e.name).filter((n) => !named.has(n))).toEqual([]);
    expect([...named].filter((n) => !ENTITIES.some((e) => e.name === n))).toEqual([]);
  });

  it('every rule is a CHECK, enforced at write, or not this step’s, exactly once', () => {
    const lists = [RULE_CHECKS, RULES_AT_WRITE, RULES_NOT_THIS_STEP].map(Object.keys);
    const all = lists.flat();
    expect(all.length, 'a rule is classified twice').toBe(new Set(all).size);
    expect(Object.keys(RULES).filter((r) => !all.includes(r)), 'unclassified rules').toEqual([]);
    expect(all.filter((r) => !(r in RULES)), 'classified rules the contract does not have').toEqual([]);
  });
});

describe('every contract field has a column', () => {
  it('with the same name, or the declared flattened / relocated names', () => {
    const missing = bindings()
      .filter((b) => !columns.has(`${b.table}.${b.column}`))
      .map((b) => `${b.at} → ${b.table}.${b.column}`);
    expect(missing).toEqual([]);
  });

  it('nullable exactly where the contract is nullable', () => {
    const wrong = bindings()
      .filter((b) => columns.has(`${b.table}.${b.column}`))
      .filter((b) => columns.get(`${b.table}.${b.column}`)!.notnull === b.nullable)
      .map((b) => `${b.at}: contract ${b.nullable ? 'nullable' : 'required'}, column ${b.nullable ? 'NOT NULL' : 'nullable'}`);
    expect(wrong).toEqual([]);
  });

  it('a contract number is a double precision column, and a contract integer an integer column', () => {
    // A JS number is a double: real (4 bytes) or numeric(p,s) would round what the contract allows.
    const wrong: string[] = [];
    for (const b of bindings()) {
      const d = def(b.schema) as Def & { format?: string };
      if (d.type !== 'number') continue;
      const type = columns.get(`${b.table}.${b.column}`)?.type;
      const want = d.format === 'safeint' ? ['smallint', 'integer', 'bigint'] : ['double precision'];
      if (!type || !want.includes(type)) wrong.push(`${b.at} → ${b.table}.${b.column}: ${type}, want ${want.join(' or ')}`);
    }
    expect(wrong).toEqual([]);
  });

  it('Seat.client_scope is seats.client_scope_all with seat_sites', () => {
    expect(columns.get('seats.client_scope_all')).toEqual({ notnull: true, type: 'boolean' });
    expect(columns.has('seat_sites.seat_id') && columns.has('seat_sites.site_id')).toBe(true);
  });
});

describe('every enum the contract places at a column has a CHECK with exactly its values', () => {
  it('scalar and array enum columns', () => {
    const wrong: string[] = [];
    for (const b of bindings()) {
      const d = def(b.schema);
      const target = d.type === 'array' ? def(d.element!) : d;
      if (target.type !== 'enum') continue;
      const want = Object.values(target.entries!).sort();
      const got = enumChecks.get(`${b.table}.${b.column}`);
      if (JSON.stringify(got) !== JSON.stringify(want))
        wrong.push(`${b.at} → ${b.table}.${b.column}: CHECK ${JSON.stringify(got)}, contract ${JSON.stringify(want)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('the enums nested in jsonb columns are exactly the declared ones, where declared', () => {
    const nested = new Map<string, Set<string>>();
    for (const b of bindings()) {
      const d = def(b.schema);
      const scalar = d.type === 'enum' || (d.type === 'array' && def(d.element!).type === 'enum');
      if (scalar) continue;
      for (const id of enumsBelow(b.schema)) {
        if (!nested.has(id)) nested.set(id, new Set());
        nested.get(id)!.add(`${b.table}.${b.column}`);
      }
    }
    const computed = Object.fromEntries([...nested].map(([id, at]) => [id, [...at].sort()]).sort());
    expect(computed).toEqual(Object.fromEntries(Object.entries(NESTED).sort()));
  });

  it('every enum is checked at a column, nested in jsonb, or declared as not stored here', () => {
    const checked = new Set<string>();
    for (const b of bindings()) {
      const d = def(b.schema);
      const target = d.type === 'array' ? d.element! : b.schema;
      const id = def(target).type === 'enum' ? enumId(target) : undefined;
      if (id) checked.add(id);
    }
    const ids = ALL_V2_ENUMS.map((e) => enumId(e)!);
    const unaccounted = ids.filter((id) => !checked.has(id) && !NESTED[id] && !NOT_STORED_HERE[id]);
    expect(unaccounted).toEqual([]);
    const stale = Object.keys(NOT_STORED_HERE).filter((id) => checked.has(id) || NESTED[id] || !ids.includes(id));
    expect(stale, 'declared not-stored but stored, or not an enum').toEqual([]);
  });
});

describe('every rule declared as a CHECK is one', () => {
  it('the constraint exists on the entity’s table', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select conname as name from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`,
    );
    const names = new Set(rows.map((r) => r.name));
    expect(Object.values(RULE_CHECKS).filter((c) => !names.has(c))).toEqual([]);
  });
});
