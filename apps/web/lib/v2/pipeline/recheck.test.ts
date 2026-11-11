import { isDeepStrictEqual } from 'node:util';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import { FixSchema, type BatchResult, type Fix, type FixEvent } from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { loadCheck } from './load';
import { pageVantage, persistBuiltCheck, readOfFixes } from './persist';
import { pgliteCheckReader, pglitePersistDb, seedRunning, seedSite } from './test-support/pglite';
import { FIRST, ROBOTS_ADDED, SECOND, secondCrawl, secondInput } from './test-support/second-check';
import type { CheckDataset, PersistOutcome } from './types';

/**
 * The re-check path of the one writer (D5): the second check of a site. Persisting it takes the paths
 * a first check does not: the site's fixes are upserted over the rows the first check wrote, fix
 * events are appended to theirs, its changes name the first check, and the check row's
 * previous_check_id is written.
 *
 * The first check is the engine's build of the recorded site. The second is built from it as the
 * pipeline builds one (`previous` is the first check with its diff inputs; `fixes` and `events` are
 * the first check's), over the recorded crawl with one more link: from the homepage to the planted
 * orphan, so its orphan fix resolves. On that crawl robots.txt has gained a group and four product
 * pages answer with an empty title, so two of its changes fill fields its resolved fixes' changes
 * leave empty: the robots.txt change its cause (the lines added), and Technical SEO's fall from B+ to
 * B its grade delta.
 * The expected rows are the builder's own output for both checks, computed here without a database.
 *
 * The second check leaves out the recorded access batches (the new link moves the access sample, which
 * the recorded batches no longer match), so it ends partial and its crawler-access fix is
 * indeterminate. The new link's anchor is generic and one recorded edge is flagged js_only, so the two
 * flags of link_edges differ on its rows.
 *
 * Where a fix's column holds the same value on both checks, the re-check's upsert writing it and not
 * writing it leave the same row. The last describe persists the second check over a copy of the
 * database whose fix rows hold, in each column but id and site_id, a value the second build does not
 * hold, and reads every column back.
 */

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Timestamps as instants (the database writes them in its own spelling); everything else as it is. */
function normalize(v: unknown): unknown {
  if (typeof v === 'string' && ISO.test(v)) return Date.parse(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}
const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const vantageOf = (batches: readonly unknown[]) =>
  pageVantage((batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : [])));

let first: BuiltCheck;
let second: BuiltCheck;
let db: PGlite;
/** A copy of `db` taken after the first check was persisted, for the last describe. */
let afterFirst: PGlite | undefined;
let written: PersistOutcome;
let loaded: CheckDataset;
/** What persisting the two checks threw, kept for the first test below to name. */
let refused: unknown = null;
const orphanFix = () => first.fixes.find((f) => f.type === 'orphan_pages')!;

beforeAll(async () => {
  const recorded = recordedBuild();
  first = buildCheck(recorded);
  second = buildCheck(secondInput(first));
  db = await freshDb();
  await applyAllMigrations(db);
  await seedSite(db, recorded.site);
  await seedRunning(db, recorded.check);
  try {
    await persistBuiltCheck(pglitePersistDb(db), {
      built: first,
      vantage: vantageOf(recorded.batches),
      map_path: null,
      read: [],
    });
    afterFirst = (await db.clone()) as PGlite;
    await seedRunning(db, secondInput(first).check);
    written = await persistBuiltCheck(pglitePersistDb(db), {
      built: second,
      vantage: vantageOf(secondCrawl()),
      map_path: null,
      read: readOfFixes(first.fixes, first.fix_events),
    });
    loaded = await loadCheck(pgliteCheckReader(db), SECOND);
  } catch (error) {
    refused = error;
  }
}, 120_000);
afterAll(async () => {
  await db?.close();
  await afterFirst?.close();
});

