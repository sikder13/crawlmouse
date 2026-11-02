import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { ENTITIES, FixEventSchema, PacketFrameworkSchema } from '@crawlmouse/types/v2';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import { constraints } from './helpers/v2-check-tables';
import { FLATTENED, RELOCATED, RULE_CHECKS, TABLE_OF } from './helpers/v2-contract-storage';

/**
 * Each contract rule held as a CHECK gives the same verdict as the contract's own rule, on the same
 * values. For every rule in RULE_CHECKS, starting from a contract fixture record of the rule's entity:
 *   - the fields the CHECK reads take every combination of their domains: an enum's values, both
 *     booleans, up to six distinct values the fixtures hold, null where the contract allows it, the
 *     extras below; a flattened object (Site.schedule) takes every combination of its subfields'
 *     domains;
 *   - against each of those, every other field of the entity whose domain is small (an enum, a
 *     boolean, or a nullable field: null and a fixture value) takes each of its values in turn, one
 *     field at a time, so a contract rule that starts reading another field disagrees somewhere;
 * and for every record the test compares the contract (does parsing it report that rule id?) with the
 * database (does the constraint's own definition, read from the catalog, refuse the row?). Every rule
 * must see both verdicts. What it does not vary: two other fields at once, and values the domains do
 * not hold (inside a jsonb document, for one).
 *
 * fix_events_kind_fields is compared the same way with the FixEvent union, whose option for each kind
 * says which of check_id and by_seat_id it carries.
 */

type Rec = Record<string, unknown>;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(HERE, '../lib/fixtures/v2');
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Record<string, unknown>);

const entity = (name: string) => ENTITIES.find((e) => e.name === name)!;
const recordsOf = (name: string): Rec[] =>
  fixtures.flatMap((d) => (d[entity(name).collection!] as Rec[] | undefined) ?? []);

/** The entity whose rule a table's CHECK holds, and how a contract record becomes that table's row. */
function binding(table: string): {
  entity: string;
  row: (r: Rec) => Rec;
  field: (col: string) => string;
} {
  const relocated = Object.entries(RELOCATED).find(([, t]) => t === table);
  if (relocated) {
    const [ent, sub] = relocated[0].split('.') as [string, string];
    return { entity: ent, row: (r) => (r[sub] as Rec | null) ?? {}, field: (c) => `${sub}.${c}` };
  }
  const ent = Object.entries(TABLE_OF).find(([, t]) => t === table)![0];
  if (ent === 'Site') {
    return {
      entity: ent,
      row: (r) => {
        const sch = r.schedule as Rec | null;
        const { schedule: _s, client_report: _c, paused, ...rest } = r;
        return {
          ...rest,
          schedule_cadence: sch?.cadence ?? null,
          schedule_iso_weekday: sch?.iso_weekday ?? null,
          schedule_hour_local: sch?.hour_local ?? null,
          paused_reason: paused ? 'trial_ended' : null,
        };
      },
      field: (c) => (c.startsWith('schedule_') ? 'schedule' : c),
    };
  }
  return { entity: ent, row: (r) => r, field: (c) => c };
}

// ─── Domains ──────────────────────────────────────────────────────────────────────────────────────

type Def = {
  type: string;
  innerType?: unknown;
  shape?: Record<string, unknown>;
  entries?: Record<string, string>;
};
const def = (s: unknown): Def => (s as { _zod: { def: Def } })._zod.def;
function fieldSchema(root: unknown, path: string): { schema: unknown; nullable: boolean } {
  let cur: unknown = root;
  let nullable = false;
  for (const key of path.split('.')) {
    while (['nullable', 'optional'].includes(def(cur).type)) cur = def(cur).innerType;
    cur = def(cur).shape![key];
    nullable = false;
    while (['nullable', 'optional'].includes(def(cur).type)) {
      nullable = nullable || def(cur).type === 'nullable';
      cur = def(cur).innerType;
    }
  }
  return { schema: cur, nullable };
}

const get = (r: Rec, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Rec | null)?.[k], r);
function set(r: Rec, path: string, v: unknown): Rec {
  const out = structuredClone(r);
  const keys = path.split('.');
  let cur = out;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Rec;
  cur[keys.at(-1)!] = v;
  return out;
}

