import type { PGlite } from '@electric-sql/pglite';
import { ALL_V2_ENUMS, ENTITIES, FixTypeSchema, RULES, v2Registry } from '@crawlmouse/types/v2';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import { constraints, enumSetOf } from './helpers/v2-check-tables';
import {
  FLATTENED,
  NESTED,
  NOT_STORED_HERE,
  NOT_STORED_YET,
  NOT_THIS_STEP,
  RELOCATED,
  RULE_CHECKS,
  GENERATED_STATUS,
  RULES_AT_WRITE,
  RULES_NOT_THIS_STEP,
  TABLE_OF,
  VALUES_NOT_STORED_YET,
} from './helpers/v2-contract-storage';

/**
 * The contract (packages/types/src/v2) against the migrated schema: every field of every entity this
 * step stores has a column, with the contract's nullability; every enum the contract places at a
 * column has a CHECK with exactly the enum's values; every enum and every rule is accounted for.
 *
 * Nothing here restates the contract. Fields, enums and rules are read from the zod schemas, the
 * `ENTITIES` list and the `RULES` registry, so a contract change (CC-12b's, say) turns this red
 * until the schema follows. What IS declared here is how this step stores the contract: which table
 * holds which entity, the one flattened and the one relocated object, where nested enums sit, and
 * which rules are CHECKs, in helpers/v2-contract-storage.ts. Each declaration is compared with what
 * the contract and catalog say. A rule CHECK's logic is compared with the contract's own rule in
 * v2-003-rule-agreement.test.ts (same values, same verdict), and v2-003-check-tables.test.ts breaks
 * each one alone, two-way rules in both directions.
 */

// ─── Reading the zod schemas ──────────────────────────────────────────────────────────────────────

type Schema = unknown;
interface Def {
  type: string;
  shape?: Record<string, Schema>;
  innerType?: Schema;
  element?: Schema;
  options?: Schema[];
  entries?: Record<string, string>;
  values?: unknown[];
  format?: string;
  checks?: { _zod: { def: { check?: string; value?: unknown } } }[];
}
const def = (s: Schema): Def => (s as { _zod: { def: Def } })._zod.def;
const enumId = (s: Schema): string | undefined =>
  (v2Registry.get(s as never) as { id: string } | undefined)?.id;

/** The schema types this file understands; anything else throws, so it cannot slip past. */
const KNOWN = new Set([
  'string',
  'number',
  'boolean',
  'literal',
  'null',
  'enum',
  'object',
  'array',
  'union',
  'nullable',
  'optional',
]);
function known(s: Schema): Def {
  const d = def(s);
  if (!KNOWN.has(d.type)) throw new Error(`contract guard: unhandled schema type "${d.type}"`);
  return d;
}

/**
 * A union entity's discriminator (FixEvent.kind) is a single-value literal in each option. Merged,
 * those literals are the field's value set, which the column's CHECK must equal like an enum's.
 */
const literalSet = (values: string[]): Schema => ({
  _zod: { def: { type: 'literalset', values } },
});

function unwrapNullable(s: Schema): { schema: Schema; nullable: boolean } {
  let nullable = false;
  let cur = s;
  for (;;) {
    const d = known(cur);
    if (d.type === 'nullable') nullable = true;
    else if (d.type !== 'optional') return { schema: cur, nullable };
    cur = d.innerType!;
  }
}

/** The fields of an object schema, or of every option of a union of objects (FixEvent). */
function fieldsOf(s: Schema): Map<string, { schema: Schema; nullable: boolean }> {
  const d = known(s);
  if (d.type === 'object') {
    return new Map(Object.entries(d.shape!).map(([k, v]) => [k, unwrapNullable(v)]));
  }
  if (d.type === 'union') {
    const opts = d.options!.map(fieldsOf);
    const keys = new Set(opts.flatMap((o) => [...o.keys()]));
    return new Map(
      [...keys].map((k) => {
        const present = opts.map((o) => o.get(k)).filter((x) => x !== undefined);
        const literals = present.every((p) => def(p.schema).type === 'literal');
        return [
          k,
          {
            schema: literals
              ? literalSet(present.flatMap((p) => def(p.schema).values as string[]))
              : present[0]!.schema,
            nullable: present.length < opts.length || present.some((p) => p.nullable),
          },
        ];
      }),
    );
  }
  throw new Error(`not an object or union of objects: ${d.type}`);
}