describe('the second check the builder made (what this file relies on)', () => {
  it('resolves the orphan fix: verified_resolved, not_detected, a verified event, a resolved change naming the first check', () => {
    const fix = second.fixes.find((f) => f.id === orphanFix().id)!;
    expect(orphanFix()).toMatchObject({ status: 'open', last_state: 'detected' });
    expect(fix).toMatchObject({
      status: 'verified_resolved',
      last_state: 'not_detected',
      last_measured_check_id: SECOND,
      first_seen_check_id: FIRST,
    });
    expect(second.fix_events).toContainEqual(
      expect.objectContaining({ fix_id: fix.id, kind: 'verified', check_id: SECOND }),
    );
    expect(second.changes).toContainEqual(
      expect.objectContaining({ fix_id: fix.id, kind: 'resolved', previous_check_id: FIRST }),
    );
    expect(second.check).toMatchObject({ previous_check_id: FIRST, status: 'partial' });
    expect(first.fix_events).toEqual([]);
  });

  it('has link edges with each flag set alone', () => {
    const flags = (e: { is_generic_anchor: boolean; js_only: boolean }) =>
      `${e.is_generic_anchor}/${e.js_only}`;
    expect(new Set(second.link_edges.map(flags))).toEqual(
      new Set(['false/false', 'true/false', 'false/true']),
    );
  });

  it('has a change quoting robots.txt’s added lines as its cause, and one with Technical SEO’s B+ → B', () => {
    expect(second.changes).toContainEqual(
      expect.objectContaining({
        subject: 'crawler_access',
        where: 'robots.txt',
        cause: expect.objectContaining({ diff: { removed: [], added: ROBOTS_ADDED } }),
      }),
    );
    expect(second.changes).toContainEqual(
      expect.objectContaining({
        subject: 'grade',
        grade_deltas: [
          expect.objectContaining({ grade: 'technical_seo', from_grade: 'B+', to_grade: 'B' }),
        ],
      }),
    );
    // The builder writes `notified` null on a change (`row`, packages/engine/src/v2/diff/changes.ts),
    // so no change here carries one.
    expect(second.changes.map((c) => c.notified)).toEqual(second.changes.map(() => null));
  });
});