/** Values that break a rule the fixtures only ever satisfy. */
function extras(rule: string): Record<string, unknown[]> {
  const packet = recordsOf('Fix')
    .map((f) => f.packet as Rec | null)
    .find((p) => p !== null)!;
  const other = PacketFrameworkSchema.options.find((f) => f !== packet.framework)!;
  const effect = recordsOf('Fix')[0]!.effect as Rec;
  const table: Record<string, Record<string, unknown[]>> = {
    packet_framework: {
      packet: [
        { ...packet, frameworks: [other] },
        { ...packet, frameworks: [packet.framework] },
        { ...packet, frameworks: [packet.framework, other] },
      ],
    },
    effect_pending: {
      effect: [
        { ...effect, ai_readability: null, ai_readability_pending_on: [] },
        { ...effect, ai_readability: 3, ai_readability_pending_on: ['0123456789abcdef'] },
      ],
    },
    schedule_timed: {
      schedule: [
        { cadence: 'on_deploy', iso_weekday: 1, hour_local: 6 },
        { cadence: 'weekly', iso_weekday: null, hour_local: null },
      ],
    },
    schedule_pair: {
      schedule: [
        { cadence: 'weekly', iso_weekday: 1, hour_local: null },
        { cadence: 'on_deploy', iso_weekday: null, hour_local: 6 },
      ],
    },
  };
  return table[rule] ?? {};
}

/** An enum's values, both booleans, or (otherwise) up to `cap` distinct fixture values. */
function scalarValues(entityName: string, path: string, schema: unknown, cap: number): unknown[] {
  const d = def(schema);
  if (d.type === 'enum') return Object.values(d.entries!);
  if (d.type === 'boolean') return [true, false];
  const seen = new Map<string, unknown>();
  for (const r of recordsOf(entityName)) {
    const v = get(r, path);
    if (v !== undefined && v !== null && seen.size < cap) seen.set(JSON.stringify(v), v);
  }
  return [...seen.values()];
}

function domain(entityName: string, path: string, rule: string): unknown[] {
  const { schema, nullable } = fieldSchema(entity(entityName).schema, path);
  const d = def(schema);
  const values: unknown[] = [];
  if (FLATTENED[`${entityName}.${path}`]) {
    // Every combination of the subfields' own domains.
    const keys = Object.keys(d.shape!);
    const subs = keys.map((k) => {
      const sub = fieldSchema(entity(entityName).schema, `${path}.${k}`);
      return [
        ...scalarValues(entityName, `${path}.${k}`, sub.schema, 2),
        ...(sub.nullable ? [null] : []),
      ];
    });
    for (const combo of product(subs))
      values.push(Object.fromEntries(keys.map((k, i) => [k, combo[i]])));
  } else if (d.type === 'enum') values.push(...Object.values(d.entries!));
  else if (d.type === 'boolean') values.push(true, false);
  else {
    const seen = new Map<string, unknown>();
    for (const r of recordsOf(entityName)) {
      const v = get(r, path);
      if (v !== undefined && v !== null && seen.size < 6) seen.set(JSON.stringify(v), v);
    }
    values.push(...seen.values());
  }
  if (nullable) values.push(null);
  values.push(...(extras(rule)[path] ?? []));
  return values;
}

function* product(lists: unknown[][]): Generator<unknown[]> {
  if (lists.length === 0) return yield [];
  for (const head of lists[0]!) for (const tail of product(lists.slice(1))) yield [head, ...tail];
}

/** The client_report half of unkept_audit is report_schedules' foreign key, tested in v2-003-check-tables. */
const BASE: Record<string, (r: Rec) => boolean> = {
  unkept_audit: (r) => r.client_report === null,
  client_report_cadence: (r) => r.client_report !== null,
};

// ─── The comparison ───────────────────────────────────────────────────────────────────────────────

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);

/** The CHECK's verdict on many rows, in one query. */
async function refusedByEach(table: string, constraint: string, rows: Rec[]): Promise<boolean[]> {
  const c = (await constraints(db, table)).find((k) => k.name === constraint)!;
  const expr = c.def.replace(/^CHECK /, '');
  const res = await db.query<{ ok: boolean }>(
    `select coalesce(${expr}, true) as ok
       from jsonb_populate_recordset(null::public.${table}, $1::jsonb) with ordinality as t
      order by ordinality`,
    [JSON.stringify(rows)],
  );
  return res.rows.map((x) => !x.ok);
}

async function refusedBy(table: string, constraint: string, row: Rec): Promise<boolean> {
  const c = (await constraints(db, table)).find((k) => k.name === constraint)!;
  const expr = c.def.replace(/^CHECK /, '');
  const { rows } = await db.query<{ ok: boolean }>(
    `select coalesce(${expr}, true) as ok from jsonb_populate_record(null::public.${table}, $1::jsonb) t`,
    [JSON.stringify(row)],
  );
  return !rows[0]!.ok;
}

