/**
 * CC-11 — the v2 contract test.
 *
 * Fails whenever a schema and a fixture drift apart. Four groups:
 *   1. every fixture parses, and every required field in it is load-bearing;
 *   2. every v2 enum value and every union option appears in at least one fixture;
 *   3. every field FACTS-proposed.md names is in the contract, read from FACTS itself;
 *   4. the fixtures reconcile with themselves and with the FACTS numbers.
 * Plus: every entity names the screens that read it, and each screen is checked for the phrase.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AccessCauseSchema,
  AgencyBrandingSchema,
  ALL_V2_ENUMS,
  CheckSchema,
  CrawlerResultSchema,
  EffectSchema,
  ENTITIES,
  FixtureDatasetSchema,
  REGISTRY_ONLY_ENUMS,
  V1_PINNED_ENUMS,
  V2_FIXTURE_ENUMS,
  VerdictSchema,
  instant,
  v2Registry,
  type Check,
  type CrawlerResult,
  type FixtureDataset,
} from './index.js';
import {
  allFieldNames,
  arrayElement,
  enumValues,
  isStrictObject,
  ownCheckCount,
  nodes,
  objectShape,
  objectKeys,
  requiredKeyPaths,
  schemaType,
  unionOptions,
  walk,
  type Path,
} from './introspect.js';

const ROOT = new URL('../../../../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');

const FIXTURE_DIR = 'apps/web/lib/fixtures/v2/';
const FIXTURE_NAMES = ['bad-site', 'clean-site', 'challenged-site'] as const;
type FixtureName = (typeof FIXTURE_NAMES)[number];

const raw: Record<FixtureName, unknown> = Object.fromEntries(
  FIXTURE_NAMES.map((name) => [name, JSON.parse(read(`${FIXTURE_DIR}${name}.json`))]),
) as Record<FixtureName, unknown>;

/** Parsed fixtures; a fixture that does not parse is reported by group 1 and skipped elsewhere. */
const parsed: Partial<Record<FixtureName, FixtureDataset>> = {};
for (const name of FIXTURE_NAMES) {
  const result = FixtureDatasetSchema.safeParse(raw[name]);
  if (result.success) parsed[name] = result.data;
}
function fixture(name: FixtureName): FixtureDataset {
  const data = parsed[name];
  if (!data) throw new Error(`${name}.json does not parse; see "every fixture parses"`);
  return data;
}

/**
 * The dataset schema is a strict object of arrays with no refinements of its own (pinned below), so a
 * record fails, or throws, exactly as it does inside the whole dataset. The sweeps parse only the
 * record that holds the path they changed, which keeps them linear in the fixture's size.
 */
const DATASET_SHAPE = objectShape(FixtureDatasetSchema);
function parseRecordAt(data: unknown, path: Path): boolean {
  const [collection, index] = path;
  if (typeof index === 'number' && typeof collection === 'string') {
    const element = arrayElement(DATASET_SHAPE[collection]!)! as z.ZodType;
    return element.safeParse((data as Record<string, unknown[]>)[collection]![index]).success;
  }
  return FixtureDatasetSchema.safeParse(data).success;
}

// ─── 1. Parsing ────────────────────────────────────────────────────────────────────────────────

describe('every fixture parses with its schema', () => {
  it('the fixture folder holds exactly the three contract fixtures', () => {
    const json = readdirSync(new URL(FIXTURE_DIR, ROOT)).filter((f) => f.endsWith('.json'));
    expect(json.sort()).toEqual(FIXTURE_NAMES.map((n) => `${n}.json`).sort());
  });

  it.each(FIXTURE_NAMES)('%s.json parses with FixtureDatasetSchema', (name) => {
    const result = FixtureDatasetSchema.safeParse(raw[name]);
    expect(result.success, result.success ? '' : z.prettifyError(result.error)).toBe(true);
  });

  // A valid fixture parses back unchanged, so a rule body, default or coercion that rewrites a
  // value the fixtures hold fails here.
  it.each(FIXTURE_NAMES)('%s.json parses to exactly itself', (name) => {
    expect(FixtureDatasetSchema.parse(raw[name])).toStrictEqual(raw[name]);
  });

  // zod 4 strips an own "__proto__" key instead of rejecting it, so the schema alone cannot see one.
  it.each(FIXTURE_NAMES)('%s.json carries no __proto__ key at any depth', (name) => {
    const found: string[] = [];
    const go = (v: unknown, path: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => go(x, `${path}/${i}`));
      else if (v && typeof v === 'object') {
        if (Object.hasOwn(v, '__proto__')) found.push(path || '/');
        for (const [k, x] of Object.entries(v)) go(x, `${path}/${k}`);
      }
    };
    go(raw[name], '');
    expect(found).toEqual([]);
  });

  it.each(FIXTURE_NAMES)('%s.json is marked as fixture data, not measurement', (name) => {
    expect((raw[name] as { provenance?: unknown }).provenance).toBe('fixture');
  });
});