/** Every enum id reachable from `s`. */
function enumsBelow(s: Schema): Set<string> {
  const out = new Set<string>();
  const walk = (x: Schema) => {
    const d = known(x);
    if (d.type === 'enum') {
      const id = enumId(x);
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

/** The value set a column must CHECK: an enum's, an array of enum's, or a union discriminator's. */
function valueSet(s: Schema): string[] | null {
  const d = def(s);
  if (d.type === 'literalset') return [...(d.values as string[])].sort();
  if (d.type === 'literal') return [...(d.values as string[])].sort();
  const target = d.type === 'array' ? def(d.element!) : d;
  return target.type === 'enum' ? Object.values(target.entries!).sort() : null;
}

/** The largest value a z.int() allows, when it declares one. */
function maxOf(d: Def): number | undefined {
  for (const c of d.checks ?? []) {
    const cd = c._zod.def;
    if (cd.check === 'less_than' && typeof cd.value === 'number') return cd.value;
  }
  return undefined;
}

/**
 * The Postgres types that hold a contract value without loss. Counts with no declared bound are
 * integer or bigint: integer caps them at 2^31 − 1, which the spec states.
 */
function columnTypesFor(s: Schema): string[] {
  const d = def(s);
  switch (d.type) {
    case 'literalset':
    case 'enum':
      return ['text'];
    case 'literal':
      // A string literal (AccessTest.method 'GET') is a one-value set; no other kind sits at a column.
      if ((d.values as unknown[]).every((v) => typeof v === 'string')) return ['text'];
      throw new Error('contract guard: a non-string literal at a column');
    case 'string':
      if (d.format === 'uuid') return ['uuid'];
      if (d.format === 'datetime') return ['timestamp with time zone'];
      if (d.format === 'date') return ['date'];
      return ['text'];
    case 'boolean':
      return ['boolean'];
    case 'number': {
      if (d.format !== 'safeint') return ['double precision'];
      const max = maxOf(d);
      return max !== undefined && max <= 32767
        ? ['smallint', 'integer', 'bigint']
        : ['integer', 'bigint'];
    }
    case 'array': {
      const el = unwrapNullable(d.element!).schema;
      const e = def(el);
      if (e.type === 'enum' || (e.type === 'string' && e.format !== 'uuid')) return ['text[]'];
      if (e.type === 'string' && e.format === 'uuid') return ['uuid[]'];
      return ['jsonb'];
    }
    case 'object':
    case 'union':
      return ['jsonb'];
    default:
      throw new Error(`no column type for a contract ${d.type}`);
  }
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
      if (NOT_STORED_YET[at]) continue;
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
/** Every enum CHECK on a single column: 'table.column' → the value set of each. */
let enumChecks = new Map<string, string[][]>();

async function readEnumChecks(d: PGlite): Promise<Map<string, string[][]>> {
  const out = new Map<string, string[][]>();
  const tables = new Set([...Object.values(TABLE_OF), ...Object.values(RELOCATED)]);
  for (const t of tables) {
    for (const k of await constraints(d, t)) {
      const set = enumSetOf(k.def);
      if (!set || k.columns.length !== 1) continue;
      const key = `${t}.${k.columns[0]}`;
      out.set(key, [...(out.get(key) ?? []), set]);
    }
  }
  return out;
}

/**
 * The columns whose enum CHECKs are not exactly the contract's value set (less the values declared
 * not stored yet), and how many columns were compared.
 */
function valueSetMismatches(checks: Map<string, string[][]>): {
  wrong: string[];
  compared: number;
} {
  const wrong: string[] = [];
  let compared = 0;
  for (const b of bindings()) {
    const want = valueSet(b.schema);
    if (!want) continue;
    compared++;
    const got = checks.get(`${b.table}.${b.column}`) ?? [];
    const pending = VALUES_NOT_STORED_YET[`${b.table}.${b.column}`] ?? [];
    const now = want.filter((v) => !pending.includes(v));
    if (got.length === 0 || got.some((g) => JSON.stringify(g) !== JSON.stringify(now)))
      wrong.push(
        `${b.at} → ${b.table}.${b.column}: CHECKs ${JSON.stringify(got)}, contract ${JSON.stringify(want)}`,
      );
  }
  return { wrong, compared };
}

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  const { rows } = await db.query<{ t: string; c: string; notnull: boolean; type: string }>(
    `select c.relname as t, a.attname as c, a.attnotnull as notnull, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped`,
  );
  for (const r of rows) columns.set(`${r.t}.${r.c}`, { notnull: r.notnull, type: r.type });
  enumChecks = await readEnumChecks(db);
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
    expect(
      Object.keys(RULES).filter((r) => !all.includes(r)),
      'unclassified rules',
    ).toEqual([]);
    expect(
      all.filter((r) => !(r in RULES)),
      'classified rules the contract does not have',
    ).toEqual([]);
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
      .map(
        (b) =>
          `${b.at}: contract ${b.nullable ? 'nullable' : 'required'}, column ${b.nullable ? 'NOT NULL' : 'nullable'}`,
      );
    expect(wrong).toEqual([]);
  });

  it('of a type that holds the contract’s values without loss', () => {
    const wrong: string[] = [];
    for (const b of bindings()) {
      const type = columns.get(`${b.table}.${b.column}`)?.type;
      const want = columnTypesFor(b.schema);
      if (!type || !want.includes(type))
        wrong.push(`${b.at} → ${b.table}.${b.column}: ${type}, want ${want.join(' or ')}`);
    }
    expect(wrong).toEqual([]);
  });

  it('Seat.client_scope is seats.client_scope_all with seat_sites', () => {
    expect(columns.get('seats.client_scope_all')).toEqual({ notnull: true, type: 'boolean' });
    expect(columns.has('seat_sites.seat_id') && columns.has('seat_sites.site_id')).toBe(true);
  });
});