const reports = (schema: unknown, value: unknown, rule: string): boolean => {
  const res = (
    schema as {
      safeParse(v: unknown): {
        success: boolean;
        error?: { issues: { params?: { rule?: string } }[] };
      };
    }
  ).safeParse(value);
  return !res.success && res.error!.issues.some((i) => i.params?.rule === rule);
};

describe('each rule CHECK refuses exactly the rows the contract’s rule refuses', () => {
  for (const [rule, { table, constraint }] of Object.entries(RULE_CHECKS)) {
    it(`${rule} (${table}.${constraint})`, async () => {
      const { entity: ent, row, field } = binding(table);
      const schema = entity(ent).schema;
      const base = recordsOf(ent).find(BASE[rule] ?? (() => true))!;
      const c = (await constraints(db, table)).find((k) => k.name === constraint)!;
      const fields = [...new Set(c.columns.map(field))];
      const domains = fields.map((f) => domain(ent, f, rule));
      // The other fields of the entity (or of the relocated object) whose domain is small.
      const prefix = fields[0]!.includes('.') ? fields[0]!.split('.')[0]! + '.' : '';
      const container = prefix ? fieldSchema(schema, prefix.slice(0, -1)).schema : schema;
      const others: [string, unknown[]][] = [];
      for (const k of Object.keys(def(container).shape!)) {
        const path = prefix + k;
        if (fields.includes(path) || (!prefix && RELOCATED[`${ent}.${k}`])) continue;
        const { schema: fs, nullable } = fieldSchema(schema, path);
        const t = def(fs).type;
        if (t === 'enum' || t === 'boolean') others.push([path, scalarValues(ent, path, fs, 1)]);
        else if (nullable) others.push([path, [...scalarValues(ent, path, fs, 1), null]]);
      }
      const variants: Rec[] = [base];
      for (const [path, values] of others)
        for (const v of values) variants.push(set(base, path, v));
      const records: { rec: Rec; label: string }[] = [];
      for (const [vi, variant] of variants.entries())
        for (const combo of product(domains))
          records.push({
            rec: fields.reduce((r, f, i) => set(r, f, combo[i]), variant),
            label: `variant ${vi}, ${JSON.stringify(Object.fromEntries(fields.map((f, i) => [f, combo[i]])))}`,
          });
      const database = await refusedByEach(
        table,
        constraint,
        records.map((x) => row(x.rec)),
      );
      const disagreements: string[] = [];
      const seen = new Set<boolean>();
      records.forEach(({ rec, label }, i) => {
        const contract = reports(schema, rec, rule);
        seen.add(contract);
        if (contract !== database[i])
          disagreements.push(
            `${label}: contract ${contract ? 'refuses' : 'accepts'}, CHECK ${database[i] ? 'refuses' : 'accepts'}`,
          );
      });
      expect(records.length, 'records compared').toBeGreaterThan(
        domains.reduce((n, d) => n * d.length, 1),
      );
      expect(disagreements.slice(0, 10), `${disagreements.length} disagreements`).toEqual([]);
      expect([...seen].sort(), 'both verdicts seen').toEqual([false, true]);
    });
  }

  it('fix_events_kind_fields: the FixEvent option for each kind', async () => {
    const check = '00000000-0000-4000-8000-0000000000c1';
    const seat = '00000000-0000-4000-8000-0000000000e1';
    const base = {
      id: '00000000-0000-4000-8000-0000000000f1',
      fix_id: '00000000-0000-4000-8000-0000000000f2',
      at: '2026-10-20T06:00:00Z',
    };
    const kinds = ['marked_done', 'verified', 'unable_to_verify', 'reopened'];
    const disagreements: string[] = [];
    const seen = new Set<boolean>();
    for (const [kind, checkId, seatId] of product([
      kinds,
      [null, check],
      [null, seat],
    ]) as Generator<[string, string | null, string | null]>) {
      const event: Rec = { ...base, kind };
      if (checkId !== null) event.check_id = checkId;
      if (kind === 'marked_done' || seatId !== null) event.by_seat_id = seatId;
      const contract = !FixEventSchema.safeParse(event).success;
      const database = await refusedBy('fix_events', 'fix_events_kind_fields', {
        ...base,
        kind,
        check_id: checkId,
        by_seat_id: seatId,
      });
      seen.add(contract);
      if (contract !== database)
        disagreements.push(
          `${kind} check=${checkId !== null} seat=${seatId !== null}: contract ${contract}, CHECK ${database}`,
        );
    }
    expect(disagreements).toEqual([]);
    expect([...seen].sort()).toEqual([false, true]);
  });
});