describe('every required field is load-bearing', () => {
  // The sweep below asks the schema which keys are required, so it cannot notice a key that has been
  // made optional. This rule is independent of that: no key in the contract is optional; a value that
  // can be absent is written as null, so every record has every key.
  it('the dataset schema adds no rule of its own, so a record can be checked on its own', () => {
    expect(ownCheckCount(FixtureDatasetSchema)).toBe(0);
    const arrays = Object.entries(DATASET_SHAPE).filter(([, f]) => schemaType(f) === 'array');
    expect(arrays.length).toBeGreaterThan(10);
    for (const [name, field] of arrays) expect(ownCheckCount(field), name).toBe(0);
  });

  it('no field anywhere in the contract is optional', () => {
    const optional = [FixtureDatasetSchema, ...ENTITIES.map((e) => e.schema)]
      .flatMap((s) => nodes(s))
      .filter((n) => schemaType(n.schema) === 'optional')
      .map((n) => n.path);
    expect(optional).toEqual([]);
  });

  it('every object anywhere in the contract rejects keys it does not declare', () => {
    const loose = [FixtureDatasetSchema, ...ENTITIES.map((e) => e.schema)]
      .flatMap((s) => nodes(s))
      .filter((n) => schemaType(n.schema) === 'object' && !isStrictObject(n.schema))
      .map((n) => n.path || '(root)');
    expect(loose).toEqual([]);
  });

  it('a literal that allows more than one value cannot hide from enum coverage', () => {
    expect(() => nodes(z.strictObject({ a: z.literal(['x', 'y']) }))).toThrow(
      /multi-value literal/,
    );
  });

  // The named mutation test: delete one required field, the fixture must stop parsing.
  it.each(FIXTURE_NAMES)(
    '%s.json stops parsing when any one required field is deleted',
    (name) => {
      const data = structuredClone(fixture(name)) as unknown;
      const paths = requiredKeyPaths(FixtureDatasetSchema, data);
      expect(paths.length).toBeGreaterThan(100);
      const survivors: string[] = [];
      for (const path of paths) {
        const parent = at(data, path.slice(0, -1)) as Record<string, unknown>;
        const key = path[path.length - 1] as string;
        const saved = parent[key];
        delete parent[key];
        if (parseRecordAt(data, path)) survivors.push(`/${path.join('/')}`);
        parent[key] = saved;
      }
      expect(survivors).toEqual([]);
    },
    120_000,
  );
});

describe('a malformed record is an error, never an exception', () => {
  // Replace each value in a fixture, one at a time, with a value of the wrong shape: safeParse must
  // report it, never throw. (An empty state_history once crashed a refinement this way.)
  const REPLACEMENTS: unknown[] = [null, [], {}, ''];
  it.each(FIXTURE_NAMES)(
    '%s.json: every single-value replacement parses or fails, never throws',
    (name) => {
      const data = structuredClone(raw[name]);
      const paths: Path[] = [];
      const collect = (v: unknown, path: Path): void => {
        if (path.length > 0) paths.push(path);
        if (Array.isArray(v)) v.forEach((x, i) => collect(x, [...path, i]));
        else if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) collect(x, [...path, k]);
        }
      };
      collect(data, []);
      expect(paths.length).toBeGreaterThan(100);
      const threw: string[] = [];
      for (const path of paths) {
        const parent = at(data, path.slice(0, -1)) as Record<string | number, unknown>;
        const key = path[path.length - 1]!;
        const saved = parent[key];
        for (const value of REPLACEMENTS) {
          parent[key] = value;
          try {
            parseRecordAt(data, path);
          } catch (e) {
            threw.push(`/${path.join('/')} := ${JSON.stringify(value)}: ${String(e)}`);
          }
        }
        parent[key] = saved;
      }
      expect(threw).toEqual([]);
    },
    300_000,
  );
});

// ─── 2. Coverage ───────────────────────────────────────────────────────────────────────────────

const seenEnum = new Map<unknown, Set<string>>();
const seenOption = new Map<unknown, Set<number>>();
for (const data of Object.values(parsed)) {
  walk(FixtureDatasetSchema, data, {
    enumValue(schema, value) {
      if (!seenEnum.has(schema)) seenEnum.set(schema, new Set());
      seenEnum.get(schema)!.add(value);
    },
    unionOption(schema, index) {
      if (!seenOption.has(schema)) seenOption.set(schema, new Set());
      seenOption.get(schema)!.add(index);
    },
  });
}
const reachable = nodes(FixtureDatasetSchema);