describe('the second check, persisted over the first and read back', () => {
  it('is written, every fix upserted', () => {
    expect(refused).toBeNull();
    expect(written).toMatchObject({
      written: true,
      counts: {
        fixes: second.fixes.length,
        fix_events: second.fix_events.length,
        changes: second.changes.length,
      },
    });
    expect(second.fixes.length).toBeGreaterThan(0); // anti-vacuity
  });

  it('is the builder’s check, page results, link edges, access tests and changes', () => {
    expect(normalize(loaded.checks)).toEqual(normalize([second.check]));
    expect(normalize(loaded.page_results)).toEqual(normalize(second.page_results));
    expect(normalize(loaded.link_edges)).toEqual(normalize(second.link_edges));
    expect(normalize(loaded.access_tests)).toEqual(normalize(byId(second.access_tests)));
    expect(normalize(byId(loaded.changes))).toEqual(normalize(byId(second.changes)));
    expect(loaded.usage_events).toEqual([]);
    expect(loaded.sites).toEqual([recordedBuild().site]);
  });

  it('holds the site’s fixes as the two checks left them, and the events of both', async () => {
    const asLeft = new Map<string, Fix>(first.fixes.map((f) => [f.id, f]));
    for (const f of second.fixes) asLeft.set(f.id, f);
    expect(normalize(loaded.fixes)).toEqual(
      normalize([...asLeft.values()].sort((a, b) => a.number - b.number)),
    );
    const events: FixEvent[] = [...first.fix_events, ...second.fix_events];
    expect(normalize(byId(loaded.fix_events))).toEqual(normalize(byId(events)));
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.site_fixes where site_id = $1`,
      [second.check.site_id],
    );
    expect(rows[0]!.n).toBe(asLeft.size);
  });

  it('flips the orphan fix in its row, with its event and its change', () => {
    const id = orphanFix().id;
    expect(loaded.fixes.find((f) => f.id === id)).toMatchObject({
      status: 'verified_resolved',
      last_state: 'not_detected',
      last_measured_check_id: SECOND,
      first_seen_check_id: FIRST,
    });
    expect(loaded.fix_events).toContainEqual(
      expect.objectContaining({ fix_id: id, kind: 'verified', check_id: SECOND }),
    );
    expect(loaded.changes).toContainEqual(
      expect.objectContaining({ fix_id: id, kind: 'resolved', previous_check_id: FIRST }),
    );
    expect(loaded.checks[0]!.previous_check_id).toBe(FIRST);
  });

  it('reads the lineages the first check wrote, which the second names', () => {
    expect(second.lineages.grading.id).toBe(first.lineages.grading.id);
    expect(normalize(byId(loaded.lineages))).toEqual(
      normalize(byId([first.lineages.grading, first.lineages.fetching])),
    );
  });
});

// ─── Every column of the upsert, over rows holding none of the build's values ────────────────────

type Row = Record<string, unknown>;

/** A check id no check has: the sentinel of the two check-id columns. */
const NO_CHECK = '5e5e5e5e-0000-4000-8000-00000000005e';
/**
 * The sentinel of a column, as SQL, by the column's type. A text sentinel names its row's id, so the
 * fingerprints stay distinct ((site_id, fingerprint) is unique). Whether the second build holds one
 * of them is the first test's to say, cell by cell.
 */
const SENTINEL: Readonly<Record<string, string>> = {
  text: `'sentinel:' || id::text`,
  int4: '-1',
  uuid: `'${NO_CHECK}'::uuid`,
  _text: `array['sentinel']`,
  jsonb: `'{"sentinel": true}'::jsonb`,
};
/** A column name, as the overwrite below interpolates it. */
const NAME = /^[a-z_]+$/;

/** site_fixes' columns, read from the catalog. */
async function fixColumns(on: PGlite): Promise<{ name: string; type: string }[]> {
  const { rows } = await on.query<{ name: string; type: string }>(
    `select column_name as name, udt_name as type from information_schema.columns
      where table_schema = 'public' and table_name = 'site_fixes' order by ordinal_position`,
  );
  return rows;
}

/** The site's fix rows, every column, as PostgREST would serialise them. */
async function fixRows(on: PGlite): Promise<Row[]> {
  const { rows } = await on.query<{ row: Row }>(
    `select to_jsonb(f) as row from public.site_fixes f where f.site_id = $1 order by f.id`,
    [second.check.site_id],
  );
  return rows.map((r) => r.row);
}

/** Each column of each row whose value is not that of the built fix with the row's id. */
function differences(rows: readonly Row[], fixes: readonly Fix[], columns: readonly string[]) {
  const built = new Map<unknown, Row>(fixes.map((f) => [f.id, f]));
  return rows.flatMap((row) =>
    columns
      .filter((column) => !isDeepStrictEqual(row[column], built.get(row.id)?.[column]))
      .map((column) => ({
        id: row.id,
        column,
        stored: row[column],
        built: built.get(row.id)?.[column],
      })),
  );
}

describe('the second check, persisted over fix rows holding none of its values', () => {
  let columns: string[] = [];
  /** Every column but id and site_id: what the overwrite set. */
  let overwritten: string[] = [];
  let sentinelRows: Row[] = [];
  let outcome: PersistOutcome | undefined;
  let rewritten: Row[] = [];
  let failed: unknown = null;

  beforeAll(async () => {
    try {
      if (!afterFirst) throw new Error('no copy of the database after the first check');
      const copy = afterFirst;
      // The CHECKs and the two check-id foreign keys would refuse the sentinels; this copy drops them.
      await copy.exec(`
        do $$
        declare
          v_name name;
        begin
          for v_name in
            select c.conname from pg_catalog.pg_constraint c
             where c.conrelid = 'public.site_fixes'::regclass
               and (c.contype = 'c'
                    or (c.contype = 'f' and c.confrelid = 'public.checks'::regclass))
          loop
            execute pg_catalog.format('alter table public.site_fixes drop constraint %I', v_name);
          end loop;
        end;
        $$;`);
      const catalog = await fixColumns(copy);
      columns = catalog.map((c) => c.name);
      const kept = ['id', 'site_id'];
      const set = catalog
        .filter((c) => !kept.includes(c.name))
        .map(({ name, type }) => {
          const value = SENTINEL[type];
          if (!NAME.test(name) || value === undefined)
            throw new Error(`no sentinel for site_fixes.${name} (${type})`);
          return `"${name}" = ${value}`;
        });
      overwritten = columns.filter((c) => !kept.includes(c));
      await copy.query(`update public.site_fixes set ${set.join(', ')} where site_id = $1`, [
        second.check.site_id,
      ]);
      sentinelRows = await fixRows(copy);
      await seedRunning(copy, secondInput(first).check);
      outcome = await persistBuiltCheck(pglitePersistDb(copy), {
        built: second,
        vantage: vantageOf(secondCrawl()),
        map_path: null,
        read: readOfFixes(first.fixes, first.fix_events),
      });
      rewritten = await fixRows(copy);
    } catch (error) {
      failed = error;
    }
  }, 120_000);

  it('starts from rows holding, in each column but id and site_id, a value the second build does not', () => {
    expect(failed).toBeNull();
    // The table's columns are the contract's fields, so comparing columns compares every field.
    expect([...columns].sort()).toEqual(Object.keys(FixSchema.shape).sort());
    // The build names every fix row of the site: the upsert writes each of them.
    expect(sentinelRows.map((r) => r.id)).toEqual(byId(second.fixes).map((f) => f.id));
    expect(differences(sentinelRows, second.fixes, ['id', 'site_id'])).toEqual([]);
    expect(differences(sentinelRows, second.fixes, overwritten)).toHaveLength(
      sentinelRows.length * overwritten.length,
    );
  });

  it('writes every column of every fix row as the second build has it', () => {
    expect(failed).toBeNull();
    expect(outcome).toMatchObject({ written: true, counts: { fixes: second.fixes.length } });
    expect(rewritten.map((r) => r.id)).toEqual(byId(second.fixes).map((f) => f.id));
    expect(differences(rewritten, second.fixes, columns)).toEqual([]);
  });
});