describe('every value set the contract places at a column has CHECKs with exactly its values', () => {
  it('enum, array-of-enum and union-discriminator columns: at least one CHECK, and every one exact', () => {
    const { wrong, compared } = valueSetMismatches(enumChecks);
    expect(wrong).toEqual([]);
    expect(compared, 'anti-vacuity: the contract places value sets at columns').toBeGreaterThan(20);
  });

  it('a CHECK missing one contract value is reported: site_fixes.type without hreflang_gap', async () => {
    const narrowed = (await db.clone()) as PGlite;
    try {
      const values = FixTypeSchema.options.filter((v) => v !== 'hreflang_gap');
      await narrowed.exec(`alter table public.site_fixes drop constraint site_fixes_type_check;
        alter table public.site_fixes add constraint site_fixes_type_check
          check (type in (${values.map((v) => `'${v}'`).join(', ')}));`);
      const { wrong } = valueSetMismatches(await readEnumChecks(narrowed));
      expect(wrong).toHaveLength(1);
      expect(wrong[0]).toMatch(/^Fix\.type → site_fixes\.type: /);
    } finally {
      await narrowed.close();
    }
  });

  it('the union discriminator FixEvent.kind is one of them', () => {
    const kind = bindings().find((b) => b.at === 'FixEvent.kind')!;
    expect(valueSet(kind.schema)).toEqual([
      'marked_done',
      'reopened',
      'unable_to_verify',
      'verified',
    ]);
  });

  it('the enums nested in jsonb columns are exactly the declared ones, where declared', () => {
    const nested = new Map<string, Set<string>>();
    for (const b of bindings()) {
      if (valueSet(b.schema)) continue;
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
    const stale = Object.keys(NOT_STORED_HERE).filter(
      (id) => checked.has(id) || NESTED[id] || !ids.includes(id),
    );
    expect(stale, 'declared not-stored but stored, or not an enum').toEqual([]);
  });
});

describe('fields and values declared as not stored yet', () => {
  it('each is a field of its entity, and none has a column yet, under its name or flattened', () => {
    const wrong = Object.keys(NOT_STORED_YET).flatMap((at) => {
      const [name, field] = at.split('.') as [string, string];
      const entity = ENTITIES.find((e) => e.name === name);
      if (!entity || !fieldsOf(entity.schema).has(field)) return [`${at}: not a contract field`];
      const table = TABLE_OF[name];
      if (FLATTENED[at] || RELOCATED[at]) return [`${at}: declared flattened or relocated`];
      if (!table) return [];
      // Stored under its own name, or flattened into `<field>_<key>` columns as Site.schedule is.
      const stored = [...columns.keys()].filter(
        (c) => c === `${table}.${field}` || c.startsWith(`${table}.${field}_`),
      );
      return stored.map((c) => `${at}: ${c} exists`);
    });
    expect(wrong).toEqual([]);
  });

  it("each value is the contract's at that column, and its CHECK does not hold it yet", () => {
    const wrong: string[] = [];
    for (const [at, values] of Object.entries(VALUES_NOT_STORED_YET)) {
      const b = bindings().find((x) => `${x.table}.${x.column}` === at);
      const want = b ? valueSet(b.schema) : undefined;
      for (const v of values) {
        if (!want?.includes(v)) wrong.push(`${at}: ${v} is not a contract value there`);
        if ((enumChecks.get(at) ?? []).some((g) => g.includes(v)))
          wrong.push(`${at}: the CHECK already holds ${v}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('every rule declared as a CHECK is one', () => {
  it('the constraint is a CHECK on the declared table', async () => {
    const missing: string[] = [];
    for (const [rule, { table, constraint }] of Object.entries(RULE_CHECKS)) {
      if (!(await constraints(db, table)).some((c) => c.name === constraint))
        missing.push(`${rule} → ${table}.${constraint}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('every status declared as generated is a generated column', () => {
  it('generated, on the declared table', async () => {
    const missing: string[] = [];
    for (const at of Object.keys(GENERATED_STATUS)) {
      const [table, column] = at.split('.') as [string, string];
      const { rows } = await db.query<{ g: string }>(
        `select attgenerated as g from pg_attribute
          where attrelid = ('public.' || $1)::regclass and attname = $2`,
        [table, column],
      );
      if (rows[0]?.g !== 's') missing.push(at);
    }
    expect(missing).toEqual([]);
  });
});