describe('every enum value appears in at least one fixture', () => {
  it.each(Object.entries(V2_FIXTURE_ENUMS))('%s: every value appears', (_name, schema) => {
    const missing = enumValues(schema).filter((v) => !seenEnum.get(schema)?.has(v));
    expect(missing).toEqual([]);
  });

  it('every enum reachable from the dataset is classified: fixture-covered or pinned to v1', () => {
    const classified = new Set<unknown>([
      ...Object.values(V2_FIXTURE_ENUMS),
      ...Object.values(V1_PINNED_ENUMS),
    ]);
    const stray = reachable
      .filter((n) => schemaType(n.schema) === 'enum' && !classified.has(n.schema))
      .map((n) => n.path);
    expect(stray).toEqual([]);
  });

  it('every enum anywhere in the contract, registry entries included, was created through named()', () => {
    const recorded = new Set<unknown>(ALL_V2_ENUMS);
    const inline = ENTITIES.flatMap((e) =>
      nodes(e.schema)
        .filter((n) => schemaType(n.schema) === 'enum' && !recorded.has(n.schema))
        .map((n) => `${e.name}.${n.path}`),
    );
    expect(inline).toEqual([]);
  });

  it('every fixture-covered enum is reachable from the dataset', () => {
    const reached = new Set(reachable.map((n) => n.schema));
    const unreached = Object.entries(V2_FIXTURE_ENUMS)
      .filter(([, s]) => !reached.has(s))
      .map(([n]) => n);
    expect(unreached).toEqual([]);
  });

  it('every enum the module defines is in exactly one group, and every group entry is one of them', () => {
    const groups = [V2_FIXTURE_ENUMS, V1_PINNED_ENUMS, REGISTRY_ONLY_ENUMS].map(
      (g) => new Set<unknown>(Object.values(g)),
    );
    expect(ALL_V2_ENUMS.length).toBeGreaterThan(30);
    const wrong = ALL_V2_ENUMS.filter((s) => groups.filter((g) => g.has(s)).length !== 1);
    expect(wrong.map((s) => v2Registry.get(s)?.id)).toEqual([]);
    const defined = new Set<unknown>(ALL_V2_ENUMS);
    const foreign = groups.flatMap((g) => [...g]).filter((s) => !defined.has(s));
    expect(foreign).toEqual([]);
  });
});

describe('every union option appears in at least one fixture', () => {
  const unions = reachable.filter((n) => schemaType(n.schema) === 'union');
  it('the contract has unions to cover', () => expect(unions.length).toBeGreaterThan(0));
  it.each(unions.map((n) => [n.path, n.schema] as const))('%s', (_path, schema) => {
    const missing = unionOptions(schema)
      .map((_, i) => i)
      .filter((i) => !seenOption.get(schema)?.has(i));
    expect(missing).toEqual([]);
  });
});

// ─── 3. FACTS-proposed.md ──────────────────────────────────────────────────────────────────────

const FACTS = read('docs/design/v2/FACTS-proposed.md');
const FACTS_CURRENT = withoutOldColumns(FACTS);

describe('every field FACTS-proposed.md names is in the contract', () => {
  it('Verdict is exactly the FACTS verdict vocabulary', () => {
    const line = FACTS.split('\n').find((l) => l.startsWith('Verdict vocabulary'))!;
    const list = line.slice(line.indexOf('states:') + 'states:'.length).split('. ')[0]!;
    const states = [...list.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);
    expect(states).toHaveLength(11);
    expect([...VerdictSchema.options].sort()).toEqual([...states].sort());
  });

  it('every snake_case identifier and JSON key FACTS names outside an Old column is a contract field or enum value', () => {
    const ids = factsIdentifiers(FACTS_CURRENT);
    expect(ids.length).toBeGreaterThan(10);
    const fields = allFieldNames(FixtureDatasetSchema);
    const values = new Set(
      reachable.filter((n) => schemaType(n.schema) === 'enum').flatMap((n) => enumValues(n.schema)),
    );
    expect(ids.filter((id) => !fields.has(id) && !values.has(id))).toEqual([]);
  });

  it('the keys FACTS withdrew from the crawler JSON are not CrawlerResult fields', () => {
    const oldKeys = new Set(
      factsJsonObjects(FACTS)
        .filter((o) => o.keys.includes('ua'))
        .flatMap((o) => o.keys),
    );
    const newKeys = new Set(
      factsJsonObjects(FACTS_CURRENT)
        .filter((o) => o.keys.includes('ua'))
        .flatMap((o) => o.keys),
    );
    const withdrawn = [...oldKeys].filter((k) => !newKeys.has(k));
    expect(withdrawn).toEqual(['pages']);
    expect(withdrawn.filter((k) => objectKeys(CrawlerResultSchema).includes(k))).toEqual([]);
  });

  it('ai_visibility, the grade name FACTS withdrew everywhere, is in no schema', () => {
    expect(factsIdentifiers(FACTS)).toContain('ai_visibility');
    expect(factsIdentifiers(FACTS_CURRENT)).not.toContain('ai_visibility');
    expect(allFieldNames(FixtureDatasetSchema).has('ai_visibility')).toBe(false);
  });

  it('each crawler object in the FACTS Developers JSON fits CrawlerResult', () => {
    const crawlers = factsJsonObjects(FACTS_CURRENT).filter((o) => o.keys.includes('verdict'));
    expect(crawlers.length).toBeGreaterThanOrEqual(2);
    const keys = new Set(objectKeys(CrawlerResultSchema));
    for (const o of crawlers) {
      expect(o.keys.filter((k) => !keys.has(k))).toEqual([]);
      expect(VerdictSchema.options).toContain(o.strings.verdict);
      if (o.strings.cause) expect(AccessCauseSchema.options).toContain(o.strings.cause);
    }
  });

  it('the effect object in the FACTS Developers JSON fits the fix Effect', () => {
    const effects = factsJsonObjects(FACTS_CURRENT).filter((o) => o.afterKey === 'effect');
    expect(effects.length).toBeGreaterThanOrEqual(1);
    const keys = new Set(objectKeys(EffectSchema));
    for (const o of effects) expect(o.keys.filter((k) => !keys.has(k))).toEqual([]);
  });

  it('the grade key in the FACTS Developers JSON is a field of Check', () => {
    expect(FACTS_CURRENT).toContain('"ai_readability": 22');
    expect(objectKeys(CheckSchema)).toContain('ai_readability');
  });

  it('portal_domain, the column FACTS keeps by name, is a field of agency branding', () => {
    expect(FACTS).toContain('`portal_domain`');
    expect(objectKeys(AgencyBrandingSchema)).toContain('portal_domain');
  });
});

// ─── 4. Coherence ──────────────────────────────────────────────────────────────────────────────

/** Every `*_id` / `*_ids` field and where it points. A new id field must be added here. */
const REFERENCES: Record<string, keyof FixtureDataset> = {
  account_id: 'accounts',
  site_id: 'sites',
  staging_of_site_id: 'sites',
  owner_seat_id: 'seats',
  by_seat_id: 'seats',
  check_id: 'checks',
  previous_check_id: 'checks',
  first_seen_check_id: 'checks',
  last_measured_check_id: 'checks',
  last_fired_check_id: 'checks',
  covers_check_ids: 'checks',
  fix_id: 'fixes',
};

describe('every id field in the contract has a reference rule', () => {
  it('the reference map covers every field named *_id or *_ids', () => {
    const idFields = [...allFieldNames(FixtureDatasetSchema)].filter((f) => /_ids?$/.test(f));
    expect(idFields.filter((f) => !(f in REFERENCES)).sort()).toEqual([]);
  });
});

describe.each(FIXTURE_NAMES)('%s.json is coherent', (name) => {
  const data = () => fixture(name);
  const checksById = () => new Map(data().checks.map((c) => [c.id, c]));
  const sitesById = () => new Map(data().sites.map((s) => [s.id, s]));
  const fixesById = () => new Map(data().fixes.map((f) => [f.id, f]));

  it('ids are unique within each collection', () => {
    for (const key of [
      'accounts',
      'seats',
      'sites',
      'checks',
      'access_tests',
      'fixes',
      'fix_events',
      'changes',
      'alert_rules',
      'reports',
    ] as const) {
      const ids = (data()[key] as { id: string }[]).map((e) => e.id);
      expect(new Set(ids).size, key).toBe(ids.length);
    }
    const pages = data().page_results.map((p) => `${p.check_id} ${p.url}`);
    expect(new Set(pages).size).toBe(pages.length);
    const edges = data().link_edges.map((e) => `${e.check_id} ${e.from_url} ${e.to_url}`);
    expect(new Set(edges).size).toBe(edges.length);
  });

  it('every reference resolves to an entity of the right kind', () => {
    const unresolved: string[] = [];
    walkRefs(data(), (field, id, path) => {
      const target = REFERENCES[field];
      if (!target) return;
      const ids = new Set((data()[target] as { id: string }[]).map((e) => e.id));
      if (!ids.has(id)) unresolved.push(`/${path.join('/')} -> ${target} ${id}`);
    });
    for (const seat of data().seats) {
      if (seat.client_scope === 'all') continue;
      for (const id of seat.client_scope) if (!sitesById().has(id)) unresolved.push(`seat ${id}`);
    }
    expect(unresolved).toEqual([]);
  });

  it('every engine_derived pointer resolves to a value in the fixture', () => {
    const unresolved = data().engine_derived.filter((p) => pointer(data(), p) === undefined);
    expect(data().engine_derived.length).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);
  });

  it('every withheld declaration matches what the fixture actually holds', () => {
    for (const w of data().withheld) {
      const held = (data()[w.collection] as { check_id: string }[]).filter(
        (e) => e.check_id === w.check_id,
      ).length;
      expect(held, `${w.collection} of ${w.check_id}`).toBe(w.included);
      expect(w.total).toBeGreaterThanOrEqual(w.included);
      const check = checksById().get(w.check_id)!;
      if (w.collection === 'page_results') expect(w.total).toBe(check.coverage?.pages_crawled);
      if (w.collection === 'link_edges') expect(w.total).toBe(check.structure?.internal_links);
    }
    for (const key of ['page_results', 'link_edges', 'access_tests'] as const) {
      for (const checkId of new Set(data()[key].map((e) => e.check_id))) {
        const declared = data().withheld.some(
          (w) => w.collection === key && w.check_id === checkId,
        );
        expect(declared, `${key} of ${checkId} must declare what it withholds`).toBe(true);
      }
    }
  });

  it('a site belongs to one account and its checks, fixes and changes stay on that site', () => {
    const sites = sitesById();
    const checks = checksById();
    for (const c of data().checks) {
      if (c.previous_check_id) expect(checks.get(c.previous_check_id)?.site_id).toBe(c.site_id);
    }
    for (const f of data().fixes) {
      expect(checks.get(f.first_seen_check_id)?.site_id).toBe(f.site_id);
      expect(checks.get(f.last_measured_check_id)?.site_id).toBe(f.site_id);
    }
    for (const ch of data().changes) {
      expect(checks.get(ch.check_id)?.site_id).toBe(ch.site_id);
      if (ch.fix_id) expect(fixesById().get(ch.fix_id)?.site_id).toBe(ch.site_id);
    }
    for (const ch of data().changes) {
      if (ch.previous_check_id) expect(checks.get(ch.previous_check_id)?.site_id).toBe(ch.site_id);
    }
    for (const r of data().reports) {
      expect(sites.get(r.site_id)?.account_id).toBe(r.account_id);
      for (const id of r.covers_check_ids) expect(checks.get(id)?.site_id, r.id).toBe(r.site_id);
    }
    for (const e of data().fix_events) {
      if (e.kind !== 'marked_done') {
        expect(checks.get(e.check_id)?.site_id, e.id).toBe(fixesById().get(e.fix_id)?.site_id);
      }
    }
    for (const a of data().alert_rules) {
      if (a.site_id) expect(sites.get(a.site_id)?.account_id).toBe(a.account_id);
    }
  });

  it('a mark-done without a seat comes from an audit nobody kept, and a seat marks only its own sites', () => {
    expect(markDoneSeatProblems(data())).toEqual([]);
    // The fixtures hold no seatless mark-done, so the rule is also run on a copy that has one on a
    // kept site, to show the seatless branch can fail.
    const broken = structuredClone(data());
    const marked = broken.fix_events.find((e) => e.kind === 'marked_done');
    if (marked && marked.kind === 'marked_done') {
      marked.by_seat_id = null;
      expect(markDoneSeatProblems(broken)).toEqual([marked.id]);
    }
  });

  it('report page slugs are unique within an agency', () => {
    for (const account of data().accounts) {
      const slugs = data()
        .sites.filter((s) => s.account_id === account.id && s.client_report)
        .map((s) => s.client_report!.page_slug);
      expect(new Set(slugs).size, account.email).toBe(slugs.length);
    }
  });

  it('an account stays inside its own plan limits', () => {
    for (const account of data().accounts) {
      const sites = data().sites.filter((s) => s.account_id === account.id && !s.paused);
      const seats = data().seats.filter((s) => s.account_id === account.id);
      expect(sites.length).toBeLessThanOrEqual(account.limits.sites);
      expect(seats.length).toBeGreaterThanOrEqual(1);
      expect(seats.length).toBeLessThanOrEqual(account.limits.seats);
      expect(seats.filter((s) => s.role === 'owner')).toHaveLength(1);
    }
  });

  it("per-page crawler counts are what the check's own AI crawler verdicts give that page", () => {
    // Of the AI crawlers tested (both AI groups): reached = verdict allowed or allowed_thin for the
    // page's template; reading its text = allowed. A page reachable only through JavaScript is reached
    // by none of them.
    let compared = 0;
    for (const p of data().page_results) {
      if (p.crawlers_reached === null) continue;
      const rows = checksById()
        .get(p.check_id)!
        .crawlers.filter((r) => r.group !== 'search_engine')
        .map((r) => r.by_template.find((t) => t.template_key === p.template_key)?.verdict);
      const reached = p.js_only
        ? 0
        : rows.filter((v) => v === 'allowed' || v === 'allowed_thin').length;
      const reading = p.js_only ? 0 : rows.filter((v) => v === 'allowed').length;
      expect([p.crawlers_reached, p.crawlers_reading_text], p.url).toEqual([reached, reading]);
      compared++;
    }
    expect(compared).toBe(data().page_results.filter((p) => p.crawlers_reached !== null).length);
  });

  it('every grade change on a Change matches the two checks it compares', () => {
    const checks = checksById();
    for (const ch of data().changes) {
      for (const d of ch.grade_deltas) {
        const before = checks.get(ch.previous_check_id ?? '')?.[d.grade];
        const after = checks.get(ch.check_id)?.[d.grade];
        expect(scoreOf(before), `${ch.id} from`).toBe(d.from_score);
        expect(scoreOf(after), `${ch.id} to`).toBe(d.to_score);
        expect(gradeOf(before)).toBe(d.from_grade);
        expect(gradeOf(after)).toBe(d.to_grade);
      }
    }
  });

  it('a fix status agrees with its event history, and events are in order', () => {
    const expected = {
      marked_done: 'marked_done',
      verified: 'verified_resolved',
      unable_to_verify: 'unable_to_verify',
      reopened: 'reopened',
    } as const;
    const queuedAt = (id: string) => instant(checksById().get(id)!.queued_at);
    for (const fix of data().fixes) {
      const events = data().fix_events.filter((e) => e.fix_id === fix.id);
      for (let i = 1; i < events.length; i++) {
        expect(instant(events[i]!.at) > instant(events[i - 1]!.at), `${fix.id} in order`).toBe(
          true,
        );
      }
      const last = events[events.length - 1];
      expect(fix.status, fix.id).toBe(last ? expected[last.kind] : 'open');
      if (last && last.kind !== 'marked_done') {
        expect(queuedAt(last.check_id) <= queuedAt(fix.last_measured_check_id), fix.id).toBe(true);
      }
    }
  });

  it('live fixes on a site have distinct ranks, and fixes have distinct numbers and fingerprints', () => {
    for (const site of data().sites) {
      const fixes = data().fixes.filter((f) => f.site_id === site.id);
      const ranks = fixes.filter((f) => f.status !== 'verified_resolved').map((f) => f.rank);
      expect(new Set(ranks).size, site.host).toBe(ranks.length);
      const numbers = fixes.map((f) => f.number);
      expect(new Set(numbers).size, site.host).toBe(numbers.length);
      const fingerprints = fixes.map((f) => f.fingerprint);
      expect(new Set(fingerprints).size, site.host).toBe(fingerprints.length);
    }
  });

  it('a fix whose AI effect waits on other fixes names fixes that exist on the same site', () => {
    for (const fix of data().fixes) {
      for (const fp of fix.effect.ai_readability_pending_on) {
        const target = data().fixes.find((f) => f.fingerprint === fp);
        expect(target?.site_id, `${fix.id} waits on ${fp}`).toBe(fix.site_id);
      }
    }
  });
});

describe('bad-site.json carries the FACTS numbers', () => {
  const data = () => fixture('bad-site');
  const site = () => data().sites.find((s) => s.host === 'example-outfitter.com')!;
  const checks = () =>
    data()
      .checks.filter((c) => c.site_id === site().id && c.status === 'finished')
      .sort((a, b) => instant(a.queued_at) - instant(b.queued_at));
  const first = () => checks()[0]!;
  const latest = () => checks()[checks().length - 1]!;
  const crawler = (c: Check, ua: string): CrawlerResult => c.crawlers.find((r) => r.ua === ua)!;

  it('the first audit is the sample site of FACTS Part 1', () => {
    const line = FACTS.split('\n').find((l) => l.startsWith('Sample site:'))!;
    const num = (re: RegExp) => Number(line.match(re)![1]!.replace(',', ''));
    expect(first().trigger).toBe('first_audit');
    expect(first().coverage!.pages_crawled).toBe(num(/· (\d+) pages \(/));
    const templates = Object.fromEntries(
      first().coverage!.templates.map((t) => [t.label, t.pages]),
    );
    expect(templates).toEqual({
      Homepage: num(/home (\d+)/),
      Collections: num(/collections (\d+)/),
      Products: num(/products (\d+)/),
      Blog: num(/blog (\d+)/),
    });
    const s = first().structure!;
    expect(s.internal_links).toBe(num(/([\d,]+) internal links/));
    expect(s.orphan_pages).toBe(num(/(\d+) orphan pages/));
    expect(s.js_only_pages).toBe(num(/(\d+) pages reachable only through JavaScript/));
    expect(s.hubs).toBe(num(/(\d+) hubs carry/));
    expect(Math.round(s.hub_pagerank_share * 100)).toBe(num(/hubs carry (\d+)%/));
    expect(s.avg_click_depth).toBe(Number(line.match(/average click depth ([\d.]+)/)![1]));
    expect(Math.round(s.generic_anchor_share * 100)).toBe(num(/(\d+)% generic anchors/));
  });

  it('the scored, unscored and robots-only crawlers are the FACTS I6 sets', () => {
    const line = FACTS.split('\n').find((l) => l.startsWith('Scored crawlers'))!;
    const list = (after: string) =>
      line
        .slice(line.indexOf(after) + after.length)
        .split('.')[0]!
        .split(',')
        .map((t) => t.trim());
    const scored = list('B8 strings): ');
    const unscored = list('your choice"): ');
    const robotsOnly = list('never a live verdict: ');
    for (const c of checks()) {
      expect(
        c.crawlers
          .filter((r) => r.scored)
          .map((r) => r.ua)
          .sort(),
      ).toEqual([...scored].sort());
      expect(
        c.crawlers
          .filter((r) => r.group === 'ai_training')
          .map((r) => r.ua)
          .sort(),
      ).toEqual([...unscored].sort());
      expect(
        c.crawlers
          .filter((r) => r.group === 'search_engine')
          .map((r) => r.ua)
          .sort(),
      ).toEqual([...robotsOnly].sort());
    }
  });

  it('GPTBot is blocked by a UA rule (403, error 1020) and PerplexityBot is challenged, as FACTS says', () => {
    const gpt = factsJsonObjects(FACTS_CURRENT).find((o) => o.strings.ua === 'GPTBot')!;
    const g = crawler(first(), 'GPTBot');
    expect(g.verdict).toBe(gpt.strings.verdict);
    expect(g.cause).toBe(gpt.strings.cause);
    expect(g.status).toBe(403);
    expect(crawler(first(), 'PerplexityBot').verdict).toBe('challenged_ua');
    expect(crawler(first(), 'OAI-SearchBot').verdict).toBe('allowed_thin');
  });

  it('the first audit finds the FACTS fix count, numbered from 1', () => {
    const total = Number(FACTS.match(/Fixes: \*\*(\d+) total/)![1]);
    const found = data().fixes.filter((f) => f.first_seen_check_id === first().id);
    expect(found).toHaveLength(total);
    expect(found.map((f) => f.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
    );
  });

  it('the free three are the three largest open fixes of the latest check (FACTS), so fix 0 joins fixes 1 and 2', () => {
    expect(FACTS).toContain('Free shows the three largest open fixes of the latest check');
    // "Largest" read as estimated points on both grades; an AI effect not yet estimated counts as 0.
    const size = (f: { effect: { technical_seo: number; ai_readability: number | null } }) =>
      f.effect.technical_seo + (f.effect.ai_readability ?? 0);
    const live = data()
      .fixes.filter((f) => f.site_id === site().id && f.rank !== null)
      .sort((a, b) => a.rank! - b.rank!);
    const free = live.filter((f) => f.rank! <= 3);
    expect(free.map((f) => f.number).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    const smallestFree = Math.min(...free.map(size));
    const largestRest = Math.max(...live.filter((f) => f.rank! > 3).map(size));
    expect(smallestFree).toBeGreaterThan(largestRest);
    for (let i = 1; i < live.length; i++) {
      expect(size(live[i]!), `rank ${live[i]!.rank}`).toBeLessThanOrEqual(size(live[i - 1]!));
    }
  });

  it('the Pro fixes of the first audit sum to the overview SEO effects (+2 / +1 / +5)', () => {
    const m = FACTS.match(/must sum to the overview's \+(\d+) \/ \+(\d+) \/ \+(\d+) SEO/)!;
    const target = Number(m[1]) + Number(m[2]) + Number(m[3]);
    const pro = data().fixes.filter((f) => f.first_seen_check_id === first().id && f.number > 3);
    expect(pro.reduce((sum, f) => sum + f.effect.technical_seo, 0)).toBe(target);
  });

  it('Claude-SearchBot, which is scored, carries the 41 to 22 drop; ClaudeBot stays visible and unscored', () => {
    expect(first().ai_readability!.withheld).toBe(false);
    expect(latest().ai_readability).toMatchObject({ withheld: false });
    const before = first().ai_readability as { total: number };
    const after = latest().ai_readability as { total: number };
    expect([before.total, after.total]).toEqual([41, 22]);
    expect(crawler(latest(), 'Claude-SearchBot')).toMatchObject({
      scored: true,
      verdict: 'disallowed_by_robots',
    });
    expect(crawler(latest(), 'ClaudeBot')).toMatchObject({
      scored: false,
      verdict: 'disallowed_by_robots',
    });
    const fix0 = data().fixes.find((f) => f.site_id === site().id && f.number === 0)!;
    expect(fix0.first_seen_check_id).toBe(latest().id);
    expect(fix0.crawler_uas).toEqual(['Claude-SearchBot']);
    expect(fix0.effect.ai_readability).toBe(19);
  });
});

// ─── Screens ───────────────────────────────────────────────────────────────────────────────────

const SCREEN_DIR = 'docs/design/v2/screens/';
const SCREENS = readdirSync(new URL(SCREEN_DIR, ROOT))
  .filter((f) => f.endsWith('.dc.html'))
  .map((f) => f.replace('.dc.html', ''));
const screenText = new Map(SCREENS.map((s) => [s, visibleText(read(`${SCREEN_DIR}${s}.dc.html`))]));

describe('each entity names the screens that read it', () => {
  it('there are 33 locked screens', () => expect(SCREENS).toHaveLength(33));

  it('every locked screen is read by at least one entity', () => {
    const read = new Set(ENTITIES.flatMap((e) => e.readBy.map((r) => r.screen)));
    expect(SCREENS.filter((s) => !read.has(s))).toEqual([]);
  });

  const claims = ENTITIES.flatMap((e) =>
    e.readBy.map((r) => [e.name, r.screen, r.evidence] as const),
  );
  it.each(claims)('%s is read by %s, which shows "%s"', (_entity, screen, evidence) => {
    expect(screenText.get(screen), `no screen named ${screen}`).toBeDefined();
    expect(screenText.get(screen)).toContain(evidence.replace(/\s+/g, ' '));
  });

  it('each entity names the fixture collection whose elements it validates', () => {
    const shape = objectShape(FixtureDatasetSchema);
    for (const e of ENTITIES) {
      if (e.collection === null) continue;
      expect(arrayElement(shape[e.collection]!), e.name).toBe(e.schema);
    }
    const documented = ENTITIES.map((e) => e.collection).filter((c) => c !== null);
    expect(new Set(documented).size).toBe(documented.length);
  });

  it('every field marked as added for a screen exists in its entity and names a real screen', () => {
    const problems: string[] = [];
    for (const e of ENTITIES) {
      const paths = new Set(
        nodes(e.schema).map((n) => n.path.replace(/<\d+>/g, '').replace(/^\./, '')),
      );
      for (const [path, source] of Object.entries(e.addedFor)) {
        if (!paths.has(path)) problems.push(`${e.name}.${path} is not a field`);
        if (source !== 'FACTS' && source !== 'brief' && !SCREENS.includes(source)) {
          problems.push(`${e.name}.${path}: ${source} is no screen`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────────────────────────

function at(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((v, k) => (v as Record<string | number, unknown>)[k], value);
}

/** RFC 6901 JSON pointer. */
function pointer(value: unknown, ptr: string): unknown {
  if (!ptr.startsWith('/')) return undefined;
  let v: unknown = value;
  for (const token of ptr.slice(1).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, key)) return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}

function walkRefs(value: unknown, visit: (field: string, id: string, path: Path) => void): void {
  const go = (v: unknown, path: Path, field: string | null): void => {
    if (Array.isArray(v)) v.forEach((item, i) => go(item, [...path, i], field));
    else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) go(child, [...path, k], k);
    } else if (typeof v === 'string' && field && field !== 'id' && /_ids?$/.test(field)) {
      visit(field, v, path);
    }
  };
  go(value, [], null);
}

/** The mark-done events whose seat does not fit the site: none for a kept site, the site's own account otherwise. */
function markDoneSeatProblems(data: FixtureDataset): string[] {
  const seats = new Map(data.seats.map((s) => [s.id, s]));
  const sites = new Map(data.sites.map((s) => [s.id, s]));
  const fixes = new Map(data.fixes.map((f) => [f.id, f]));
  return data.fix_events
    .filter((e) => e.kind === 'marked_done')
    .filter((e) => {
      if (e.kind !== 'marked_done') return false;
      const site = sites.get(fixes.get(e.fix_id)!.site_id)!;
      if (e.by_seat_id === null) return site.account_id !== null;
      return seats.get(e.by_seat_id)?.account_id !== site.account_id;
    })
    .map((e) => e.id);
}

function scoreOf(grade: unknown): number | null {
  const g = grade as { score?: number | null; total?: number | null } | null | undefined;
  return g?.score ?? g?.total ?? null;
}
function gradeOf(grade: unknown): string | null {
  return (grade as { grade?: string | null } | null | undefined)?.grade ?? null;
}

/** FACTS with every markdown-table "Old" cell blanked: what FACTS currently names. */
function withoutOldColumns(md: string): string {
  const lines = md.split('\n');
  let oldIndex = -1;
  return lines
    .map((line, i) => {
      if (!line.startsWith('|')) {
        oldIndex = -1;
        return line;
      }
      const cells = line.split(/(?<!\\)\|/);
      if (!lines[i - 1]?.startsWith('|')) {
        oldIndex = cells.findIndex((c) => c.trim() === 'Old');
        return line;
      }
      if (oldIndex < 0 || /^\|[\s|-]+\|?$/.test(line)) return line;
      cells[oldIndex] = ' ';
      return cells.join('|');
    })
    .join('\n');
}

function factsIdentifiers(md: string): string[] {
  const ids = new Set<string>();
  for (const m of md.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) ids.add(m[1]!);
  for (const m of md.matchAll(/"([a-z][a-z0-9_]*)"\s*:/g)) ids.add(m[1]!);
  return [...ids].sort();
}

interface FactsObject {
  keys: string[];
  strings: Record<string, string>;
  afterKey: string | null;
}
function factsJsonObjects(md: string): FactsObject[] {
  return [...md.matchAll(/(?:"([a-z_]+)"\s*:\s*)?\{([^{}]*)\}/g)].map((m) => ({
    afterKey: m[1] ?? null,
    keys: [...m[2]!.matchAll(/"([a-z_]+)"\s*:/g)].map((k) => k[1]!),
    strings: Object.fromEntries(
      [...m[2]!.matchAll(/"([a-z_]+)"\s*:\s*"([^"]*)"/g)].map((k) => [k[1]!, k[2]!]),
    ),
  }));
}

/** The text a reader sees: no style or script, tags dropped, entities decoded, spaces collapsed. */
function visibleText(html: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    middot: '·',
    mdash: '—',
    ndash: '–',
    rarr: '→',
    larr: '←',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    hellip: '…',
    times: '×',
    minus: '−',
  };
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => named[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ');
}
